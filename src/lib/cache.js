const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

async function cacheGet(key) {
    return cache.get(key);
}

async function cacheSet(key, value) {
    return cache.set(key, value);
}

module.exports = { cacheGet, cacheSet };
