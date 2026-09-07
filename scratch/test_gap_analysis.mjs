import { scrapeFullPlaceMetrics } from './full_place_scraper.mjs';

// 비교 대상:
// 1. 사용자 업체: '0314070103' (백세보리밥 닭한마리)
// 2. '안산맛집' 오가닉 1위 경쟁업체: '2076438404' (용광쭈꾸미 안산중앙점)
// 3. '안산맛집' 오가닉 2위 경쟁업체: '2081555904' (수안초밥 안산중앙역점)

async function runCompetitorDiagnosis() {
  const myId = process.argv[2] || '0314070103';
  const comp1Id = process.argv[3] || '1248090055'; // 초장집 선부점
  const comp2Id = process.argv[4] || '2004977310'; // 디몰토 안산점

  console.log('================================================================================');
  console.log('🔍 [네이버 스마트플레이스 실시간 경쟁사 진단 & Gap 분석 엔진 가동]');
  console.log('================================================================================\n');

  console.log(`[1/3] 내 매장 데이터 수집 중 (${myId})...`);
  const myStore = await scrapeFullPlaceMetrics(myId);

  console.log(`[2/3] 안산맛집 실제 1위 업체 데이터 수집 중 (${comp1Id})...`);
  const comp1 = await scrapeFullPlaceMetrics(comp1Id);

  console.log(`[3/3] 안산맛집 실제 2위 업체 데이터 수집 중 (${comp2Id})...`);
  const comp2 = await scrapeFullPlaceMetrics(comp2Id);

  console.log('\n================================================================================');
  console.log('📊 [키워드: "안산맛집" 기준 내 매장 vs 상위 1~2위 경쟁사 1:1 비교표]');
  console.log('================================================================================');

  const rows = [
    { 지표: '상호명', 내매장: myStore.name, '1위(경쟁사)': comp1.name, '2위(경쟁사)': comp2.name },
    { 지표: '업종 카테고리', 내매장: myStore.category, '1위(경쟁사)': comp1.category, '2위(경쟁사)': comp2.category },
    { 지표: '방문자(영수증) 리뷰', 내매장: `${myStore.seoMetrics.visitorReviewsTotal}건`, '1위(경쟁사)': `${comp1.seoMetrics.visitorReviewsTotal}건`, '2위(경쟁사)': `${comp2.seoMetrics.visitorReviewsTotal}건` },
    { 지표: '블로그/카페 리뷰', 내매장: `${myStore.seoMetrics.cafeBlogReviewsTotal}건`, '1위(경쟁사)': `${comp1.seoMetrics.cafeBlogReviewsTotal}건`, '2위(경쟁사)': `${comp2.seoMetrics.cafeBlogReviewsTotal}건` },
    { 지표: '정성 텍스트 리뷰', 내매장: `${myStore.seoMetrics.textReviewsTotal}건`, '1위(경쟁사)': `${comp1.seoMetrics.textReviewsTotal}건`, '2위(경쟁사)': `${comp2.seoMetrics.textReviewsTotal}건` },
    { 지표: '평점 스코어', 내매장: `${myStore.seoMetrics.visitorReviewsScore || '비공개'}점`, '1위(경쟁사)': `${comp1.seoMetrics.visitorReviewsScore || '비공개'}점`, '2위(경쟁사)': `${comp2.seoMetrics.visitorReviewsScore || '비공개'}점` },
    { 지표: '키워드 리뷰 총 투표수', 내매장: `${myStore.seoMetrics.totalVoteCount}표`, '1위(경쟁사)': `${comp1.seoMetrics.totalVoteCount}표`, '2위(경쟁사)': `${comp2.seoMetrics.totalVoteCount}표` },
    { 지표: '네이버 톡톡 연동', 내매장: myStore.seoMetrics.hasTalktalk ? '연동됨' : '미연동', '1위(경쟁사)': comp1.seoMetrics.hasTalktalk ? '연동됨' : '미연동', '2위(경쟁사)': comp2.seoMetrics.hasTalktalk ? '연동됨' : '미연동' },
    { 지표: '스마트콜(0507) 사용', 내매장: myStore.seoMetrics.hasSmartCall ? '사용중' : '미사용', '1위(경쟁사)': comp1.seoMetrics.hasSmartCall ? '사용중' : '미사용', '2위(경쟁사)': comp2.seoMetrics.hasSmartCall ? '사용중' : '미사용' },
    { 지표: '등록 메뉴 수', 내매장: `${myStore.seoMetrics.menuCount}개`, '1위(경쟁사)': `${comp1.seoMetrics.menuCount}개`, '2위(경쟁사)': `${comp2.seoMetrics.menuCount}개` },
    { 지표: '등록 사진 수', 내매장: `${myStore.seoMetrics.photoCount}장`, '1위(경쟁사)': `${comp1.seoMetrics.photoCount}장`, '2위(경쟁사)': `${comp2.seoMetrics.photoCount}장` },
  ];

  console.table(rows);

  console.log('--------------------------------------------------------------------------------');
  console.log('🚨 [동네비즈 AI 알고리즘 진단: 내 매장이 상위노출 되기 위해 부족한 점 (Gap Report)]');
  console.log('--------------------------------------------------------------------------------');
  
  const visitorDiff1 = comp1.seoMetrics.visitorReviewsTotal - myStore.seoMetrics.visitorReviewsTotal;
  const blogDiff1 = comp1.seoMetrics.cafeBlogReviewsTotal - myStore.seoMetrics.cafeBlogReviewsTotal;
  const voteDiff1 = comp1.seoMetrics.totalVoteCount - myStore.seoMetrics.totalVoteCount;

  console.log(`1. [방문자 영수증 리뷰 부족]: 1위 업체 대비 ${visitorDiff1 > 0 ? visitorDiff1 + '건 부족 ⚠️' : '우세 ✅'}`);
  console.log(`   ➔ 진단: 플레이스 순위 알고리즘에서 가장 가중치가 높은 영수증 리뷰가 1위 대비 크게 뒤처져 있습니다.`);
  console.log(`2. [블로그 / 카페 리뷰 비교]: 1위 업체 대비 ${blogDiff1 > 0 ? blogDiff1 + '건 부족 ⚠️' : '우세 ✅'}`);
  console.log(`3. [키워드 리뷰 참여도]: 1위 업체 대비 총 ${voteDiff1 > 0 ? voteDiff1 + '표 부족 ⚠️' : '우세 ✅'}`);
  
  console.log('\n4. [상위 1위 업체의 1등 키워드 분석]:');
  console.log(`   • 1위 업체 최다 득표: "${comp1.topRepKeywords[0]?.keyword}" (${comp1.topRepKeywords[0]?.count}표)`);
  console.log(`   • 내 매장 최다 득표:   "${myStore.topRepKeywords[0]?.keyword}" (${myStore.topRepKeywords[0]?.count}표)`);
  console.log('================================================================================\n');
}

runCompetitorDiagnosis();
