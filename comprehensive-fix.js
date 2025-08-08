#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Applying comprehensive YouTube streaming fix...');

const musicUtilsPath = path.join(__dirname, 'utils', 'musicUtils.js');
const backupPath = path.join(__dirname, 'utils', 'musicUtils.js.backup');

// Create backup
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(musicUtilsPath, backupPath);
    console.log('✅ Backup created');
}

// Multi-method streaming function
const newFunction = `
async function createAudioStream(url) {
    console.log('🎵 Multi-method streaming for:', url);
    
    // Method 1: Try yt-dlp-wrap (most reliable)
    try {
        console.log('🔧 Trying yt-dlp-wrap...');
        const YTDlpWrap = require('yt-dlp-wrap').default;
        const ytDlpWrap = new YTDlpWrap();
        
        // Get stream URL
        const streamUrl = await ytDlpWrap.execPromise([
            url,
            '--get-url',
            '--format', 'bestaudio[ext=webm]/bestaudio'
        ]);
        
        if (streamUrl && streamUrl.trim()) {
            console.log('✅ Got stream URL with yt-dlp');
            
            // Create a simple HTTP stream
            const https = require('https');
            const { PassThrough } = require('stream');
            const stream = new PassThrough();
            
            https.get(streamUrl.trim(), (response) => {
                response.pipe(stream);
            });
            
            return { stream, inputType: 'arbitrary' };
        }
    } catch (error) {
        console.log('❌ yt-dlp-wrap failed:', error.message);
    }
    
    // Method 2: Try basic ytdl-core with different settings
    try {
        console.log('🔧 Trying basic ytdl-core...');
        const ytdl = require('ytdl-core');
        
        if (ytdl.validateURL(url)) {
            const stream = ytdl(url, {
                filter: 'audioonly',
                quality: 'lowest',
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
                    }
                }
            });
            
            console.log('✅ Basic ytdl-core stream created');
            return { stream, inputType: 'arbitrary' };
        }
    } catch (error) {
        console.log('❌ ytdl-core failed:', error.message);
    }
    
    // Method 3: Error message
    console.error('❌ All streaming methods failed');
    throw new Error('🚫 Unable to stream this video. YouTube may be temporarily blocking requests.');
}`;

// Read current file
let content = fs.readFileSync(musicUtilsPath, 'utf8');

// Find and replace the function
const functionStart = content.indexOf('async function createAudioStream(');
if (functionStart === -1) {
    console.log('❌ Could not find createAudioStream function');
    process.exit(1);
}

// Find the end of the function
let braceCount = 0;
let pos = functionStart;
let functionEnd = -1;

while (pos < content.length) {
    if (content[pos] === '{') braceCount++;
    if (content[pos] === '}') {
        braceCount--;
        if (braceCount === 0) {
            functionEnd = pos + 1;
            break;
        }
    }
    pos++;
}

if (functionEnd === -1) {
    console.log('❌ Could not find end of function');
    process.exit(1);
}

// Replace the function
const newContent = content.substring(0, functionStart) + 
                  newFunction.trim() + 
                  content.substring(functionEnd);

fs.writeFileSync(musicUtilsPath, newContent);

console.log('✅ Applied comprehensive streaming fix');
console.log('🎯 This tries yt-dlp-wrap first, then basic ytdl-core');
console.log('📦 Install dependencies: npm install yt-dlp-wrap --legacy-peer-deps');
console.log('🚀 Restart: pm2 restart discord-bot');
