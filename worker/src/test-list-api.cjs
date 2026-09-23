async function run() {
  const keyword = encodeURIComponent("안산삼계탕");
  let res = await fetch(`https://map.naver.com/p/api/search/allSearch?query=${keyword}&type=all&searchCoord=126.8300000%3B37.3300000&boundary=`);
  console.log(res.status);
  let text = await res.text();
  console.log(text.substring(0, 100));
}
run();
