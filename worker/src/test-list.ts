import { getPlaceList } from './scraper.js';
async function run() {
  const list = await getPlaceList('백세삼계탕 안산점', 'popular', 50);
  if(list.length > 0) {
    const item = list[0];
    console.log(JSON.stringify(item, null, 2));
  } else {
    console.log('No results');
  }
}
run();
