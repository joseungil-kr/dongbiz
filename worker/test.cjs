const { scrapeFullPlaceMetrics } = require('./src/scraper');
async function run() {
  try {
    const data = await scrapeFullPlaceMetrics('1994640103'); // just a place id
    console.log(data.seoMetrics);
  } catch(e) {
    console.error(e);
  }
}
run();
