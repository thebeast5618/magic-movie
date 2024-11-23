const axios = require('axios');

function getQualityInfo(name) {
    const quality = {
        '2160p': 4,
        '1080p': 3,
        '720p': 2,
        '480p': 1,
        'HDR': 4.5,
        'REMUX': 5,
        'BLURAY': 4.5,
        'WEB-DL': 3.5,
        'WEBRip': 3,
        'BRRip': 2.5,
        'DVDRip': 1.5
    };

    let score = 0;
    const normalizedName = name.toUpperCase();

    Object.entries(quality).forEach(([key, value]) => {
        if (normalizedName.includes(key.toUpperCase())) {
            score = Math.max(score, value);
        }
    });

    if (normalizedName.includes('HDR')) score += 0.5;
    if (normalizedName.includes('10BIT')) score += 0.3;
    if (normalizedName.includes('HEVC') || normalizedName.includes('X265')) score += 0.2;
    if (normalizedName.includes('REMUX')) score += 1;

    return score;
}

function isVideoFile(filename) {
    return /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm)$/i.test(filename);
}

async function checkRealDebridLibrary(apiKey, imdbId, type, season = null, episode = null) {
    try {
        const baseUrl = 'https://api.real-debrid.com/rest/1.0';
        const headers = { 
            'Authorization': `Bearer ${apiKey}`
        };

        // Get all torrents from Real-Debrid
        const response = await axios.get(`${baseUrl}/torrents`, { headers });
        const torrents = response.data;

        // Filter torrents based on type and identifiers
        const relevantTorrents = torrents.filter(torrent => {
            const name = torrent.filename.toLowerCase();
            
            // Check if it matches the IMDB ID
            if (name.includes(imdbId.toLowerCase())) return true;
            
            // For series, check season/episode patterns
            if (type === 'series' && season) {
                const s = season.toString().padStart(2, '0');
                const e = episode ? episode.toString().padStart(2, '0') : null;
                
                const seasonPattern = new RegExp(`s${s}|season.?${season}`, 'i');
                if (!seasonPattern.test(name)) return false;
                
                if (episode) {
                    const episodePattern = new RegExp(`s${s}e${e}|${season}x${e}|e${e}\\b`, 'i');
                    return episodePattern.test(name);
                }
                
                return true;
            }
            
            return false;
        });

        return relevantTorrents;
    } catch (error) {
        console.error('Error checking Real-Debrid library:', error);
        return [];
    }
}

async function normalProcessWithRealDebrid(torrent, apiKey, options = {}) {
    try {
        // Add magnet to Real-Debrid
        const addMagnetResponse = await axios.post(
            'https://api.real-debrid.com/rest/1.0/torrents/addMagnet',
            `magnet=${encodeURIComponent(torrent.magnet)}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const torrentId = addMagnetResponse.data.id;

        // Select files (all video files for movies, specific episode for series)
        const torrentInfo = await axios.get(
            `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
            {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            }
        );

        const files = torrentInfo.data.files;
        let selectedFiles;

        if (options.type === 'series' && options.season && options.episode) {
            const episodeFile = findEpisodeFile(files, options.season, options.episode);
            selectedFiles = episodeFile ? [episodeFile.id] : [files[0].id];
        } else {
            selectedFiles = files.filter(f => isVideoFile(f.path)).map(f => f.id);
        }

        // Select files in Real-Debrid
        await axios.post(
            `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
            `files=${selectedFiles.join(',')}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        // Wait for the torrent to be processed
        let links;
        for (let i = 0; i < 10; i++) {
            const statusResponse = await axios.get(
                `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
                {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                }
            );

            if (statusResponse.data.links && statusResponse.data.links.length > 0) {
                links = statusResponse.data.links;
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!links || links.length === 0) {
            throw new Error('No links generated');
        }

        // Unrestrict the link
        const unrestrictResponse = await axios.post(
            'https://api.real-debrid.com/rest/1.0/unrestrict/link',
            `link=${links[0]}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        return {
            name: `🌟 ${torrent.name}`,
            url: unrestrictResponse.data.download,
            title: `Real-Debrid | ${getQualityInfo(torrent.name).toFixed(1)}⭐`,
            behaviorHints: {
                bingeGroup: options.type === 'series' ? `RD-${options.imdbId}-S${options.season}` : undefined
            }
        };
    } catch (error) {
        console.error('Error in normalProcessWithRealDebrid:', error);
        return null;
    }
}

async function processWithRealDebrid(stream, apiKey, options = {}) {
    const { type, season, episode } = options;
    
    try {
        // First try the normal torrent processing
        const result = await normalProcessWithRealDebrid(stream, apiKey, options);
        if (result) return result;

        // If no result, check Real-Debrid library
        console.log('Checking Real-Debrid library for existing content...');
        const libraryTorrents = await checkRealDebridLibrary(apiKey, options.imdbId, type, season, episode);
        
        for (const torrent of libraryTorrents) {
            if (torrent.links && torrent.links.length > 0) {
                const unrestricted = await axios.post(
                    'https://api.real-debrid.com/rest/1.0/unrestrict/link',
                    `link=${torrent.links[0]}`,
                    { 
                        headers: { 
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        } 
                    }
                );

                if (unrestricted.data.download) {
                    return {
                        name: `💫 RD Library | ${torrent.filename}`,
                        url: unrestricted.data.download,
                        title: `Real-Debrid Library`,
                        behaviorHints: {
                            bingeGroup: type === 'series' ? `RD-LIB-${options.imdbId}-S${season}` : undefined
                        }
                    };
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error in processWithRealDebrid:', error);
        return null;
    }
}

function findEpisodeFile(files, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    // Sort files by size (largest first) to prefer higher quality versions
    const videoFiles = files
        .filter(file => isVideoFile(file.path))
        .sort((a, b) => b.bytes - a.bytes);

    // Normalize paths for matching
    const normalizedFiles = videoFiles.map(file => ({
        ...file,
        normalizedPath: file.path.toLowerCase()
    }));

    // First try exact episode match with strict patterns
    const strictPatterns = [
        `s${s}e${e}`,
        `${s}x${e}`,
        `season.${season}.episode.${episode}`,
        `season ${season} episode ${episode}`,
        `e${e}`,
    ];

    for (const file of normalizedFiles) {
        const filename = file.normalizedPath;
        if (strictPatterns.some(pattern => filename.includes(pattern))) {
            console.log(`Found exact match for S${s}E${e}: ${file.path}`);
            return file;
        }
    }

    // Try numerical matching as fallback
    const seasonPattern = new RegExp(`season[ .]?${season}|s${s}`, 'i');
    const seasonFiles = normalizedFiles.filter(file => seasonPattern.test(file.normalizedPath));

    if (seasonFiles.length > 0) {
        // Try to extract episode numbers
        for (const file of seasonFiles) {
            const filename = file.path.split(/[/\\]/).pop().toLowerCase();
            const patterns = [
                new RegExp(`e(\\d{1,2})`, 'i'),
                new RegExp(`ep(\\d{1,2})`, 'i'),
                new RegExp(`episode[. ](\\d{1,2})`, 'i'),
                new RegExp(`\\b(\\d{1,2})\\b`)
            ];

            for (const pattern of patterns) {
                const match = filename.match(pattern);
                if (match && parseInt(match[1]) === parseInt(episode)) {
                    console.log(`Found numerical match for S${s}E${e}: ${file.path}`);
                    return file;
                }
            }
        }
    }

    return null;
}

module.exports = { 
    processWithRealDebrid, 
    findEpisodeFile, 
    getQualityInfo,
    checkRealDebridLibrary 
};
