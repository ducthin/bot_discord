# 🚀 Deploy Discord Bot lên VPS

## 1. Yêu cầu VPS
- **OS**: Ubuntu 20.04+ hoặc CentOS 7+
- **RAM**: Tối thiểu 512MB (khuyến nghị 1GB+)
- **CPU**: 1 core
- **Storage**: 5GB+
- **Network**: Kết nối internet ổn định

## 2. Cài đặt môi trường trên VPS

### Cập nhật hệ thống
```bash
sudo apt update && sudo apt upgrade -y
```

### Cài đặt Node.js 18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Cài đặt PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

### Cài đặt FFmpeg
```bash
sudo apt install ffmpeg -y
```

### Cài đặt Git
```bash
sudo apt install git -y
```

## 3. Upload code lên VPS

### Option 1: Clone từ GitHub
```bash
git clone https://github.com/ducthin/bot_discord.git
cd bot_discord
```

### Option 2: Upload trực tiếp (SCP/SFTP)
```bash
# Trên máy local
scp -r discordBot/ user@your-vps-ip:/home/user/
```

## 4. Cấu hình trên VPS

### Cài đặt dependencies
```bash
cd bot_discord  # hoặc discordBot
npm install
```

### Tạo file .env
```bash
nano .env
```

Nội dung file .env:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here
PORT=3000
```

### Cấu hình firewall
```bash
sudo ufw allow 3000
sudo ufw enable
```

## 5. Chạy bot với PM2

### Tạo file ecosystem
```bash
nano ecosystem.config.js
```

### Khởi chạy với PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Kiểm tra status
```bash
pm2 status
pm2 logs discord-bot
```

## 6. Tự động khởi động

```bash
# Thiết lập PM2 tự start khi boot
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME
```

## 7. Monitoring và Logs

```bash
# Xem logs real-time
pm2 logs discord-bot --lines 50

# Restart bot
pm2 restart discord-bot

# Stop bot
pm2 stop discord-bot

# Monitor resources
pm2 monit
```

## 8. Backup và Update

### Update code
```bash
git pull origin main
npm install
pm2 restart discord-bot
```

### Backup data
```bash
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

## 9. Security Tips

1. **Firewall**: Chỉ mở port cần thiết
2. **SSH Keys**: Sử dụng SSH keys thay vì password
3. **Regular Updates**: Cập nhật hệ thống thường xuyên
4. **Environment Variables**: Không hard-code sensitive data
5. **Log Monitoring**: Theo dõi logs để phát hiện issues

## 10. Troubleshooting

### Bot không start
```bash
pm2 logs discord-bot
npm test
```

### Memory issues
```bash
free -h
pm2 restart discord-bot
```

### Network issues
```bash
ping discord.com
curl -I https://discord.com/api
```
