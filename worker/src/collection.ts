/** Shared Naver transport. No response bodies or credentials are logged. */
export type CollectionCode = 'RATE_LIMITED' | 'BLOCKED' | 'UPSTREAM_HTTP' | 'TIMEOUT' | 'NETWORK' | 'PARSE_CHANGED';
export type CollectionFailureSource = 'upstream_http' | 'upstream_content' | 'host_cooldown' | 'keyword_cooldown' | 'network' | 'timeout' | 'parse' | 'unknown';

export class CollectionError extends Error {
  constructor(
    public code: CollectionCode,
    public stage: string,
    public upstreamStatus?: number,
    public failureSource: CollectionFailureSource = 'unknown',
    public retryAfterUtc?: string,
    public cooldownUntilUtc?: string,
    public keywordCooldownUntilUtc?: string,
    public retryAfterSeconds?: string,
    public keywordCooldownIndefinite?: boolean,
  ) {
    super(code === 'PARSE_CHANGED'
      ? '네이버 응답에서 필요한 정보를 확인하지 못했습니다. 전화번호 또는 공유주소로 검색해 보시거나 잠시 후 다시 시도해주세요.'
      : '네이버 정보 수집이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    this.name = 'CollectionError';
  }
}

// Isolate-local protection, not a distributed lock. Independent Worker instances
// can still overlap; a shared scheduler is a separate deployment decision.
const pending = new Map<string, Promise<string>>();
const cooldowns = new Map<string, { until: number; retryAfterUtc?: string; retryAfterSeconds?: string }>();
let nextStart = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type CollectionFailureDetails = {
  failureSource?: CollectionFailureSource;
  retryAfterUtc?: string;
  cooldownUntilUtc?: string;
  keywordCooldownUntilUtc?: string;
  retryAfterSeconds?: string;
  keywordCooldownIndefinite?: boolean;
};

export function collectionFailure(code: CollectionCode, stage: string, status?: number, details: CollectionFailureDetails = {}): CollectionError {
  const failureSource = details.failureSource || (status != null ? 'upstream_http'
    : code === 'PARSE_CHANGED' ? 'parse' : code === 'TIMEOUT' ? 'timeout'
      : code === 'NETWORK' ? 'network' : 'unknown');
  console.error(JSON.stringify({ event: 'naver_collection_failure', code, stage, failureSource,
    upstreamStatus: status ?? null, retryAfterUtc: details.retryAfterUtc ?? null,
    cooldownUntilUtc: details.cooldownUntilUtc ?? null, keywordCooldownUntilUtc: details.keywordCooldownUntilUtc ?? null,
    retryAfterSeconds: details.retryAfterSeconds ?? null, keywordCooldownIndefinite: details.keywordCooldownIndefinite ?? false,
    at: new Date().toISOString() }));
  return new CollectionError(code, stage, status, failureSource, details.retryAfterUtc, details.cooldownUntilUtc,
    details.keywordCooldownUntilUtc, details.retryAfterSeconds, details.keywordCooldownIndefinite);
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  const header = value?.trim();
  if (!header) return undefined;
  let timestamp: number;
  if (/^\d+$/.test(header)) {
    const seconds = BigInt(header);
    const remainingMs = BigInt(Math.max(0, Math.floor(8.64e15 - now)));
    if (seconds * 1000n > remainingMs) return Number.POSITIVE_INFINITY;
    timestamp = now + Number(seconds * 1000n);
  } else {
    timestamp = Date.parse(header);
  }
  if (timestamp === Number.POSITIVE_INFINITY) return timestamp;
  if (!Number.isFinite(timestamp) || timestamp > 8.64e15 || timestamp < now) return undefined;
  return timestamp;
}

export async function naverHtml(url: string, stage: string, headers: HeadersInit = {}, redirectOnly = false, body?: string): Promise<string> {
  const requestKey = `${redirectOnly ? 'redirect:' : 'html:'}${url}:${body || ''}`;
  const existing = pending.get(requestKey);
  if (existing) return existing;
  const host = new URL(url).hostname;
  const task = (async () => {
    const delay = Math.max(0, nextStart - Date.now());
    nextStart = Date.now() + delay + 1000;
    if (delay) await sleep(delay);
    const hostCooldown = cooldowns.get(host);
    if (hostCooldown && hostCooldown.until > Date.now()) {
      throw collectionFailure('RATE_LIMITED', stage, undefined, {
        failureSource: 'host_cooldown', retryAfterUtc: hostCooldown.retryAfterUtc,
        cooldownUntilUtc: Number.isFinite(hostCooldown.until) ? new Date(hostCooldown.until).toISOString() : undefined,
        retryAfterSeconds: hostCooldown.retryAfterSeconds,
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal, redirect: redirectOnly ? 'manual' : 'follow',
        ...(body ? { method: 'POST', body } : {}) });
      if (redirectOnly && res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) throw collectionFailure('PARSE_CHANGED', stage, res.status);
        return location;
      }
      if (!res.ok) {
        const code = res.status === 429 ? 'RATE_LIMITED' : res.status === 403 ? 'BLOCKED' : 'UPSTREAM_HTTP';
        let retryAfterUtc: string | undefined;
        let retryAfterSeconds: string | undefined;
        let cooldownUntilUtc: string | undefined;
        if (res.status === 429 || res.status === 403) {
          const now = Date.now();
          const retryHeader = res.headers.get('Retry-After')?.trim();
          const retryAt = parseRetryAfter(retryHeader || null, now);
          const cooldownUntil = retryAt == null ? now + 60_000 : Math.max(now + 60_000, retryAt);
          retryAfterUtc = retryAt == null || !Number.isFinite(retryAt) ? undefined : new Date(retryAt).toISOString();
          retryAfterSeconds = retryHeader && /^\d+$/.test(retryHeader) ? retryHeader : undefined;
          cooldownUntilUtc = Number.isFinite(cooldownUntil) ? new Date(cooldownUntil).toISOString() : undefined;
          cooldowns.set(host, { until: cooldownUntil, retryAfterUtc, retryAfterSeconds });
        }
        await res.body?.cancel();
        throw collectionFailure(code, stage, res.status, { retryAfterUtc, cooldownUntilUtc, retryAfterSeconds });
      }
      const html = await res.text();
      // Merely containing an ncaptcha script is NOT proof of a challenge.
      if (/<title[^>]*>[^<]*(?:captcha|접근\s*제한|접속\s*차단|보안\s*확인)/i.test(html)) {
        const cooldownUntil = Date.now() + 60000;
        cooldowns.set(host, { until: cooldownUntil });
        throw collectionFailure('BLOCKED', stage, res.status, {
          failureSource: 'upstream_content', cooldownUntilUtc: new Date(cooldownUntil).toISOString(),
        });
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
