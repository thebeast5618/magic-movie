const axios = require('axios');

async function processWithRealDebrid(streams, apiKey) {
    if (!apiKey) return streams;

    const processedStreams = [];
    
    for (const stream of streams) {
        if (!stream.infoHash) continue;

        try {
            // Construct magnet link
            const magnet = `magnet:?xt=urn:btih:${stream.infoHash}`;

            // Step 1: Add magnet to Real-Debrid
            const addTorrentResponse = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', 
                { magnet: magnet },
                { headers: { Authorization: `Bearer ${apiKey}` } }
            );

            const torrentId = addTorrentResponse.data.id;

            // Step 2: Get torrent info
            const torrentInfo = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });

            // Step 3: Select the largest file
            const files = torrentInfo.data.files;
            let maxFileId = '1'; // Default to first file
            let maxSize = 0;

            files.forEach(file => {
                if (file.bytes > maxSize) {
                    maxSize = file.bytes;
                    maxFileId = file.id;
                }
            });

            // Step 4: Select files
            await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 
                { files: maxFileId },
                { headers: { Authorization: `Bearer ${apiKey}` } }
            );

            // Step 5: Wait for the torrent to be processed
            let downloadLink = null;
            let attempts = 0;
            const maxAttempts = 5;

            while (!downloadLink && attempts < maxAttempts) {
                const statusResponse = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                    headers: { Authorization: `Bearer ${apiKey}` }
                });

                if (statusResponse.data.links && statusResponse.data.links.length > 0) {
                    // Step 6: Unrestrict the link
                    const unrestrictResponse = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', 
                        { link: statusResponse.data.links[0] },
                        { headers: { Authorization: `Bearer ${apiKey}` } }
                    );

                    downloadLink = unrestrictResponse.data.download;
                    break;
                }

                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between checks
            }

            if (downloadLink) {
                processedStreams.push({
                    name: `🌟 RD | ${stream.name}`,
                    title: `${stream.title} | Real-Debrid`,
                    url: downloadLink,
                    behaviorHints: {
                        bingeGroup: `RD-${stream.infoHash}`,
                        notWebReady: false
                    }
                });
            }

        } catch (error) {
            console.error('Real-Debrid processing error:', error.message);
            // Keep the original stream as fallback
            processedStreams.push(stream);
        }
    }

    return processedStreams;
}

module.exports = { processWithRealDebrid };
