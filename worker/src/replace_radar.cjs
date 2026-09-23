const fs = require('fs');
let html = fs.readFileSync('c:/project/대행사 에이젼시 기획/worker/public/index.html', 'utf8');

// 1. Change radarPanelTitle text
html = html.replace('내 매장 vs 상위 6개 평균', '내 매장 vs 상위 10개 평균');

// 2. Change radar chart datasets
const oldRadarCode = `
      radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: ['영수증 리뷰', '블로그 리뷰', '키워드 투표수', '소비자 평점'],
          datasets: [
            {
              label: '내 매장',
              data: [
                (my.seoMetrics.visitorReviewsTotal / maxVisitor) * 100,
                (my.seoMetrics.cafeBlogReviewsTotal / maxBlog) * 100,
                (my.seoMetrics.totalVoteCount / maxVote) * 100,
                (Number(my.seoMetrics.visitorReviewsScore || 4) / 5) * 100
              ],
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              borderColor: 'rgba(59, 130, 246, 1)',
              pointBackgroundColor: 'rgba(59, 130, 246, 1)',
              borderWidth: 2
            },
            {
              label: compareLabel || '상위 6개 평균',
              data: [
                (stats.visitorReviewsTotal.avg / maxVisitor) * 100,
                (stats.cafeBlogReviewsTotal.avg / maxBlog) * 100,
                (stats.totalVoteCount.avg / maxVote) * 100,
                (Number(stats.visitorReviewsScore.avg || 4) / 5) * 100
              ],
              backgroundColor: 'rgba(226, 232, 240, 0.2)',
              borderColor: 'rgba(148, 163, 184, 1)',
              pointBackgroundColor: 'rgba(148, 163, 184, 1)',
              borderDash: [5, 5],
              borderWidth: 2
            }
          ]
        },
`;

const newRadarCode = `
      const mySave = Number(my.seoMetrics.saveCount || 0);
      const avgSave = Number(stats.saveCount?.avg || 0);
      const maxSave = Math.max(mySave, avgSave, 1);
      
      let mySaveRatio = (mySave / maxSave) * 100;
      let avgSaveRatio = (avgSave / maxSave) * 100;
      
      if (mySave === 0 && avgSave === 0) {
        mySaveRatio = 100;
        avgSaveRatio = 100;
      }

      radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: ['영수증 리뷰', '블로그 리뷰', '키워드 투표수', '소비자 평점', '저장수'],
          datasets: [
            {
              label: '내 매장',
              data: [
                (my.seoMetrics.visitorReviewsTotal / maxVisitor) * 100,
                (my.seoMetrics.cafeBlogReviewsTotal / maxBlog) * 100,
                (my.seoMetrics.totalVoteCount / maxVote) * 100,
                (Number(my.seoMetrics.visitorReviewsScore || 4) / 5) * 100,
                mySaveRatio
              ],
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              borderColor: 'rgba(59, 130, 246, 1)',
              pointBackgroundColor: 'rgba(59, 130, 246, 1)',
              borderWidth: 2
            },
            {
              label: compareLabel || '상위 10개 평균',
              data: [
                (stats.visitorReviewsTotal.avg / maxVisitor) * 100,
                (stats.cafeBlogReviewsTotal.avg / maxBlog) * 100,
                (stats.totalVoteCount.avg / maxVote) * 100,
                (Number(stats.visitorReviewsScore.avg || 4) / 5) * 100,
                avgSaveRatio
              ],
              backgroundColor: 'rgba(226, 232, 240, 0.2)',
              borderColor: 'rgba(148, 163, 184, 1)',
              pointBackgroundColor: 'rgba(148, 163, 184, 1)',
              borderDash: [5, 5],
              borderWidth: 2
            }
          ]
        },
`;
html = html.replace(oldRadarCode, newRadarCode);
fs.writeFileSync('c:/project/대행사 에이젼시 기획/worker/public/index.html', html);
