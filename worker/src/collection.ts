/** Shared Naver transport. No response bodies or credentials are logged. */
export type CollectionCode = 'RATE_LIMITED' | 'BLOCKED' | 'UPSTREAM_HTTP' | 'TIMEOUT' | 'NETWORK' | 'PARSE_CHANGED';
export class CollectionError extends Error {
  constructor(public code: CollectionCode, public stage: string, public upstreamStatus?: number) {
    super(code === 'PARSE_CHANGED'
      ? '네이버 응답에서 필요한 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'
      : '네이버 정보 수집이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    this.name = 'CollectionError';
  }
}

// Isolate-local protection, not a distributed lock. Independent Worker instances
// can still overlap; a shared scheduler is a separate deployment decision.
const pending = new Map<string, Promise<string>>();
const cooldowns = new Map<string, number>();
let nextStart = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function collectionFailure(code: CollectionCode, stage: string, status?: number): CollectionError {
  console.error(JSON.stringify({ event: 'naver_collection_failure', code, stage, upstreamStatus: status, at: new Date().toISOString() }));
  return new CollectionError(code, stage, status);
}

export async function naverHtml(url: string, stage: string, headers: HeadersInit = {}, redirectOnly = false): Promise<string> {
  const requestKey = `${redirectOnly ? 'redirect:' : 'html:'}${url}`;
  const existing = pending.get(requestKey);
  if (existing) return existing;
  const host = new URL(url).hostname;
  const task = (async () => {
    const delay = Math.max(0, nextStart - Date.now());
    nextStart = Date.now() + delay + 1000;
    if (delay) await sleep(delay);
    if ((cooldowns.get(host) || 0) > Date.now()) throw new CollectionError('RATE_LIMITED', stage);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal, redirect: redirectOnly ? 'manual' : 'follow' });
      if (redirectOnly && res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) throw collectionFailure('PARSE_CHANGED', stage, res.status);
        return location;
      }
      if (!res.ok) {
        const code = res.status === 429 ? 'RATE_LIMITED' : res.status === 403 ? 'BLOCKED' : 'UPSTREAM_HTTP';
        if (res.status === 429 || res.status === 403) {
          const retry = res.headers.get('Retry-After');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
          cooldowns.set(host, Date.now() + Math.min(Math.max(seconds, 60), 900) * 1000);
        }
        await res.body?.cancel();
        throw collectionFailure(code, stage, res.status);
      }
      const html = await res.text();
      // Merely containing an ncaptcha script is NOT proof of a challenge.
      if (/<title[^>]*>[^<]*(?:captcha|접근\s*제한|접속\s*차단|보안\s*확인)/i.test(html)) {
        cooldowns.set(host, Date.now() + 60000);
        throw collectionFailure('BLOCKED', stage, res.status);
      }
      return html;
    } catch (err) {
      if (err instanceof CollectionError) throw err;
      throw collectionFailure(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', stage);
    } finally {
      clearTimeout(timer);
    }
  })();
  pending.set(requestKey, task);
  try { return await task; } finally { pending.delete(requestKey); }
}
