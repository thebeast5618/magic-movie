const { addonBuilder } = require('stremio-addon-sdk');
const { getTorrents } = require('./lib/torrent');
const { processWithRealDebrid } = require('./lib/debrid');
const { config } = require('./config/config');

const manifest = {
    id: 'org.magicmovie',
    version: '1.0.0',
    name: 'Magic Movie',
    description: 'Stream movies and TV shows with Real-Debrid integration',
    types: ['movie', 'series'],
    catalogs: [],
    resources: ['stream'],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
    try {
        const imdbId = id.split(':')[0];
        const torrents = await getTorrents(imdbId);
        
        const streams = torrents.map(torrent => ({
            name: `💫 ${torrent.name}`,
            title: `${torrent.size} | S:${torrent.seeds} L:${torrent.leeches}`,
            infoHash: torrent.magnetLink.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase(),
        })).filter(s => s.infoHash);

        if (config.realDebridKey) {
            return { streams: await processWithRealDebrid(streams, config.realDebridKey) };
        }

        return { streams };
    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
