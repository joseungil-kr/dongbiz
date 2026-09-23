import { getPlaceList } from './scraper.js';
async function run() {
  const items = await getPlaceList('안산 삼계탕', { limit: 100 });
  console.log(items.length);
}
run();
