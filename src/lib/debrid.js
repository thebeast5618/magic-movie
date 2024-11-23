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
    
    const patterns = [
        new RegExp(`s${s}e${e}`, 'i'),
        new RegExp(`${s}x${e}`, 'i'),
        new RegExp(`season[. ]?${season}[. ]?episode[. ]?${episode}`, 'i'),
        new RegExp(`e${e}`, 'i'),
        new RegExp(`episode[. ]?${episode}`, 'i'),
        new RegExp(`[/\\\\]${episode}[. ][^/\\\\]*$`, 'i')
    ];

    // Filter video files and sort by size (largest first)
    const videoFiles = files
        .filter(file => isVideoFile(file.path))
        .sort((a, b) => b.bytes - a.bytes);

    // First try exact episode match
    for (const file of videoFiles) {
        for (const pattern of patterns) {
            if (pattern.test(file.path)) {
                return file;
            }
        }
    }

    // If no exact match found and files are numbered sequentially, try position-based matching
    if (videoFiles.length === episode) {
        return videoFiles[episode - 1];
    }

    return null;
}

async function processWithRealDebrid(stream, apiKey, options = {}) {
    if (!apiKey || !stream.infoHash) return null;

    const { type, season, episode } = options;
    
    try {
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
            // For TV series, try to find the specific episode
            const episodeFile = findEpisodeFile(files, season, episode);
            if (episodeFile) {
                selectedFiles = [episodeFile];
            }
        }

        // If no specific episode found or not a TV series, select the largest video file
        if (selectedFiles.length === 0) {
            selectedFiles = files
                .filter(file => isVideoFile(file.path))
                .sort((a, b) => b.bytes - a.bytes)
                .slice(0, 1);
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
