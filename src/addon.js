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
        // Add more specific patterns for shows like Yellowstone
        `${season} season`,
        `season${season}`,
        // Additional patterns for various naming conventions
        `${s}complete`,
        `season${s}`,
        `${season}x00`,
        `s${s}pack`,
        `season${season}pack`
    ];

    // Check for season pack indicators
    const isPack = patterns.some(pattern => {
        const isMatch = normalizedName.includes(pattern.toLowerCase());
        if (config.debug && isMatch) {
            console.log(`Season pack pattern matched: ${pattern} for ${name}`);
        }
        return isMatch;
    });

    if (!isPack) return false;

    // Enhanced episode pattern detection
    const episodePatterns = [
        new RegExp(`s${s}e([0-9]{2})`, 'i'),
        new RegExp(`${season}x([0-9]{2})`, 'i'),
        new RegExp(`episode.?([0-9]{1,2})`, 'i'),
        new RegExp(`e([0-9]{2})`, 'i'),
        new RegExp(`${season}x([0-9]{2})`, 'i')
    ];

    // Check if it's a single episode
    for (const pattern of episodePatterns) {
        const match = normalizedName.match(pattern);
        if (match) {
            const epNum = parseInt(match[1]);
            if (config.debug) {
                console.log(`Episode number found: ${epNum} in ${name}`);
            }
            // Consider it a pack if it's a special episode number (like E00)
            return epNum === 0;
        }
    }

    // Additional checks for season pack indicators
    const seasonIndicators = [
        'complete',
        'season',
        'collection',
        'all.episodes',
        'full.season',
        'full',
    ];

    const hasSeasonIndicator = seasonIndicators.some(indicator => 
        normalizedName.includes(indicator.toLowerCase())
    );

    if (config.debug && hasSeasonIndicator) {
        console.log(`Season indicator found in: ${name}`);
    }

    return true;
}

builder.defineStreamHandler(async ({ type, id }) => {
    try {
        console.log(`Processing request for ${type} - ${id}`);
        
        if (!config.realDebridKey) {
            console.log('No Real-Debrid API key configured');
            return { streams: [] };
        }

        const [imdbId, season, episode] = id.split(':');
        let torrents = await getTorrents(imdbId, type, season);
        console.log(`Found ${torrents.length} initial torrents for ${imdbId}`);

        if (config.debug) {
            console.log('Initial torrents:', torrents.map(t => ({
                name: t.name,
                size: t.size,
                seeds: t.seeds
            })));
        }

        // Filter out unwanted torrents
        torrents = torrents.filter(torrent => {
            if (!torrent.seeds || torrent.seeds < config.filters.minSeeds) {
                if (config.debug) console.log(`Filtered out due to seeds: ${torrent.name} (${torrent.seeds})`);
                return false;
            }
            
            const name = torrent.name.toLowerCase();
            if (config.filters.excludeX265 && name.includes('x265')) {
                if (config.debug) console.log(`Filtered out x265: ${torrent.name}`);
                return false;
            }
            if (config.filters.excludeHEVC && name.includes('hevc')) {
                if (config.debug) console.log(`Filtered out HEVC: ${torrent.name}`);
                return false;
            }
            if (config.filters.excludeH265 && name.includes('h265')) {
                if (config.debug) console.log(`Filtered out H265: ${torrent.name}`);
                return false;
            }
            
            const sizeGB = torrent.size / (1024 * 1024 * 1024);
            if (sizeGB < config.filters.minSize || sizeGB > config.filters.maxSize) {
                if (config.debug) console.log(`Filtered out due to size: ${torrent.name} (${sizeGB.toFixed(2)}GB)`);
                return false;
            }

            return true;
        });

        // Sort all torrents by quality first
        torrents = sortTorrents(torrents);

        if (type === 'series' && season) {
            // Split torrents into season packs and regular episodes
            const seasonPacks = torrents.filter(t => isSeasonPack(t.name, season));
            const episodeTorrents = torrents.filter(t => !isSeasonPack(t.name, season));
            
            console.log(`Found ${seasonPacks.length} season packs and ${episodeTorrents.length} episode torrents`);
            
            if (config.debug) {
                console.log('Season packs:', seasonPacks.map(t => t.name));
                console.log('Episode torrents:', episodeTorrents.map(t => t.name));
            }

            // Prioritize season packs but keep some episode torrents as backup
            const topSeasonPacks = seasonPacks.slice(0, 5); // Increased from 3 to 5
            const topEpisodeTorrents = episodeTorrents.slice(0, 10); // Increased from 7 to 10
            torrents = [...topSeasonPacks, ...topEpisodeTorrents];
        }

        const streams = [];
        const processedHashes = new Set();

        for (const torrent of torrents) {
            if (processedHashes.has(torrent.infoHash)) {
                if (config.debug) console.log(`Skipping duplicate hash: ${torrent.infoHash}`);
                continue;
            }
            processedHashes.add(torrent.infoHash);

            console.log(`Processing torrent: ${torrent.name}`);
            
            try {
                const debridStream = await processWithRealDebrid(
                    {
                        name: torrent.name,
                        infoHash: torrent.infoHash || torrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase()
                    },
                    config.realDebridKey,
                    { type, season, episode }
                );
                
                if (debridStream) {
                    if (config.debug) {
                        console.log('Successfully processed stream:', {
                            name: debridStream.name,
                            quality: debridStream.qualityScore,
                            size: debridStream.size
                        });
                    }

                    streams.push(debridStream);
                    
                    // For movies, get a few good quality streams
                    if (type === 'movie' && streams.length >= 3 && 
                        streams.some(s => s.qualityScore > 3)) {
                        break;
                    }
                    
                    // For series, get more options
                    if (type === 'series' && streams.length >= 5) {
                        break;
                    }
                }
            } catch (error) {
                console.error(`Error processing torrent ${torrent.name}:`, error);
                continue;
            }
        }

        // Sort streams by quality score
        streams.sort((a, b) => b.qualityScore - a.qualityScore);

        // Add more detailed stream information
        const enhancedStreams = streams.map(stream => ({
            ...stream,
            description: `${stream.title} | Quality Score: ${stream.qualityScore}`,
            behaviorHints: {
                ...stream.behaviorHints,
                bingeGroup: `RD-${type}-${stream.qualityScore}`,
            }
        }));

        if (config.debug) {
            console.log(`Returning ${enhancedStreams.length} streams`);
            console.log('Stream quality scores:', enhancedStreams.map(s => s.qualityScore));
        }

        return { streams: enhancedStreams };

    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
