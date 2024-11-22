const { addonBuilder } = require('stremio-addon-sdk');
const { getTorrents } = require('./lib/torrent');
const { processWithRealDebrid } = require('./lib/debrid');
const { getConfig } = require('./config/config');

const manifest = {
    id: 'org.magicmovie',
    version: '1.0.0',
    name: 'Magic Movie',
    description: 'Stream movies and TV shows from various torrent sources',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://your-hosted-domain.com/logo.png',
    background: 'https://your-hosted-domain.com/bg.jpg',
    config: {
        body: {
            realdebridKey: {
                type: 'string',
                title: 'Real-Debrid API Key',
                required: true
            },
            filterCodecs: {
                type: 'boolean',
                title: 'Filter HEVC/x265 Codecs',
                default: false
            }
        }
    }
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id, config }) => {
    const [imdbId] = id.split(':');
    const userConfig = getConfig(config);
    
    let streams = await getTorrents(imdbId, type);
    
    if (userConfig.filterCodecs) {
        streams = streams.filter(stream => 
            !stream.title.toLowerCase().includes('x265') && 
            !stream.title.toLowerCase().includes('hevc')
        );
    }
    
    if (userConfig.realdebridKey) {
        streams = await processWithRealDebrid(streams, userConfig.realdebridKey);
    }
    
    return { streams };
});

module.exports = builder.getInterface();
