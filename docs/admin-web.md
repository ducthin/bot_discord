# Bảng điều khiển bot trên cùng VPS

Trang quản trị ở **`/admin/`** chạy ngay trong tiến trình bot, dùng cùng cổng `PORT` (mặc định `3001`) và cơ sở dữ liệu PostgreSQL hiện có. Không cần chạy thêm Node, React hoặc dịch vụ web ứng dụng thứ hai. Bot vẫn giữ `/health` để trình cập nhật kiểm tra kết nối Discord.

## Trước khi mở trang

Trang chỉ hoạt động sau khi bật quản trị và đặt mật khẩu. Không dùng Discord token làm mật khẩu trang web. Mật khẩu được nhập ẩn; công cụ chỉ ghi hash scrypt vào `.env`, không hiển thị mật khẩu và không thay các cấu hình bot khác.

Sau khi cập nhật mã lên VPS, tạo mật khẩu bằng tài khoản chạy bot:

```bash
cd /opt/discord-bot
sudo -u discordbot /usr/local/bin/node scripts/admin-password.js --configure /opt/discord-bot/.env
sudo systemctl restart discord-bot.service
curl --fail --silent http://127.0.0.1:3001/health
```

Công cụ mặc định cấu hình địa chỉ riêng `http://127.0.0.1:3001`. `ADMIN_ENABLED=true`, hash mật khẩu, địa chỉ được phép và chế độ cookie được ghi tự động. Nếu tài khoản `discordbot` không có quyền sửa `.env`, chạy công cụ với tài khoản quản trị đang sở hữu tệp; giữ quyền đọc tệp cho tiến trình bot. Không đổi chủ sở hữu hoặc quyền của `.env` nếu chưa kiểm tra cách dịch vụ hiện tại đọc tệp.

Nếu đã đổi `PORT`, truyền địa chỉ đúng cổng:

```bash
sudo -u discordbot /usr/local/bin/node scripts/admin-password.js --configure /opt/discord-bot/.env --origin http://127.0.0.1:32001
```

Khởi động lại dịch vụ sau mỗi lần đổi mật khẩu hoặc cấu hình quản trị. Các phiên đăng nhập cũ kết thúc khi tiến trình bot khởi động lại.

## Dùng ngay khi chưa có tên miền

Trên máy Windows của bạn, nhấp đúp **OPEN_ADMIN.bat**. Công cụ mở đường hầm SSH bằng khóa đã dùng cho cập nhật VPS, rồi mở trình duyệt. Giữ cửa sổ công cụ chạy; nhấn **Ctrl+C** để đóng kết nối. Nếu chưa cài khóa SSH, dùng **UPDATE_VPS.bat → 3** một lần. Nếu khóa có passphrase, mở khóa bằng SSH agent theo hướng dẫn cập nhật VPS.

Hoặc mở PowerShell để kết nối thủ công:

```powershell
ssh -N -L 3001:127.0.0.1:3001 root@180.93.126.48
```

Mở **`http://127.0.0.1:3001/admin/`** trong trình duyệt và nhập mật khẩu quản trị. Đường hầm SSH chuyển kết nối vào VPS, nên không cần công khai cổng quản trị. Dùng đúng `127.0.0.1`, cổng và giao thức đã đặt trong `ADMIN_ORIGIN`.

Nếu cổng `3001` trên máy Windows đang có bot chạy, dùng cổng cục bộ khác và cấu hình origin tương ứng, ví dụ:

```bash
# Trên VPS: cho phép địa chỉ sẽ mở từ trình duyệt.
sudo -u discordbot /usr/local/bin/node /opt/discord-bot/scripts/admin-password.js --configure /opt/discord-bot/.env --origin http://127.0.0.1:33001
sudo systemctl restart discord-bot.service
```

```powershell
# Trên Windows: 33001 là cổng máy bạn, 3001 là cổng của bot trên VPS.
ssh -N -L 33001:127.0.0.1:3001 root@180.93.126.48
```

Sau đó mở **`http://127.0.0.1:33001/admin/`**. Đóng cửa sổ SSH sẽ ngắt truy cập từ máy bạn; bot vẫn chạy trên VPS.

Công cụ Windows cũng nhận cổng tùy chọn, sau khi đã cấu hình origin tương ứng trên VPS:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\open-admin.ps1 -LocalPort 33001 -RemotePort 3001
```

Nếu cổng đang được dùng, công cụ dừng và báo lý do, không tự dừng bot hoặc chương trình khác. Công cụ chỉ đóng tiến trình SSH do chính nó tạo.

## Dùng tên miền và HTTPS

Trỏ bản ghi DNS của tên miền, chẳng hạn `bot.example.com`, đến IP VPS. Cấu hình mẫu [nginx-admin.conf](../config/nginx-admin.conf) chỉ chuyển `/admin/` vào bot; không công khai mã nguồn hoặc dữ liệu. Thay tên miền và cổng `3001` trong bản sao nếu cần.

Trên VPS Ubuntu:

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
sudo cp /opt/discord-bot/config/nginx-admin.conf /etc/nginx/sites-available/discord-bot-admin
sudo nano /etc/nginx/sites-available/discord-bot-admin
sudo ln -s /etc/nginx/sites-available/discord-bot-admin /etc/nginx/sites-enabled/discord-bot-admin
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d bot.example.com --redirect
```

Nếu symlink đã tồn tại, giữ nó và bỏ qua lệnh `ln -s`. Cần cho phép cổng `80` và `443` ở tường lửa hệ điều hành/nhà cung cấp; giữ kết nối SSH hiện có. Không cần mở cổng `3001` ra Internet. Cấu hình Nginx ban đầu dùng HTTP để Certbot cấp chứng chỉ; trang quản trị công khai chỉ dùng được qua HTTPS.

Đặt địa chỉ chính xác và cookie HTTPS:

```bash
cd /opt/discord-bot
sudo -u discordbot /usr/local/bin/node scripts/admin-password.js --configure /opt/discord-bot/.env --origin https://bot.example.com
sudo systemctl restart discord-bot.service
sudo certbot renew --dry-run
```

Mở **`https://bot.example.com/admin/`**. Sau khi chuyển sang tên miền, đường hầm với địa chỉ `127.0.0.1` không còn là origin được cho phép. Đổi lại origin bằng công cụ nếu muốn dùng lại chế độ đường hầm.

## Cập nhật và vận hành

- Trong **Ví & Tiệm Bánh**, danh sách ví hiển thị tên Discord kèm ID để phân biệt thành viên trùng tên. Tên ưu tiên biệt danh trong máy chủ, rồi đến tên hiển thị và tên tài khoản Discord.
- Khi cấp xu, bấm ô **Thành viên nhận xu** để chọn từ danh sách hoặc gõ tên/ID để tìm. Kiểm tra tên và ID trong hộp xác nhận trước khi cấp; bot vẫn xác minh người nhận đang ở đúng máy chủ. Nếu Discord chưa trả được tên, ID vẫn được giữ để đối chiếu.
- **UPDATE_VPS.bat** đóng gói cả thư mục `web/`, kiểm tra JavaScript và thay bảng quản trị cùng bot. `.env`, PostgreSQL và dữ liệu hiện có được giữ nguyên.
- Trang lấy dữ liệu thật từ bot đang chạy. Việc đóng trình duyệt không dừng bot. Nếu bot hoặc VPS dừng, trang cũng không truy cập được; dùng SSH/systemd để khởi động lại.
- Chỉ các thao tác có sẵn trên bảng được thực hiện; trang không cung cấp ô chạy lệnh hệ thống hoặc đọc `.env`. Thông tin đăng nhập và Discord token không được trả về trình duyệt.
- Bấm **Đăng xuất** khi dùng máy chung. Để đổi mật khẩu, chạy lại công cụ cấu hình rồi khởi động lại dịch vụ.
- Tắt trang bằng cách đặt `ADMIN_ENABLED=false` trong `.env` rồi khởi động lại. Bot và `/health` vẫn hoạt động bình thường.

## Khi không vào được

| Hiện tượng | Kiểm tra |
| --- | --- |
| Trang không tải qua đường hầm | SSH còn chạy, cổng cục bộ chưa bị chiếm, origin dùng đúng `127.0.0.1` và cổng. |
| Địa chỉ không được phép hoặc không đăng nhập được | `ADMIN_ORIGIN` phải khớp giao thức, tên miền và cổng của trình duyệt. Chạy lại công cụ cấu hình và khởi động lại bot. |
| Nginx báo 502 | `systemctl status discord-bot.service`, `/health` tại cổng của bot, cổng `proxy_pass` trong Nginx. |
| Trang tải nhưng bot chưa sẵn sàng | Kiểm tra Discord và PostgreSQL bằng `/health`, `journalctl -u discord-bot.service -n 50 --no-pager`. |
| Tên miền dùng HTTP | Hoàn tất Certbot và truy cập HTTPS; không tắt cookie bảo mật cho tên miền công khai. |
| Quên mật khẩu | Chạy lại `scripts/admin-password.js --configure ...` qua SSH và khởi động lại dịch vụ. |

Chạy thử riêng giao diện với dữ liệu minh họa bằng công cụ preview do dự án cung cấp không đăng nhập Discord và không điều khiển bot thật. Hãy dùng bảng kết nối VPS sau khi cấu hình để thực hiện các thay đổi thực tế.

## Kiểm tra phần triển khai

`bash tests/deployUbuntu.test.sh` đã đạt **11 tình huống** trong WSL Ubuntu, dùng dịch vụ và HTTP giả: đóng gói/cập nhật cả `web/`, giữ `.env` và dữ liệu, khôi phục web cùng mã bot khi khởi động lỗi, chờ dừng có giới hạn và dọn tạm chậm. Các script PowerShell và Bash đã qua kiểm tra cú pháp. Công cụ mở trang đã được kiểm tra khi cổng bận: báo lỗi và giữ nguyên tiến trình đang dùng cổng. Chưa cấu hình Nginx, cấp chứng chỉ hoặc thay đổi dịch vụ thật trên VPS bằng các bước kiểm tra này.
