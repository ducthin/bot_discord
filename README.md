# 🎵 Discord Music Bot - Enhanced Version

Bot Discord phát nhạc từ YouTube với nhiều tính năng nâng cao và tiện ích.

## ✨ Tính năng mới đã thêm

### 🔊 **Volume Control**
- `/volume 0-100` hoặc `/v 0-100` - Điều chỉnh âm lượng nhạc
- Âm lượng được lưu cho từng server
- Hỗ trợ real-time volume adjustment

### 🔄 **Loop/Repeat System**
- `/loop off` hoặc `/lp off` - Tắt lặp lại
- `/loop track` hoặc `/lp track` - Lặp lại bài hiện tại
- `/loop queue` hoặc `/lp queue` - Lặp lại toàn bộ playlist

### 🎵 **Autoplay**
- `/autoplay true/false` - Tự động phát nhạc liên quan khi hết queue
- Tìm kiếm bài hát liên quan dựa trên bài cuối cùng
- Thông báo khi thêm bài mới từ autoplay

### 💾 **Save Playlist System**
- `/playlist-save save <tên>` - Lưu queue hiện tại thành playlist
- `/playlist-save load <tên>` - Load playlist đã lưu
- `/playlist-save list` - Xem danh sách playlist cá nhân
- `/playlist-save delete <tên>` - Xóa playlist
- Mỗi user có playlist riêng biệt

### 📜 **Music History**
- `/history show` hoặc `/his show` - Xem lịch sử nhạc đã phát
- `/history clear` hoặc `/his clear` - Xóa lịch sử
- Lưu tối đa 100 bài gần nhất cho mỗi user
- Hiển thị thời gian phát và thông tin bài hát

## 📁 Cấu trúc dự án

```
discordBot/
├── commands/
│   ├── aliases.js          # Tất cả lệnh viết tắt (bao gồm v, lp, his)
│   ├── help.js             # Hướng dẫn sử dụng (đã cập nhật)
│   ├── volume.js           # 🔊 Điều chỉnh âm lượng
│   ├── loop.js             # 🔄 Lặp lại nhạc
│   ├── autoplay.js         # 🎵 Tự động phát nhạc
│   ├── playlist-save.js    # 💾 Lưu/load playlist
│   ├── history.js          # 📜 Lịch sử nhạc
│   └── ... (các lệnh cũ)
├── data/                   # 📂 Thư mục lưu trữ
│   ├── playlists/         # Playlist của từng user
│   └── history/           # Lịch sử nhạc của từng user
├── utils/
│   ├── musicUtils.js      # Logic chính (đã nâng cấp)
│   └── ... (các utils khác)
└── ...
```

## 🎮 Danh sách lệnh đầy đủ

### 🎶 **Phát nhạc cơ bản**
| Lệnh đầy đủ | Viết tắt | Mô tả |
|-------------|----------|-------|
| `/play <query>` | `/p` | Phát nhạc từ YouTube |
| `/playlist <url>` | - | Phát playlist YouTube |
| `/pause` | `/ps` | Tạm dừng nhạc |
| `/resume` | `/r` | Tiếp tục phát nhạc |
| `/skip` | `/s` | Bỏ qua bài hiện tại |
| `/stop` | `/st` | Dừng nhạc và xóa queue |

### 🔊 **Điều khiển nâng cao**
| Lệnh đầy đủ | Viết tắt | Mô tả |
|-------------|----------|-------|
| `/volume <0-100>` | `/v` | Điều chỉnh âm lượng |
| `/loop <mode>` | `/lp` | Bật/tắt lặp lại |
| `/autoplay <true/false>` | - | Tự động phát nhạc liên quan |

### 📋 **Thông tin & Quản lý**
| Lệnh đầy đủ | Viết tắt | Mô tả |
|-------------|----------|-------|
| `/queue` | `/q` | Hiển thị danh sách phát |
| `/nowplaying` | `/np` | Hiển thị bài đang phát |
| `/lyrics` | `/l` | Hiển thị lời bài hát |
| `/history show` | `/his` | Xem lịch sử nhạc |
| `/shuffle` | - | Xáo trộn danh sách phát |

### 💾 **Playlist cá nhân**
| Lệnh | Mô tả |
|------|-------|
| `/playlist-save save <tên>` | Lưu queue thành playlist |
| `/playlist-save load <tên>` | Load playlist đã lưu |
| `/playlist-save list` | Xem danh sách playlist |
| `/playlist-save delete <tên>` | Xóa playlist |

### 🚪 **Khác**
| Lệnh đầy đủ | Viết tắt | Mô tả |
|-------------|----------|-------|
| `/leave` | `/dc` | Bot rời voice channel |
| `/help` | `/h` | Hiển thị hướng dẫn |

## 🎯 Ví dụ sử dụng

### 🔊 Volume Control
```
/volume 80        # Đặt âm lượng 80%
/v 50            # Viết tắt - đặt âm lượng 50%
```

### 🔄 Loop System
```
/loop track      # Lặp lại bài hiện tại
/lp queue        # Lặp lại toàn bộ queue
/lp off          # Tắt lặp lại
```

### 🎵 Autoplay
```
/autoplay true   # Bật tự động phát nhạc liên quan
/autoplay false  # Tắt autoplay
```

### 💾 Playlist Management
```
/playlist-save save "My Favorites"    # Lưu queue thành playlist
/playlist-save load "My Favorites"    # Load playlist
/playlist-save list                   # Xem danh sách playlist
```

### 📜 History
```
/history show          # Xem 10 bài gần nhất
/history show limit:20 # Xem 20 bài gần nhất
/his clear            # Xóa lịch sử
```

## 🎨 Tính năng Interactive

### 🎮 **Button Controls**
Sau khi phát nhạc, sử dụng buttons để điều khiển:
- ⏸️ **Pause** - Tạm dừng
- ▶️ **Resume** - Tiếp tục  
- ⏭️ **Skip** - Bỏ qua
- 📋 **Queue** - Xem danh sách
- ⏹️ **Stop** - Dừng hẳn

### 📊 **Rich Embeds**
- Hiển thị thông tin bài hát đầy đủ
- Thumbnail, thời lượng, người yêu cầu
- Trạng thái volume và loop mode
- Progress tracking

## 🔧 Cài đặt và chạy

1. **Cài đặt dependencies:**
   ```bash
   npm install
   ```

2. **Tạo file .env:**
   ```
   DISCORD_TOKEN=your_bot_token_here
   ```

3. **Chạy bot:**
   ```bash
   npm start
   # hoặc
   node index.js
   ```

## 📦 Dependencies

```json
{
  "discord.js": "^14.14.1",
  "@discordjs/voice": "^0.16.1", 
  "@distube/ytdl-core": "^4.16.12",
  "youtube-sr": "^4.3.11",
  "genius-lyrics": "^4.4.7",
  "ffmpeg-static": "^5.2.0",
  "libsodium-wrappers": "^0.7.11"
}
```

## 🚀 Tính năng nổi bật

- ✅ **Stable YouTube Support** - Chỉ tập trung vào YouTube để đảm bảo ổn định
- ✅ **Volume Control** - Điều chỉnh âm lượng real-time
- ✅ **Smart Loop System** - Linh hoạt với 3 chế độ lặp
- ✅ **Personal Playlists** - Mỗi user có playlist riêng
- ✅ **Music History** - Theo dõi lịch sử nghe nhạc
- ✅ **Autoplay Intelligence** - Tự động tìm nhạc liên quan
- ✅ **Compact Commands** - Hệ thống aliases gọn gàng
- ✅ **Data Persistence** - Lưu trữ playlist và lịch sử

## 💡 Tips sử dụng

1. **Sử dụng viết tắt** để gõ lệnh nhanh hơn
2. **Lưu playlist** yêu thích để dễ dàng phát lại
3. **Bật autoplay** khi muốn nghe nhạc liên tục
4. **Kiểm tra history** để tìm lại bài hát đã nghe
5. **Điều chỉnh volume** phù hợp với không gian

Bot này được thiết kế để mang lại trải nghiệm nghe nhạc tốt nhất với đầy đủ tính năng hiện đại! 🎵
