# Cập nhật bot từ Windows lên VPS Ubuntu

Hướng dẫn dùng cho VPS đã cài bot ở `/opt/discord-bot` với dịch vụ `discord-bot.service`. Địa chỉ mặc định là `root@180.93.126.48`. Nếu đổi VPS, sửa giá trị mặc định trong `scripts/deploy-vps.ps1` hoặc truyền `-Server root@IP-MOI` khi chạy script.

Bản hiện tại dùng PostgreSQL. Chuẩn bị cơ sở dữ liệu riêng và đặt `DATABASE_URL` trong `/opt/discord-bot/.env` trước khi cập nhật. Các file JSON ứng dụng cũ không được tự nhập; cơ sở dữ liệu mới bắt đầu trống. Giữ nguyên `DATABASE_URL` khi cập nhật những lần sau. Xem [hướng dẫn PostgreSQL](docs/postgresql.md).

Bảng điều khiển web chạy cùng bot tại `/admin/`. Sau khi cập nhật, đặt mật khẩu bằng `scripts/admin-password.js`, rồi truy cập qua đường hầm SSH hoặc tên miền HTTPS. Xem [hướng dẫn trang quản trị](docs/admin-web.md); không cần chạy thêm một tiến trình bot.

Trang mở hòm dành cho người chơi ở `/play/` dùng chung xu và kho skin với tài khoản Discord. Mở **OPEN_PLAY.bat** trên Windows, rồi dùng mã riêng từ lệnh **/web** để đăng nhập. Xem [hướng dẫn trang mở hòm và Upgrade](docs/player-web.md).

1. Nhấp đúp **UPDATE_VPS.bat** trên máy Windows, trong thư mục dự án.
2. Chọn **1** để gửi bản hiện tại. Nếu dùng mật khẩu SSH, nhập khi tải lên và khi chạy cập nhật.
3. Khi thấy thông báo bot đã kết nối Discord, bản mới đã chạy.

Script kiểm tra mã và thư viện trước khi dừng bot. VPS chỉ cài lại thư viện khi các tệp npm thay đổi hoặc thiếu thư mục thư viện. Nếu bản mới khởi động lỗi, script phục hồi bản trước. File `.env`, thư mục cache `data` và cấu hình systemd nằm tại VPS trong suốt quá trình; PostgreSQL lưu ví, kho, lịch sử và cấu hình ứng dụng.

Script báo riêng bước dừng bot, thay mã, khởi động và chờ Discord. Dừng/khởi động có giới hạn 45 giây; chờ bot sẵn sàng có giới hạn 60 giây và báo tiến độ mỗi 5 giây. Script chỉ thay hoặc khôi phục mã sau khi xác nhận dịch vụ đã dừng và không còn tiến trình trong nhóm của bot.

Kiểm tra trạng thái đọc riêng cổng `PORT` từ tiến trình hoặc `.env`, rồi gọi `/health`; không phụ thuộc nhật ký `journalctl`. Dọn thư mục tạm có giới hạn 15 giây, thêm tối đa 5 giây để kết thúc lệnh. Khi đĩa chậm, script hoãn dọn và báo đường dẫn còn lại, giữ bản bot đã chạy khỏe. Kết nối SSH có keepalive để phát hiện mất kết nối.

## Khi cửa sổ cập nhật đứng lâu

Nếu đã thấy bot online, cửa sổ vẫn có thể đang chờ dọn tệp tạm. Tránh mở nhiều lượt cập nhật cùng lúc. Kiểm tra qua SSH:

```bash
systemctl show discord-bot.service --property=ActiveState,SubState,MainPID --no-pager
curl --fail --silent --max-time 3 http://127.0.0.1:3001/health
vmstat 1 3
cat /proc/pressure/io
ps -eo pid,ppid,stat,wchan:32,comm
```

Thay `3001` bằng cổng thực nếu đã cấu hình cổng khác. `healthy` xác nhận bot đã kết nối Discord, không xác nhận đĩa đang hoạt động bình thường. Nếu cột `wa` của `vmstat` liên tục gần 100% và nhiều tiến trình ở trạng thái `D`, hệ điều hành đang chờ I/O đĩa. Cần kiểm tra lưu trữ VPS; thay mã bot hoặc chạy cập nhật lặp lại không xử lý được tình trạng này.

Sau khi khởi động lại VPS từ bảng quản lý, chờ SSH hoạt động rồi kiểm tra lại dịch vụ, `/health` và I/O trước khi cập nhật tiếp. Nếu VPS không lên hoặc I/O vẫn treo, xem Console/VNC và nhờ nhà cung cấp kiểm tra lưu trữ. Giữ lại thư mục sao lưu được script báo khi khôi phục chưa xong.

Kiểm thử trình cập nhật trên Linux/WSL: `bash tests/deployUbuntu.test.sh`. Các fixture dùng thư mục và dịch vụ giả, không thay đổi bot đang chạy.

## Tự gửi khi lưu code

Chế độ **2** theo dõi thay đổi sau khi bạn mở công cụ. Dùng **1** để gửi bản đầu nếu cần. Khi mã đã ổn định 8 giây, công cụ gửi bản mới và khởi động lại bot. Giữ cửa sổ mở khi muốn tiếp tục đồng bộ. Nhấn **Ctrl+C** để dừng theo dõi.

Nếu chế độ **2** báo VPS chưa chấp nhận khóa, mở lại **UPDATE_VPS.bat** và chọn **3** để cài khóa một lần.

1. Khi công cụ hỏi passphrase của khóa, nhấn Enter hai lần nếu muốn chạy tự động mà không dùng SSH agent. Nếu đặt passphrase, bật Windows SSH agent theo bước bên dưới.
2. Khi SSH hỏi mật khẩu VPS, nhập mật khẩu đăng nhập VPS hiện tại. Công cụ gửi khóa công khai và kiểm tra đăng nhập tự động.
3. Khi thấy thông báo cài khóa xong, mở lại **UPDATE_VPS.bat** và chọn **2**.

Khi kết nối VPS lần đầu, xác minh dấu vân tay SSH như lúc cài máy.

### Mở khóa SSH có passphrase

Mở PowerShell bằng **Run as administrator** và chạy:

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

Mở lại **UPDATE_VPS.bat** và chọn **2**. Khi công cụ hỏi, nhập passphrase bạn đã đặt lúc tạo khóa SSH.
