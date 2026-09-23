const fs = require('fs');
let code = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/src/index.ts', 'utf8');

let startIndex = code.indexOf('// 오가닉 1~14위 (키워드 단위 캐시)');
let endIndex = code.indexOf('displayLabel = keyword!;');

if (startIndex > -1 && endIndex > -1) {
  const newLogic = `// 오가닉 1~300위 (키워드 단위 캐시) - List API로 300개 수집하여 모든 지표 추출
      const listItems = await cached(c.env, 'list:' + keyword, KEYWORD_TTL, () => getPlaceList(keyword, { limit: 300 }));
      ranking = listItems.map(i => i.placeId);
      
      if (!ranking || ranking.length === 0) {
        return c.json({ error: '"' + keyword + '" 키워드의 검색 결과를 찾을 수 없습니다.' }, 404);
      }

      const myRankIndex = ranking.indexOf(placeId);
      myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;
      
      // 내 매장 정보에 순위를 추가 업데이트
      myStore.rank = myRank;

      const top10Items = listItems.slice(0, TOP_N).filter(i => i.placeId !== placeId);
      if (top10Items.length === 0) {
        return c.json({ error: '비교할 경쟁사가 없습니다.' }, 404);
      }
      
      competitors = top10Items.map(item => ({
        placeId: item.placeId,
        name: item.name,
        category: item.category,
        roadAddress: item.roadAddress,
        coordinates: { x: item.x, y: item.y },
        rank: item.rank,
        seoMetrics: {
          visitorReviewsTotal: item.visitorReviewCount,
          visitorReviewsScore: item.visitorReviewScore || 0,
          cafeBlogReviewsTotal: item.blogCafeReviewCount,
          saveCount: item.saveCountMin || 0,
          bookmarkCount: 0,
          textReviewsTotal: 0,
          hasTalktalk: item.hasTalktalk,
          hasSmartCall: false,
          photoCount: item.imageCount,
          menuCount: 0,
          totalVoteCount: 0,
          descriptionLength: 0,
          hasReviewPenalty: false,
          isNewOpening: false,
          hasNaverBooking: item.hasBooking,
          hasSmartOrder: false,
          couponCount: 0,
          reviewMediasTotal: 0,
          isGoodStore: false,
          isOpenNow: false,
          isBizHourMissing: false,
          isMenuImageMissing: false,
          isAccessorMissing: false,
          isDescriptionMissing: false,
          isConveniencesMissing: false,
        }
      }));

      const boundaryItem = listItems[TOP_N - 1] && listItems[TOP_N - 1].placeId !== placeId ? listItems[TOP_N - 1] : listItems[TOP_N];
      boundaryStore = boundaryItem ? competitors.find(s => s.placeId === boundaryItem.placeId) || {
        placeId: boundaryItem.placeId,
        name: boundaryItem.name,
        category: boundaryItem.category,
        roadAddress: boundaryItem.roadAddress,
        coordinates: { x: boundaryItem.x, y: boundaryItem.y },
        rank: boundaryItem.rank,
        seoMetrics: {
          visitorReviewsTotal: boundaryItem.visitorReviewCount,
          visitorReviewsScore: boundaryItem.visitorReviewScore || 0,
          cafeBlogReviewsTotal: boundaryItem.blogCafeReviewCount,
          saveCount: boundaryItem.saveCountMin || 0
        }
      } : null;
      `;
  code = code.substring(0, startIndex) + newLogic + code.substring(endIndex);
}

// Add 'saveCount' to metricKeys
code = code.replace("['photoCount', false],", "['photoCount', false],\n      ['saveCount', false],");

fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/index.ts', code);
