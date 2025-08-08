#!/usr/bin/env node

// Emergency fix - temporarily disable ytdl-core and use only play-dl
const fs = require('fs');
const path = require('path');

console.log('🚨 Applying emergency fix for ytdl-core issues...');

// Backup original musicUtils.js
const musicUtilsPath = path.join(__dirname, 'utils', 'musicUtils.js');
const backupPath = path.join(__dirname, 'utils', 'musicUtils.js.backup');

if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(musicUtilsPath, backupPath);
    console.log('✅ Backed up original musicUtils.js');
}

// Read current file
let content = fs.readFileSync(musicUtilsPath, 'utf8');

// Replace the createAudioStream function with play-dl only version
const newCreateAudioStream = `
// Emergency fallback - use only play-dl due to ytdl-core issues
async function createAudioStream(url) {
    console.log('Using play-dl for:', url);
    
    try {
        const playDL = require('play-dl');
        const stream = await playDL.stream(url, { quality: 2 });
        return { stream: stream.stream, inputType: 'opus' };
    } catch (error) {
        console.error('play-dl streaming failed:', error.message);
        throw new Error('Unable to stream audio from this source');
    }
}`;

// Find and replace the createAudioStream function
const functionStart = content.indexOf('// Fallback audio streaming function');
const functionEnd = content.indexOf('\n}', content.indexOf('async function createAudioStream')) + 2;

if (functionStart !== -1 && functionEnd !== -1) {
    const newContent = content.substring(0, functionStart) + 
                      newCreateAudioStream + 
                      content.substring(functionEnd);
    
    fs.writeFileSync(musicUtilsPath, newContent);
    console.log('✅ Applied emergency fix - now using only play-dl');
    console.log('📝 Original file backed up as musicUtils.js.backup');
} else {
    console.log('❌ Could not find function to replace');
}

console.log('🔧 Emergency fix applied! Restart the bot with: pm2 restart discord-bot');
