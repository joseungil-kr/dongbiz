async function run() {
  const keyword = encodeURIComponent("안산삼계탕");
  const url = `https://pcmap.place.naver.com/restaurant/list?query=${keyword}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://map.naver.com/" }});
  const html = await res.text();
  
  const start = html.indexOf("window.__APOLLO_STATE__ = ");
  const from = html.indexOf("{", start);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}") depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  const state = JSON.parse(html.slice(from, end));
  const placeKey = Object.keys(state).find(k => k.startsWith("PlaceListBusinessesItem:"));
  console.log(JSON.stringify(state[placeKey], null, 2));
}
run();
