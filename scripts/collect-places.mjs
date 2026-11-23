import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import assert from 'node:assert/strict';

export const keywords = ['안산 철거', '안산 상가철거', '안산 원상복구', '안산 폐업철거', '안산 사무실철거', '안산 단원구 철거', '안산 상록구 철거', '군포 철거', '군포 상가철거', '시흥 철거', '시흥 상가철거', '철거업체'];
const out = fileURLToPath(new URL('../data/places/', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const integer = v => v == null || String(v).trim() === '' ? null : (Number.isFinite(Number(String(v).replace(/,/g, ''))) ? Number(String(v).replace(/,/g, '')) : null);

export function parsePlaces(html) {
  const marker = /window\.__APOLLO_STATE__\s*=\s*\{/.exec(html);
  if (!marker) throw new Error('PARSE_CHANGED: window.__APOLLO_STATE__ missing');
  const from = marker.index + marker[0].length - 1;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('PARSE_CHANGED: unbalanced Apollo JSON');
  const state = JSON.parse(html.slice(from, end));
  const items = [];
  // shortcut: 기존 수집기와 같은 객체 키 순서이며 깊은 순위는 검증되지 않았다.
  for (const value of Object.values(state)) {
    if (!value || typeof value !== 'object') continue;
    const type = value.__typename;
    if (typeof type !== 'string' || !('saveCount' in value || 'visitorReviewCount' in value)) continue;
    if (/Ad(Summary|Item)$/.test(type) || !value.id || !value.name) continue;
    items.push({ rank: items.length + 1, placeId: String(value.id), name: value.name,
      category: value.category ?? null, visitorReviewCount: integer(value.visitorReviewCount),
      blogCafeReviewCount: integer(value.blogCafeReviewCount), totalReviewCount: integer(value.totalReviewCount),
      saveCountRaw: value.saveCount ?? null, roadAddress: value.roadAddress ?? null,
      hasBooking: value.hasBooking ?? null });
    if (items.length === 50) break;
  }
  return items;
}

function selfTest() {
  // 합성 파서 테스트 전용. 실측 산출물에는 저장하지 않는다.
  const state = { ad: { __typename: 'PlaceAdSummary', id: 'a', name: 'ad', saveCount: '1' },
    first: { __typename: 'Place', id: 'b', name: 'brace } and " quote \\', visitorReviewCount: '1,234', saveCount: '120+' },
    secondAd: { __typename: 'PlaceAdItem', id: 'c', name: 'ad', visitorReviewCount: 1 },
    second: { __typename: 'Place', id: 'd', name: 'second', visitorReviewCount: '' } };
  const items = parsePlaces(`window.__APOLLO_STATE__=${JSON.stringify(state)}; trailing {}`);
  assert.deepEqual(items.map(x => [x.placeId, x.rank]), [['b', 1], ['d', 2]]);
  assert.equal(items[0].visitorReviewCount, 1234);
  assert.equal(items[0].saveCountRaw, '120+');
  assert.equal(items[1].visitorReviewCount, null);
  assert.equal(items[1].hasBooking, null);
  assert.throws(() => parsePlaces('window.__APOLLO_STATE__ = {'));
  assert.throws(() => parsePlaces('missing'));
  console.log('parser self-test: PASS');
}

async function collect(keyword) {
  const sourceUrl = `https://pcmap.place.naver.com/place/list?${new URLSearchParams({ query: keyword })}`;
  const result = { keyword, collectedAt: null, status: 'failed', sourceUrl, attempts: [], items: [] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    let retry = false;
    const at = new Date().toISOString();
    try {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000), headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://map.naver.com/', 'Accept-Language': 'ko-KR,ko;q=0.9',
      } });
      const html = await response.text();
      retry = [403, 429].includes(response.status) || (!html.includes('window.__APOLLO_STATE__') && /captcha|접근.*제한|비정상적인 접근|access denied/i.test(html));
      if (!response.ok || retry) throw new Error(`HTTP ${response.status} ${response.statusText}\n${html}`);
      result.items = parsePlaces(html);
      result.collectedAt = new Date().toISOString();
      result.status = 'success';
      result.attempts.push({ attempt, at, status: response.status });
      break;
    } catch (error) {
      result.attempts.push({ attempt, at, error: inspect(error, { depth: 8 }) });
      // 전송 계층 차단은 우회하지 않는다. HTTP 차단만 정해진 1회 재시도한다.
      if (!retry || attempt === 2) break;
      console.log(`${keyword}: blocked; waiting 60 seconds before final retry`);
      await sleep(60000);
    }
  }
  return result;
}

async function main() {
  await mkdir(out, { recursive: true });
  const results = [];
  for (const [i, keyword] of keywords.entries()) {
    if (i) await sleep(4000 + Math.floor(Math.random() * 2001));
    const result = await collect(keyword);
    await writeFile(resolve(out, `${keyword.replaceAll(' ', '-')}.json`), JSON.stringify(result, null, 2) + '\n');
    results.push(result);
    console.log(`${keyword}: ${result.status}, ${result.items.length} places`);
  }
  const cell = v => v == null ? '' : String(v).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
  let summary = '# 플레이스 수집 결과\n\n순위는 광고를 제외한 Apollo 객체 키 순서입니다. 검색 위치·시점에 따라 달라지며 깊은 순위는 검증되지 않았습니다. 빈 값은 확인 불가이며 0과 다릅니다. 저장수는 원문입니다.\n\n| 키워드 | 결과 | 업체 수 | 수집 시각(UTC) |\n|---|---|---:|---|\n';
  summary += results.map(r => `| ${r.keyword} | ${r.status} | ${r.items.length} | ${r.collectedAt ?? '확인 불가'} |`).join('\n');
  for (const r of results) {
    summary += `\n\n## ${r.keyword}\n\n출처: ${r.sourceUrl}\n`;
    if (!r.items.length) summary += '\n수집 0건: 상위 10곳 표를 만들지 않음.\n';
    else summary += '\n| 순위 | 업체명 | 카테고리 | 방문리뷰 | 블로그리뷰 | 저장수 | 주소 | placeId |\n|---:|---|---|---:|---:|---|---|---|\n' + r.items.slice(0, 10).map(p => `| ${[p.rank,p.name,p.category,p.visitorReviewCount,p.blogCafeReviewCount,p.saveCountRaw,p.roadAddress,p.placeId].map(cell).join(' | ')} |`).join('\n') + '\n';
    for (const a of r.attempts.filter(a => a.error)) summary += `\n시도 ${a.attempt} (${a.at}):\n\n\`\`\`text\n${a.error}\n\`\`\`\n`;
  }
  await writeFile(resolve(out, 'SUMMARY.md'), summary);
}

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
