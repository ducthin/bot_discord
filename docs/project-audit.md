# Rà soát và tinh gọn dự án — 16/11/2026

## Trạng thái hiện tại

Bot tập trung vào `/hom`, Tiệm Bánh và phát nhạc. Giữ ví, daily, kho, khóa món, Chợ skin, Trade Up, Battle, playlist cá nhân, favorites, lyrics và lịch sử nhạc.

Đã gỡ AI chat, nhận diện/đọc giọng nói, `/musicquiz`, `/recommend`, `/autotrending` riêng, `/visualizer` và nút xem lại lượt quay hòm. `groq-sdk`, cấu hình AI mẫu, handler và state của các tính năng này đã được dọn. `/trending auto`, voice phát nhạc và mở hòm có tiếng vẫn hoạt động. Nút cũ của tính năng đã gỡ trả thông báo trước khi thay đổi dữ liệu. Bot không yêu cầu Message Content Intent; lệnh chủ bot `!addxu` qua tin nhắn riêng vẫn được giữ.

Nhóm quản lý server vẫn tắt trong `config/features.json`: thông báo, phòng tạm, chào thành viên, báo cáo, ticket và tiện ích cộng đồng không được khởi tạo. Mã nguồn và dữ liệu nhóm này được giữ. `/setup` hiện chỉ cấu hình Tiệm Bánh; `/botstatus` kiểm tra kết nối và quyền nhạc.

## Các sửa và tối ưu đã hoàn tất

- `/hom` đọc ví/kho theo người dùng; giao dịch chợ tải các bên tham gia rồi kiểm tra lại chủ sở hữu. Tiệm Bánh không tải kho skin. Transaction giữ khóa theo server, ghi nguyên tử và chặn ghi ngoài phạm vi đã chọn.
- Bán đồ kiểm tra lại giá khi xác nhận. Bán đồ và Trade Up đều kiểm tra lại khóa món, danh tính và phiên bản vật phẩm. Nếu skin đã rời kho rồi quay lại, kể cả đăng chợ rồi hủy tin, bảng xác nhận cũ hết hiệu lực. Trade Up vẫn chấp nhận cùng bộ nguyên liệu khi chỉ đổi thứ tự trong kho.
- Thứ tự kho ổn định với cả món có ngày nhận và dữ liệu cũ thiếu ngày nhận. Ảnh kho dùng ảnh chính đã cache, không tải hoặc chờ ảnh dự phòng khi đã đủ ảnh chính; vẫn dùng ảnh dự phòng khi cần. Giữ ảnh kho dạng lưới và ảnh chi tiết skin.
- Kết quả Battle chia trang theo giới hạn nội dung Discord, tối đa bốn vòng mỗi trang; phần hòa dài cũng được chia trong kết quả và lịch sử. Khôi phục trận kiểm tra shutdown, tránh chạy trùng và phát thưởng lặp.
- Battle dùng GIF 25 fps và hàng đợi render hữu hạn. Mở lẻ, mở nhiều và Battle giữ ô vàng trong dải quay lẫn khung dừng, có biểu tượng dự phòng nếu thiếu ảnh. Không đổi xác suất hay kết quả đã lưu.
- Cache ảnh giới hạn 96 ảnh, 32 MiB tổng cộng và 8 MiB mỗi lượt tải; gộp yêu cầu cùng ảnh đang chạy. Truy vấn YouTube giống nhau cũng dùng chung worker và kết thúc worker sau kết quả, lỗi hoặc timeout.
- Bỏ mua/mở Terminal và cơ chế đề nghị cũ; giữ catalogue Terminal để vật phẩm cũ còn xem, khóa, bán, đăng chợ và Trade Up được. Giữ các utility dùng chung cho hòm và Tiệm Bánh dù tên có `management`.
- Chặn interaction cược trùng và chỉ bắt đầu timer sau khi lưu thành công. Gộp cập nhật xếp hạng, chọn top mà không sắp xếp toàn bộ ví. Giữ health endpoint HTTP tích hợp và thư viện voice cần cho phát nhạc.

## Dọn file chưa thực hiện

Đã xác định bốn file `scratch_*`, ba ảnh preview không có caller và một số báo cáo/runtime kiểm thử đã dùng xong có thể dọn. Tuy nhiên, cơ chế phê duyệt tự động từ chối cả lệnh xóa hàng loạt lẫn lệnh hẹp xóa bốn file nháp và ba ảnh preview với lý do `blocked by policy`. Các file trong `assets`, `scratch_*` và `.runtime` chưa được xóa; không thử lệnh khác để vượt chặn.

Phần dọn mã không dùng trong hai file đã hoàn tất. Ảnh Battle, ảnh nguồn để tái tạo/kiểm thử, biểu tượng rare reel, âm thanh, catalogue cũ, PostgreSQL, runtime Python và công cụ triển khai/khôi phục vẫn được giữ. Báo cáo đề xuất trước đây được thay bằng [ghi chú dẫn tới trạng thái hiện tại](feature-pruning-review.md).

Danh sách đã kiểm tra để dọn, hiện **vẫn còn trên ổ đĩa**: 30 mục, 18.313 file, tổng 495.279.298 byte (khoảng 472 MiB).

| Nhóm | Đường dẫn |
| --- | --- |
| File nháp | `scratch_health.js`, `scratch_output.txt`, `scratch_ytdlp.js`, `scratch_yts_playlist.js` |
| Ảnh xem thử Battle | `assets/cs2-battle-art/contact-sheet.jpg`, `tie-left-last.png`, `tie-right-last.png` trong cùng thư mục |
| Bộ thử và ảnh xem thử | `.runtime/feature-tests`, `battle-review`, `gold-reel-review`, `inventory-review`, `inventory-hd-preview.png`, `inventory-preview-1.png`, `inventory-preview-2.png`, `inventory-preview-12.png` trong `.runtime` |
| Fixture triển khai | `.runtime/deploy-watch-01dc136fdfec435b92fb1cd054d856fb`, `.runtime/deploy-watch-8172d71a6c6b4241bec1c2389fa6292c` |
| Công cụ kiểm thử Linux | `.runtime/node-linux-reel-validation`, `.runtime/ffmpeg-linux-reel-validation`, `.runtime/deploy-validation.sh` |
| Báo cáo tạo tự động | `.runtime/audit-production.json`, `audit-production-final.json`, `audit-tests-final.json`, `battle-performance-before.json`, `battle-performance-after.json`, `battle-performance-mixed-after.json`, `battle-performance-mixed-default.json` trong `.runtime` |
| Bộ cài đã giải nén và bản sao tính năng đã bỏ | `.runtime/python.zip`, `.runtime/removed-features-2026-11-16`, `.runtime/retired-commands-2026-11-15` |

Hai cụm PostgreSQL kiểm thử, dữ liệu merge, cập nhật, SSH và các mục phục hồi VPS không nằm trong danh sách dọn. Runtime Python hiện tại và `node_modules` của bot vẫn cần cho vận hành.

## Kiểm chứng và giới hạn

Kiểm tra cuối **sau toàn bộ năm bước tối ưu**: **53 suite / 569 test đạt** trên PostgreSQL dùng một lần; không có test bỏ qua. Lượt Jest mặc định đạt **50 suite / 547 test**, bỏ qua **3 suite / 22 test PostgreSQL** khi không có `TEST_DATABASE_URL`. Cụm PostgreSQL thử đã dừng và xóa sau khi chạy.

Kiểm tra cú pháp 151 file JavaScript và 256 `require` tương đối của mã chạy bot, không có đường dẫn thiếu; nạp và serialize được 40 slash command. Schema của toàn bộ 40 lệnh và public exports của `/hom` giữ nguyên sau khi tách module; 115 hàm giữ nguyên AST. `node scripts/preflight.js --dependencies-only` đạt.

Các kiểm tra trên không đăng nhập Discord hoặc gọi API YouTube thật. Chưa triển khai hay khởi động lại bot trong đợt sửa; danh sách slash command được cập nhật ở lần khởi động tiếp theo. Chạy lại `npm test -- --runInBand` để kiểm tra mã hiện tại. Test PostgreSQL cần `TEST_DATABASE_URL` trỏ tới database kiểm thử riêng.

## Đợt tối ưu tiếp theo

Theo yêu cầu thực hiện lần lượt, đã bổ sung số đo PostgreSQL, render và upload dưới cờ `HOM_PERF_METRICS`; log tổng hợp mỗi phút có giới hạn bộ nhớ. Battle gộp render giống nhau, dùng cache GIF ngắn hạn có giới hạn, giữ attachment PNG bất biến trên đúng tin nhắn và bỏ upload bìa ở trạng thái mở lẻ đang tải.

Tiệm Bánh đăng và khôi phục bàn ngoài transaction bằng reservation/lease/nonce rồi xác nhận CAS. Timer, công bố xúc xắc và cập nhật cache chỉ chạy sau commit; khôi phục cùng ván giữ nguyên cược phát sinh trong thời gian Discord chậm. Worker tìm YouTube giới hạn 2 chạy, 16 chờ, thời hạn chờ 10 giây và thời hạn chạy 20 giây; truy vấn trùng tiếp tục dùng chung tác vụ.

Đã tách `commands/hom.js` từ 2.105 xuống 1.026 dòng, đưa kho, chợ, Trade Up và kết nối Battle vào bốn module `commands/hom/`. Các map phiên nằm trong module sở hữu; factory nhận dependency cụ thể, không import vòng. Số liệu và hướng dẫn vận hành xem [Đo và tối ưu hiệu năng](performance.md).

Chi tiết hành vi hiện tại xem [Kho đồ và Trade Up](hom-inventory.md), [Case Battle](case-battle.md) và [PostgreSQL](postgresql.md).
