const placeId = '2058645213';

async function inspectFullSummary(id) {
  const summaryApiUrl = `https://map.naver.com/p/api/place/summary/${id}`;
  const res = await fetch(summaryApiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://map.naver.com/',
      'Accept': 'application/json, text/plain, */*'
    }
  });
  const json = await res.json();
  const detail = json.data?.placeDetail || {};

  console.log('All Keys in placeDetail:', Object.keys(detail));
  console.log('Labels:', detail.labels);
  console.log('Bookmark / Save / Counts:');
  console.log({
    bookingReviewCount: detail.bookingReviewCount,
    visitorReviewCount: detail.visitorReviewCount,
    blogReviewCount: detail.blogReviewCount,
    receiptReviewCount: detail.receiptReviewCount,
    bookmarkCount: detail.bookmarkCount,
    saveCount: detail.saveCount,
  });
  console.log('Description / Intro:');
  console.log({
    description: detail.description,
    microReview: detail.microReview,
    keyword: detail.keyword,
    keywords: detail.keywords,
  });
  console.log('Business Hours:');
  console.log(detail.bizhourInfo || detail.openingHours || detail.businessHours);
  console.log('Homepage / SNS:');
  console.log({
    homepage: detail.homepage,
    homepages: detail.homepages,
    naverBlogUrl: detail.naverBlogUrl,
    instagram: detail.instagram,
  });
}

inspectFullSummary(placeId);
