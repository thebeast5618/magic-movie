const axios = require('axios');

class RealDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });
    }

    async addMagnet(magnetLink) {
        try {
            const { data } = await this.client.post('/torrents/addMagnet', {
                magnet: magnetLink
            });
            return data;
        } catch (error) {
            console.error('RealDebrid addMagnet error:', error.message);
            throw error;
        }
    }

    async selectFiles(torrentId) {
        try {
            const { data } = await this.client.post(`/torrents/selectFiles/${torrentId}`, {
                files: 'all'
            });
            return data;
        } catch (error) {
            console.error('RealDebrid selectFiles error:', error.message);
            throw error;
        }
    }

    async getTorrentInfo(torrentId) {
        try {
            const { data } = await this.client.get(`/torrents/info/${torrentId}`);
            return data;
        } catch (error) {
            console.error('RealDebrid getTorrentInfo error:', error.message);
            throw error;
        }
    }

    async getUnrestrictedLink(link) {
        try {
            const { data } = await this.client.post('/unrestrict/link', {
                link: link
            });
            return data;
        } catch (error) {
            console.error('RealDebrid unrestrict error:', error.message);
            throw error;
        }
    }
}

async function processWithRealDebrid(streams, apiKey) {
    const rd = new RealDebrid(apiKey);
    
    const processed = await Promise.all(
        streams.map(async stream => {
            try {
                // Add magnet to Real-Debrid
                const torrent = await rd.addMagnet(stream.infoHash);
                
                // Select all files
                await rd.selectFiles(torrent.id);
                
                // Wait for torrent info
                const torrentInfo = await rd.getTorrentInfo(torrent.id);
                
                // Get unrestricted link for the largest file
                if (torrentInfo.links && torrentInfo.links.length > 0) {
                    const unrestrictedData = await rd.getUnrestrictedLink(torrentInfo.links[0]);
                    
                    return {
                        ...stream,
                        url: unrestrictedData.download,
                        behavioral: {
                            autoPlay: true,
                            autoSkip: false
                        }
                    };
                }
                return stream;
            } catch (error) {
                console.error('Processing stream error:', error.message);
                return stream;
            }
        })
    );
    
    return processed.filter(stream => stream.url);
}

module.exports = { processWithRealDebrid };
