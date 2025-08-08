#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🎵 Applying simple working fix...');

const musicUtilsPath = path.join(__dirname, 'utils', 'musicUtils.js');
const backupPath = path.join(__dirname, 'utils', 'musicUtils.js.backup');

// Create backup
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(musicUtilsPath, backupPath);
    console.log('✅ Backup created');
}

// Ultra-simple working function
const newFunction = `
async function createAudioStream(url) {
    console.log('🎵 Simple streaming for:', url);
    
    const ytdl = require('ytdl-core');
    
    try {
        // Very basic stream - just try to work
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'lowestaudio'
        });
        
        console.log('✅ Simple stream created');
        return { stream, inputType: 'arbitrary' };
        
    } catch (error) {
        console.error('❌ Streaming failed:', error.message);
        throw new Error('Unable to play this song');
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

// Replace the function
const newContent = content.substring(0, functionStart) + 
                  newFunction.trim() + 
                  content.substring(functionEnd);

fs.writeFileSync(musicUtilsPath, newContent);

console.log('✅ Applied simple fix - absolute basic streaming');
console.log('🚀 Restart: pm2 restart discord-bot');
