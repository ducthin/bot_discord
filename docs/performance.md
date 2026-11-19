# Đo và tối ưu hiệu năng

Đặt `HOM_PERF_METRICS=true` trong môi trường chạy bot rồi khởi động lại theo quy trình vận hành. Mặc định tắt. Khi có hoạt động, bot ghi một dòng `[performance]` tổng hợp mỗi 60 giây; không ghi ID người chơi/server, từ khóa tìm kiếm, URL hoặc từng giao dịch.

| Nhãn | Nội dung đo |
| --- | --- |
| `store.read` | Đọc dữ liệu PostgreSQL theo phạm vi yêu cầu |
| `store.transaction` | Toàn bộ transaction, gồm chờ khóa và commit |
| `store.locked` | Callback chạy sau khi đã lấy khóa, gồm đọc và ghi dữ liệu |
| `hom.render.queue` | Chờ lượt tạo ảnh động |
| `hom.render.single`, `hom.render.batch`, `hom.render.inventory` | Thời gian chuẩn bị ảnh, chờ lượt và render; nhãn batch có thể gồm cache hit |
| `hom.upload`, `battle.upload` | Lời gọi sửa/gửi tin Discord và số byte file trong bộ nhớ được gửi thành công |
| `hom.render.batch.cacheHit`, `hom.render.batch.coalesced` | Lượt dùng lại GIF hoặc dùng chung render đang chạy |
| `youtube.search`, `youtube.queue`, `youtube.worker` | Toàn bộ yêu cầu tìm kiếm, thời gian chờ và thời gian chạy worker |
| `youtube.coalesced`, `youtube.rejected`, `youtube.timeout` | Truy vấn trùng được gộp, hàng đợi đầy và hết hạn chờ/chạy |

Mỗi nhãn có số lượt, lỗi, kết quả null, byte, thời gian trung bình, lớn nhất và `p95UpperMs`. P95 là cận trên của khoảng histogram, không phải phân vị chính xác. Bộ nhớ thống kê giới hạn bằng danh sách nhãn và số khoảng cố định; số liệu được reset sau mỗi dòng log. `rssBytes` là RAM của tiến trình Node, không bao gồm FFmpeg con.

Đọc số liệu trong giờ đông người: nếu transaction dài nhưng callback ngắn, kiểm tra chờ khóa/commit; nếu callback dài, kiểm tra thao tác trong transaction. Nếu render dài, xem thời gian hàng đợi và số kết quả null. Nếu upload dài, kiểm tra mạng và giới hạn Discord. Chỉ so sánh các khoảng có tải tương đương.

## Kiểm tra renderer ngoại tuyến

```powershell
node scripts/benchmark-cs2-battles.js --concurrency=1,2 --players=4 --profile=battle --artwork=mixed --reuse=true
```

Script dùng ảnh cục bộ, không đăng nhập Discord hoặc đọc dữ liệu người chơi. Mỗi mức concurrency dùng seed riêng để tránh cache từ mức trước; mục `reuse` kiểm tra hai yêu cầu giống nhau và một yêu cầu lặp sau khi render xong.

Mốc trên máy phát triển ngày 16/11/2026: một vòng 4 người khoảng 1,44 giây, hai vòng khác nhau đồng thời khoảng 1,42 giây; GIF khoảng 2,39 MB. Hai yêu cầu giống nhau dùng chung Buffer; yêu cầu dùng lại cache mất dưới 1 ms theo độ phân giải phép đo. Đây là số đo renderer cục bộ, chưa gồm PostgreSQL, mạng hoặc Discord.

Battle chỉ dùng cache cho dải quay có seed xác định và đầy đủ nội dung/giới hạn dung lượng giống nhau. Cache tối đa 8 GIF, 16 MiB, TTL 30 giây; gộp tối đa 14 render đang chờ/chạy. Kết quả null/lỗi không được lưu. Cache không thay đổi kết quả, xác suất, số vòng hay thời lượng quay; không tạo nút phát lại.

## Giao dịch Tiệm Bánh

Đăng và khôi phục bàn dùng ba bước: transaction lưu yêu cầu, gọi Discord bên ngoài transaction, rồi transaction xác nhận đích tin nhắn. Yêu cầu có lease 60 giây, gia hạn mỗi 15 giây khi đang gửi; lần khởi động sau có thể tiếp tục yêu cầu bị ngắt. Kênh, ván nguồn và trạng thái được kiểm tra lại trước khi chấp nhận bàn mới. Khôi phục cùng ván chỉ thay kênh/mã tin nhắn, giữ các cược phát sinh trong thời gian gửi.

Nonce ổn định giúp Discord khử trùng lần gửi lại gần nhau. Discord chỉ bảo đảm khử trùng trong một khoảng thời gian ngắn; bảo đảm của bot là một bàn được chấp nhận trong dữ liệu và thưởng được ghi một lần. Tin thừa không khớp mã tin nhắn hiện hành không nhận cược. Timer, công bố xúc xắc và cập nhật xếp hạng bắt đầu sau khi commit thành công.

Chạy toàn bộ kiểm thử với PostgreSQL dùng một lần:

```powershell
node scripts/test-postgres.js
```

Script dùng PostgreSQL 17 đã cài trên Windows; đặt `POSTGRES_BIN` nếu thư mục binary khác. Nó tạo thư mục tạm mới và cổng loopback riêng, truyền `TEST_DATABASE_URL` cho Jest, bỏ `DATABASE_URL` khỏi môi trường Jest, rồi dừng/xóa cụm thử do chính nó tạo. Không dùng lại cụm PostgreSQL hoặc dữ liệu của bot. Có thể truyền tên file test sau lệnh; `--probe` chỉ kiểm tra khởi tạo/kết nối/cleanup.

## Worker tìm kiếm YouTube

Tìm video, playlist và thông tin video dùng chung tối đa 2 worker, 16 yêu cầu khác nhau đang chờ. Yêu cầu trùng dùng cùng tác vụ cả khi chờ lẫn khi chạy. Hàng đợi theo thứ tự đến, chờ tối đa 10 giây; mỗi worker được chạy tối đa 20 giây sau khi nhận lượt. Bot chỉ trả slot khi thread đã kết thúc, kể cả khi đã nhận được kết quả.

Hàng đợi đầy hoặc hết hạn chờ kết thúc yêu cầu theo cơ chế lỗi hiện có, không tự retry làm tăng tải. Lỗi mạng vẫn retry như trước. Đây là giới hạn tìm kiếm `yt-search`; việc phát âm thanh bằng `yt-dlp` giữ luồng xử lý riêng.

## Cấu trúc `/hom`

`commands/hom.js` giữ đăng ký lệnh, định tuyến interaction, dữ liệu hòm/giá dùng chung và điều phối tác vụ mở hòm. Các phần còn lại nằm trong:

| File | Trách nhiệm |
| --- | --- |
| `commands/hom/inventory.js` | Kho, ảnh kho, xem món, bán lẻ/bán nhiều và khóa món |
| `commands/hom/market.js` | Bảng Chợ skin, bộ lọc, biểu mẫu đăng bán, mua và hủy tin |
| `commands/hom/tradeUp.js` | Phiên chọn nguyên liệu, xem xác suất và xác nhận Trade Up |
| `commands/hom/battle.js` | Kết nối Battle với ví/kho, kết quả mở lẻ và tín hiệu dừng hoạt ảnh |

Mỗi module dùng factory với dependency cụ thể; các map phiên nằm trong module sở hữu chúng. Module kho được truyền cho chợ, Trade Up và Battle; các module không import ngược `hom.js` hoặc import lẫn nhau. Phần Battle chung vẫn ở `utils/cs2BattleUi.js`. Tách file giữ nguyên custom ID, public exports và cấu trúc slash command; không tạo thêm lệnh Discord.
