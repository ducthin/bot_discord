# Rà soát hòm và mở rộng danh mục — 17/11/2026

Bản rà soát dưới đây ghi lại đợt 24 hòm trước. Danh mục hiện tại đã lên **169 hòm**; xem [36 hòm sưu tầm, Howl và 240 skin bổ sung](cs2-iconic-expansion.md).

Phạm vi gồm **42 hòm gốc** trong `/hom`, **109 hòm Battle hiện có** và **24 hòm Battle bổ sung**, đưa danh mục Battle lên **133 hòm**. Hòm mới có thể mở lẻ hoặc ghép vào lịch Battle. Bộ lọc **Hòm mới** chọn riêng 24 hòm của đợt này; các hòm trước đó vẫn tìm được theo nhóm và trong toàn bộ danh mục.

## Hòm gốc

42 hòm gốc dùng chung bảng trọng số 3.910 vé. Bot chọn bậc trước, sau đó chọn đều một skin trong pool của bậc tương ứng ở hòm đang mở.

| Bậc | Vé | Xác suất |
| --- | ---: | ---: |
| Mil-Spec | 3.125 | 79,923274% |
| Restricted | 625 | 15,984655% |
| Classified | 125 | 3,196931% |
| Covert | 25 | 0,639386% |
| Rare Special Item | 10 | 0,255754% |

Phần trăm trên được tính từ trọng số thực trong mã nguồn; giao diện làm tròn tới ba chữ số thập phân. Tỷ lệ một skin cụ thể còn phụ thuộc số skin trong pool của bậc đó. Skin hỗ trợ StatTrak có xác suất StatTrak 10% sau khi đã chọn skin. Float được chọn trong giới hạn riêng của skin với độ phân giải một phần triệu; paint seed được chọn đều từ 0 đến 1.000 cho vật phẩm có float.

Hòm gốc dùng giá hòm BUFF còn hạn cộng chìa cố định 60.000 xu. **Công thức hoàn trả kỳ vọng 95% của Battle không áp dụng cho giá hòm gốc và chìa.** Không thay trọng số của 42 hòm gốc trong đợt mở rộng này.

## Hòm Battle và định giá

Mỗi hòm Battle có **10.000 vé nguyên**, nên độ phân giải của một dòng phần thưởng là 0,01%. Mỗi lần mở gọi `crypto.randomInt` độc lập; danh tính, chỗ ngồi, bot và chuỗi thắng/thua không điều chỉnh bảng vé. Tỷ lệ của từng món có trong **Xem vật phẩm**. Các biến thể catalogue chỉ được thêm khi có giá hợp lệ và vẫn giữ nhóm xác suất cũng như phía lời/lỗ của món gốc.

Phí được tính bằng **giá trị kỳ vọng / 0,95**, rồi làm tròn lên tới 0,01 xu. Vì làm tròn phí, tỷ lệ giá trị kỳ vọng/phí có thể thấp hơn 95% một lượng nhỏ. Đây là trung bình toán học theo bảng thưởng và giá đã khóa, **không phải 95% cơ hội thắng hoặc lời**, và không bảo đảm giá trị nhận được ở một lượt cụ thể. Bảng chọn hòm và bảng vật phẩm hiện công khai riêng tỷ lệ lời, hòa vốn và lỗ theo phí đang xem; phòng đã đăng sử dụng giá đã khóa.

Các hòm Farm vẫn dành 99% vé cho súng phổ thông và 1% cho đồ vàng. Hòm Jackpot giữ nhóm giải lớn 1%, 5% hoặc 10% như đã công bố. Nhãn nhóm thưởng mô tả vé, không cam kết món của nhóm đó luôn lời sau khi giá thay đổi. Hòm chỉ dao/găng tiếp tục chỉ có đồ vàng; Blue Gem tiếp tục giữ sáu kết quả seed riêng và đợi đủ báo giá CSFloat còn hạn.

Giữ ID, vị trí catalogue và bảng phần thưởng của toàn bộ 109 hòm cũ. 24 hòm mới được nối sau Blue Gem. Phòng đã đăng vẫn sử dụng snapshot vật phẩm, giá và vé của chính phòng đó; không thay kết quả hoặc tính lại phần thưởng cũ.

## 24 hòm bổ sung

| Nhóm | Hòm mới | Điểm khác biệt |
| --- | --- | --- |
| Dòng súng (4) | MAG-7, Sawed-Off, M249, R8 Revolver | Bổ sung các dòng súng chưa có hòm riêng; mỗi hòm chỉ có đúng dòng súng tương ứng. |
| Dao (6) | Flip, Gut, Navaja, Ursus, Stiletto, Kukri | Mỗi hòm chỉ có đúng loại dao tương ứng với các finish và độ mòn hợp lệ. |
| Finish (6) | Tiger Tooth, Marble Fade, Lore, Autotronic, Slaughter, Freehand | Mỗi hòm gom các dao có cùng finish. |
| Phối hợp (8) | Đột Kích Giảm Thanh, Biệt Đội CT, Biệt Đội T, Cam Trắng, Hắc Kim, Lam Tím, Súng Lục Cao Cấp, Đột Kích Hạng Nặng | Các bộ sưu tập theo loadout, màu sắc và dòng vũ khí, với phân bố vé riêng. |

Tám hòm phối hợp dùng bốn nhóm thưởng dưới đây. Theo thứ tự sáu món neo trong bảng hòm: nhóm 1 gồm món 1–2, nhóm 2 gồm món 3–4, nhóm 3 là món 5 và nhóm 4 là món 6. Tỷ lệ của từng biến thể vẫn được công khai trong **Xem vật phẩm**. Thứ tự nhóm không cam kết mức giá tăng dần và **không phải tỷ lệ lời**.

| Hòm | Nhóm 1 | Nhóm 2 | Nhóm 3 | Nhóm 4 |
| --- | ---: | ---: | ---: | ---: |
| Đột Kích Giảm Thanh | 55% | 30% | 12% | 3% |
| Biệt Đội CT | 45% | 35% | 16% | 4% |
| Biệt Đội T | 50% | 32% | 14% | 4% |
| Cam Trắng | 40% | 35% | 20% | 5% |
| Hắc Kim | 65% | 25% | 8% | 2% |
| Lam Tím | 60% | 28% | 10% | 2% |
| Súng Lục Cao Cấp | 50% | 35% | 12% | 3% |
| Đột Kích Hạng Nặng | 50% | 33% | 14% | 3% |

Mỗi hòm có bìa PNG **1.024 × 640** riêng, dựng từ phần thưởng thật có trong bảng hòm. Màu, biểu tượng và bố cục theo chủ đề giúp phân biệt hòm trong menu; bìa không mô tả xác suất hoặc hứa hẹn giá trị rơi. Bộ tạo ảnh chỉ dựng 24 ID mới để giữ nguyên nội dung 109 bìa cũ.

## Kiểm chứng

- `node scripts/test-postgres.js --testPathPatterns='(hom|cs2)'`: **51 bộ / 679 ca đạt**. Chạy với PostgreSQL tạm, sau đó dừng và dọn cụm thử nghiệm. Bao phủ mở lẻ, 133 hòm, vé/biến thể/float hợp lệ, định giá, Blue Gem, kho, Trade Up/Upgrade, Battle, phân trang, đan xen và lịch sử. Đây là phạm vi hòm/CS2, không phải toàn bộ các chức năng âm nhạc hoặc quản lý máy chủ.
- `node scripts/audit-cs2-case-odds.js --output=.runtime/case-odds-audit-2026-11-17.json`: **42 hòm gốc + 133 hòm Battle; duyệt 1.330.000 vé qua hàm mở thật; 0 lỗi**. Kiểm tra tổng vé, tỷ lệ vàng và nhóm giải đặc biệt, EV/95% bằng số nguyên, snapshot, giá và xác suất seed có phần lẻ.
- `node scripts/audit-cs2-battle-fairness.js --output=.runtime/battle-fairness-2026-11-17.json`: **603 cấu hình, 10.750.000 trận, 66.950.000 lượt mở; 0 cảnh báo** ở 1.967 tỷ lệ ghế/đội theo ngưỡng Hoeffding đồng thời 99%. Dùng giá giả lập và trọng số công bố, không dùng lịch sử người chơi; không thay cho kiểm tra thực tế Discord hoặc chứng minh mọi chuỗi ngẫu nhiên.
- Kiểm tra ảnh: đủ **133 bìa PNG riêng 1.024 × 640**; SHA-256 của 109 bìa cũ giữ nguyên; 24 bìa mới có hash riêng. Đã xem trực quan bảng ảnh mới và chạy kiểm thử kích thước, dung lượng, tệp dự phòng.

Cache giá lịch sử hiện đủ định giá **132/133 hòm**, bao gồm **24/24 hòm mới** và **144/144 món neo mới**. Hòm **Tay Đua Neon / Neon Rider** cũ thiếu báo giá **MAC-10 | Neon Rider (Battle-Scarred)**; giữ khóa mở khi thiếu giá, chờ bộ đồng bộ có báo giá còn hạn. Các con số cache không xác nhận giá trực tiếp hay độ mới của runtime. Xem [bảng rà soát đủ 133 hòm](case-odds-summary-2026-11-17.md); báo cáo JSON lưu cả mã băm nguồn để đối chiếu.

Các hòm mới có phí tham chiếu khoảng **23.967–5.594.242 xu** trong cache này; phân loại rủi ro gồm **4 thấp / 15 vừa / 5 cao** theo xác suất lỗ. Các tỷ lệ và phí này có thể thay đổi theo giá tại thời điểm mở. Trong hòm Farm, xác suất lỗ có thể tới 99%; 1% vé đồ vàng không bảo đảm lời sau khi trừ phí.
