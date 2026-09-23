const fs = require('fs');
let code = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/src/index.ts', 'utf8');

const targetStr = `myStore.rank = myRank;`;
const insertStr = `
      myStore.rank = myRank;
      
      const myListItem = listItems.find(i => i.placeId === placeId);
      if (myListItem) {
        myStore.seoMetrics.visitorReviewsTotal = Math.max(myStore.seoMetrics.visitorReviewsTotal || 0, myListItem.visitorReviewCount || 0);
        myStore.seoMetrics.cafeBlogReviewsTotal = Math.max(myStore.seoMetrics.cafeBlogReviewsTotal || 0, myListItem.blogCafeReviewCount || 0);
        myStore.seoMetrics.saveCount = Math.max(myStore.seoMetrics.saveCount || 0, myListItem.saveCountMin || 0);
        myStore.seoMetrics.visitorReviewsScore = myListItem.visitorReviewScore || myStore.seoMetrics.visitorReviewsScore || 0;
        myStore.seoMetrics.photoCount = Math.max(myStore.seoMetrics.photoCount || 0, myListItem.imageCount || 0);
      }
`;

if (code.includes(targetStr) && !code.includes('myListItem.visitorReviewCount')) {
  code = code.replace(targetStr, insertStr);
  fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/src/index.ts', code);
}
