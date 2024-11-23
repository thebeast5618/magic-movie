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

function isMatchingEpisode(torrentName, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    const patterns = [
        `s${s}e${e}`,
        `s${s}ep${e}`,
        `${s}x${e}`,
        `season ${season}.*episode ${episode}`
    ];
    
    const normalizedName = torrentName.toLowerCase();
    return patterns.some(pattern => normalizedName.includes(pattern));
}

function isMatchingSeason(torrentName, season) {
    const s = season.toString().padStart(2, '0');
    const normalizedName = torrentName.toLowerCase();
    
    const patterns = [
        `season ${season}`,
        `s${s}`,
        `season.${season}`,
        `complete.season.${season}`
    ];
    
    return patterns.some(pattern => normalizedName.includes(pattern));
}

function getEpisodeFileName(fileList, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    const patterns = [
        new RegExp(`s${s}e${e}`, 'i'),
        new RegExp(`${s}x${e}`, 'i'),
        new RegExp(`episode[. ]${episode}`, 'i')
    ];

    return fileList.find(file => {
        const fileName = file.path.toLowerCase();
        return patterns.some(pattern => pattern.test(fileName));
    });
}

builder.defineStreamHandler(async ({ type, id }) => {
    try {
        if (!config.realDebridKey) {
            console.log('No Real-Debrid API key configured');
            return { streams: [] };
        }

        const [imdbId, season, episode] = id.split(':');
        let torrents = await getTorrents(imdbId);
        
        // First try specific episodes
        let filteredTorrents = sortTorrents(
            torrents.filter(torrent => {
                // Apply filters
                if (torrent.seeds < config.filters.minSeeds) return false;
                
                const name = torrent.name.toLowerCase();
                if (config.filters.excludeX265 && name.includes('x265')) return false;
                if (config.filters.excludeHEVC && name.includes('hevc')) return false;
                if (config.filters.excludeH265 && name.includes('h265')) return false;
                
                // Convert size to GB and check
                const sizeGB = parseFloat(torrent.size);
                if (sizeGB > config.filters.maxSize) return false;

                // For TV shows, check if it's the correct episode
                if (type === 'series' && season && episode) {
                    return isMatchingEpisode(name, parseInt(season), parseInt(episode));
                }
                
                return true;
            })
        );

        // If no episodes found, try season packs
        if (type === 'series' && filteredTorrents.length === 0 && season) {
            filteredTorrents = sortTorrents(
                torrents.filter(torrent => {
                    const name = torrent.name.toLowerCase();
                    if (torrent.seeds < config.filters.minSeeds) return false;
                    if (config.filters.excludeX265 && name.includes('x265')) return false;
                    if (config.filters.excludeHEVC && name.includes('hevc')) return false;
                    if (config.filters.excludeH265 && name.includes('h265')) return false;
                    
                    const sizeGB = parseFloat(torrent.size);
                    if (sizeGB > config.filters.maxSize) return false;

                    return isMatchingSeason(name, parseInt(season));
                })
            );
        }

        // Get only the best quality torrent
        const bestTorrent = filteredTorrents[0];
        if (!bestTorrent) return { streams: [] };

        const infoHash = bestTorrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
        if (!infoHash) return { streams: [] };

        // Process with Real-Debrid
        const stream = {
            name: bestTorrent.name,
            infoHash: infoHash
        };

        const debridStream = await processWithRealDebrid(stream, config.realDebridKey);

        // Handle season pack file selection
        if (type === 'series' && season && episode && debridStream && debridStream.fileList) {
            const episodeFile = getEpisodeFileName(debridStream.fileList, season, episode);
            if (episodeFile) {
                debridStream.url = episodeFile.url;
                debridStream.name = episodeFile.path;
            }
        }
        
        return { 
            streams: debridStream ? [debridStream] : []
        };

    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
