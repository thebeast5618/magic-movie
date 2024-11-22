const axios = require('axios');
const cheerio = require('cheerio');

async function scrapePirateBay(imdbId, type) {
    const baseUrl = 'https://thepiratebay.org';
    const searchUrl = `${baseUrl}/search/${imdbId}`;
    
    try {
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data);
        
        return $('.searchResult tr')
            .map((_, element) => {
                const $el = $(element);
                return {
                    title: $el.find('.detName').text(),
                    infoHash: $el.find('a[href^="magnet:"]').attr('href'),
                    size: $el.find('.detDesc').text().match(/Size (.*?),/)[1],
                    seeders: parseInt($el.find('td:nth-child(3)').text()),
                    source: 'ThePirateBay'
                };
            })
            .get();
    } catch (error) {
        console.error('PirateBay scraping error:', error);
        return [];
    }
}

module.exports = { scrapePirateBay };
