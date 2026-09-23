const fs = require('fs');
let html = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/public/index.html', 'utf8');

const oldHtml = `            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span class="text-slate-400 block text-[10px]">대표메뉴</span>
                <span id="previewMenu" class="font-bold text-white"></span>
              </div>
              <div class="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span id="previewKeywordLabel" class="text-slate-400 block text-[10px]">인기키워드</span>
                <span id="previewKeyword" class="font-bold text-amber-400"></span>
              </div>
            </div>`;
const newHtml = `            <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 flex items-center justify-center">
              <span id="previewRankText" class="font-bold text-emerald-400 text-sm"></span>
            </div>`;
html = html.replace(oldHtml, newHtml);

// Populate previewRankText in JS
const oldJs = `document.getElementById('previewKeyword').innerText = topKeyword;`;
const newJs = `// document.getElementById('previewKeyword').innerText = topKeyword;
      const rankStr = my.rank ? my.rank + '위' : '순위권 밖';
      document.getElementById('previewRankText').innerText = "'" + data.targetKeyword + "' 현재 " + rankStr;`;
html = html.replace(oldJs, newJs);

// Find 'boundaryCards' logic to add '저장갯수' card
const cardsIdx = html.indexOf("renderBoundaryCard('영수증 리뷰',");
const saveCardHtml = `
      // 저장갯수 카드 추가 (업종별로 0이면 표시 안 함)
      if (stats.saveCount && (stats.saveCount.avg > 0 || Number(my.seoMetrics.saveCount) > 0)) {
        cardsHtml += renderBoundaryCard('저장갯수', Number(my.seoMetrics.saveCount) || 0, stats.saveCount.avg, stats.saveCount.boundary, false);
      }
`;
html = html.substring(0, cardsIdx) + saveCardHtml + html.substring(cardsIdx);

fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/public/index.html', html);
