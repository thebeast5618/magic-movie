const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const port = process.env.PORT || 3000;

serveHTTP(addonInterface, { port });

console.log(`Addon running at http://localhost:${port}`);
