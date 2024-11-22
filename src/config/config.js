require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    realDebridKey: process.env.REALDEBRID_KEY || '',
    cacheTime: 3600,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    filters: {
        excludeX265: true,
        excludeHEVC: true,
        excludeH265: true,
        minSeeds: 1,
        maxSize: 20,
        preferredQuality: ['2160p', '1080p', '720p']
    }
};

module.exports = { config };
