# 🔥 TRENDING MUSIC FEATURES

## 🎵 **Tính năng Nhạc Thịnh Hành mới:**

### 1. 🔥 `/trending` - Phát nhạc thịnh hành
```
/trending region:VN count:10
```
**Tham số:**
- `region`: Khu vực (VN, KR, US, GLOBAL, ASIA)
- `count`: Số bài hát (1-20)

**Khu vực hỗ trợ:**
- 🇻🇳 **Việt Nam**: Vpop, nhạc trẻ, trending TikTok VN
- 🇰🇷 **Hàn Quốc**: K-pop, BTS, BLACKPINK, NewJeans...
- 🇺🇸 **Mỹ**: Billboard Hot 100, Pop, Hip-hop
- 🌍 **Toàn cầu**: Trending worldwide, viral TikTok
- 🌏 **Châu Á**: J-pop, C-pop, Thai-pop, Bollywood

### 2. 🤖 `/autotrending` - Tự động phát nhạc thịnh hành
```
/autotrending enabled:true region:VN
```
**Hoạt động:**
- Tự động thêm nhạc trending khi queue trống
- Ưu tiên theo khu vực đã chọn
- Cập nhật real-time từ YouTube

### 3. 🎮 **Interactive Controls**

**Trending Panel Buttons:**
- ▶️ **Phát ngay**: Bắt đầu phát nhạc trending
- 🔀 **Trộn bài**: Shuffle danh sách trending
- ➕ **Thêm 10 bài**: Lấy thêm nhạc trending
- 🔄 **Làm mới**: Refresh danh sách mới

**Auto-Trending Buttons:**
- 🇻🇳 **Việt Nam**: Chuyển sang trending VN
- 🇰🇷 **K-pop**: Chuyển sang trending Hàn Quốc
- 🇺🇸 **US**: Chuyển sang trending Mỹ
- 🌍 **Global**: Chuyển sang trending toàn cầu
- ❌ **Tắt**: Tắt auto-trending

## 🎯 **Cách sử dụng tối ưu:**

### **Scenario 1: Party với nhạc Vpop**
```
1. /trending region:VN count:15
2. Click "▶️ Phát ngay"
3. /autotrending enabled:true region:VN
```

### **Scenario 2: K-pop session**
```
1. /trending region:KR count:20
2. Click "🔀 Trộn bài" 
3. /autotrending enabled:true region:KR
```

### **Scenario 3: Mix quốc tế**
```
1. /trending region:GLOBAL count:10
2. /trending region:US count:5 (thêm nữa)
3. /autotrending enabled:true region:GLOBAL
```

## 🔧 **Tính năng nâng cao:**

### **Smart Algorithm:**
- AI phân tích trending real-time
- Lọc duplicate songs tự động
- Ưu tiên chất lượng cao (views, duration)
- Tránh repeat trong 1 session

### **Auto-Integration:**
- Tích hợp với autoplay cũ
- Fallback system khi API fail
- Memory efficient cho long sessions
- Auto-cleanup expired trends

### **Performance:**
- Async loading không lag
- Batch processing cho nhiều bài
- Error handling robust
- Retry mechanism tự động

## 📊 **Monitoring & Stats:**

Theo dõi trong guildData:
```javascript
guildData.autoTrending = {
    enabled: true,
    region: 'VN',
    lastFetch: '2024-xx-xx',
    count: 25  // Số bài đã auto-add
}
```

## 🎵 **Sample Trending Keywords:**

### **Việt Nam:**
- "trending vietnam music 2024"
- "nhạc việt thịnh hành"
- "vpop viral tiktok"
- "sơn tùng mtp mới nhất"

### **K-pop:**
- "kpop trending 2024"
- "bts latest hits"
- "newjeans trending"
- "kpop viral tiktok"

### **Global:**
- "trending music worldwide 2024"
- "viral songs tiktok"
- "global hits 2024"
- "youtube trending music"

---

## 🚀 **Quick Start:**

1. **Trending ngay:** `/trending`
2. **Auto endless:** `/autotrending enabled:true`
3. **Enjoy music!** 🎵

**Bot sẽ tự động duy trì nhạc trending 24/7!** 🔥