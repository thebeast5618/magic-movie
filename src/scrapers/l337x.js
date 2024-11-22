const axios = require('axios');
const cheerio = require('cheerio');

async function scrape1337x(imdbId, type) {
    const baseUrl = 'https://1337x.to';
    const searchUrl = `${baseUrl}/search/${imdbId}/1/`;
    
    try {
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data);
        
        return $('.table-list tbody tr')
            .map((_, element) => {
                const $el = $(element);
                return {
                    title: $el.find('a:nth-child(2)').text(),
                    infoHash: $el.find('a.btn-magnet').attr('href'),
                    size: $el.find('td.size').text(),
                    seeders: parseInt($el.find('td.seeds').text()),
                    source: '1337x'
                };
            })
            .get();
    } catch (error) {
        console.error('1337x scraping error:', error);
        return [];
    }
}

module.exports = { scrape1337x };
