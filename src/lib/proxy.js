const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');

function getProxiedAxios(proxy) {
    if (!proxy) return axios;
    
    const httpsAgent = new HttpsProxyAgent(proxy);
    return axios.create({ httpsAgent });
}

module.exports = { getProxiedAxios };
