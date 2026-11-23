import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export function parseContent(md) {
  const blocks = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim().split(/^##\s+/m);
  const answer = blocks.shift().trim();
  const sections = [], faqs = [];
  for (const block of blocks) {
    const split = block.indexOf('\n');
    const h = (split < 0 ? block : block.slice(0, split)).trim();
    const body = split < 0 ? '' : block.slice(split + 1).trim();
    if (h === '자주 묻는 질문') {
      for (const match of body.matchAll(/^Q\.\s*([\s\S]*?)\s+A\.\s*([\s\S]*?)(?=\nQ\.\s|(?![\s\S]))/gm)) {
        faqs.push({ q: match[1].trim(), a: match[2].trim() });
      }
      assert.equal(faqs.length, (body.match(/^Q\./gm) || []).length, 'Unparsed FAQ');
    } else sections.push({ h, paragraphs: body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean) });
  }
  return { answer, sections, faqs };
}

assert.equal(parseContent('## 제목\n\n본문').answer, '');
assert.equal(parseContent('도입\n\n## 제목\n본문').answer, '도입');
assert.deepEqual(parseContent('## 자주 묻는 질문\nQ. 질문\nA. 답\n다음 줄').faqs, [{q:'질문', a:'답\n다음 줄'}]);
const root = new URL('../', import.meta.url);
const mapping = JSON.parse(readFileSync(new URL('data/page-places.json', root), 'utf8'));
const content = {};
for (const slug of Object.keys(mapping)) {
  const md = readFileSync(new URL(`data/content/${slug}.md`, root), 'utf8');
  content[slug] = parseContent(md);
  assert.ok(content[slug].sections.length && content[slug].faqs.length === 3, slug);
}
assert.equal(Object.keys(content).length, 15);
writeFileSync(new URL('data/content.json', root), JSON.stringify(content, null, 2) + '\n');
console.log(`Built ${Object.keys(content).length} articles: ${fileURLToPath(new URL('data/content.json', root))}`);
