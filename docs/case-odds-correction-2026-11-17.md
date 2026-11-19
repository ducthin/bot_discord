# Rà soát và sửa tỷ lệ hòm ngày 17/11/2026

Đã cập nhật bộ xử lý chung cho web, mở lẻ Discord và Case Battle trên VPS. API sau triển khai được kiểm tra chỉ đọc lúc 11:34:20 UTC ngày 17/11/2026.

## Kết quả thực tế

| Kiểm tra API | Kết quả |
| --- | ---: |
| Tổng số hòm | 169 |
| Hòm đủ giá và khả dụng | 168 |
| Kết quả skin/độ mòn có giá | 7.173 |
| Cặp món đắt hơn nhưng tỷ lệ cao hơn | 0 |
| Hòm khả dụng sai tổng 10.000 vé / 100% | 0 |
| Kết quả khả dụng thiếu giá | 0 |
| Lỗi HTTP | 0 |

Tay Đua Neon (`battle-neon-rider`) tạm không khả dụng vì thiếu báo giá MAC-10 Neon Rider Battle-Scarred. Hệ thống không tự điền giá giả để mở hòm này.

Trong Chớp Nhoáng, AWP Printstream Field-Tested giá 977.077 xu có tỷ lệ 0,02%; P2000 Sure Grip Field-Tested giá 1.290 xu có tỷ lệ 5,81%. Phí tại thời điểm kiểm tra là 4.200,54 xu. Giá và phí có thể thay đổi khi đồng bộ báo giá mới.

## Nguyên nhân và cách sửa

Tỷ lệ trước sửa được chia theo nhóm thưởng và anchor. Khi thêm biến thể, anchor giữ phần vé lớn hơn biến thể, dù giá thị trường của biến thể có thể thấp hơn. Audit trước sửa tìm thấy 40.197 cặp đảo tương quan giá/tỷ lệ trong 168 hòm khả dụng.

Sau khi chọn đủ biến thể và lấy giá, hệ thống phân các cỡ vé hiện có theo giá tăng dần: món đắt hơn nhận số vé không lớn hơn món rẻ hơn. Giữ đủ kết quả, vé nguyên dương, tổng 10.000, thứ tự dữ liệu và tập số vé. Giá bằng nhau được xử lý ổn định. Phí, giá trị kỳ vọng, rủi ro, tỷ lệ dao/găng và nhóm thưởng được tính lại từ vé cuối cùng. Phí làm tròn lên từ EV / 95%.

Tên Jackpot I/II/III thay các tên phần trăm cố định; mô tả web và Discord hiển thị tỷ lệ nhóm thực tế từ báo giá. Các phần trăm cũ của nhóm Howl và hòm sưu tầm được thay bằng số tính từ bảng mới. Lịch sử và phòng đã khóa bảng giá tiếp tục dùng snapshot gốc để đối chiếu và chia thưởng.

Quy tắc giá/tỷ lệ áp dụng cho kết quả skin/độ mòn theo giá niêm yết. Với skin có pattern, seed được quay riêng với xác suất đều 1/1001; Blue Gem có giá riêng theo seed. Vì vậy không áp dụng cam kết tương quan giá/tỷ lệ này cho từng seed. Giao diện có giải thích cơ chế này; EV và phí vẫn tính cả các báo giá seed đã ghi nhận.

## Kiểm chứng

- 66 bộ kiểm thử chạy trong các tiến trình Jest riêng: 870 đạt, 4 bỏ qua, không lỗi. Bao gồm ranh giới vé, báo giá, số dư, chia thưởng, hồi phục lịch sử, xác minh Battle và web.
- Audit offline: 42 hòm tiêu chuẩn và 169 hòm tự tạo; thử 1.690.000 vé qua hàm quay thực, kiểm tra tỷ lệ theo giá, EV, phí và snapshot; không lỗi.
- So sánh hai thuật toán trên cùng cache: cùng 7.232 kết quả trong 168 hòm đủ giá; không thay tập kết quả; phí giảm ở cả 168 hòm. Cache này khác thời điểm API thực tế nên không dùng để khẳng định giá hiện tại.
- Kiểm tra trình duyệt trên bản thử cô lập: trang tỷ lệ hiển thị đủ kết quả, tổng 100% và hàng ba món hiếm.
- Sau triển khai, mã nguồn VPS trùng SHA-256 các file sửa; dịch vụ active, health healthy và bot kết nối Discord.

Các suite được tách tiến trình để timer tự xóa kết quả 60 giây của các mock Discord không chạy chéo sau khi một suite đã kết thúc. Lần chạy gộp có 870 assertion đạt nhưng timer mock ghi log muộn khiến tiến trình báo lỗi; lần chạy tách 66/66 tiến trình đều trả mã 0.

## Tệp tỷ lệ và báo cáo

- [CSV tỷ lệ tiếng Việt, sắp món đắt trước trong mỗi hòm](../outputs/ty-le-hom-sau-ra-soat-2026-11-17.csv)
- [JSON API sau sửa](../outputs/odds-audit-after-2026-11-17.json)
- [JSON API trước sửa](../outputs/odds-audit-before-2026-11-17.json)
- [Audit offline](../outputs/odds-audit-offline-final-2026-11-17.json)
- [So sánh phí trên cùng cache](../outputs/odds-fee-comparison-final-2026-11-17.json)

CSV gồm phí mở, tên hòm, tên skin, độ mòn, giá và tỷ lệ hiện tại, vé / 10.000, cùng giá và tỷ lệ trước sửa nếu ghép được cùng skin. Tệp là ảnh chụp dữ liệu tại thời điểm xuất; web và bot kiểm tra lại báo giá khi xác nhận mở.
