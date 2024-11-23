const axios = require('axios');

// Helper function to extract quality and resolution info
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

    // Check for quality indicators
    Object.entries(quality).forEach(([key, value]) => {
        if (normalizedName.includes(key.toUpperCase())) {
            score = Math.max(score, value);
        }
    });

    // Additional quality bonuses
    if (normalizedName.includes('HDR')) score += 0.5;
    if (normalizedName.includes('10BIT')) score += 0.3;
    if (normalizedName.includes('HEVC') || normalizedName.includes('X265')) score += 0.2;
    if (normalizedName.includes('REMUX')) score += 1;

    return score;
}

async function processWithRealDebrid(streams, apiKey) {
    if (!apiKey) return [];

    const processedStreams = [];
    
    for (const stream of streams) {
        if (!stream.infoHash) continue;

        try {
            // Construct magnet link with both hash and name
            const magnet = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(stream.name)}`;

            // Step 1: Add magnet to Real-Debrid
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
                console.error('No torrent ID received');
                continue;
            }

            const torrentId = addTorrentResponse.data.id;

            // Step 2: Get torrent info and wait for availability
            let torrentInfo;
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                torrentInfo = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                if (torrentInfo.data.status === 'waiting_files_selection') {
                    break;
                }

                attempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (!torrentInfo || !torrentInfo.data.files || torrentInfo.data.files.length === 0) {
                console.error('No files found in torrent');
                continue;
            }

            // Step 3: Select the largest video file
            const files = torrentInfo.data.files;
            let maxFileId = null;
            let maxSize = 0;

            files.forEach(file => {
                const isVideo = /\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i.test(file.path);
                if (isVideo && file.bytes > maxSize) {
                    maxSize = file.bytes;
                    maxFileId = file.id;
                }
            });

            if (!maxFileId) maxFileId = '1';

            // Step 4: Select files
            await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 
                `files=${maxFileId}`,
                { 
                    headers: { 
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    } 
                }
            );

            // Step 5: Wait for the torrent to be processed
            let downloadLink = null;
            attempts = 0;

            while (!downloadLink && attempts < 10) {
                const statusResponse = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                if (statusResponse.data.links && statusResponse.data.links.length > 0) {
                    // Step 6: Unrestrict the link
                    const unrestrictResponse = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link',
                        `link=${statusResponse.data.links[0]}`,
                        { 
                            headers: { 
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/x-www-form-urlencoded'
                            } 
                        }
                    );

                    if (unrestrictResponse.data.download) {
                        downloadLink = unrestrictResponse.data.download;
                        break;
                    }
                }

                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (downloadLink) {
                const fileSize = maxSize ? `${(maxSize / (1024 * 1024 * 1024)).toFixed(2)} GB` : '';
                const qualityScore = getQualityInfo(stream.name);
                
                processedStreams.push({
                    name: `🌟 RD | ${stream.name}`,
                    title: `${fileSize} | Real-Debrid`,
                    url: downloadLink,
                    behaviorHints: {
                        bingeGroup: `RD-${stream.infoHash}`,
                        notWebReady: false
                    },
                    qualityScore: qualityScore, // Added for sorting
                    size: maxSize // Added for sorting
                });
            }

        } catch (error) {
            console.error('Real-Debrid processing error:', error.message);
            if (error.response) {
                console.error('Error details:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
        }
    }

    // Sort streams by quality score and size
    return processedStreams.sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) {
            return b.qualityScore - a.qualityScore;
        }
        return b.size - a.size;
    });
}

module.exports = { processWithRealDebrid };
