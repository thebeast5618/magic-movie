const { scrapePirateBay } = require('../scrapers/piratebay');
const { scrape1337x } = require('../scrapers/l337x');
const { cacheGet, cacheSet } = require('./cache');

async function getTorrents(imdbId, type) {
    const cacheKey = `${imdbId}-${type}`;
    const cached = await cacheGet(cacheKey);
    
    if (cached) return cached;
    
    const [pirateBayResults, l337xResults] = await Promise.all([
        scrapePirateBay(imdbId, type),
        scrape1337x(imdbId, type)
    ]);
    
    const results = [...pirateBayResults, ...l337xResults]
        .sort((a, b) => b.seeders - a.seeders);
        
    await cacheSet(cacheKey, results);
    return results;
}

module.exports = { getTorrents };
