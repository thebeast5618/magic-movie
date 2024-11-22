const axios = require('axios');
const { config } = require('../config/config');

async function scrapePirateBay(imdbId) {
    try {
        const url = `https://apibay.org/q.php?q=${imdbId}`;
        const response = await axios.get(url);
        
        if (!response.data || response.data === 'No results returned') {
            return [];
        }

        return response.data
            .filter(torrent => torrent.status === 'trusted' || torrent.status === 'vip')
            .map(torrent => ({
                name: torrent.name,
                size: `${(torrent.size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
                seeds: parseInt(torrent.seeders),
                leeches: parseInt(torrent.leechers),
                magnetLink: `magnet:?xt=urn:btih:${torrent.info_hash}&dn=${encodeURIComponent(torrent.name)}`
            }));
    } catch (error) {
        console.error('PirateBay scraping error:', error.message);
        return [];
    }
}

module.exports = { scrapePirateBay };
