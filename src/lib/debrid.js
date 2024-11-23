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
    const videoExtensions = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm|ts|m2ts)$/i;
    return videoExtensions.test(filename);
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

    // Enhanced patterns for episode matching
    const strictPatterns = [
        // Standard patterns
        `s${s}e${e}\\b`,
        `${s}x${e}\\b`,
        `season.?${season}.?episode.?${episode}\\b`,
        `season.?${season}.?ep.?${episode}\\b`,
        `^${e}\\b`,
        `.e${e}\\b`,
        // Additional patterns for shows like Yellowstone
        `${season}x${e}\\b`,
        `season.?${season}.${e}\\b`,
        `s${s}.${e}\\b`,
        `${season}.?${episode}\\b`,
        `episode.?${episode}\\b`,
        `ep.?${episode}\\b`,
        // Numeric patterns
        `\\b${episode}\\b`,
        `episode ${episode}\\b`,
        // Handle cases where episode number is at the end
        `[^0-9]${episode}$`
    ];

    // Special handling for episode 1 to avoid confusion with 10,11,etc
    if (episode === '01') {
        const exclusionPatterns = [`e10`, `e11`, `e12`, `e13`, `e14`, `e15`, `e16`, `e17`, `e18`, `e19`];
        
        for (const file of normalizedFiles) {
            const hasPattern = strictPatterns.some(pattern => {
                const matches = new RegExp(pattern, 'i').test(file.normalizedPath);
                if (matches && process.env.DEBUG) {
                    console.log(`Pattern ${pattern} matched file: ${file.path}`);
                }
                return matches;
            });
            
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
            const matchingPattern = strictPatterns.find(pattern => 
                new RegExp(pattern, 'i').test(file.normalizedPath)
            );
            
            if (matchingPattern) {
                if (process.env.DEBUG) {
                    console.log(`Pattern ${matchingPattern} matched file: ${file.path}`);
                }
                console.log(`Found exact match for S${s}E${e}: ${file.path}`);
                return file;
            }
        }
    }

    // Enhanced season folder detection
    const seasonPatterns = [
        new RegExp(`season.?${season}\\b`, 'i'),
        new RegExp(`s${s}\\b`, 'i'),
        new RegExp(`\\b${season}\\b`, 'i'),
        new RegExp(`season.?${season}[^0-9]`, 'i'),
        new RegExp(`^${season}[^0-9]`, 'i')
    ];

    // Try to find files in season folders
    const seasonFolderFiles = normalizedFiles.filter(file => {
        return file.parts.some(part => 
            seasonPatterns.some(pattern => pattern.test(part))
        );
    });

    if (seasonFolderFiles.length > 0) {
        // Enhanced episode number detection
        const episodeFiles = seasonFolderFiles.map(file => {
            const filename = file.parts[file.parts.length - 1];
            let episodeNum = null;

            const patterns = [
                new RegExp(`e(\\d{1,2})\\b`, 'i'),
                new RegExp(`ep(\\d{1,2})\\b`, 'i'),
                new RegExp(`episode[. ](\\d{1,2})\\b`, 'i'),
                new RegExp(`^(\\d{1,2})\\b`),
                new RegExp(`${season}x(\\d{1,2})\\b`, 'i'),
                new RegExp(`\\b(\\d{1,2})\\b`),
                // Additional patterns for numeric-only filenames
                new RegExp(`[^0-9](\\d{1,2})[^0-9]`),
                new RegExp(`^(\\d{1,2})[^0-9]`)
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

        if (process.env.DEBUG) {
            console.log('Sorted episodes:', sortedEpisodes.map(f => ({
                path: f.path,
                episodeNum: f.episodeNum
            })));
        }

        // Try exact episode match first
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

    // Last resort: try numerical ordering within season folders
    const seasonFiles = normalizedFiles.filter(file => {
        return file.parts.some(part => 
            seasonPatterns.some(pattern => pattern.test(part))
        );
    });

    if (seasonFiles.length > 0) {
        // Natural sort by filename
        const sortedByName = seasonFiles.sort((a, b) => {
            const aName = a.path.split(/[/\\]/).pop();
            const bName = b.path.split(/[/\\]/).pop();
            return aName.localeCompare(bName, undefined, {numeric: true});
        });

        if (process.env.DEBUG) {
            console.log('Sorted files by name:', sortedByName.map(f => f.path));
        }

        if (sortedByName.length >= parseInt(episode)) {
            const potentialEpisode = sortedByName[parseInt(episode) - 1];
            console.log(`Found episode by folder position for S${s}E${e}: ${potentialEpisode.path}`);
            return potentialEpisode;
        }
    }

    console.log(`No matching episode found for S${s}E${e}`);
    return null;
}

async function processWithRealDebrid(torrent, apiKey, metadata) {
    try {
        const baseUrl = 'https://api.real-debrid.com/rest/1.0';
        const headers = { Authorization: `Bearer ${apiKey}` };

        // Add magnet/torrent to Real-Debrid
        const addResponse = await axios.post(`${baseUrl}/torrents/addMagnet`, {
            magnet: `magnet:?xt=urn:btih:${torrent.infoHash}`
        }, { headers });

        const torrentId = addResponse.data.id;

        // Select all files by default for movies
        const info = await axios.get(`${baseUrl}/torrents/info/${torrentId}`, { headers });
        
        let fileToDownload;
        if (metadata.type === 'series' && metadata.season && metadata.episode) {
            fileToDownload = findEpisodeFile(info.data.files, metadata.season, metadata.episode);
            if (!fileToDownload) {
                throw new Error('Could not find matching episode file');
            }
        } else {
            // For movies, select the largest video file
            fileToDownload = info.data.files
                .filter(file => isVideoFile(file.path))
                .sort((a, b) => b.bytes - a.bytes)[0];
        }

        if (!fileToDownload) {
            throw new Error('No suitable video file found');
        }

        // Select files for download
        await axios.post(`${baseUrl}/torrents/selectFiles/${torrentId}`, {
            files: info.data.files.indexOf(fileToDownload) + 1
        }, { headers });

        // Get instant availability status
        const availabilityResponse = await axios.get(
            `${baseUrl}/torrents/instantAvailability/${torrent.infoHash}`,
            { headers }
        );

        const isInstantlyAvailable = availabilityResponse.data[torrent.infoHash.toLowerCase()]?.rd?.length > 0;

        if (!isInstantlyAvailable) {
            console.log('Torrent not instantly available, starting conversion...');
            // Start the conversion
            await axios.post(`${baseUrl}/torrents/select/${torrentId}`, {}, { headers });
        }

        // Get download links
        const links = await axios.get(`${baseUrl}/torrents/info/${torrentId}`, { headers });
        
        if (!links.data.links || links.data.links.length === 0) {
            throw new Error('No download links available');
        }

        // Unrestrict the link
        const unrestrictResponse = await axios.post(`${baseUrl}/unrestrict/link`, {
            link: links.data.links[0]
        }, { headers });

        const qualityScore = getQualityInfo(torrent.name);

        return {
            name: 'Real-Debrid',
            title: `[RD] ${fileToDownload.path.split('/').pop()} (Quality: ${qualityScore.toFixed(1)})`,
            url: unrestrictResponse.data.download,
            qualityScore,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `rd-${qualityScore}`
            }
        };

    } catch (error) {
        console.error('Real-Debrid processing error:', error.message);
        if (process.env.DEBUG) {
            console.error('Full error:', error);
        }
        return null;
    }
}

module.exports = {
    processWithRealDebrid,
    findEpisodeFile,
    getQualityInfo,
    isVideoFile
};
