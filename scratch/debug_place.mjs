const query = process.argv[2] || '0314070103';

async function testNaverSearch() {
  const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(query)}&type=all`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://map.naver.com/p/search/' + encodeURIComponent(query),
    'Accept': 'application/json, text/plain, */*'
  };

  const res = await fetch(url, { headers });
  const json = await res.json();
  console.log('JSON place result:', JSON.stringify(json.result?.place, null, 2));
}

testNaverSearch();
