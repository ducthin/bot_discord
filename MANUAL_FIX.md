# Manual Fix Instructions for VPS

## Problem
The bot is failing to stream music due to YouTube API changes affecting both ytdl-core and play-dl.

## Quick Fix Steps

### 1. Connect to VPS and navigate to bot directory
```bash
cd /tmp/bot_discord
```

### 2. Pull latest code
```bash
git pull origin main
```

### 3. Install/update play-dl
```bash
npm install play-dl@latest --legacy-peer-deps
```

### 4. Apply the improved fix
```bash
node improved-fix.js
```

### 5. Restart the bot
```bash
pm2 restart discord-bot
pm2 logs discord-bot
```

## Manual Code Fix (if script fails)

Edit `utils/musicUtils.js` and replace the `createAudioStream` function with:

```javascript
async function createAudioStream(url) {
    console.log('🎵 Attempting to stream from:', url);
    
    // Try play-dl first
    try {
        const playDL = require('play-dl');
        console.log('📺 Using play-dl...');
        
        const info = await playDL.video_info(url);
        console.log('✅ Video found:', info.video_details.title);
        
        const streamObj = await playDL.stream(url, { 
            quality: 2,
            discordPlayerCompatibility: true 
        });
        
        return { stream: streamObj.stream, inputType: 'opus' };
        
    } catch (error) {
        console.log('❌ play-dl failed:', error.message);
        
        // Simple ytdl-core fallback
        const ytdl = require('ytdl-core');
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'lowest'
        });
        
        return { stream, inputType: 'arbitrary' };
    }
}
```

## Expected Results
- ✅ Music streaming should work
- ✅ Better error messages
- ✅ Automatic fallback between methods
