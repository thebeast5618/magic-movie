const { serveHTTP, publishToCentral } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

serveHTTP(addonInterface, { port: process.env.PORT || 3000 });

if (process.env.NODE_ENV === 'production') {
    publishToCentral('https://your-addon-url.com/manifest.json');
}
