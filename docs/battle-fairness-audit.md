# Kiểm tra công bằng vị trí Battle — 16/11/2026

Kiểm tra tập trung vào nghi vấn **ghế giữa trong trận 3 người**, đồng thời rà soát trận 2–10 người, 2v2, Thường, Crazy, Chia đều, bot và hai luật hòa. Chưa tìm thấy điều kiện ưu tiên ghế giữa trong mã hiện tại. Phát hiện và sửa một sai lệch nhỏ trong chia **xu lẻ**, không làm thay đổi người thắng.

## Kết quả mô phỏng

Chạy **7.350.000 trận giả lập**, tương ứng **56.750.000 lượt bốc vé**, trong **263 cấu hình**, kiểm tra 947 tỷ lệ theo ghế/đội. Dùng đúng hàm `chooseWinners`/`breakTie` của engine, `crypto.randomInt(10000)` cho mỗi lượt và trọng số vé công bố của cả 48 hòm. Giá là **dữ liệu giả lập dương**, không phải giá BUFF tại thời điểm chơi; thêm các phân bố dễ hòa để kiểm tra vòng phụ. Không đọc ví, lịch sử người chơi, không gọi Discord hoặc cơ sở dữ liệu.

Với Battle Cân Bằng, một vòng, Thường, mỗi dòng có 200.000 trận độc lập:

| Luật hòa | Ghế 1 | Ghế giữa | Ghế 3 |
| --- | ---: | ---: | ---: |
| Chia đều xu — tỷ lệ thắng quy đổi | 33,4308% | 33,3073% | 33,2620% |
| Vòng phụ — tỷ lệ người thắng cuối cùng | 33,3880% | 33,2490% | 33,3630% |

Khi chia hòa, mỗi ghế đồng hạng nhận `1 / số ghế đồng hạng` điểm thắng để so sánh công bằng. Ví dụ hòa cả ba thì mỗi ghế nhận 1/3, không tính là ba trận thắng riêng. Tỷ lệ có mặt trong nhóm được thưởng vì thế có thể lớn hơn 33,33%. Với 2v2, so sánh **hai đội**, kỳ vọng mỗi đội 50%; hai người cùng đội có chung kết quả. Chia đều luôn thưởng tất cả người chơi.

Một số cấu hình còn lại, Thường + vòng phụ, mỗi dòng có 50.000 trận:

| Kiểu trận | Kỳ vọng mỗi ghế/đội | Khoảng tỷ lệ quan sát giữa các ghế/đội |
| --- | ---: | ---: |
| 2 người | 50% | 49,912–50,088% |
| 4 người | 25% | 24,868–25,140% |
| 5 người | 20% | 19,616–20,388% |
| 6 người | 16,667% | 16,518–16,840% |
| 7 người | 14,286% | 14,068–14,396% |
| 8 người | 12,5% | 12,350–12,818% |
| 9 người | 11,111% | 10,888–11,254% |
| 10 người | 10% | 9,690–10,274% |
| 2v2 — tính theo đội | 50% | 49,906–50,094% |

Cả 947 tỷ lệ đều nằm trong ngưỡng sai số đồng thời 99% tính bằng bất đẳng thức Hoeffding và union bound. Ngưỡng cho mẫu 200.000 trận là ±0,5512 **điểm phần trăm** quanh kỳ vọng; ngưỡng này đã tính việc so sánh nhiều ghế/cấu hình. Mô phỏng hữu hạn không chứng minh tỷ lệ thực tế luôn bằng nhau. Chứng cứ bổ sung là kiểm tra bất biến theo đổi chỗ và duyệt hết nhánh ngẫu nhiên nhỏ dưới đây.

## Rà soát logic và hình ảnh

- Mỗi người bốc một vé mới từ cùng bảng vật phẩm, xác suất và giá đã khóa. Không có điều kiện tăng/giảm cơ hội theo ghế, chủ phòng, bot hay chuỗi thắng/thua. Float, paint seed và reel seed không quyết định người thắng.
- Thường lấy tổng cao nhất, Crazy lấy tổng thấp nhất; đội dùng tổng hai thành viên. Đổi thứ tự người chơi không thay đổi tập người có điểm thắng.
- Hòa ba bên: một bên được miễn vòng đầu, có cơ hội 1/2 sau khi đã biết nhánh; hai bên còn lại có cơ hội 1/4. Engine xáo ngẫu nhiên nhánh trước, nên **mỗi ghế ban đầu đều có cơ hội tổng thể 1/3**. Miễn đấu không gắn cố định với ghế giữa. Kiểm tra chính xác cả 24 đường ngẫu nhiên cho ba bên và 192 đường cho bốn bên cho số lần thắng bằng nhau. Lập luận đối xứng của phép xáo Fisher–Yates cũng áp dụng cho 5–10 bên; mô phỏng thêm trường hợp tất cả cùng hòa ở từng số người.
- Kiểm tra đủ 10.000 vé ở từng hòm bằng hàm mở thật trong `cs2BattleCases.test.js`, không chỉ kiểm tra một vài mốc. Có thêm kiểm tra đổi chỗ chủ phòng/người chơi/bot và giữ nguyên điểm, phí, quyền nhận thưởng.
- UI chuyển đúng drop/seed của từng user sang đúng hàng GIF. Kiểm tra thắng riêng lần lượt ở ghế 1, 2, 3; Thường/Crazy; Chia đều; 2v2 và phòng cũ có thứ tự khác. Kiểm tra FFmpeg thật với đồ hiếm ở từng hàng, trước và sau reveal, không thấy đảo hàng. Kết quả và điểm lấy theo userId; renderer không chọn người thắng.

## Sai lệch đã sửa

Trước đây khi tổng xu không chia hết, những ghế thắng đứng trước luôn được thêm một đơn vị **0,01 xu**. Trong một số trận ba người, ghế 1 và ghế giữa có thể nhận thêm phần lẻ so với ghế 3. Đây là lệch tiền làm tròn, **không phải lệch tỷ lệ thắng**.

Hiện tại engine chọn ngẫu nhiên ghế bắt đầu chia phần dư. Mỗi ghế được thưởng, kể cả bot, có cơ hội nhận phần lẻ bằng nhau; chênh lệch mỗi người tối đa 0,01 xu, tổng tiền được bảo toàn. Test duyệt mọi điểm bắt đầu với 3/6/7/9 người đồng hạng, tính cả phần bot. Payout được lưu cùng kết quả và không bốc lại khi phát GIF, khôi phục hay bấm lặp. Những trận đã lưu giữ nguyên kết quả và khoản thưởng cũ.

## Chạy lại

```powershell
node scripts/audit-cs2-battle-fairness.js --output=.runtime/battle-fairness.json
node scripts/test-postgres.js
```

Script lưu ngày chạy, SHA-256 của hai file engine/bảng hòm, số trận, sai số và từng tỷ lệ vào JSON. Lượt kiểm tra nêu trên lưu ở `.runtime/battle-fairness-2026-11-16.json`. Test dùng PostgreSQL tạm hoàn toàn riêng khi chạy lệnh thứ hai.

Sau sửa phần chia xu lẻ, toàn bộ **61 bộ kiểm thử / 710 ca** đều đạt trên PostgreSQL tạm, gồm các ca công bằng, ánh xạ ghế và GIF thật mới bổ sung. PostgreSQL tạm đã được dừng và dọn sau kiểm thử.

Sau khi mở rộng lên **72 hòm**, chạy lại cùng script với danh mục mới: **8.310.000 trận**, **59.630.000 lượt bốc vé**, **359 cấu hình**, không có tỷ lệ nào vượt ngưỡng sai số đồng thời 99%. Báo cáo mới lưu ở `.runtime/battle-fairness-72-cases-2026-11-16.json`. Giá vẫn là dữ liệu giả lập; các số đo và bảng ở đầu tài liệu thuộc lần chạy 48 hòm trước đó.

Sau khi bổ sung tiếp **36 hòm**, danh mục **108 hòm** được kiểm tra lại với **9.750.000 trận**, **63.950.000 lượt bốc vé**, **503 cấu hình**. Không có tỷ lệ nào vượt ngưỡng sai số đồng thời 99%. Báo cáo lưu ở `.runtime/battle-fairness-108-cases-2026-11-16.json`; giá tiếp tục là dữ liệu giả lập, không phải giá BUFF thực tế. ID, thứ tự, bảng vật phẩm và xác suất của 72 hòm trước đó được kiểm tra giữ nguyên.

Sau khi thêm **Blue Gem**, danh mục **109 hòm** chạy **9.790.000 trận**, **64.070.000 lượt bốc vé**, **507 cấu hình**, gồm **1.679 tỷ lệ ghế/đội**. Không có tỷ lệ nào vượt ngưỡng sai số đồng thời 99%. Báo cáo `.runtime/battle-fairness-109-blue-gem-2026-11-16.json` khớp mã băm engine hiện tại. Mô phỏng vẫn dùng giá dương giả lập; việc định giá thật theo seed được kiểm tra riêng qua endpoint CSFloat của OpenSkin và bộ kiểm thử Blue Gem. Toàn bộ bảng vật phẩm của 108 hòm cũ được kiểm tra giữ nguyên.

Kết luận áp dụng cho mã nguồn đang được kiểm tra. Không dùng thống kê lịch sử thực chiến để xác nhận một phiên bản bot cũ đang chạy; việc người chơi gặp chuỗi thắng/thua hoặc thường hòa trong một số hòm vẫn có thể xảy ra với cơ chế ngẫu nhiên công bằng.
