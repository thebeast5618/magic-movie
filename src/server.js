const express = require('express');
const { config } = require('./config');
const { processWithRealDebrid } = require('./debrid');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: config.cacheTime });

// Helper function to validate and format stream data
function validateAndFormatStream(stream) {
    if (!stream || !stream.infoHash || !stream.fileIdx || !stream.name || !stream.url) {
        return null;
    }

    // Create magnet link if not present
    if (!stream.magnet) {
        stream.magnet = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(stream.name)}`;
    }

    return stream;
}

// Helper function to check if a torrent matches episode criteria
function matchesEpisodeCriteria(name, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    const patterns = [
        new RegExp(`s${s}e${e}\\b`, 'i'),
        new RegExp(`${s}x${e}\\b`, 'i'),
        new RegExp(`season.?${season}.?episode.?${episode}\\b`, 'i'),
        new RegExp(`e${e}\\b`, 'i')
    ];

    return patterns.some(pattern => pattern.test(name));
}

// Helper function to filter streams based on config
function filterStreams(streams, type, season = null, episode = null) {
    return streams.filter(stream => {
        const name = stream.name.toLowerCase();

        // Apply quality filters
        if (config.filters.excludeX265 && name.includes('x265')) return false;
        if (config.filters.excludeHEVC && name.includes('hevc')) return false;
        if (config.filters.excludeH265 && name.includes('h265')) return false;

        // Size filter (convert GB to bytes)
        const maxSizeBytes = config.filters.maxSize * 1024 * 1024 * 1024;
        if (stream.size && stream.size > maxSizeBytes) return false;

        // Seeds filter
        if (stream.seeds < config.filters.minSeeds) return false;

        // Episode specific filtering for series
        if (type === 'series' && season && episode) {
            if (config.episodeHandling.preferIndividualEpisodes) {
                return matchesEpisodeCriteria(name, season, episode);
            }
        }

        return true;
    });
}

// Helper function to sort streams by quality
function sortStreamsByQuality(streams) {
    return streams.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        
        // Check preferred qualities
        for (const quality of config.filters.preferredQuality) {
            if (aName.includes(quality.toLowerCase()) && !bName.includes(quality.toLowerCase())) return -1;
            if (!aName.includes(quality.toLowerCase()) && bName.includes(quality.toLowerCase())) return 1;
        }

        // If no preferred quality matches, sort by seeds
        return b.seeds - a.seeds;
    });
}

app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'org.community.realdebrid',
        version: '1.0.0',
        name: 'Real-Debrid Community',
        description: 'Real-Debrid Community Addon',
        resources: ['stream'],
        types: ['movie', 'series'],
        catalogs: []
    });
});

app.get('/stream/:type/:id/:extra?.json', async (req, res) => {
    try {
        const { type, id, extra } = req.params;
        const cacheKey = `stream-${type}-${id}-${extra || ''}`;
        
        // Check cache first
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            console.log('Returning cached result');
            return res.json(cachedResult);
        }

        // Parse video info
        let videoInfo = { type, imdbId: id };
        if (type === 'series' && extra) {
            const [season, episode] = extra.split(':');
            videoInfo.season = parseInt(season);
            videoInfo.episode = parseInt(episode);
        }

        // Get stream data from Torrentio
        const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}/${extra || ''}.json`;
        const response = await axios.get(torrentioUrl, {
            headers: { 'User-Agent': config.userAgent }
        });

        let streams = response.data.streams || [];

        // Validate and format each stream
        streams = streams
            .map(validateAndFormatStream)
            .filter(stream => stream !== null);

        // Apply filters
        streams = filterStreams(streams, type, videoInfo.season, videoInfo.episode);

        // Sort by quality
        streams = sortStreamsByQuality(streams);

        // Process with Real-Debrid
        const processedStreams = [];
        for (const stream of streams) {
            try {
                const processed = await processWithRealDebrid(stream, config.realDebridKey, videoInfo);
                if (processed) {
                    processedStreams.push(processed);
                    if (config.singleLinkMode) break;
                }
            } catch (error) {
                console.error('Error processing stream:', error);
            }
        }

        const result = { streams: processedStreams };
        
        // Cache the result
        cache.set(cacheKey, result);
        
        res.json(result);
    } catch (error) {
        console.error('Error in stream handler:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
});
