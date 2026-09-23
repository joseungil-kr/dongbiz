import { scrapeFullPlaceMetrics } from './scraper.js';
async function run() {
  const data = await scrapeFullPlaceMetrics('1994640103');
  console.log(data.seoMetrics);
}
run();
