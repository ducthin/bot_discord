# Kho đồ và Trade Up

Mở `/hom` → **Kho đồ**. Menu **Sắp xếp** hỗ trợ tier, float và giá theo hai chiều tăng/giảm, cùng chế độ món mới nhận trước. Giá hoặc float chưa có được đặt cuối danh sách. Lựa chọn được lưu theo người chơi; khi đổi kiểu sắp xếp, giao diện quay về trang đầu để dễ tìm món.

Màn chọn nguyên liệu **Trade Up** có menu sắp xếp tương tự. Đổi thứ tự không đổi những món đã chọn, và lựa chọn ở trang khác được giữ lại. Món khóa không được tính vào số nguyên liệu đủ điều kiện hoặc lựa chọn nhanh.

Chọn một món để mở chi tiết, rồi bấm **Khóa món** hoặc **Mở khóa món**. Chọn nhiều món trong kho để khóa hoặc mở khóa cả nhóm. Món đã khóa có biểu tượng 🔒 và nhãn **ĐÃ KHÓA** trên ảnh kho. Khóa được lưu cùng vật phẩm và còn hiệu lực sau khi khởi động lại bot.

Món đã khóa không thể bán lấy xu, đăng lên chợ hoặc làm nguyên liệu Trade Up/Upgrade. Bán nhiều/bán hết bỏ qua món đang khóa; nếu món vừa được khóa sau khi mở bảng xác nhận, thao tác bán cũ bị chặn trước khi trừ món hay cộng xu. Trade Up và Upgrade cũng kiểm tra lại trạng thái khóa tại thời điểm xác nhận.

Nút **Upgrade** có trên bảng `/hom` và trong kho. Tính năng cho chọn tối đa 10 skin, thêm xu, lọc skin đích và xem xác suất trước lượt. Xem [cơ chế, nguồn nghiên cứu và cách kiểm chứng](hom-upgrade.md).

Nếu một món được đăng lên chợ rồi hủy tin, bảng xác nhận bán nhiều/bán hết hoặc Trade Up mở trước đó sẽ hết hiệu lực. Hãy mở lại kho và chọn lại các món để xác nhận. Hủy tin giữ nguyên ngày nhận ban đầu của món đồ.

Ảnh kho ưu tiên ảnh chính đã lưu trong cache và hiển thị ngay khi tải đủ ảnh chính, tránh phải chờ ảnh dự phòng. Ảnh dự phòng vẫn được dùng nếu ảnh chính lỗi hoặc tải chậm.

Nút **Xem lại lượt quay** đã được bỏ, cùng cache lưu GIF mở hòm để phát lại. Mở hòm mới vẫn có hoạt ảnh và kết quả được lưu vào kho; ảnh kho dạng lưới và ảnh chi tiết skin vẫn hiển thị như trước. Nút xem lại trên bảng cũ không chạy lại hoạt ảnh hoặc thay đổi ví/kho.

Kết quả Battle tự chia trang theo độ dài nội dung, tối đa bốn vòng mỗi trang. Phòng đông người có thể có ít vòng hơn trên một trang; dùng **Vòng trước** và **Vòng sau** để xem đủ vật phẩm. Kết quả vòng phụ khi hòa được chia thành nhiều phần nếu cần, áp dụng cả trong lịch sử.

## Sửa hiển thị món vàng

Trước đây renderer thay ô vàng bằng ô thường trong các khung hình đang quay, rồi hiện lại ô vàng khi dừng. Dải quay và khung hình dừng hiện dùng cùng một ô vàng cho mở lẻ, mở nhiều và Battle. Khi ảnh biểu tượng vàng bị thiếu, renderer có biểu tượng vàng dự phòng. Thay đổi chỉ sửa hiển thị, giữ nguyên xác suất và kết quả đã lưu.

Kiểm tra bằng GIF thực tại khung hình 5,8 giây, trước hiệu ứng lộ vật phẩm ở 6,6 giây: ô trúng đã có biểu tượng và vạch vàng; các ô thường vẫn dùng màu tier tương ứng.
