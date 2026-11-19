# Blue Gem

Mở `/hom` → **Battle** → nhóm **Hòm mới** hoặc **Theo chủ đề** → **Blue Gem**. Có thể mở lẻ hoặc ghép với các hòm khác, xếp đan xen, chơi cùng người thật hoặc bot. Đây là hòm thứ 109 trong danh mục.

| Phần thưởng | Seed | Độ mòn | Xác suất |
| --- | ---: | --- | ---: |
| Five-SeveN Case Hardened | 868 | Battle-Scarred | 50% |
| Five-SeveN Case Hardened | 868 | Field-Tested | 30% |
| AK-47 Case Hardened | 661 | Field-Tested | 12% |
| M9 Bayonet Case Hardened | 150 | Field-Tested | 5% |
| Butterfly Knife Case Hardened | 182 | Field-Tested | 2,5% |
| Karambit Case Hardened | 955 | Field-Tested | 0,5% |

Cả sáu kết quả đều là seed trong danh sách Blue Gem đã được đối chiếu của bot. Vé chọn kết quả trước, sau đó giữ nguyên seed của kết quả đó; float vẫn được bốc trong khoảng hợp lệ của độ mòn đã công bố. Không bốc lại seed bất kỳ sau khi đã chọn phần thưởng. Phí tính từ giá trị kỳ vọng chia 0,95 như các hòm Battle khác. Seed không làm thay đổi cơ hội theo vị trí, chủ phòng hoặc bot.

## Nguồn giá

[OpenSkin Pricing API](https://openskin.dev/) có endpoint công khai `https://api-v2.openskin.dev/v1/prices/csfloat/patterns?item=<market_hash_name>`, được mô tả trong [OpenAPI](https://openskin.dev/openapi.json). Bot không cần API key cho nguồn này. Đây là báo giá bán CSFloat do OpenSkin cung cấp, không phải báo giá BUFF hoặc giá giao dịch chắc chắn thực hiện được.

Bot chỉ nhận một bản ghi khi tên đầy đủ khớp skin/độ mòn/StatTrak, `paint_seed` là số nguyên đúng seed và nhãn pattern chỉ định riêng một `#seed`. Nhóm `Common`, `Tier 3-4`, giá thấp nhất chung và các nhóm gồm nhiều seed không được dùng làm giá riêng. Số lệnh bán và giá USD phải dương; dùng thời điểm cập nhật của từng bản ghi, không lấy thời điểm tải trang làm thời điểm của giá. USD đổi sang xu/VND bằng tỷ giá tham chiếu USD/VND đã kiểm tra từ Frankfurter.

Giá được đồng bộ nền mỗi 30 phút, tối đa ba yêu cầu cùng lúc, timeout chung 30 giây, giới hạn JSON mỗi tên 128 KiB và không theo redirect. Thao tác xem/mua/bán/Upgrade chỉ đọc cache. Giá còn hạn 24 giờ mới được dùng trong giao dịch; tối đa 48 giờ chỉ để xem giá đã lưu. Một phản hồi hợp lệ không còn pattern tương ứng sẽ loại báo giá cũ của pattern đó. Mất mạng chỉ giữ dữ liệu cũ trong thời hạn cho phép.

Khi thiếu bất kỳ giá nào trong sáu kết quả, hòm chờ bảng giá mới; không lấy giá Case Hardened cơ bản thay thế. Lúc triển khai 16/11/2026, kiểm tra nguồn công khai xác nhận có đủ sáu giá còn hạn. Tình trạng này có thể thay đổi khi hết lệnh bán hoặc nguồn cập nhật.

Phần thưởng của hòm Blue Gem lưu `priceVariant: "blue-gem"` cùng seed. Hòm Battle thường vẫn bốc seed đều từ 0 tới 1000. Khi mở lẻ hoặc khóa bảng giá cho một phòng mới, bot tính giá riêng cho các seed có báo giá CSFloat còn hạn, theo đúng skin, độ mòn và StatTrak. Phí và tỉ lệ lỗ tính cả xác suất của từng seed có giá riêng. Món rơi trúng seed đã có giá riêng lưu cùng dấu định giá Blue Gem để dùng đúng báo giá khi bán lại hoặc làm nguyên liệu Upgrade.

Seed chưa có báo giá riêng dùng giá theo skin và độ mòn của hòm thường. Kết quả Battle hiển thị điểm đã khóa và báo giá tham khảo CSFloat riêng nếu có. Chi tiết đồ mua lại theo giá thường cũng hiển thị giá tham khảo theo seed. Các phòng đã khóa giá theo phiên bản cũ tiếp tục quyết toán bằng bảng đã công bố.

Phòng Battle khóa seed, nguồn định giá và giá từng kết quả khi đăng. Mở lại, khôi phục hoặc phát GIF không bốc lại seed hoặc lấy bảng giá mới để thay kết quả. Kho, khóa đồ, chợ người chơi và lịch sử giữ nguyên thông tin giá riêng. Upgrade kiểm tra lại báo giá đúng seed khi chuẩn bị và quyết toán; biên nhận buộc seed và nguồn giá vào dữ liệu kiểm chứng. Trade Up tạo một vật phẩm mới với seed riêng, không kế thừa bảng giá Blue Gem của nguyên liệu.

## Ảnh pattern

Có ảnh tham chiếu riêng cho **48 seed** trên AK-47, Five-SeveN, Karambit, M9 Bayonet và Butterfly. Nguồn là [pattern.wiki](https://pattern.wiki/), với liên kết trang seed, URL nguồn và SHA-256 trong `assets/cs2-blue-gems/manifest.json`. Bot giữ watermark và pixel gốc, chuyển định dạng sang PNG; không tô xanh một ảnh Case Hardened thường để làm Blue Gem.

Theo [FAQ của pattern.wiki](https://pattern.wiki/wiki/faq/), ảnh dùng renderer tham chiếu riêng. Ảnh thể hiện pattern seed, không mô phỏng chính xác float, độ mòn hoặc ánh sáng trong game. Float thật của vật phẩm vẫn hiện riêng trong chi tiết. Ảnh có thể được xem lại qua liên kết **Ảnh pattern**.

Reel và lưới kho đọc PNG cục bộ theo đúng URL đã đăng ký, qua bộ nhớ đệm có giới hạn. Kiểm tra file dùng tên hợp lệ, kích thước ảnh và mã băm; không mở rộng danh sách host ảnh tải từ mạng. Ảnh chưa có cho một seed khác tiếp tục dùng ảnh skin dự phòng.

```powershell
python scripts/generateCs2BlueGemArt.py
node scripts/generateCs2BattleArt.js --ids battle-blue-gem --selected-sheet contact-sheet-blue-gem.jpg
```

Các ảnh nguồn có sẵn được dùng lại để tạo PNG ngoại tuyến. Hòm Blue Gem có cover riêng; 108 cover cũ và ảnh/GIF hòa điểm không đổi.

## Kiểm tra ngày 16/11/2026

Sau sửa tích hợp cache ảnh và mock khởi động, chạy lại trên PostgreSQL tạm: **66 bộ / 784 ca đều đạt**. Phạm vi gồm Blue Gem, hòm/Battle, kho, bán, chợ, Upgrade, Trade Up, nguồn giá, ảnh, các kiểm tra hồi quy và các phần còn lại ngoài ba bộ điểm danh đang lệch cấu hình. PostgreSQL tạm đã được dừng và dọn.

Lần chạy toàn bộ phát hiện năm ca ở `management.test.js`, `postgresStorage.test.js` và `taixiuBoardPublication.test.js` còn kỳ vọng 5 triệu xu/8 giờ, trong khi cấu hình hiện tại của `commands/taixiu.js` là 20 triệu xu/4 giờ. Những cấu hình và ba bộ kiểm thử này được giữ nguyên, không thuộc thay đổi Blue Gem. Lệnh xác minh phần còn lại:

```powershell
node scripts/test-postgres.js --testPathIgnorePatterns='tests/(management|postgresStorage|taixiuBoardPublication)\.test\.js$'
```

Mô phỏng công bằng vị trí chạy **9,79 triệu trận / 64,07 triệu lượt bốc vé**, 507 cấu hình; không có tỷ lệ nào vượt ngưỡng sai số đồng thời 99%. Giá trong mô phỏng là dữ liệu giả lập. Kiểm tra nguồn thật riêng đã lấy được 85 báo giá exact seed còn hạn, trong đó đủ sáu báo giá của hòm Blue Gem, và định giá được hòm bằng cùng công thức phí dùng trong bot.
