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

function getQualityScore(name) {
    const normalizedName = name.toUpperCase();
    let score = 0;
    
    // Resolution scoring
    if (normalizedName.includes('2160P') || normalizedName.includes('4K')) score += 100;
    if (normalizedName.includes('1080P')) score += 80;
    if (normalizedName.includes('720P')) score += 60;
    
    // Quality indicators
    if (normalizedName.includes('REMUX')) score += 50;
    if (normalizedName.includes('BLURAY')) score += 40;
    if (normalizedName.includes('HDR')) score += 30;
    if (normalizedName.includes('WEB-DL')) score += 25;
    if (normalizedName.includes('WEBRIP')) score += 20;
    if (normalizedName.includes('HEVC') || normalizedName.includes('X265')) score += 15;
    if (normalizedName.includes('10BIT')) score += 10;
    
    // Negative indicators
    if (normalizedName.includes('CAM')) score -= 50;
    if (normalizedName.includes('HDTS')) score -= 40;
    if (normalizedName.includes('HDTC')) score -= 30;
    if (normalizedName.includes('SCREENER')) score -= 20;
    
    return score;
}

function sortTorrents(torrents) {
    return torrents.sort((a, b) => {
        const qualityScoreA = getQualityScore(a.name);
        const qualityScoreB = getQualityScore(b.name);

        if (qualityScoreA !== qualityScoreB) {
            return qualityScoreB - qualityScoreA;
        }

        // If quality scores are equal, prefer higher seeds
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
        `season ${season}.*episode ${episode}`,
        `season.${season}.*episode.${episode}`,
        `s${s}.?e${e}`,
        `${season}x${e}`
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
        `complete.season.${season}`,
        `season${season}`,
        `${season}complete`,
        `s${s}complete`
    ];
    
    return patterns.some(pattern => normalizedName.includes(pattern));
}

function isCompleteSeries(torrentName) {
    const patterns = [
        'complete series',
        'complete collection',
        'all seasons',
        'full series',
        'season 1.*season',  // Indicates multiple seasons
        's01.*s02'          // Indicates multiple seasons
    ];
    
    const normalizedName = torrentName.toLowerCase();
    return patterns.some(pattern => normalizedName.includes(pattern));
}

function getEpisodePattern(season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    return [
        new RegExp(`[/\\\\]s${s}e${e}[^/\\\\]*$`, 'i'),
        new RegExp(`[/\\\\]${s}x${e}[^/\\\\]*$`, 'i'),
        new RegExp(`episode[. ]?${episode}[^/\\\\]*$`, 'i'),
        new RegExp(`e${e}[^/\\\\]*$`, 'i'),
        new RegExp(`s${s}e${e}`, 'i')
    ];
}

function filterTorrents(torrents, type, season, episode) {
    return torrents.filter(torrent => {
        // Basic quality filters
        if (torrent.seeds < config.filters.minSeeds) return false;
        
        const name = torrent.name.toLowerCase();
        if (config.filters.excludeX265 && name.includes('x265')) return false;
        if (config.filters.excludeHEVC && name.includes('hevc')) return false;
        if (config.filters.excludeH265 && name.includes('h265')) return false;
        
        const sizeGB = torrent.size / (1024 * 1024 * 1024);
        if (sizeGB > config.filters.maxSize) return false;

        // Skip obvious fake/spam torrents
        if (name.includes('password') || name.includes('signup')) return false;

        return true;
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
        console.log(`Found ${torrents.length} initial torrents for ${imdbId}`);

        // Apply basic filters
        torrents = filterTorrents(torrents, type, season, episode);
        
        if (type === 'series' && season && episode) {
            // Try to find exact episode matches first
            let matchingTorrents = torrents.filter(t => isMatchingEpisode(t.name, season, episode));
            console.log(`Found ${matchingTorrents.length} exact episode matches`);

            // If no episode matches, look for season packs
            if (matchingTorrents.length === 0) {
                matchingTorrents = torrents.filter(t => isMatchingSeason(t.name, season));
                console.log(`Found ${matchingTorrents.length} season pack matches`);
            }

            // If still nothing, look for complete series
            if (matchingTorrents.length === 0) {
                matchingTorrents = torrents.filter(t => isCompleteSeries(t.name));
                console.log(`Found ${matchingTorrents.length} complete series matches`);
            }

            torrents = matchingTorrents;
        }

        // Sort and get the best quality torrent
        torrents = sortTorrents(torrents);
        const bestTorrent = torrents[0];
        
        if (!bestTorrent) {
            console.log('No suitable torrents found');
            return { streams: [] };
        }

        console.log(`Selected torrent: ${bestTorrent.name}`);
        
        // Process with Real-Debrid
        const stream = {
            name: bestTorrent.name,
            infoHash: bestTorrent.infoHash || bestTorrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase()
        };

        const debridStream = await processWithRealDebrid(stream, config.realDebridKey, {
            type,
            season: parseInt(season),
            episode: parseInt(episode),
            patterns: season && episode ? getEpisodePattern(season, episode) : null
        });

        return { 
            streams: debridStream ? [debridStream] : []
        };

    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
