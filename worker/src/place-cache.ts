import { resolvePlaceId, scrapeFullPlaceMetrics } from './scraper';

const pending = new Map<string, Promise<any>>();
const TTL = 86400;
type CacheEnv = { CACHE?: KVNamespace };

async function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const task = work();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

/** Resolve aliases once; cache by canonical ID and requested completeness. */
export async function cachedPlace(env: CacheEnv, query: string, includeFeed = false): Promise<any> {
  const input = query.trim();
  const aliasKey = `place-id:v1:${input}`;
  const id = /^[1-9]\d{6,11}$/.test(input) ? input : await once(aliasKey, async () => {
    const hit = await env.CACHE?.get(aliasKey);
    if (hit) return hit;
    const resolved = await resolvePlaceId(input);
    await env.CACHE?.put(aliasKey, resolved, { expirationTtl: TTL });
    return resolved;
  });
  const key = `place:v10:${id}:${includeFeed ? 'feed' : 'home'}`;
  const result = await once(key, async () => {
    const hit = await env.CACHE?.get(key, 'json');
    if (hit) return hit;
    const fresh = await scrapeFullPlaceMetrics(id, includeFeed);
    fresh.collectedAt = new Date().toISOString();
    await env.CACHE?.put(key, JSON.stringify(fresh), { expirationTtl: TTL });
    if (includeFeed) {
      await env.CACHE?.put(`place:v10:${id}:home`, JSON.stringify(fresh), { expirationTtl: TTL });
    }
    return fresh;
  });
  // Callers add keyword-specific rankFactors. Never share a mutable result.
  return structuredClone(result);
}
