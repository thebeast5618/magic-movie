const express = require('express');
const cors = require('cors');
const path = require('path');
const { config } = require('./config/config');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const rateLimit = require('express-rate-limit');

const app = express();

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

app.use(cors());
app.use(express.json());
app.use(limiter);

// Serve static files
app.use(express.static(path.join(__dirname, '../static')));

// Configuration page
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '../static/configure.html'));
});

// API endpoints for configuration
app.get('/api/config', (req, res) => {
    const publicConfig = {
        filters: config.filters,
        realDebridKey: config.realDebridKey ? '********' : ''
    };
    res.json(publicConfig);
});

app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        
        if (newConfig.realDebridKey) {
            config.realDebridKey = newConfig.realDebridKey;
        }
        
        if (newConfig.filters) {
            config.filters = {
                ...config.filters,
                ...newConfig.filters
            };
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stremio addon routes
app.use('/', getRouter(addonInterface));

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const port = config.port;
app.listen(port, () => {
    console.log(`Addon active on port ${port}`);
    console.log(`Configure at: http://localhost:${port}/configure`);
});
