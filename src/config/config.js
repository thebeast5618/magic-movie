require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    realDebridKey: process.env.REALDEBRID_KEY || '',
    singleLinkMode: true, // Always true now since we only show one stream
    cacheTime: 3600,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    filters: {
        excludeX265: true,
        excludeHEVC: true,
        excludeH265: true,
        minSeeds: 1,
        maxSize: 20,
        preferredQuality: ['2160p', '1080p', '720p']
    },
    episodeHandling: {
        preferIndividualEpisodes: true,
        allowSeasonPacks: true,
        minSeasonPackSize: 500 * 1024 * 1024, // 500MB minimum for season packs
        episodeMatchingThreshold: 5, // Minimum score for episode matching
        checkRealDebridLibrary: true
    },
    logging: {
        debugMode: false,
        logEpisodeMatching: true,
        logRealDebridCalls: true
    }
};

module.exports = { config };
