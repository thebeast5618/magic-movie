const RealDebrid = require('real-debrid');

async function processWithRealDebrid(streams, apiKey) {
    const rd = new RealDebrid(apiKey);
    
    const processed = await Promise.all(
        streams.map(async stream => {
            try {
                const torrentInfo = await rd.addMagnet(stream.infoHash);
                const links = await rd.getTorrentLinks(torrentInfo.id);
                
                return {
                    ...stream,
                    url: links[0],
                    behavioral: {
                        autoPlay: true,
                        autoSkip: false
                    }
                };
            } catch (error) {
                return stream;
            }
        })
    );
    
    return processed.filter(stream => stream.url);
}

module.exports = { processWithRealDebrid };
