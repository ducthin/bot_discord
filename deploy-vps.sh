#!/bin/bash

# Discord Bot VPS Deployment Script
# Chạy script này trên VPS để deploy bot

echo "🚀 Starting Discord Bot deployment..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Update system
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
print_status "Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    print_warning "Node.js is already installed: $(node --version)"
fi

# Install PM2
print_status "Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    print_warning "PM2 is already installed: $(pm2 --version)"
fi

# Install FFmpeg
print_status "Installing FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    sudo apt install ffmpeg -y
else
    print_warning "FFmpeg is already installed: $(ffmpeg -version | head -n1)"
fi

# Install Git
print_status "Installing Git..."
if ! command -v git &> /dev/null; then
    sudo apt install git -y
else
    print_warning "Git is already installed: $(git --version)"
fi

# Clone repository
print_status "Cloning Discord Bot repository..."
if [ ! -d "bot_discord" ]; then
    git clone https://github.com/ducthin/bot_discord.git
    cd bot_discord
else
    print_warning "Repository already exists, updating..."
    cd bot_discord
    git pull origin main
fi

# Install dependencies
print_status "Installing Node.js dependencies..."
npm install

# Create logs directory
mkdir -p logs

# Setup environment file
if [ ! -f ".env" ]; then
    print_warning "Creating .env file template..."
    cat > .env << EOF
# Discord Bot Configuration
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
CLIENT_ID=YOUR_CLIENT_ID_HERE
GUILD_ID=YOUR_GUILD_ID_HERE
PORT=3000
EOF
    print_error "Please edit .env file with your Discord bot credentials!"
    print_status "Use: nano .env"
    exit 1
else
    print_status ".env file already exists"
fi

# Setup firewall
print_status "Configuring firewall..."
sudo ufw allow 3000
sudo ufw --force enable

# Start bot with PM2
print_status "Starting Discord Bot with PM2..."
pm2 start ecosystem.config.js

# Save PM2 configuration
print_status "Saving PM2 configuration..."
pm2 save

# Setup PM2 startup
print_status "Setting up PM2 auto-startup..."
pm2 startup systemd -u $USER --hp $HOME

print_status "✅ Discord Bot deployment completed!"
print_status "📋 Next steps:"
echo "  1. Edit .env file: nano .env"
echo "  2. Check bot status: pm2 status"
echo "  3. View logs: pm2 logs discord-bot"
echo "  4. Monitor: pm2 monit"

print_status "🔧 Useful commands:"
echo "  - Restart bot: pm2 restart discord-bot"
echo "  - Stop bot: pm2 stop discord-bot"
echo "  - View logs: pm2 logs discord-bot --lines 50"
echo "  - Update bot: git pull && npm install && pm2 restart discord-bot"
