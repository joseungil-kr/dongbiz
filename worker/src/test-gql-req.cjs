async function run() {
  const query = `query getPlaceDetail($id: String!) { placeDetail(input: {id: $id, isNx: false, deviceType: "mobile", checkRedirect: true}) { id name businessType base { visitorReviewsTotal cafeBlogReviewsTotal saveCount bookmarkCount } } }`;
  const res = await fetch("https://pcmap.place.naver.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://pcmap.place.naver.com/restaurant/1994640103/home"
    },
    body: JSON.stringify([{"operationName":"getPlaceDetail","variables":{"id":"1994640103"},"query":query}])
  });
  const data = await res.text();
  console.log(data);
}
run();
