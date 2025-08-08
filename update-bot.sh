#!/bin/bash

# Quick Update Script for Discord Bot on VPS
# Chạy script này để update bot nhanh chóng

echo "🔄 Updating Discord Bot..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Stop bot
print_status "Stopping bot..."
pm2 stop discord-bot

# Backup current data
print_status "Backing up data..."
if [ -d "data" ]; then
    cp -r data data_backup_$(date +%Y%m%d_%H%M%S)
fi

# Pull latest changes
print_status "Pulling latest changes..."
git pull origin main

# Install/update dependencies
print_status "Updating dependencies..."
npm install

# Restart bot
print_status "Restarting bot..."
pm2 restart discord-bot

# Show status
print_status "Bot status:"
pm2 status discord-bot

print_status "✅ Update completed!"
print_warning "Check logs if needed: pm2 logs discord-bot"
