const NodeCache = require('node-cache');
const cache = new NodeCache();

async function getCache(key) {
    return cache.get(key);
}

async function setCache(key, value, ttl = 3600) {
    return cache.set(key, value, ttl);
}

module.exports = { getCache, setCache };
