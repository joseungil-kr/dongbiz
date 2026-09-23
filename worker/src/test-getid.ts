import { getPlaceList } from './scraper.js';
async function run() {
  const items = await getPlaceList('수원금거래소', { limit: 5 });
  console.log(items[0].placeId);
}
run();
