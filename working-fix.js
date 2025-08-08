#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🎯 Applying working YouTube streaming fix...');

const musicUtilsPath = path.join(__dirname, 'utils', 'musicUtils.js');
const backupPath = path.join(__dirname, 'utils', 'musicUtils.js.backup');

// Create backup
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(musicUtilsPath, backupPath);
    console.log('✅ Backup created');
}

// Working streaming function that bypasses YouTube blocks
const newFunction = `
async function createAudioStream(url) {
    console.log('🎵 Working streaming method for:', url);
    
    try {
        const ytdl = require('ytdl-core');
        
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }
        
        console.log('📺 Getting fresh stream info...');
        
        // Get video info first to ensure it's accessible
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                }
            }
        });
        
        console.log('✅ Video info retrieved:', info.videoDetails.title);
        
        // Create stream with fresh info
        const stream = ytdl.downloadFromInfo(info, {
            filter: 'audioonly',
            quality: 'lowest',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }
        });
        
        console.log('✅ Fresh stream created successfully');
        return { stream, inputType: 'arbitrary' };
        
    } catch (error) {
        console.error('❌ YouTube streaming failed:', error.message);
        
        // If video is unavailable, give helpful message
        if (error.message.includes('410') || error.message.includes('unavailable')) {
            throw new Error('🚫 This video is currently unavailable or region-blocked. Please try a different song.');
        }
        
        throw new Error('🚫 Unable to stream this video. Please try again later.');
    }
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

console.log('✅ Applied working YouTube streaming fix');
console.log('🔧 This gets fresh stream URLs to bypass 410 errors');
console.log('🚀 Restart: pm2 restart discord-bot');
console.log('📋 Monitor: pm2 logs discord-bot');
