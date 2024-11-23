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
    
    // Resolution scoring (higher priority)
    if (normalizedName.includes('2160P') || normalizedName.includes('4K')) score += 1000;
    if (normalizedName.includes('1080P')) score += 800;
    if (normalizedName.includes('720P')) score += 600;
    
    // Source quality
    if (normalizedName.includes('BLURAY')) score += 40;
    if (normalizedName.includes('REMUX')) score += 50;
    if (normalizedName.includes('WEB-DL')) score += 35;
    if (normalizedName.includes('WEBDL')) score += 35;
    if (normalizedName.includes('WEB')) score += 30;
    if (normalizedName.includes('HDTV')) score += 20;
    
    // Encoding quality
    if (normalizedName.includes('X265') || normalizedName.includes('HEVC')) score += 25;
    if (normalizedName.includes('X264') || normalizedName.includes('H264')) score += 20;
    
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
    
    // More specific patterns first
    const patterns = [
        `complete.season.${season}`,
        `season.${season}.complete`,
        `s${s}.complete`,
        `season ${season} complete`,
        `complete season ${season}`,
        `season.${season}`,
        `season ${season}`,
        `s${s}`,
    ];

    // Check for season pack indicators
    const isPack = patterns.some(pattern => normalizedName.includes(pattern.toLowerCase()));
    if (!isPack) return false;

    // Make sure it's not just a single episode
    const episodePattern = new RegExp(`s${s}e([0-9]{2})|${season}x([0-9]{2})|episode.?([0-9]{1,2})`, 'i');
    const match = normalizedName.match(episodePattern);
    
    // If there's an episode number, make sure it's not episode 1-10
    if (match) {
        const epNum = parseInt(match[1] || match[2] || match[3]);
        return epNum === 0; // Only true for S01E00 style season packs
    }

    return true;
}

function isValidEpisodeFile(filename, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    const name = filename.toLowerCase();

    // Exclude sample files and non-video files
    if (name.includes('sample') || !name.match(/\.(mp4|mkv|avi|m4v|mov)$/i)) {
        return false;
    }

    // Specific episode patterns
    const patterns = [
        new RegExp(`s${s}e${e}\\b`, 'i'),
        new RegExp(`${s}x${e}\\b`, 'i'),
        new RegExp(`season.?${season}.?episode.?${episode}\\b`, 'i'),
        new RegExp(`e${e}\\b`, 'i'),
    ];

    // Special handling for episode numbers to avoid confusion between 1 and 10
    if (episode === 1) {
        return patterns.some(p => p.test(name)) && !name.includes(`e10`);
    }

    return patterns.some(p => p.test(name));
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

        // Sort all torrents by quality first
        torrents = sortTorrents(torrents);

        if (type === 'series' && season) {
            // Split torrents into season packs and regular episodes
            const seasonPacks = torrents.filter(t => isSeasonPack(t.name, season));
            const episodeTorrents = torrents.filter(t => !isSeasonPack(t.name, season));
            
            console.log(`Found ${seasonPacks.length} season packs and ${episodeTorrents.length} episode torrents`);
            
            // Try season packs first, then individual episodes
            torrents = [...seasonPacks, ...episodeTorrents];
        }

        // Try more torrents for series than movies
        const torrentLimit = type === 'movie' ? 3 : 10;

        for (const torrent of torrents.slice(0, torrentLimit)) {
            console.log(`Processing torrent: ${torrent.name}`);
            
            const stream = {
                name: torrent.name,
                infoHash: torrent.infoHash || torrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase()
            };

            try {
                const debridStream = await processWithRealDebrid(stream, config.realDebridKey);
                
                if (debridStream) {
                    if (type === 'movie') {
                        return { streams: [debridStream] };
                    } else if (type === 'series' && season && episode) {
                        // For series, verify we have the correct episode
                        if (debridStream.fileList) {
                            const episodeFiles = debridStream.fileList.filter(file => 
                                isValidEpisodeFile(file.path, season, episode)
                            ).sort((a, b) => b.size - a.size); // Sort by size descending

                            if (episodeFiles.length > 0) {
                                const selectedFile = episodeFiles[0];
                                return {
                                    streams: [{
                                        name: `🎬 ${torrent.name}`,
                                        url: selectedFile.url,
                                        title: `S${season}E${episode} | ${(selectedFile.size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
                                        behaviorHints: {
                                            bingeGroup: `${imdbId}-${season}`
                                        }
                                    }]
                                };
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing torrent ${torrent.name}:`, error);
                continue;
            }
        }

        console.log('No valid streams found');
        return { streams: [] };

    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
