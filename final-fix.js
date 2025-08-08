#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚨 Applying final streaming fix - removing all problematic methods...');

const musicUtilsPath = path.join(__dirname, 'utils', 'musicUtils.js');
const backupPath = path.join(__dirname, 'utils', 'musicUtils.js.backup');

// Create backup
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(musicUtilsPath, backupPath);
    console.log('✅ Backup created');
}

// New ultra-simple function that uses only working methods
const newFunction = `
async function createAudioStream(url) {
    console.log('🎵 Starting simple stream for:', url);
    
    try {
        // Use ytdl-core with absolute minimal settings
        const ytdl = require('ytdl-core');
        
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }
        
        console.log('📺 Creating basic ytdl stream...');
        
        // Most basic possible stream configuration
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'lowest',
            format: 'mp4',
            requestOptions: {
                headers: {
                    'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
                }
            }
        });
        
        console.log('✅ Basic stream created successfully');
        return { stream, inputType: 'arbitrary' };
        
    } catch (error) {
        console.error('❌ Simple stream failed:', error.message);
        
        // Last resort: throw a user-friendly error
        throw new Error('🚫 Unable to play this song. YouTube may be blocking requests. Please try a different song.');
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

console.log('✅ Applied ultra-simple streaming fix');
console.log('🔧 This uses basic ytdl-core with minimal settings');
console.log('🚀 Restart: pm2 restart discord-bot');
console.log('📋 Monitor: pm2 logs discord-bot');
