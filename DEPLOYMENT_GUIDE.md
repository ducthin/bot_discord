# 🚀 Discord Bot Deployment Guide

## 🎯 Khuyến nghị deploy

### 🆓 **Dành cho học tập/test: Railway.app**
### 💰 **Dành cho production: DigitalOcean VPS**

---

## 🚂 Deploy trên Railway (Miễn phí)

### 1. **Chuẩn bị code**
```bash
# Tạo file railway.json
{
  "build": {
    "command": "npm install"
  },
  "deploy": {
    "startCommand": "npm start"
  }
}
```

### 2. **Push lên GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/discord-bot
git push -u origin main
```

### 3. **Deploy trên Railway**
1. Tạo tài khoản tại [railway.app](https://railway.app)
2. Connect GitHub repository
3. Thêm environment variables:
   - `DISCORD_TOKEN=your_bot_token`
4. Deploy tự động!

### 4. **Monitoring**
- Railway dashboard hiển thị logs và usage
- Free tier: $5 credit/tháng (đủ dùng)

---

## 🖥️ Deploy trên DigitalOcean VPS (Production)

### 1. **Tạo VPS**
```bash
# Tạo Droplet Ubuntu 22.04
# Size: 1GB RAM, 25GB SSD ($6/tháng)
# Chọn region gần bạn nhất
```

### 2. **Setup server**
```bash
# SSH vào server
ssh root@your_server_ip

# Update system
apt update && apt upgrade -y

# Cài Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Cài PM2 (process manager)
npm install -g pm2

# Cài Git
apt install git -y
```

### 3. **Deploy bot**
```bash
# Clone repository
git clone https://github.com/yourusername/discord-bot.git
cd discord-bot

# Cài dependencies
npm install

# Tạo .env file
nano .env
# Thêm: DISCORD_TOKEN=your_bot_token

# Start với PM2
pm2 start index.js --name discord-bot

# Auto-start on boot
pm2 startup
pm2 save
```

### 4. **Monitoring & Management**
```bash
# Xem logs
pm2 logs discord-bot

# Restart bot
pm2 restart discord-bot

# Stop bot
pm2 stop discord-bot

# Xem status
pm2 status
```

---

## 🐳 Deploy với Docker (Advanced)

### 1. **Tạo Dockerfile**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

USER node

CMD ["node", "index.js"]
```

### 2. **Docker Compose**
```yaml
version: '3.8'
services:
  discord-bot:
    build: .
    restart: unless-stopped
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
    volumes:
      - ./data:/app/data
```

### 3. **Deploy**
```bash
# Build và run
docker-compose up -d

# Xem logs
docker-compose logs -f
```

---

## 📊 So sánh platforms

| Platform | Chi phí | Độ khó | Uptime | Phù hợp cho |
|----------|---------|--------|--------|-------------|
| **Railway** | $0-5/tháng | ⭐ | 95% | Learning/Testing |
| **Render** | $0/tháng | ⭐ | 90% | Light usage |
| **VPS** | $5-6/tháng | ⭐⭐⭐ | 99.9% | Production |
| **Heroku** | $7/tháng | ⭐⭐ | 99% | Not recommended |
| **AWS** | $10-20/tháng | ⭐⭐⭐⭐ | 99.9% | Enterprise |

---

## 🔧 Tips optimize cho production

### 1. **Environment Variables**
```bash
# Trong .env
DISCORD_TOKEN=your_token
NODE_ENV=production
LOG_LEVEL=info
```

### 2. **Logging**
```javascript
// Thêm vào index.js
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});
```

### 3. **Auto-restart on crash**
```json
// package.json scripts
{
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "pm2": "pm2 start ecosystem.config.js"
  }
}
```

### 4. **Backup data**
```bash
# Backup playlist và history
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

---

## 🆘 Troubleshooting

### **Bot không online**
```bash
# Kiểm tra logs
pm2 logs discord-bot

# Kiểm tra process
pm2 status

# Restart
pm2 restart discord-bot
```

### **Voice connection issues**
```bash
# Kiểm tra ffmpeg
which ffmpeg

# Cài ffmpeg nếu thiếu
apt install ffmpeg -y
```

### **Memory issues**
```bash
# Kiểm tra RAM usage
free -h

# Tăng swap nếu cần
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
```

---

## 💡 Khuyến nghị cuối cùng

**Cho người mới bắt đầu:** Railway.app
- Deploy trong 5 phút
- Không cần kiến thức server
- Free tier đủ dùng

**Cho production/serious use:** DigitalOcean VPS
- Chi phí rẻ nhất ($6/tháng)
- Performance ổn định
- 24/7 uptime
- Học được nhiều về server management

🎵 **Happy deploying!**
