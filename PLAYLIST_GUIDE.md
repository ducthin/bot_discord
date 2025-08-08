# 📋 Hướng dẫn sử dụng Playlist

Bot Discord Music giờ đây hỗ trợ phát playlist từ YouTube!

## 🎵 Cách sử dụng

### 1. **Lệnh `/playlist`**
```
/playlist url:<link-playlist> [limit:<số-lượng>]
```

**Ví dụ:**
```
/playlist url:https://www.youtube.com/playlist?list=PLExample123
/playlist url:https://youtube.com/playlist?list=PLExample123 limit:10
```

### 2. **Tham số:**
- **`url`** (bắt buộc): Link playlist YouTube
- **`limit`** (tùy chọn): Số bài hát tối đa (1-100, mặc định: 20)

## 🔍 Cách lấy link playlist

### Từ YouTube:
1. Vào trang playlist trên YouTube
2. Copy URL từ thanh địa chỉ
3. URL sẽ có dạng: `https://www.youtube.com/playlist?list=PLxxxxxxx`

### Từ video trong playlist:
1. Click vào video trong playlist
2. URL sẽ có dạng: `https://www.youtube.com/watch?v=xxxxx&list=PLxxxxxxx`
3. Copy toàn bộ URL (bot sẽ tự nhận diện playlist)

## ⚡ Tính năng thông minh

### **Phát hiện tự động:**
- Nếu dùng `/play` với URL playlist → Bot sẽ thông báo dùng `/playlist`
- Nếu dùng `/playlist` với URL video → Bot sẽ báo lỗi

### **Giới hạn hợp lý:**
- Mặc định: **20 bài** đầu tiên (tránh spam)
- Tối đa: **100 bài** (tránh quá tải)
- Có thể tùy chỉnh với tham số `limit`

## 📊 Thông tin hiển thị

Sau khi thêm playlist, bot sẽ hiển thị:
- ✅ **Tên playlist**
- 📈 **Số bài đã thêm**
- 🎵 **Tổng số video trong playlist**
- 📍 **Vị trí trong queue**
- 👤 **Người yêu cầu**

## 🎮 Ví dụ thực tế

### **Playlist nhạc Việt:**
```
/playlist url:https://www.youtube.com/playlist?list=PLxxxxxxxxx limit:15
```

### **Playlist nhạc quốc tế:**
```
/playlist url:https://youtube.com/playlist?list=PLyyyyyyyy limit:25
```

### **Album của nghệ sĩ:**
```
/playlist url:https://www.youtube.com/playlist?list=PLzzzzzzz
```

## ⚠️ Lưu ý quan trọng

### **Playlist hỗ trợ:**
- ✅ Playlist công khai
- ✅ Playlist không được liệt kê (unlisted)
- ❌ Playlist riêng tư (private)

### **Giới hạn:**
- **Tối thiểu:** 1 bài
- **Tối đa:** 100 bài
- **Mặc định:** 20 bài

### **Xử lý lỗi:**
- Video bị xóa/riêng tư → Bỏ qua
- Playlist trống → Thông báo lỗi
- URL không hợp lệ → Thông báo lỗi

## 🎯 Tips sử dụng

1. **Playlist lớn:** Dùng `limit` nhỏ để tránh chờ lâu
2. **Test trước:** Thử với 5-10 bài trước khi phát playlist lớn
3. **Queue management:** Dùng `/queue` để xem và `/skip` để bỏ qua
4. **Kết hợp commands:** Có thể `/play` thêm bài vào playlist đang phát

## 🚀 Workflow hoàn chỉnh

```
1. Vào voice channel
2. /playlist url:https://youtube.com/playlist?list=xxx limit:20
3. Bot tải và bắt đầu phát
4. Sử dụng buttons để điều khiển:
   ⏸️ Pause | ▶️ Resume | ⏭️ Skip | 📋 Queue | ⏹️ Stop
5. /play để thêm bài lẻ nếu cần
```

**Giờ đây bạn có thể thưởng thức cả album/playlist yêu thích một cách dễ dàng!** 🎶
