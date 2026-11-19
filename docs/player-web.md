# Happy house Scam Club: mở hòm, Upgrade và Battle trên web

Trang dành cho người chơi ở **`/play/`**, chạy trong cùng tiến trình và cùng cổng với bot Discord. Tài khoản trên web dùng đúng **ví xu và kho skin của bạn trong máy chủ Discord đã đăng nhập**. Những máy chủ khác nhau vẫn có ví và kho riêng như trong bot.

VPS hiện dùng tên miền **https://teoteo.site/play/**. Người chơi truy cập trực tiếp bằng điện thoại hoặc máy tính, dùng `/web` trong Discord để lấy mã đăng nhập riêng. `www.teoteo.site` chuyển về tên miền chính; không cần SSH hoặc OPEN_PLAY trên máy khác. OPEN_PLAY.bat hiện mở địa chỉ công khai này. Các hướng dẫn SSH bên dưới dành cho chế độ localhost trước khi gắn tên miền hoặc cài đặt khác.

Xu và skin trong ứng dụng là dữ liệu trò chơi ảo. Trang không nạp/rút tiền, không chuyển vật phẩm vào Steam và không cung cấp giao dịch vật phẩm thật.

## Mở trang khi chưa có tên miền

1. Nhấp đúp **OPEN_PLAY.bat** trong thư mục dự án trên máy Windows.
2. Công cụ kết nối VPS bằng khóa SSH hiện có rồi mở **`http://127.0.0.1:3001/play/`**.
3. Trong máy chủ Discord muốn dùng ví, nhập lệnh **`/web`**. Bot gửi mã đăng nhập chỉ mình bạn nhìn thấy.
4. Chọn đăng nhập trên trang và dán mã đó. Mã có 16 ký tự, hiển thị theo nhóm để dễ đọc, có hiệu lực tối đa **5 phút** và chỉ dùng **một lần**.

Trang không cần mật khẩu quản trị, Discord token hoặc tài khoản Steam. Không gửi mã đăng nhập cho người khác: mã xác nhận đúng tài khoản và máy chủ đã cấp nó. Nếu nhập mã hết hạn, dùng lại `/web` để lấy mã mới.

Nếu **OPEN_ADMIN.bat** hoặc một kết nối SSH cũ đã dùng cổng `3001`, công cụ chỉ dùng lại khi địa chỉ `/play/api/session` trả đúng dấu nhận diện `may-skins`. Giữ cửa sổ đang cung cấp kết nối đó mở. Nếu công cụ tự tạo đường hầm mới, giữ cửa sổ **OPEN_PLAY** mở và nhấn **Ctrl+C** khi muốn ngắt truy cập từ máy Windows. Bot trên VPS vẫn chạy.

Công cụ không dừng chương trình đang chiếm cổng. Nếu cổng bận nhưng không phải trang Happy house Scam Club, nó báo lỗi để bạn tự chọn kết nối phù hợp. Nếu chưa cài khóa SSH, dùng **UPDATE_VPS.bat → 3** theo [hướng dẫn VPS](../UBUNTU_VPS.md).

Phiên đăng nhập được lưu trên PostgreSQL nên vẫn còn sau khi bot khởi động lại hoặc cập nhật. Phiên tự gia hạn khi bạn dùng trang, hết hạn sau 30 ngày không hoạt động hoặc tối đa 90 ngày; chọn **Đăng xuất** khi dùng máy chung.

## Mở hòm, kho đồ và Upgrade

- **Danh mục hòm:** có 169 hòm Battle và đủ 42 **Hòm thường** từ lệnh `/hom` trên Discord. Chọn bộ lọc **Hòm thường** để xem danh sách, hoặc bấm vào từng hòm để xem skin, tỷ lệ và một khoảng giá gộp từ các báo giá mới theo độ mòn/bản StatTrak™. Di chuột vào giá để xem từng mức. Giá vật phẩm thực tế phụ thuộc vào kết quả mở. Hòm thường dùng cùng nội dung và tỷ lệ như Discord. Terminal và bộ sưu tập vẫn là nguồn skin; phòng Battle tiếp tục dùng danh mục hòm Battle riêng.
- **Mở hòm:** chọn số lượng có sẵn hoặc nhập số lượng tùy ý, rồi xem phí trước khi mở. Với hòm thường, trang dùng hòm và chìa đang có trong kho Discord trước, chỉ tính xu cho phần còn thiếu. Chìa có giá **60.000 xu**; giá hòm lấy từ bảng giá mới của bot. Nếu giá hòm hết hạn, bạn vẫn mở được số hòm đã có (và mua chìa còn thiếu nếu cần). Hòm thường dùng tỷ lệ `/hom` và không có Exclusive Drop.
- **Xác nhận kết quả:** máy chủ xác định kết quả và cập nhật ví/kho trước khi giao diện chạy hoạt ảnh; hoạt ảnh không thay đổi tỷ lệ. Nếu số hòm, chìa hoặc giá áp dụng đổi khi xác nhận, trang yêu cầu xem lại phí. Nếu mất mạng lúc máy chủ xử lý, có thể khôi phục cùng lượt mở đã gửi để tránh gửi giao dịch mới.
- **Hoạt ảnh và âm thanh:** mỗi hòm trong lượt mở nhiều hòm có vòng quay riêng, hình skin dừng theo kết quả máy chủ. Âm thanh mở, lướt qua và báo độ hiếm dùng bộ tiếng CS2 đang có trong dự án, kèm tiếng tổng hợp dự phòng; không phải bản thu âm từ Skin.Club. Trình duyệt bật tiếng sau lần chạm/bấm đầu tiên; nút trên thanh điều hướng bật/tắt và ghi nhớ lựa chọn. Khi tắt tiếng, âm đang phát cũng dừng.
- **Kho đồ:** xem skin nhận trên Discord hoặc web, chọn vật phẩm để khóa/mở khóa, bán về xu khi có giá hợp lệ. Vật phẩm đang khóa được giữ khỏi thao tác bán và Upgrade.
- **Chợ người chơi:** vào mục **Chợ** để đăng bán skin với giá bạn chọn, xem tin trong cùng máy chủ, mua bằng xu hoặc hủy tin để lấy skin về. Skin đang đăng được giữ khỏi kho và không thể dùng/bán lần nữa; web kiểm tra lại giá tham khảo, quyền sở hữu, khóa skin và số dư trước giao dịch.
- **Chuyển xu:** nhập ID Discord người nhận trong cùng máy chủ, xem tên và số dư sau giao dịch, rồi xác nhận lần cuối. Phí chuyển hiện là 0 xu; hệ thống không cho tự chuyển, chuyển cho bot, người ngoài máy chủ hoặc vượt số dư. Chuyển tối đa 10 lần mỗi giờ.
- **Upgrade:** chọn tối đa 10 skin và/hoặc xu, chọn món đích rồi xem tỷ lệ thắng và chi phí trước khi xác nhận. Thắng nhận skin đích; thua mất đúng các skin/xu đã chọn. Kết quả dùng cùng bộ xử lý Upgrade với Discord.

Giá lấy từ bảng thị trường đã đồng bộ của bot. Nếu không có báo giá còn hạn, trang không dùng giá thay thế để mua hòm hoặc bán skin. Số dư, quyền sở hữu, giá và khóa vật phẩm được kiểm tra lại trong giao dịch của máy chủ.

## Case Battle

Tạo phòng **đấu đơn 2–6 người**, **2v2**, **3v3** hoặc **2v2v2**, chọn từ **1 đến 100 hòm** theo thứ tự muốn mở. Vị trí ghế quyết định đội; đổi ghế cũng đổi đội. Web có chín luật:

- **Thường:** người có tổng giá trị skin cao nhất nhận toàn bộ skin của trận.
- **Crazy:** người có tổng giá trị thấp nhất nhận toàn bộ skin của trận.
- **Sharing:** tổng giá trị skin được chia thành xu cho mọi người. Khi chế độ Thường hoặc Crazy có nhiều người đồng hạng thắng, giá trị cũng được chia thành xu cho những người đó.
- **Terminal / Terminal Crazy:** chỉ vòng cuối quyết định thắng; chọn bên có giá trị vòng cuối cao nhất / thấp nhất. Phần thưởng vẫn gồm toàn bộ skin của tất cả vòng.
- **Clutch / Clutch Crazy:** so sánh vòng có giá trị cao nhất / thấp nhất của mỗi bên, thay vì tổng cả trận.
- **Jackpot / Jackpot Crazy:** bốc thăm theo tỷ trọng tổng giá trị / nghịch đảo tổng giá trị. Các bên có tổng bằng không chia đều cơ hội khi chơi Jackpot Crazy; nếu tất cả bằng không, cả hai luật Jackpot chia đều cơ hội. Vòng bốc thăm dùng HMAC-SHA256 và rejection sampling với số nguyên BigInt.

Trong đấu đội, điểm mỗi vòng là tổng giá trị của các thành viên trong đội. Đội thắng chia đều toàn bộ giá trị thưởng thành xu; Sharing chia cho tất cả người chơi, bất kể đội. Hòa chia xu giữa tất cả thành viên của các bên thắng. Phần lẻ được phân bổ bằng cùng nguồn ngẫu nhiên đã khóa. Bot không giữ xu hay skin; phần của bot được ghi riêng, không chia thêm cho người thật. Trận đấu đơn có một người thắng trao toàn bộ skin cho người đó.

Phòng chỉ xuất hiện trong máy chủ Discord đã đăng nhập. Thành viên vào phòng từ trang Battle; chủ phòng bấm bắt đầu khi đủ người. Phòng chờ hết hạn sau **10 phút**. Vào phòng chưa trừ hoặc giữ xu. Khi bắt đầu, hệ thống kiểm tra lại thành viên, phí và số dư của tất cả người chơi; nếu có thay đổi không hợp lệ thì không trừ xu của ai.

Mỗi vòng có một cột quay dọc cho từng người. Tất cả người xem dùng chung mốc thời gian máy chủ cho quay thường, Exclusive, cộng từng món và bốc thăm Jackpot. Chuyển tab không tự hiện kết quả; quay lại tiếp tục đúng tiến độ chung. Các bảng điểm đội và luật riêng tách khỏi tổng skin đã mở. Người thắng Jackpot chỉ được công bố sau khi kết thúc hoạt ảnh bốc thăm. Ví giữ phần thưởng khỏi số dư hiển thị cho đến lúc trình chiếu hoàn tất, kể cả khi tải lại trang giữa trận.

Sau trận, nút **Chơi lại cấu hình này** mở sẵn cùng hòm theo đúng thứ tự, luật, thể thức, số ghế và Exclusive Drop. Bạn có thể chỉnh lại rồi xác nhận tạo phòng; hệ thống kiểm tra giá mới và chưa tạo phòng hay trừ xu trước khi bấm xác nhận.

Kết quả, phí của mọi người và phần thưởng được lưu cùng một giao dịch trước khi trình duyệt chạy lại từng vòng. Tải lại trang hoặc bấm bắt đầu nhiều lần không mở thêm trận hay trừ phí lần nữa. Phòng và kết quả đã lưu vẫn còn sau khi bot khởi động lại; phiên đăng nhập mới cũng được giữ qua restart và cập nhật.

Phòng hiển thị mã cam kết SHA-256 từ lúc tạo; khi kết thúc mới công bố server seed, client seed và kết quả kiểm tra HMAC-SHA256, kèm vé và tổng trọng số của Jackpot. Có thể mời bot trình diễn vào chỗ còn trống; bot không dùng ví hoặc kho đồ người chơi. Phòng mới dùng phiên bản luật 2; phòng cũ và kết quả cũ tiếp tục kiểm chứng bằng phiên bản gốc.

## Chạy bản xem trước

Để kiểm tra giao diện mà không kết nối Discord hay PostgreSQL, chạy `node scripts/preview-player.js 4337 --scenes`, rồi mở `http://127.0.0.1:4337/play/`. Trình xem trước dùng kho dữ liệu tạm và mã đăng nhập demo, không ghi vào ví hoặc kho người chơi thật. Khi triển khai bản nguồn mới, chạy `npm run build:play` trước khi khởi động ứng dụng.

## So sánh với Skin.Club

Giao diện được làm theo hướng tham khảo Skin.Club: nền tối tím, điểm nhấn hồng/tím, banner sự kiện, thẻ hòm theo lưới, vòng quay, màn Upgrade và điều hướng điện thoại. Ảnh nền banner trong `web/play/club-assets/heist-background.jpg` được lấy từ ảnh banner công khai của Skin.Club: `https://cfdn.skin.club/assets/img/event/grand-heist/main-page-banner/back.jpg?policy=bg-auto`. Tên thương hiệu, biểu tượng, ảnh skin, tỉ lệ, kho đồ và luồng giao dịch vẫn dùng dữ liệu của Happy house Scam Club. Đây không phải bản sao pixel-perfect; website tham khảo yêu cầu đăng nhập để xem hết luồng mở và âm thanh, nên phần đó chưa được xác minh hay sao chép.

## Ảnh skin

Ảnh skin trên trang được tải qua đường dẫn cùng VPS và lưu đệm tại `data/player-images/`. Nếu ảnh theo độ mòn không tải được, máy chủ thử ảnh gốc của **đúng skin đó**. Blue Gem ưu tiên ảnh mẫu đã xác minh trong dự án. Khi cả hai nguồn đều không sẵn sàng, trang hiện ô báo chưa tải được ảnh cùng tên skin; kết quả, xu và vật phẩm vẫn được giữ nguyên.

Bộ nhớ đệm ảnh có giới hạn 48 MB trong RAM và 128 MB trên đĩa, không thuộc dữ liệu ví/kho. Script triển khai giữ nguyên thư mục `data/`.

## Cấu hình trên VPS

Trong `/opt/discord-bot/.env`, bật riêng trang người chơi:

```dotenv
PLAYER_ENABLED=true
PLAYER_ORIGIN=http://127.0.0.1:3001
```

Giữ nguyên các thiết lập Discord và PostgreSQL đang dùng, rồi khởi động lại:

```bash
sudo systemctl restart discord-bot.service
curl --fail --silent http://127.0.0.1:3001/health
```

Không cần tạo dịch vụ Node thứ hai. Script cập nhật hiện tại đóng gói thư mục `web/` cùng mã bot và khôi phục chúng cùng nhau nếu bản cập nhật lỗi. Trang quản trị vẫn dùng thiết lập `ADMIN_*` riêng.

Nếu đổi cổng cục bộ, đặt `PLAYER_ORIGIN` khớp chính xác địa chỉ sẽ mở trong trình duyệt. Ví dụ bot trên VPS vẫn dùng cổng `3001`, máy Windows dùng cổng `33001`:

```dotenv
PLAYER_ORIGIN=http://127.0.0.1:33001
```

Sau khi khởi động lại bot, chạy trên Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\open-play.ps1 -LocalPort 33001 -RemotePort 3001
```

## Cho người chơi khác truy cập bằng tên miền

Chế độ SSH hiện tại dành cho máy có kết nối vào VPS. Để người chơi mở trang trực tiếp từ điện thoại hoặc máy khác, gắn tên miền HTTPS vào VPS.

Mẫu [nginx-player.conf](../config/nginx-player.conf) chỉ chuyển `/play/` vào bot, không công khai `/admin/`, `/health` hoặc mã nguồn. Thay `skins.example.com` bằng tên miền đã trỏ đến VPS và thay cổng nếu bot không dùng `3001`.

Cấu hình cụ thể của VPS này dùng [nginx-teoteo.conf](../config/nginx-teoteo.conf) để khởi tạo HTTP, sau đó Certbot thêm HTTPS tại `/etc/nginx/sites-available/teoteo.site`. DNS: `@ A 180.93.126.48`, `www CNAME teoteo.site`. Trong `.env` trên VPS: `PLAYER_ORIGIN=https://teoteo.site`, `HTTP_HOST=127.0.0.1`; giữ nguyên `ADMIN_ORIGIN=http://127.0.0.1:3001`. Bot nghe localhost, Nginx công khai cổng 80/443. Cấu hình Certbot tự gia hạn chứng chỉ.

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
sudo cp /opt/discord-bot/config/nginx-player.conf /etc/nginx/sites-available/may-skins
sudo nano /etc/nginx/sites-available/may-skins
sudo ln -s /etc/nginx/sites-available/may-skins /etc/nginx/sites-enabled/may-skins
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d skins.example.com --redirect
```

Nếu symlink đã có, bỏ qua lệnh `ln -s`. Hoàn tất chứng chỉ, rồi đổi cấu hình và khởi động lại bot:

```dotenv
PLAYER_ENABLED=true
PLAYER_ORIGIN=https://skins.example.com
```

```bash
sudo systemctl restart discord-bot.service
sudo certbot renew --dry-run
```

Người chơi mở **`https://skins.example.com/play/`** và vẫn dùng mã `/web` để đăng nhập. Trang chỉ chấp nhận HTTPS với địa chỉ công khai. Không cần mở cổng `3001` ra Internet; Nginx chuyển tiếp qua localhost. Sau khi đổi origin sang tên miền, địa chỉ localhost cũ không còn là địa chỉ được phép của trang người chơi.

## Khi cần kiểm tra

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Công cụ báo cổng bận | Kiểm tra cửa sổ SSH/OPEN_ADMIN cũ; chỉ dùng lại kết nối trả đúng dấu nhận diện của trang. |
| Trang không tải | Bot đang chạy, đường hầm còn mở, `PLAYER_ENABLED=true`, địa chỉ và cổng khớp `PLAYER_ORIGIN`. |
| Chưa có lệnh `/web` | Chờ bot đăng ký lệnh sau khi khởi động; dùng trong máy chủ được bot cho phép. |
| Mã không dùng được | Tạo mã mới bằng `/web`; mã cũ chỉ dùng một lần và hết hạn sau tối đa 5 phút. |
| Xu hoặc skin khác dự kiến | Kiểm tra máy chủ đã dùng khi gọi `/web`; mỗi máy chủ có ví và kho riêng. |
| Hòm hoặc skin đang chờ giá | Chờ bot đồng bộ giá thị trường; không phải mọi món đều có báo giá còn hạn cùng lúc. |
| Upgrade yêu cầu chọn lại | Kho, khóa vật phẩm hoặc giá đã thay đổi trên Discord/web; tải lại và xác nhận dữ liệu mới. |
| Quay không có tiếng | Bật nút âm thanh, thao tác/chạm vào trang một lần để trình duyệt cho phát tiếng, rồi kiểm tra tab/trình duyệt có bị tắt tiếng không. |
| Skin có tên nhưng chưa có ảnh | Thử tải lại trang; VPS sẽ thử lại nguồn ảnh sau thời gian chờ ngắn và dùng ảnh gốc cùng skin khi ảnh độ mòn lỗi. |
| Battle không bắt đầu | Cần đủ người, chủ phòng bấm bắt đầu, mọi người còn trong máy chủ và còn đủ xu; phòng/giá chưa hết hạn. |

Không đưa Discord token, chuỗi kết nối cơ sở dữ liệu hoặc mã đăng nhập vào ảnh chụp hỗ trợ. Có thể kiểm tra sức khỏe bot qua SSH bằng `/health`; khi cần xem nhật ký, dùng `journalctl -u discord-bot.service -n 50 --no-pager` tại VPS.
