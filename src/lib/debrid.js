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

    // Try to find numerically ordered files
    const seasonPattern = new RegExp(`season[ .]?${season}|s${s}`, 'i');
    const seasonFiles = normalizedFiles.filter(file => seasonPattern.test(file.normalizedPath));

    if (seasonFiles.length > 0) {
        // Try to extract episode numbers from filenames
        const episodeFiles = seasonFiles.map(file => {
            const filename = file.path.split(/[/\\]/).pop().toLowerCase();
            let episodeNum = null;

            // Try various patterns to extract episode number
            const patterns = [
                new RegExp(`e(\\d{1,2})`, 'i'),
                new RegExp(`ep(\\d{1,2})`, 'i'),
                new RegExp(`episode[. ](\\d{1,2})`, 'i'),
                new RegExp(`\\b(\\d{1,2})\\b`),
            ];

            for (const pattern of patterns) {
                const match = filename.match(pattern);
                if (match) {
                    const num = parseInt(match[1]);
                    if (num > 0 && num <= 100) { // Reasonable episode number range
                        episodeNum = num;
                        break;
                    }
                }
            }

            return {
                ...file,
                episodeNum
            };
        });

        // Sort by episode number
        const sortedEpisodes = episodeFiles
            .filter(file => file.episodeNum !== null)
            .sort((a, b) => a.episodeNum - b.episodeNum);

        // Find the matching episode
        const matchingEpisode = sortedEpisodes.find(file => file.episodeNum === parseInt(episode));
        if (matchingEpisode) {
            console.log(`Found episode by number matching for S${s}E${e}: ${matchingEpisode.path}`);
            return matchingEpisode;
        }

        // If we have the correct number of files, assume they're in order
        if (sortedEpisodes.length >= parseInt(episode)) {
            const orderedEpisode = sortedEpisodes[parseInt(episode) - 1];
            console.log(`Found episode by position for S${s}E${e}: ${orderedEpisode.path}`);
            return orderedEpisode;
        }
    }

    console.log(`No matching episode found for S${s}E${e}`);
    return null;
}

async function processWithRealDebrid(stream, apiKey, options = {}) {
    if (!apiKey || !stream.infoHash) return null;

    const { type, season, episode } = options;
    
    try {
        console.log(`Processing stream: ${stream.name} (${type}, S${season}E${episode})`);
        const magnet = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(stream.name)}`;

        // Step 1: Add magnet
        const addTorrentResponse = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', 
            `magnet=${encodeURIComponent(magnet)}`,
            { 
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                } 
            }
        );

        if (!addTorrentResponse.data.id) {
            throw new Error('No torrent ID received');
        }

        const torrentId = addTorrentResponse.data.id;

        // Step 2: Get torrent info
        let torrentInfo;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            torrentInfo = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (torrentInfo.data.status === 'waiting_files_selection') {
                break;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!torrentInfo?.data?.files?.length) {
            throw new Error('No files found in torrent');
        }

        // Step 3: Select files
        const files = torrentInfo.data.files;
        let selectedFiles = [];

        if (type === 'series' && season && episode) {
            const episodeFile = findEpisodeFile(files, season, episode);
            if (episodeFile) {
                selectedFiles = [episodeFile];
                console.log(`Selected episode file: ${episodeFile.path}`);
            }
        }

        if (selectedFiles.length === 0) {
            const largestVideo = files
                .filter(file => isVideoFile(file.path))
                .sort((a, b) => b.bytes - a.bytes)[0];
            
            if (largestVideo) {
                selectedFiles = [largestVideo];
                console.log(`Selected largest video file: ${largestVideo.path}`);
            }
        }

        if (selectedFiles.length === 0) {
            throw new Error('No suitable video files found');
        }

        // Select files
        const fileIds = selectedFiles.map(file => file.id).join(',');
        await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 
            `files=${fileIds}`,
            { 
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                } 
            }
        );

        // Step 4: Wait for processing and get links
        let downloadLinks = [];
        attempts = 0;

        while (attempts < 10) {
            const statusResponse = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (statusResponse.data.links?.length > 0) {
                const linkPromises = statusResponse.data.links.map(link =>
                    axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link',
                        `link=${link}`,
                        { 
                            headers: { 
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/x-www-form-urlencoded'
                            } 
                        }
                    )
                );

                const linkResponses = await Promise.all(linkPromises);
                downloadLinks = linkResponses.map(response => ({
                    url: response.data.download,
                    filename: response.data.filename
                }));
                break;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (downloadLinks.length > 0) {
            const selectedFile = selectedFiles[0];
            const fileSize = selectedFile.bytes ? `${(selectedFile.bytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : '';
            const qualityScore = getQualityInfo(stream.name);
            
            return {
                name: `🌟 RD | ${selectedFile.path.split(/[/\\]/).pop()}`,
                title: `${fileSize} | Real-Debrid`,
                url: downloadLinks[0].url,
                behaviorHints: {
                    bingeGroup: type === 'series' ? `RD-${stream.infoHash}-S${season}` : `RD-${stream.infoHash}`,
                    notWebReady: false
                },
                qualityScore: qualityScore,
                size: selectedFile.bytes,
                fileList: files.map((file, index) => ({
                    path: file.path,
                    url: downloadLinks[index]?.url || null,
                    size: file.bytes
                }))
            };
        }

        return null;

    } catch (error) {
        console.error('Real-Debrid processing error:', error.message);
        return null;
    }
}

module.exports = { processWithRealDebrid };
