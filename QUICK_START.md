# 🎵 Quick Start Guide - Discord Music Bot

## 🚀 Lệnh cơ bản (dùng hàng ngày)

### 🎶 **Phát nhạc ngay**
```
/p tên bài hát        # Phát nhạc (viết tắt)
/p URL YouTube        # Phát từ link
/v 70                 # Đặt âm lượng 70%
```

### ⏯️ **Điều khiển nhanh**  
```
/ps                   # Tạm dừng
/r                    # Tiếp tục
/s                    # Bỏ qua
/st                   # Dừng hẳn
```

### 📋 **Xem thông tin**
```
/q                    # Xem queue
/np                   # Bài đang phát
/his                  # Lịch sử nhạc
```

## 🔥 Tính năng hot nhất

### 🔄 **Loop thông minh**
```
/lp track            # Lặp bài hiện tại
/lp queue            # Lặp cả playlist  
/lp off              # Tắt lặp
```

### 🎵 **Autoplay thông minh**
```
/autoplay true       # Tự động phát nhạc liên quan
```

### 💾 **Lưu playlist yêu thích**
```
/playlist-save save "Nhạc chill"     # Lưu queue hiện tại
/playlist-save load "Nhạc chill"     # Load playlist đã lưu
/playlist-save list                  # Xem tất cả playlist
```

## 💡 Pro Tips

1. **Combo hay dùng:**
   - `/p bài hát` → `/v 80` → `/lp queue` → `/autoplay true`

2. **Lưu playlist nhanh:**
   - Thêm nhiều bài vào queue → `/playlist-save save "tên playlist"`

3. **Điều khiển không cần gõ:**
   - Dùng buttons dưới mỗi bài hát để điều khiển

4. **Tìm lại bài cũ:**
   - `/his show limit:20` để xem 20 bài gần nhất

## 🎯 Workflow lý tưởng

### 🌅 **Buổi sáng**
```
/playlist-save load "Morning Vibes"
/v 60
/lp queue
/autoplay true
```

### 🎉 **Party mode**  
```
/p nhạc sôi động
/v 90
/shuffle
/autoplay true
```

### 🌙 **Buổi tối chill**
```
/playlist-save load "Chill Night"
/v 40
/lp queue
```

Enjoy your music! 🎵
