#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Applying improved streaming fix...');

const musicUtilsPath = path.join(__dirname, 'utils', 'musicUtils.js');
const backupPath = path.join(__dirname, 'utils', 'musicUtils.js.backup');

// Backup original if not exists
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(musicUtilsPath, backupPath);
    console.log('✅ Backed up original file');
}

// Read the current file
let content = fs.readFileSync(musicUtilsPath, 'utf8');

// New improved function
const newFunction = `
async function createAudioStream(url) {
    console.log('🎵 Attempting to stream from:', url);
    
    // Try play-dl first (more reliable)
    try {
        const playDL = require('play-dl');
        console.log('📺 Using play-dl...');
        
        // Get video info first to validate
        const info = await playDL.video_info(url);
        console.log('✅ Video found:', info.video_details.title);
        
        // Create stream
        const streamObj = await playDL.stream(url, { 
            quality: 2,
            discordPlayerCompatibility: true 
        });
        
        console.log('✅ play-dl stream created successfully');
        return { stream: streamObj.stream, inputType: 'opus' };
        
    } catch (playDlError) {
        console.log('❌ play-dl failed:', playDlError.message);
        console.log('🔄 Trying fallback method...');
    }

    // Fallback to ytdl-core with safe settings
    try {
        const ytdl = require('ytdl-core');
        console.log('📺 Using ytdl-core fallback...');
        
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }
        
        // Use simplest possible options
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'lowest', // Use lowest to avoid signature issues
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });
        
        console.log('✅ ytdl-core fallback stream created');
        return { stream, inputType: 'arbitrary' };
        
    } catch (ytdlError) {
        console.log('❌ ytdl-core fallback also failed:', ytdlError.message);
    }
    
    // If all methods fail
    throw new Error('🚫 All streaming methods failed. Please try again later.');
}`;

// Find the function and replace it
const functionStart = content.indexOf('async function createAudioStream(');
if (functionStart === -1) {
    console.log('❌ Could not find createAudioStream function');
    process.exit(1);
}

// Find the end of the function (next function or end of file)
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

console.log('✅ Successfully replaced createAudioStream function');
console.log('🚀 Restart bot with: pm2 restart discord-bot');
console.log('📋 Monitor with: pm2 logs discord-bot');
