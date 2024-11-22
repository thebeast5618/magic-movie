const { scrape1337x } = require('../scrapers/l337x');
const { scrapePirateBay } = require('../scrapers/piratebay');
const { getCache, setCache } = require('./cache');
const { config } = require('../config/config');

function filterTorrents(torrents) {
    return torrents.filter(torrent => {
        const name = torrent.name.toLowerCase();
        
        // Apply codec filters
        if (config.filters.excludeX265 && name.includes('x265')) return false;
        if (config.filters.excludeHEVC && name.includes('hevc')) return false;
        if (config.filters.excludeH265 && name.includes('h265')) return false;

        // Apply seed filter
        if (torrent.seeds < config.filters.minSeeds) return false;

        // Apply size filter
        const sizeMatch = torrent.size.match(/(\d+\.?\d*)\s*(GB|MB)/i);
        if (sizeMatch) {
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            const sizeInGB = unit === 'GB' ? size : size / 1024;
            if (sizeInGB > config.filters.maxSize) return false;
        }

        return true;
    });
}

async function getTorrents(imdbId) {
    const cacheKey = `torrents:${imdbId}`;
    const cached = await getCache(cacheKey);
    if (cached) return filterTorrents(cached);

    try {
        const results = await Promise.all([
            scrape1337x(imdbId),
            scrapePirateBay(imdbId)
        ]);

        const torrents = results
            .flat()
            .filter(t => t && t.magnetLink);

        // Sort by seeds
        torrents.sort((a, b) => b.seeds - a.seeds);

        // Cache the unfiltered results
        await setCache(cacheKey, torrents, config.cacheTime);

        // Return filtered results
        return filterTorrents(torrents);
    } catch (error) {
        console.error('Error getting torrents:', error);
        return [];
    }
}

module.exports = { getTorrents };
