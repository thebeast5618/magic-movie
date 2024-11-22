const axios = require('axios');

async function processWithRealDebrid(streams, apiKey) {
    if (!apiKey) return streams;

    try {
        const processedStreams = [];
        
        for (const stream of streams) {
            if (!stream.infoHash) continue;

            try {
                // Add magnet to Real-Debrid
                const addMagnetResponse = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
                    magnet: `magnet:?xt=urn:btih:${stream.infoHash}`,
                }, {
                    headers: { Authorization: `Bearer ${apiKey}` }
                });

                // Select files
                const torrentId = addMagnetResponse.data.id;
                await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, {
                    files: "all"
                }, {
                    headers: { Authorization: `Bearer ${apiKey}` }
                });

                // Get links
                const linksResponse = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                    headers: { Authorization: `Bearer ${apiKey}` }
                });

                if (linksResponse.data.links && linksResponse.data.links.length > 0) {
                    // Unrestrict link
                    const unrestrictResponse = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
                        link: linksResponse.data.links[0]
                    }, {
                        headers: { Authorization: `Bearer ${apiKey}` }
                    });

                    processedStreams.push({
                        ...stream,
                        url: unrestrictResponse.data.download,
                        title: `🌟 RD | ${stream.title}`
                    });
                }
            } catch (error) {
                console.error(`Error processing stream with Real-Debrid: ${error.message}`);
                processedStreams.push(stream);
            }
        }

        return processedStreams;
    } catch (error) {
        console.error('Real-Debrid processing error:', error);
        return streams;
    }
}

module.exports = { processWithRealDebrid };
