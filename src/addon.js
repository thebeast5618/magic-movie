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
    
    // Source quality
    if (normalizedName.includes('BLURAY')) score += 40;
    if (normalizedName.includes('WEB-DL')) score += 35;
    if (normalizedName.includes('WEBDL')) score += 35;
    if (normalizedName.includes('WEB')) score += 30;
    if (normalizedName.includes('HDTV')) score += 20;
    
    // Encoding quality
    if (normalizedName.includes('REMUX')) score += 50;
    if (normalizedName.includes('X264')) score += 20;
    if (normalizedName.includes('H264')) score += 20;
    if (normalizedName.includes('X265') || normalizedName.includes('HEVC')) score += 25;
    
    return score;
}

function sortTorrents(torrents) {
    return torrents.sort((a, b) => {
        const qualityScoreA = getQualityScore(a.name);
        const qualityScoreB = getQualityScore(b.name);

        if (qualityScoreA !== qualityScoreB) {
            return qualityScoreB - qualityScoreA;
        }

        // If quality is the same, prefer higher seeds
        return b.seeds - a.seeds;
    });
}

function isSeasonPack(name, season) {
    const normalizedName = name.toLowerCase();
    const s = season.toString().padStart(2, '0');
    
    const patterns = [
        `season ${season}`,
        `season.${season}`,
        `s${s}`,
        `season${season}`,
        `season ${season} complete`,
        `complete season ${season}`,
        `${season}complete`,
        `season.${season}.complete`,
        `s${s}complete`,
        `s${s}e00`,
        `${season}x00`
    ];

    // Check if it's a season pack but NOT a specific episode
    if (patterns.some(pattern => normalizedName.includes(pattern))) {
        // Make sure it's not a specific episode
        const episodePattern = new RegExp(`s${s}e[0-9]{2}|${season}x[0-9]{2}|episode[. ]?[0-9]{1,2}`, 'i');
        return !episodePattern.test(normalizedName);
    }
    return false;
}

function isValidVideoFile(filename) {
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.m4v', '.mov'];
    const lowercaseFilename = filename.toLowerCase();
    return videoExtensions.some(ext => lowercaseFilename.endsWith(ext)) &&
           !lowercaseFilename.includes('sample');
}

function findEpisodeFile(files, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    // Sort files by size (largest first) to prefer higher quality versions
    const sortedFiles = [...files].sort((a, b) => b.size - a.size);
    
    const patterns = [
        new RegExp(`[/\\\\]?s${s}e${e}[^/\\\\]*$`, 'i'),
        new RegExp(`[/\\\\]?${s}x${e}[^/\\\\]*$`, 'i'),
        new RegExp(`[/\\\\]?e${e}[^/\\\\]*$`, 'i'),
        new RegExp(`episode[. ]?${episode}[^/\\\\]*$`, 'i'),
        new RegExp(`ep[. ]?${episode}[^/\\\\]*$`, 'i'),
        new RegExp(`[/\\\\]?${episode}[^/\\\\]*$`, 'i')
    ];

    // First try exact episode match
    for (const file of sortedFiles) {
        if (!isValidVideoFile(file.path)) continue;
        
        for (const pattern of patterns) {
            if (pattern.test(file.path)) {
                return file;
            }
        }
    }

    // If no exact match found and we have the correct number of video files,
    // try to use position-based matching
    const videoFiles = sortedFiles.filter(file => isValidVideoFile(file.path));
    if (videoFiles.length >= episode) {
        return videoFiles[episode - 1];
    }

    return null;
}

builder.defineStreamHandler(async ({ type, id }) => {
    try {
        console.log(`Processing request for ${type} - ${id}`);
        
        if (!config.realDebridKey) {
            console.log('No Real-Debrid API key configured');
            return { streams: [] };
        }

        const [imdbId, season, episode] = id.split(':');
        let torrents = await getTorrents(imdbId);
        console.log(`Found ${torrents.length} initial torrents for ${imdbId}`);

        // Filter out unwanted torrents
        torrents = torrents.filter(torrent => {
            if (!torrent.seeds || torrent.seeds < config.filters.minSeeds) return false;
            
            const name = torrent.name.toLowerCase();
            if (config.filters.excludeX265 && name.includes('x265')) return false;
            if (config.filters.excludeHEVC && name.includes('hevc')) return false;
            if (config.filters.excludeH265 && name.includes('h265')) return false;
            
            const sizeGB = torrent.size / (1024 * 1024 * 1024);
            if (sizeGB < config.filters.minSize || sizeGB > config.filters.maxSize) return false;

            return true;
        });

        if (type === 'series' && season) {
            // For TV shows, try season packs first
            const seasonTorrents = torrents.filter(t => isSeasonPack(t.name, season));
            console.log(`Found ${seasonTorrents.length} season pack torrents`);
            
            if (seasonTorrents.length > 0) {
                torrents = seasonTorrents;
            }
        }

        // Sort torrents by quality
        torrents = sortTorrents(torrents);
        console.log(`Processing ${torrents.length} sorted torrents`);

        const streams = [];
        // Process top 5 torrents
        for (const torrent of torrents.slice(0, 5)) {
            console.log(`Processing torrent: ${torrent.name}`);
            
            const stream = {
                name: torrent.name,
                infoHash: torrent.infoHash || torrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase()
            };

            try {
                const debridStream = await processWithRealDebrid(stream, config.realDebridKey, {
                    type,
                    season: parseInt(season),
                    episode: parseInt(episode)
                });
                
                if (debridStream) {
                    if (type === 'series' && season && episode) {
                        const episodeFile = findEpisodeFile(debridStream.fileList, season, episode);
                        if (episodeFile) {
                            streams.push({
                                name: `🌟 RD | ${episodeFile.path.split(/[/\\]/).pop()}`,
                                url: episodeFile.url,
                                title: `S${season}E${episode} | ${(episodeFile.size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
                                behaviorHints: {
                                    bingeGroup: `RD-${imdbId}-S${season}`,
                                }
                            });
                        }
                    } else {
                        streams.push(debridStream);
                    }
                }
            } catch (error) {
                console.error(`Error processing torrent ${torrent.name}:`, error);
                continue;
            }
        }

        console.log(`Found ${streams.length} valid streams`);
        return { streams };

    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
