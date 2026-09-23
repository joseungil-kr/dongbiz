import { getOrganicRanking } from './scraper.js';
async function run() {
  const ranking = await getOrganicRanking('안산 삼계탕', 20);
  console.log('Ranking:', ranking);
}
run();
