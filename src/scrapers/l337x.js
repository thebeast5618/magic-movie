const axios = require('axios');
const cheerio = require('cheerio');
const { config } = require('../config/config');

async function scrape1337x(imdbId) {
    try {
        const url = `https://1337x.to/search/${imdbId}/1/`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const $ = cheerio.load(response.data);
        const results = [];

        $('.table-list tbody tr').each((i, element) => {
            const titleElement = $(element).find('.name a:nth-child(2)');
            const name = titleElement.text().trim();
            const detailUrl = 'https://1337x.to' + titleElement.attr('href');
            const seeds = parseInt($(element).find('.seeds').text().trim()) || 0;
            const leeches = parseInt($(element).find('.leeches').text().trim()) || 0;
            const size = $(element).find('.size').text().trim();

            if (name) {
                results.push({
                    name,
                    detailUrl,
                    seeds,
                    leeches,
                    size
                });
            }
        });

        // Get magnet links from detail pages
        const torrentsWithMagnets = await Promise.all(
            results.map(async (result) => {
                try {
                    const detailResponse = await axios.get(result.detailUrl, {
                        headers: {
                            'User-Agent': config.userAgent,
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                        }
                    });
                    const $detail = cheerio.load(detailResponse.data);
                    const magnetLink = $detail('a[href^="magnet:"]').attr('href');
                    return { ...result, magnetLink };
                } catch (error) {
                    console.error(`Error fetching magnet for ${result.name}:`, error.message);
                    return result;
                }
            })
        );

        return torrentsWithMagnets.filter(t => t.magnetLink);
    } catch (error) {
        console.error('1337x scraping error:', error.message);
        return [];
    }
}

module.exports = { scrape1337x };
