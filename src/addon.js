const { addonBuilder } = require('stremio-addon-sdk');
const { getTorrents } = require('./lib/torrent');
const { processWithRealDebrid } = require('./lib/debrid');
const { config } = require('./config/config');

const manifest = {
    id: 'org.magicmovie',
    version: '1.0.0',
    name: 'Magic Movie',
    description: 'Stream movies and TV shows with Real-Debrid integration',
    types: ['movie', 'series'],
    catalogs: [],
    resources: ['stream'],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

function sortTorrents(torrents) {
    return torrents.sort((a, b) => {
        const getQualityScore = (name) => {
            const normalizedName = name.toUpperCase();
            let score = 0;
            
            if (normalizedName.includes('2160P') || normalizedName.includes('4K')) score += 100;
            if (normalizedName.includes('1080P')) score += 80;
            if (normalizedName.includes('720P')) score += 60;
            if (normalizedName.includes('HDR')) score += 10;
            if (normalizedName.includes('REMUX')) score += 15;
            if (normalizedName.includes('BLURAY')) score += 12;
            if (normalizedName.includes('WEB-DL')) score += 8;
            if (normalizedName.includes('HEVC') || normalizedName.includes('X265')) score += 5;
            
            return score;
        };

        const qualityScoreA = getQualityScore(a.name);
        const qualityScoreB = getQualityScore(b.name);

        if (qualityScoreA !== qualityScoreB) {
            return qualityScoreB - qualityScoreA;
        }

        return b.seeds - a.seeds;
    });
}

builder.defineStreamHandler(async ({ type, id }) => {
    try {
        if (!config.realDebridKey) {
            console.log('No Real-Debrid API key configured');
            return { streams: [] };
        }

        const imdbId = id.split(':')[0];
        let torrents = await getTorrents(imdbId);
        
        // Filter and sort torrents
        torrents = sortTorrents(
            torrents.filter(torrent => torrent.seeds > 0)
        );

        // If single link mode is enabled, only keep the best torrent
        if (config.singleLinkMode) {
            torrents = [torrents[0]];
        } else {
            torrents = torrents.slice(0, 15); // Limit to top 15 best torrents
        }

        const streams = torrents.map(torrent => {
            const infoHash = torrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
            if (!infoHash) return null;

            return {
                name: torrent.name,
                title: `💾 ${torrent.size} | 🌱 ${torrent.seeds}`,
                infoHash: infoHash,
                behaviorHints: {
                    bingeGroup: `torrent-${infoHash}`
                }
            };
        }).filter(Boolean);

        return { streams };
    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
