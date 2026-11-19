# Chạy bot trên Windows VPS

1. Chép thư mục dự án lên VPS Windows 64-bit. Không cần chép `node_modules` hoặc `.runtime`; launcher sẽ chuẩn bị lại trên VPS.
2. Cài PostgreSQL 17 trên máy chạy bot, rồi chạy **SETUP_POSTGRES.bat**. Nhập mật khẩu quản trị PostgreSQL khi được hỏi; công cụ tạo tài khoản/cơ sở dữ liệu riêng và ghi `DATABASE_URL` vào `.env`. Nếu dịch vụ PostgreSQL đang tắt, bước khởi động dịch vụ có thể cần **Run as administrator**. Xem [hướng dẫn PostgreSQL](docs/postgresql.md).
3. Để bắt đầu trắng theo yêu cầu, dừng bot rồi chạy **RESET_DATA.bat** một lần. Công cụ chuẩn bị thư viện nếu cần, xóa dữ liệu ứng dụng PostgreSQL và các thư mục JSON ứng dụng cũ, không sao lưu hoặc nhập dữ liệu cũ.
4. Nhấp đúp **START_BOT.bat**. Lần đầu cần Internet để tải Node.js 22, Python và thư viện. Nếu Notepad mở `.env`, điền `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (hoặc `GUILD_IDS` cho nhiều server), lưu rồi đóng Notepad. Bot đã gỡ AI nên không cần API key AI. Không chia sẻ file `.env`.
5. Bot dùng PostgreSQL cho dữ liệu mới. Bot chạy trong cửa sổ log. Những lần sau chỉ nhấp đúp **START_BOT.bat**; khởi động lại không xóa dữ liệu PostgreSQL. Chạy lại `/setup tiembanh` để cấu hình bàn tự động sau lần xóa trắng.

Bot không yêu cầu **Message Content Intent** trong Discord Developer Portal; mời bot vào đúng server với quyền xem/gửi tin nhắn, kết nối và nói trong voice. `CLIENT_ID` là Application ID, `GUILD_ID` là Server ID. Lệnh chủ bot `!addxu` đọc nội dung trong tin nhắn riêng, không cần intent nội dung kênh server.

Khi chạy thủ công, giữ cửa sổ launcher mở. Có thể ngắt kết nối Remote Desktop, nhưng đăng xuất phiên Windows sẽ dừng bot. Đóng cửa sổ hoặc Ctrl+C để dừng.

## Tự chạy sau khi VPS khởi động

1. Chạy **START_BOT.bat** một lần để kiểm tra bot, rồi đóng cửa sổ bot.
2. Chạy **ENABLE_AUTOSTART.bat** trên VPS. Nếu Windows từ chối quyền đăng ký task, dùng **Run as administrator** với tài khoản Windows có quyền đọc thư mục dự án.
3. Điền thông tin tài khoản Windows trong hộp thoại hệ thống. Task chạy dưới tài khoản đó với quyền giới hạn.
4. Trong **Task Scheduler**, chọn **DiscordMusicBot** → **Run** để thử ngay. Task sẽ tự chạy khi Windows khởi động. Launcher sẽ thử lại nếu Discord chưa kết nối được ngay.

Log chạy nền nằm trong `.runtime\bot.stdout.log` và `.runtime\bot.stderr.log`. Lỗi khởi động launcher nằm trong `.runtime\launcher.log`. Để tắt tính năng tự chạy, dùng **End** rồi **Disable** trong Task Scheduler. Sau khi chuyển thư mục dự án hoặc đổi mật khẩu Windows, cập nhật task trước khi dựa vào nó để tự khởi động.

Task chạy bằng [Windows Task Scheduler](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask).

Launcher ngăn mở trùng trong cùng thư mục và thử chạy lại khi bot thoát lỗi, tối đa 5 lần lỗi liên tiếp trong thời gian ngắn. Nếu lỗi cài đặt native module, xem log npm; VPS có thể cần Visual C++ Runtime/Build Tools khi không tải được bản dựng sẵn. Cần cho phép kết nối ra Internet tới Discord, npm, GitHub, YouTube và các nguồn giá CS2.

Khi cập nhật mã, dùng **End → Run** trên tác vụ **DiscordMusicBot**. Launcher mới cho tiến trình Node tự thoát nếu launcher đã dừng. Nếu cổng `3001` vẫn bị chiếm, bot sẽ báo lỗi trước khi đăng nhập Discord. Kiểm tra PID bằng `netstat -ano | findstr :3001` và xác định tiến trình trước khi dừng nó. Bản bot cũ chạy từ trước khi cập nhật có thể cần dừng một lần.

Chỉ kiểm tra cấu hình/thư viện, không đăng nhập Discord:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1 -CheckOnly
```

Runtime tải từ [Node.js](https://nodejs.org/dist/latest-v22.x/) và [Python](https://www.python.org/ftp/python/3.12.10/). File Node được đối chiếu SHA-256 do máy chủ Node công bố.

## Thiết lập Tiệm Bánh

Chạy các lệnh cấu hình trong Discord bằng tài khoản có quyền **Quản lý máy chủ**.

| Lệnh | Cách dùng |
| --- | --- |
| `/setup tiembanh channel:#tiem-banh` | Đặt bàn Tiệm Bánh Mây cố định. Bot cần quyền xem kênh, gửi tin nhắn và nhúng liên kết. |
| `/setup status` | Xem cấu hình bàn hiện tại. |
| `/setup disable` | Tắt bàn tự động. Ván đã có cược vẫn được tính kết quả. |
| `/tiembanh play` | Mở bàn chơi. Chọn Bánh Bông hoặc Bánh Bơ rồi nhập số xu hoặc `all` để cược hết số dư. Cược đầu tiên bắt đầu đếm ngược 30 giây. |
| `/tiembanh daily` | Nhận 5,000,000 xu mỗi 8 giờ trên máy chủ; cũng có nút điểm danh trên bàn. Thời gian chờ được lưu qua lần khởi động lại. |

Giữ cùng cơ sở dữ liệu và `DATABASE_URL` khi cập nhật để giữ ví, kho, lịch sử và thiết lập. `/help` liệt kê lệnh hiện có; `/botstatus` kiểm tra kết nối và quyền phát nhạc.

Nhóm quản lý server đang tắt trong `config/features.json`; các cờ `.env` cũ không bật lại thông báo, phòng tạm, chào thành viên, báo cáo, ticket hoặc tiện ích cộng đồng. AI, music quiz, gợi ý nhạc, visualizer và lệnh `/autotrending` riêng đã được gỡ. Dùng `/trending auto` nếu muốn phát nhạc thịnh hành khi hết hàng đợi.
