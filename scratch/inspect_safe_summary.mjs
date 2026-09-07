const placeId = '2058645213';

async function inspectFullSummary(id) {
  const summaryApiUrl = `https://map.naver.com/p/api/place/summary/${id}`;
  const res = await fetch(summaryApiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': `https://map.naver.com/p/entry/place/${id}`,
      'Accept': 'application/json, text/plain, */*'
    }
  });
  const text = await res.text();
  console.log('Status:', res.status, 'Length:', text.length);
  if (text) {
    try {
      const json = JSON.parse(text);
      const detail = json.data?.placeDetail || {};
      console.log('All Keys in placeDetail:', Object.keys(detail));
      console.log('Detail Object Sample:');
      for (const [k, v] of Object.entries(detail)) {
        if (typeof v !== 'object' || v === null) {
          console.log(`- ${k}:`, v);
        } else if (Array.isArray(v)) {
          console.log(`- ${k}: [Array(${v.length})]`, v.slice(0, 3));
        } else {
          console.log(`- ${k}: [Object]`, Object.keys(v));
        }
      }
    } catch(e) {
      console.log('JSON Parse Error:', e.message);
    }
  }
}

inspectFullSummary(placeId);
