#!/bin/bash

# Discord Bot VPS Setup Script
# Chạy với: bash setup.sh

echo "🚀 Discord Music Bot VPS Setup"
echo "================================"

# Update system
echo "📦 Updating system..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
echo "🟢 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
echo "⚙️ Installing PM2..."
sudo npm install -g pm2

# Install Git
echo "📂 Installing Git..."
sudo apt install git -y

# Install FFmpeg
echo "🎵 Installing FFmpeg..."
sudo apt install ffmpeg -y

# Create logs directory
echo "📝 Creating logs directory..."
mkdir -p logs

# Install dependencies
echo "📚 Installing dependencies..."
npm install

# Setup environment
echo "🔧 Setting up environment..."
if [ ! -f .env ]; then
    echo "Creating .env file..."
    echo "DISCORD_TOKEN=your_bot_token_here" > .env
    echo "NODE_ENV=production" >> .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file and add your Discord bot token!"
    echo "   nano .env"
fi

# Setup PM2
echo "🔄 Setting up PM2..."
pm2 start ecosystem.config.js
pm2 save
sudo pm2 startup

echo ""
echo "✅ Setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env file: nano .env"
echo "2. Add your Discord bot token"
echo "3. Start the bot: pm2 restart discord-music-bot"
echo ""
echo "🔧 Useful commands:"
echo "- View logs: pm2 logs discord-music-bot"
echo "- Restart bot: pm2 restart discord-music-bot"
echo "- Stop bot: pm2 stop discord-music-bot"
echo "- Bot status: pm2 status"
echo ""
echo "🎵 Bot should be running at: http://$(curl -s ifconfig.me):3000"
