const express = require('express');
const { config } = require('./config');
const { processWithRealDebrid } = require('./debrid');
const axios = require('axios');
const NodeCache = require('node-cache');

class Addon {
    constructor() {
        this.cache = new NodeCache({ stdTTL: config.cacheTime });
        this.manifest = {
            id: 'org.community.realdebrid',
            version: '1.0.0',
            name: 'Real-Debrid Community',
            description: 'Real-Debrid Community Addon',
            resources: ['stream'],
            types: ['movie', 'series'],
            catalogs: []
        };
    }

    async getManifest(req, res) {
        res.json(this.manifest);
    }

    validateAndFormatStream(stream) {
        if (!stream || !stream.infoHash || !stream.fileIdx || !stream.name || !stream.url) {
            return null;
        }

        if (!stream.magnet) {
            stream.magnet = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(stream.name)}`;
        }

        return stream;
    }

    matchesEpisodeCriteria(name, season, episode) {
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

    filterStreams(streams, type, season = null, episode = null) {
        return streams.filter(stream => {
            const name = stream.name.toLowerCase();

            // Quality filters
            if (config.filters.excludeX265 && name.includes('x265')) return false;
            if (config.filters.excludeHEVC && name.includes('hevc')) return false;
            if (config.filters.excludeH265 && name.includes('h265')) return false;

            // Size filter
            const maxSizeBytes = config.filters.maxSize * 1024 * 1024 * 1024;
            if (stream.size && stream.size > maxSizeBytes) return false;

            // Seeds filter
            if (stream.seeds < config.filters.minSeeds) return false;

            // Episode specific filtering
            if (type === 'series' && season && episode) {
                if (config.episodeHandling.preferIndividualEpisodes) {
                    if (!this.matchesEpisodeCriteria(name, season, episode)) {
                        // Check if it's a valid season pack when individual episodes are preferred
                        if (config.episodeHandling.allowSeasonPacks) {
                            const seasonPattern = new RegExp(`season.?${season}|s${season}\\b|complete`, 'i');
                            if (seasonPattern.test(name)) {
                                // Verify minimum size for season packs
                                return stream.size >= config.episodeHandling.minSeasonPackSize;
                            }
                        }
                        return false;
                    }
                }
            }

            return true;
        });
    }

    sortStreamsByQuality(streams) {
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

    async handleStream(req, res) {
        try {
            const { type, id, extra } = req.params;
            const cacheKey = `stream-${type}-${id}-${extra || ''}`;
            
            // Check cache
            const cachedResult = this.cache.get(cacheKey);
            if (cachedResult) {
                if (config.logging.debugMode) {
                    console.log('Returning cached result');
                }
                return res.json(cachedResult);
            }

            // Parse video info
            let videoInfo = { type, imdbId: id };
            if (type === 'series' && extra) {
                const [season, episode] = extra.split(':');
                videoInfo.season = parseInt(season);
                videoInfo.episode = parseInt(episode);
            }

            // Log request details if debug mode is enabled
            if (config.logging.debugMode) {
                console.log('Processing request:', {
                    type,
                    imdbId: id,
                    season: videoInfo.season,
                    episode: videoInfo.episode
                });
            }

            // Get streams from Torrentio
            const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}/${extra || ''}.json`;
            const response = await axios.get(torrentioUrl, {
                headers: { 'User-Agent': config.userAgent }
            });

            let streams = response.data.streams || [];

            // Process streams
            streams = streams
                .map(stream => this.validateAndFormatStream(stream))
                .filter(stream => stream !== null);

            // Apply filters
            streams = this.filterStreams(streams, type, videoInfo.season, videoInfo.episode);

            // Sort by quality
            streams = this.sortStreamsByQuality(streams);

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
                    if (config.logging.debugMode) {
                        console.error('Error processing stream:', error);
                    }
                }
            }

            const result = { streams: processedStreams };
            
            // Cache the result
            this.cache.set(cacheKey, result);
            
            res.json(result);
        } catch (error) {
            console.error('Error in stream handler:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    createServer() {
        const app = express();

        app.get('/manifest.json', (req, res) => this.getManifest(req, res));
        app.get('/stream/:type/:id/:extra?.json', (req, res) => this.handleStream(req, res));

        return app;
    }
}

module.exports = { Addon };
