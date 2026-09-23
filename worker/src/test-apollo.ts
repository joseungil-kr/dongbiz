async function run() {
  const res = await fetch('https://m.place.naver.com/place/1994640103/home', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36' }
  });
  const html = await res.text();
  console.log('Title:', html.match(/<title>(.*?)<\/title>/)?.[1]);
}
run();
