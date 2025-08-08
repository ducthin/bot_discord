#!/bin/bash

# Script to fix VPS deployment issues
echo "🔧 Fixing VPS deployment issues..."

# Stop the current bot
echo "⏹️ Stopping current bot..."
pm2 stop discord-bot || true
pm2 delete discord-bot || true

# Install system dependencies for audio processing
echo "📦 Installing system dependencies..."
apt-get update
apt-get install -y ffmpeg python3 make g++ libnss3-dev libgconf-2-4 libxss1 libxrandr2 libasound2-dev libxtst6 libxinerama1 libxi6

# Clean npm cache and node_modules
echo "🧹 Cleaning npm cache..."
npm cache clean --force
rm -rf node_modules package-lock.json

# Install dependencies with opus support
echo "📦 Installing Node.js dependencies..."
npm install --legacy-peer-deps

# Install opus libraries specifically
echo "🎵 Installing audio encoding libraries..."
npm install @discordjs/opus opusscript play-dl --legacy-peer-deps

# Verify installation
echo "✅ Verifying installation..."
node -e "
try { 
    require('@discordjs/opus'); 
    console.log('✅ @discordjs/opus installed successfully'); 
} catch(e) { 
    console.log('❌ @discordjs/opus failed:', e.message); 
}

try { 
    require('opusscript'); 
    console.log('✅ opusscript installed successfully'); 
} catch(e) { 
    console.log('❌ opusscript failed:', e.message); 
}

try { 
    require('ytdl-core'); 
    console.log('✅ ytdl-core installed successfully'); 
} catch(e) { 
    console.log('❌ ytdl-core failed:', e.message); 
}

try { 
    require('play-dl'); 
    console.log('✅ play-dl installed successfully'); 
} catch(e) { 
    console.log('❌ play-dl failed:', e.message); 
}
"

# Start the bot
echo "🚀 Starting bot with PM2..."
pm2 start ecosystem.config.js

# Show logs
echo "📋 Showing bot logs..."
pm2 logs discord-bot --lines 20

echo "✅ VPS fix script completed!"
echo "📝 Next steps:"
echo "   1. Check logs: pm2 logs discord-bot"
echo "   2. Save PM2 config: pm2 save"
echo "   3. Setup startup: pm2 startup"
