# 🎵 Discord Music Bot - Enhanced Version

Bot Discord tập trung vào hòm CS2 (`/hom`), Tiệm Bánh Mây (`/tiembanh`) và phát nhạc YouTube.

Dữ liệu ứng dụng lưu trong PostgreSQL: ví xu, kho đồ, Battle, cấu hình máy chủ, lịch sử nhạc, yêu thích và playlist. Trên Windows, cài PostgreSQL 17 rồi chạy `SETUP_POSTGRES.bat`. Xem [hướng dẫn PostgreSQL](docs/postgresql.md) và [chạy bot trên Windows](WINDOWS_VPS.md). Phiên bản này bắt đầu bằng dữ liệu PostgreSQL mới, không nhập JSON cũ. Dùng `RESET_DATA.bat` một lần khi cần bắt đầu trắng; khởi động bình thường giữ dữ liệu.

`/hom` hiện gồm hòm CS2, kho đồ, Upgrade bằng skin/xu ảo, Trade Up, Chợ skin và Battle. Battle có 169 hòm, gồm [36 hòm sưu tầm mới, Howl và 240 skin bổ sung](docs/cs2-iconic-expansion.md), cùng [Blue Gem với seed, ảnh và giá riêng](docs/blue-gem.md). Tính năng mua/mở Terminal đã được bỏ; vật phẩm cũ vẫn được giữ để xem, khóa, bán và Trade Up. Upgrade dùng giá BUFF còn hạn hoặc giá CSFloat theo seed của phần thưởng Blue Gem; công thức odds và quy trình kiểm chứng riêng của bot được ghi tại [tài liệu nghiên cứu Upgrade](docs/hom-upgrade.md). Xem [kết quả rà soát và tối ưu](docs/project-audit.md) và [cách đo hiệu năng](docs/performance.md).

Đã gỡ AI chat, nhận diện/đọc giọng nói, `/musicquiz`, `/recommend`, `/autotrending`, `/visualizer` và nút xem lại lượt quay hòm. Ảnh kho dạng lưới và ảnh chi tiết skin vẫn được giữ. Dùng `/trending auto` để quản lý nhạc thịnh hành tự động.

Tiện ích quản lý server vẫn tắt trong `config/features.json`: không chạy tác vụ thông báo, phòng tạm hoặc chào thành viên; mã nguồn và dữ liệu cũ của nhóm này được giữ. `/setup` chỉ còn cấu hình Tiệm Bánh; `/botstatus` dùng để kiểm tra kết nối và quyền nhạc. Bot cập nhật danh sách slash command sau lần khởi động tiếp theo.

### 📦 Hòm và Tiệm Bánh

| Lệnh | Chức năng |
|---|---|
| `/hom` | Mua/mở hòm, quản lý kho, Upgrade, Trade Up, chợ skin và Battle |
| `/tiembanh play` | Mở bàn chơi |
| `/tiembanh wallet` | Ví xu dùng chung với `/hom` |
| `/tiembanh daily` | Nhận 5,000,000 xu mỗi 8 giờ |
| `/tiembanh top` | Xếp hạng xu, gồm cả tiền đang cược |
| `/tiembanh history` · `/tiembanh dice` | Lịch sử cược cá nhân và kết quả xúc xắc |
| `/setup tiembanh` | Quản trị viên chọn kênh bàn tự động |
| `/setup status` · `/setup disable` | Xem thiết lập hoặc tắt bàn tự động |

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
├── data/                   # Cache có thể tạo lại (không lưu ví/kho/playlist)
├── utils/
│   ├── musicUtils.js      # Logic chính (đã nâng cấp)
│   ├── database.js        # PostgreSQL pool, schema và giao dịch
│   └── ... (các utils khác)
└── ...
```

## 🎮 Danh sách lệnh đầy đủ

### 🎶 **Phát nhạc cơ bản**
| Lệnh đầy đủ | Viết tắt | Mô tả |
|-------------|----------|-------|
| `/play <query> [limit]` | `/p` | Phát theo tên bài hát, link video, playlist hoặc YouTube Mix. Playlist mặc định tối đa 100 bài. |
| `/playlist <url> [limit]` | - | Cú pháp cũ để phát playlist YouTube |
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
| `/queue` | `/q` | Xem hàng đợi và chọn bài phát tiếp trong menu |
| `/queue action:remove position:3` | - | Xóa bài ở vị trí #3 |
| `/queue action:move position:5 to:2` | - | Chuyển bài #5 tới vị trí #2 |
| `/botstatus` | - | Kiểm tra trạng thái và quyền voice, chỉ người quản lý server thấy phản hồi |
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

Các thao tác điều khiển nhạc yêu cầu người dùng ở cùng kênh voice với bot. Dùng `/nowplaying` để mở bảng điều khiển và `/queue action:next position:3` để đưa bài #3 lên tiếp theo. Vị trí #1 là bài hiện tại nếu bot đang phát.

Dùng `/play query:<bài hát hoặc link> next:true` hoặc `/p` để chèn ngay sau bài đang phát. Nếu chưa có bài nào đang phát, bot chèn lên đầu. Playlist và Mix giữ thứ tự các bài bên trong.

Khi có từ **3 người nghe** trong phòng voice, nút **Bỏ qua** và `/skip` dùng chung phiếu. Mỗi người có một phiếu cho mỗi lượt phát và cần quá nửa số người nghe hiện tại. Phòng 1–2 người có thể skip ngay. Người có role tên **DJ** cũng có thể skip ngay. Để chọn role cụ thể, đặt `DJ_ROLE_IDS` trong `.env` thành danh sách ID, cách nhau bằng dấu phẩy. Với server có role được chỉ định, bot dùng các ID đó. Trong phòng từ 3 người, `/skipto` chỉ dành cho DJ.

Các lệnh đã gỡ không được bật lại bằng cờ `.env` cũ. `/role` vẫn thuộc nhóm quản lý server đang tắt trong `config/features.json`.

Thống kê theo server bắt đầu từ các lượt phát có ghi server. Lịch sử cũ vẫn xem được qua `/history`.

Bot không dùng khóa API AI và không yêu cầu **Message Content Intent**. Lệnh chủ bot `!addxu` qua tin nhắn riêng vẫn hoạt động; nhạc và mở hòm có tiếng vẫn dùng voice.

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

1. **Dùng Node.js 22.12 trở lên và cài dependencies theo lockfile:**
   ```bash
   npm ci
   ```

2. **Tạo `.env` từ `.env.example`:** điền `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` hoặc `GUILD_IDS`, và `DATABASE_URL`. Chạy `npm run db:init` để chuẩn bị schema.

3. **Chạy bot:**
   ```bash
   npm start
   # hoặc
   node index.js
   ```

## 📦 Dependencies

Danh sách và phiên bản được quản lý trong [package.json](package.json) và [package-lock.json](package-lock.json). Bot dùng `discord.js`, `@discordjs/voice`, `yt-dlp-exec`, `yt-search`, FFmpeg và PostgreSQL. Health endpoint dùng HTTP tích hợp của Node.js.

Chạy `npm test -- --runInBand` để kiểm thử, hoặc `npm run dev` để phát triển với cấu hình theo dõi file trong `.nodemonrc`. Nếu đã cài riêng dependency production, chạy `npm ci --include=dev` trước khi kiểm thử. Các test PostgreSQL chỉ chạy khi có `TEST_DATABASE_URL` trỏ đến database thử nghiệm riêng; chúng xóa dữ liệu trong database đó.

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
