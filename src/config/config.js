function getConfig(configInput = {}) {
    return {
        realdebridKey: configInput.realdebridKey || '',
        filterCodecs: configInput.filterCodecs || false
    };
}

module.exports = { getConfig };
