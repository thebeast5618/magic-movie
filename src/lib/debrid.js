const axios = require('axios');

function getQualityInfo(name) {
    const quality = {
        '2160p': 4,
        '1080p': 3,
        '720p': 2,
        '480p': 1,
        'HDR': 4.5,
        'REMUX': 5,
        'BLURAY': 4.5,
        'WEB-DL': 3.5,
        'WEBRip': 3,
        'BRRip': 2.5,
        'DVDRip': 1.5
    };

    let score = 0;
    const normalizedName = name.toUpperCase();

    Object.entries(quality).forEach(([key, value]) => {
        if (normalizedName.includes(key.toUpperCase())) {
            score = Math.max(score, value);
        }
    });

    if (normalizedName.includes('HDR')) score += 0.5;
    if (normalizedName.includes('10BIT')) score += 0.3;
    if (normalizedName.includes('HEVC') || normalizedName.includes('X265')) score += 0.2;
    if (normalizedName.includes('REMUX')) score += 1;

    return score;
}

function isVideoFile(filename) {
    return /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm)$/i.test(filename);
}

function findEpisodeFile(files, season, episode) {
    const s = season.toString().padStart(2, '0');
    const e = episode.toString().padStart(2, '0');
    
    const videoFiles = files
        .filter(file => isVideoFile(file.path))
        .sort((a, b) => b.bytes - a.bytes);

    const normalizedFiles = videoFiles.map(file => ({
        ...file,
        normalizedPath: file.path.toLowerCase(),
        parts: file.path.toLowerCase().split(/[/\\]/)
    }));

    // More comprehensive patterns for episode matching
    const strictPatterns = [
        `s${s}e${e}\\b`,
        `${s}x${e}\\b`,
        `season.?${season}.?episode.?${episode}\\b`,
        `season.?${season}.?ep.?${episode}\\b`,
        `^${e}\\b`,
        `.e${e}\\b`
    ];

    // Special handling for episode 1 to avoid confusion with 10,11,etc
    if (episode === '01') {
        const exclusionPatterns = [`e10`, `e11`, `e12`, `e13`, `e14`, `e15`, `e16`, `e17`, `e18`, `e19`];
        
        for (const file of normalizedFiles) {
            const hasPattern = strictPatterns.some(pattern => 
                new RegExp(pattern, 'i').test(file.normalizedPath)
            );
            const hasExclusion = exclusionPatterns.some(pattern => 
                file.normalizedPath.includes(pattern)
            );
            
            if (hasPattern && !hasExclusion) {
                console.log(`Found exact match for S${s}E${e}: ${file.path}`);
                return file;
            }
        }
    } else {
        // Regular episode matching
        for (const file of normalizedFiles) {
            if (strictPatterns.some(pattern => new RegExp(pattern, 'i').test(file.normalizedPath))) {
                console.log(`Found exact match for S${s}E${e}: ${file.path}`);
                return file;
            }
        }
    }

    // Try to find season folder structure
    const seasonFolderFiles = normalizedFiles.filter(file => {
        return file.parts.some(part => 
            part.match(new RegExp(`^season.?${season}$|^s${s}$`, 'i'))
        );
    });

    if (seasonFolderFiles.length > 0) {
        // Try to extract episode numbers
        const episodeFiles = seasonFolderFiles.map(file => {
            const filename = file.parts[file.parts.length - 1];
            let episodeNum = null;

            // Enhanced episode number detection
            const patterns = [
                new RegExp(`e(\\d{1,2})\\b`, 'i'),
                new RegExp(`ep(\\d{1,2})\\b`, 'i'),
                new RegExp(`episode[. ](\\d{1,2})\\b`, 'i'),
                new RegExp(`^(\\d{1,2})\\b`),
            ];

            for (const pattern of patterns) {
                const match = filename.match(pattern);
                if (match) {
                    const num = parseInt(match[1]);
                    if (num > 0 && num <= 100) {
                        episodeNum = num;
                        break;
                    }
                }
            }

            return {
                ...file,
                episodeNum
            };
        });

        // Sort by episode number and find match
        const sortedEpisodes = episodeFiles
            .filter(file => file.episodeNum !== null)
            .sort((a, b) => a.episodeNum - b.episodeNum);

        const matchingEpisode = sortedEpisodes.find(file => file.episodeNum === parseInt(episode));
        if (matchingEpisode) {
            console.log(`Found episode by number matching for S${s}E${e}: ${matchingEpisode.path}`);
            return matchingEpisode;
        }

        // If we have enough episodes and they seem to be in order
        if (sortedEpisodes.length >= parseInt(episode)) {
            const orderedEpisode = sortedEpisodes[parseInt(episode) - 1];
            if (orderedEpisode) {
                console.log(`Found episode by position for S${s}E${e}: ${orderedEpisode.path}`);
                return orderedEpisode;
            }
        }
    }

    // Last resort: try to find by simple numbering in a season folder
    const seasonFiles = normalizedFiles.filter(file => {
        const hasSeasonIndicator = file.normalizedPath.includes(`season${season}`) || 
                                 file.normalizedPath.includes(`s${s}`);
        const notOtherSeason = !file.normalizedPath.match(new RegExp(`season(?!${season}\\b)\\d+|s(?!${s}\\b)\\d{2}`, 'i'));
        return hasSeasonIndicator && notOtherSeason;
    });

    if (seasonFiles.length > 0) {
        const sortedByName = seasonFiles.sort((a, b) => {
            const aName = a.path.split(/[/\\]/).pop();
            const bName = b.path.split(/[/\\]/).pop();
            return aName.localeCompare(bName, undefined, {numeric: true});
        });

        if (sortedByName.length >= parseInt(episode)) {
            const potentialEpisode = sortedByName[parseInt(episode) - 1];
            console.log(`Found episode by folder position for S${s}E${e}: ${potentialEpisode.path}`);
            return potentialEpisode;
        }
    }

    console.log(`No matching episode found for S${s}E${e}`);
    return null;
}

async function processWithRealDebrid(stream, apiKey, options = {}) {
    if (!apiKey || !stream.infoHash) return null;

    const { type, season, episode } = options;
    
    try {
        console.log(`Processing stream: ${stream.name} (${type}, S${season}E${episode})`);
        const magnet = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(stream.name)}`;

        // Step 1: Add magnet
        const addTorrentResponse = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', 
            `magnet=${encodeURIComponent(magnet)}`,
            { 
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                } 
            }
        );

        if (!addTorrentResponse.data.id) {
            throw new Error('No torrent ID received');
        }

        const torrentId = addTorrentResponse.data.id;

        // Step 2: Get torrent info and wait for availability
        let torrentInfo;
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
            torrentInfo = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (torrentInfo.data.status === 'waiting_files_selection' || 
                torrentInfo.data.status === 'downloaded') {
                break;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!torrentInfo?.data?.files?.length) {
            throw new Error('No files found in torrent');
        }

        // For season packs, wait a bit longer to ensure all files are processed
        if (type === 'series' && torrentInfo.data.files.length > 5) {
            console.log('Large file count detected, waiting for full processing...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Step 3: Select files
        const files = torrentInfo.data.files;
        let selectedFiles = [];

        if (type === 'series' && season && episode) {
            const episodeFile = findEpisodeFile(files, season, episode);
            if (episodeFile) {
                selectedFiles = [episodeFile];
                console.log(`Selected episode file: ${episodeFile.path}`);
            }
        } else {
            // For movies or fallback: select largest video file
            const videoFiles = files
                .filter(file => isVideoFile(file.path))
                .sort((a, b) => b.bytes - a.bytes);
            
            if (videoFiles.length > 0) {
                selectedFiles = [videoFiles[0]];
                console.log(`Selected largest video file: ${videoFiles[0].path}`);
            }
        }

        if (selectedFiles.length === 0) {
            throw new Error('No suitable video files found');
        }

        // Select files on Real-Debrid
        const fileIds = selectedFiles.map(file => file.id).join(',');
        await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 
            `files=${fileIds}`,
            { 
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                } 
            }
        );

        // Step 4: Wait for processing and get links
        let downloadLinks = [];
        attempts = 0;

        while (attempts < maxAttempts) {
            const statusResponse = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (statusResponse.data.links?.length > 0) {
                const linkPromises = statusResponse.data.links.map(link =>
                    axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link',
                        `link=${link}`,
                        { 
                            headers: { 
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/x-www-form-urlencoded'
                            } 
                        }
                    )
                );

                const linkResponses = await Promise.all(linkPromises);
                downloadLinks = linkResponses.map(response => ({
                    url: response.data.download,
                    filename: response.data.filename,
                    filesize: response.data.filesize
                }));
                break;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (downloadLinks.length === 0) {
            throw new Error('No download links generated');
        }

        // Create stream object
        const selectedFile = selectedFiles[0];
        const fileSize = selectedFile.bytes ? `${(selectedFile.bytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : '';
        const qualityScore = getQualityInfo(stream.name);

        return {
            name: `🌟 RD | ${selectedFile.path.split(/[/\\]/).pop()}`,
            title: `${fileSize} | Real-Debrid`,
            url: downloadLinks[0].url,
            behaviorHints: {
                bingeGroup: type === 'series' ? `RD-${stream.infoHash}-S${season}` : `RD-${stream.infoHash}`,
                notWebReady: false
            },
            qualityScore: qualityScore,
            size: selectedFile.bytes,
            fileList: files.map((file, index) => ({
                path: file.path,
                url: downloadLinks[index]?.url || null,
                size: file.bytes
            }))
        };

    } catch (error) {
        console.error('Real-Debrid processing error:', error.message);
        return null;
    }
}

module.exports = { processWithRealDebrid };
