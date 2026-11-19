# Kiểm tra lỗi Battle ngày 17/11/2026

## Lỗi và cách sửa

| Luồng | Nguyên nhân | Kết quả sau sửa |
| --- | --- | --- |
| Tạo lại trận dài, như ảnh 30 vòng | Nút dùng lịch sử cá nhân chỉ lưu 1 phút từ lúc tạo phòng; lịch sử đã hết hạn khi hoạt ảnh kết thúc. | Dùng cấu hình kết quả riêng trong thời hạn của tin kết quả. Chỉ người thật tham gia đến cuối trận, trong đúng kênh, được tạo lại. |
| Xem tỷ lệ rồi quay lại thao tác | Phiên ngắn, thao tác xem tỷ lệ không gia hạn; mở bảng khác thay thế phiên của cùng người. | Phiên có 15 phút không thao tác, gia hạn khi xem tỷ lệ/chuyển trang/mở biểu mẫu thành công. Các bảng riêng có phiên riêng. Phiên hết hạn có nút mở lại. |
| Về hòm Battle sau khi mở Howl hoặc skin collection | Nút trả về dùng collection làm hòm gốc trong khi collection không có chìa để mở. | Trở lại đúng hòm Battle qua hòm gốc hợp lệ; các nút collection cũ vẫn đọc được. |
| Trở lại hòm ở trang sau hoặc giá hòm thay đổi | Danh mục xếp theo phí, nhưng bảng chọn trở về trang đầu và tự chọn hòm khác. | Tìm đúng trang của hòm đã chọn; chỉ đổi trang khi người chơi yêu cầu. |
| Bán/khóa/xem skin collection có ID dài | ID nút có thể vượt giới hạn 100 ký tự của Discord. | Rút gọn đường dẫn nút và phục hồi trang kho từ vật phẩm sở hữu khi cần; nguồn collection thật vẫn giữ nguyên. |
| Chuyển trang/xem hòm trên kết quả sau nhiều trận | Giới hạn dọn 30 phòng xóa dữ liệu trước khi tin kết quả hết 10 phút. | Giữ vòng đấu và giá đã khóa đến hạn của tin kết quả, sau đó cho phép dọn như trước. |

Các thay đổi giữ nguyên xác suất, quy tắc thắng, phí và phần thưởng đã quyết toán. Xem hòm, quay lại, tạo bản nháp và đăng phòng chờ không tự thu thêm tiền. Khi đăng hoặc bắt đầu, bot tiếp tục kiểm tra giá và số dư.

Theo yêu cầu tiếp theo, thời hạn tự xóa tin kết quả được đổi từ 10 phút thành **1 phút kể từ khi hiện kết quả cuối cùng**. Xem trang hoặc làm mới không gia hạn. Khi khôi phục, các bản ghi cũ có hạn 10 phút cũng dùng hạn tối đa 1 phút từ lúc công bố ban đầu; nếu đã quá hạn thì xóa ngay. Nút tạo lại dùng cùng thời hạn của tin kết quả.

## Phạm vi xác minh

Kiểm thử mô phỏng tương tác Discord, thời gian và lỗi gửi tin. Các ca liên quan dữ liệu chạy trên PostgreSQL tạm được tạo riêng và dọn sau khi chạy. Không dùng ví hoặc kho thật, không đăng trận thật và chưa khởi động lại bot.

Các tình huống mới gồm lịch sử hết hạn sau trận 30 vòng, quyền người tham gia/người ngoài/người đã rời/bot, cấu hình qua khởi động lại, xem tỷ lệ liên tục rồi quay lại, mở nhiều bảng riêng, nút cũ, giá đổi làm hòm chuyển trang, ID vật phẩm dài, lỗi Discord khi thay bảng và hơn 30 phòng mới trong thời hạn kết quả.

Lệnh kiểm thử toàn bộ chức năng hòm/CS2:

```powershell
node scripts/test-postgres.js --testPathPatterns='(hom|cs2)' --json --outputFile=.runtime/battle-navigation-jest-2026-11-17.json
```

Kết quả: **58 bộ / 795 ca kiểm thử đạt**, không có ca lỗi hoặc bỏ qua. PostgreSQL tạm đã dừng và được dọn. Kiểm tra cú pháp năm tệp xử lý và `git diff --check` đã đạt. Báo cáo JSON ở trên lưu kết quả chi tiết. Chưa xác minh trực tiếp trên Discord hoặc khởi động lại tiến trình bot đang chạy.

Sau khi đổi hạn tự xóa thành 1 phút: **6 bộ / 93 ca đạt** trên PostgreSQL tạm, gồm đúng mốc 59.999 → 60.000 ms, khởi động lại sau 40 giây còn 20 giây, không gia hạn khi làm mới, xử lý lỗi xóa và bản ghi 10 phút cũ. Báo cáo: `.runtime/battle-one-minute-expiry-2026-11-17.json`. PostgreSQL tạm đã được dọn; bot thật chưa được khởi động lại.
