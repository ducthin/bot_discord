# Case Battle

Mở `/hom` → **Battle**. Chọn hòm, nhập **Số lượng**, rồi bấm **Thêm ×N**. Một hòm tương ứng một vòng; số vòng và phí mỗi người được tính lại từ lịch hòm, tối đa 100 vòng cho mỗi trận trên Discord và web. Có thể trộn nhiều loại hòm, bớt một hòm, xóa một loại hoặc **Xóa tất cả** trong **Lịch hòm**. Bộ lọc hỗ trợ chủ đề, khoảng phí và bốn mức rủi ro.

Phiên tạo trận hết hạn sau **15 phút không thao tác**. Xem vật phẩm, chuyển trang tỷ lệ và mở biểu mẫu đều gia hạn phiên khi thành công. Mỗi bảng tạo trận có phiên riêng; quay lại vẫn giữ hòm đang chọn, kể cả khi giá mới làm thay đổi thứ tự danh mục. Phiên hết hạn có nút **Mở lại Battle** để chọn lại và kiểm tra giá.

Để mở hòm đan xen, thêm ít nhất hai loại rồi vào **Lịch hòm → Xếp đan xen**. Ví dụ 3 hòm A và 2 hòm B trở thành **A–B–A–B–A**; có nhiều loại thì luân phiên theo thứ tự xuất hiện đầu tiên. Thao tác giữ nguyên số lượng từng loại và tổng số vòng, hòm còn dư xếp tiếp ở cuối. Bảng lịch hiển thị đúng thứ tự sẽ mở; phòng đăng và cấu hình dùng lại từ lịch sử đều giữ thứ tự này. Hòm thêm sau đó vẫn nối cuối lịch, có thể bấm **Xếp đan xen** lại khi cần. Giá tiếp tục được cập nhật và kiểm tra như bình thường.

## Tạo và chơi

- Chọn 2, 3, 4 người, tùy chỉnh 5–10 người hoặc 2 đấu 2.
- **Thường**: tổng giá trị cao nhất thắng. **Crazy**: tổng giá trị thấp nhất thắng. **Chia đều**: mọi người nhận một phần tổng giá trị; không áp dụng cho 2 đấu 2.
- Trận cá nhân Thường/Crazy trao toàn bộ skin cho người thắng. Trận đội và Chia đều trả thưởng bằng xu.
- Trong **Tùy chọn**, chủ phòng chọn luật hòa: **Chia đều xu** (mặc định) hoặc **Vòng 50/50**. Chia xu chỉ áp dụng cho các bên đồng hạng thắng; đội hòa chia cho cả bốn người. Phần dư 0,01 xu được chia từ một ghế bắt đầu ngẫu nhiên trong các ghế được thưởng (kể cả bot), để mỗi ghế có cơ hội nhận phần lẻ bằng nhau. Tổng tiền luôn giữ nguyên; kết quả đã lưu không bốc lại.
- Vòng phụ 50/50 chỉ phân định bên thắng, không thu thêm phí và không tạo thêm skin. Hòa hai bên dùng một lần tung đồng xu bằng `crypto.randomInt(2)`. Hòa ba/bốn bên xáo ngẫu nhiên nhánh đấu rồi đấu từng cặp; suất miễn đấu cũng ngẫu nhiên để mọi bên có cơ hội tổng thể bằng nhau. Mỗi cặp phát GIF 2,6 giây, xanh là bên trái và đỏ là bên phải; GIF kết thúc đúng kết quả đã lưu. Khi không đính kèm được ảnh, kết quả hiện bằng chữ. Luật được khóa khi đăng phòng; phòng cũ thiếu luật hòa giữ bốc thăm như trước.
- Battle luôn phát lần lượt **đầy đủ mọi vòng**; đã bỏ tùy chọn mở nhanh. Phòng và cấu hình lịch sử cũ dùng chế độ nhanh cũng phát đủ vòng. Khi không thể tạo hoặc gửi GIF, kết quả đã lưu vẫn được hiển thị.
- **Đăng phòng** tạo bảng công khai trong kênh hiện tại. Phí chỉ trừ khi đủ người và tất cả ví còn đủ xu. Phòng chờ hết hạn sau 10 phút; chủ phòng có thể hủy.
- Trong phòng chờ, dùng menu **Chọn vị trí để tham gia / đổi chỗ**. Trận cá nhân có vị trí 1–10 theo số người đã chọn; 2v2 có **A1, A2, B1, B2**. Người mới chọn chỗ trống để vào; người đã tham gia, kể cả chủ phòng, chọn chỗ trống khác để đổi vị trí. Chuyển giữa A và B sẽ đổi đội tương ứng. Ghế đã có người không thể bị chiếm; rời phòng chỉ trả lại đúng ghế đó, các ghế còn lại giữ nguyên. Các nút tham gia nhanh vẫn dùng được.
- Đổi chỗ không trừ xu; khi đủ người, trận khóa vị trí và bắt đầu như trước. Vị trí được lưu cùng phòng và lịch sử, hiển thị trên bảng điểm và kết quả mỗi vòng. Bot lấp đúng các ghế trống, giữ nguyên chỗ của người thật.
- Nếu chưa có đủ người, chủ phòng bấm **Đấu với bot** để bắt đầu ngay; bot lấp mọi ghế còn trống và đội 2v2 được chia cân bằng. Bot mở cùng hòm và được tính điểm, nhưng không bị trừ phí, không có ví hay kho đồ. Khi chia thưởng bằng xu (Chia đều, đội thắng hoặc hòa chia xu), tổng giá trị được chia theo **tất cả ghế được thưởng, kể cả Bot**. Người thật chỉ nhận phần của mình; phần Bot được ghi riêng trên kết quả và không dồn cho người thật. Nếu chỉ Bot thắng, không cộng xu hoặc skin cho người thật. Trận cá nhân có người thật thắng riêng vẫn trao toàn bộ skin theo luật Thường/Crazy. Bấm bot-start sẽ lập tức khóa chỗ còn lại, nên người thật không thể tham gia sau đó. Các trận đã kết toán trước bản sửa giữ nguyên số tiền đã lưu, không tự tính lại hoặc thu hồi tiền.
- Kết quả hiển thị tối đa bốn vòng mỗi trang; lịch mở hiển thị một vòng mỗi trang. Có thể xem từng hòm và bảng xác suất đã khóa của trận.
- Tin nhắn **Kết quả Case Battle** tự xóa sau **1 phút kể từ khi hiện kết quả cuối cùng**. Đổi trang hoặc làm mới không gia hạn. Bot lưu thời hạn để tiếp tục xóa sau khi khởi động lại; kết quả quá hạn được xóa khi bot kết nối lại. Kết quả cũ từng lưu hạn 10 phút cũng áp dụng hạn 1 phút từ thời điểm đã hiện kết quả. Xu và skin đã quyết toán được giữ nguyên. Dữ liệu xem trang, lịch hòm và tỷ lệ của kết quả được giữ trong thời hạn này, kể cả khi có nhiều trận mới. Nếu Discord tạm thời từ chối xóa, bot thử lại sau một phút.

## Hòm và xác suất

Danh mục gồm **169 hòm**. Bộ lọc **Hòm mới** hiển thị **36 hòm sưu tầm**: 30 hòm theo collection, Howl Contraband, Dấu Chân Sói, Huyền Thoại AWP, Bảo Tàng AK-47, Bảo Tàng M4 và Di Vật Súng Lục. Đợt này bổ sung **240 skin**, gồm Howl, Dragon Lore, Gungnir, Wild Lotus và nhiều mẫu collection nổi tiếng. Xem [danh sách, tỷ lệ và kiểm chứng](cs2-iconic-expansion.md). Howl giữ độ hiếm Contraband, không Trade Up. Toàn bộ 133 hòm trước đó giữ nguyên vị trí, vật phẩm, vé và candidate.

Đợt mở rộng 36 hòm trước đó gồm:

Hòm **Blue Gem** có sáu kết quả seed cố định: Five-SeveN #868 ở Battle-Scarred (50%) và Field-Tested (30%); AK-47 #661 Field-Tested (12%); M9 Bayonet #150 Field-Tested (5%); Butterfly #182 Field-Tested (2,5%); Karambit #955 Field-Tested (0,5%). Giá dùng báo giá CSFloat riêng cho từng seed và độ mòn. Xem [cơ chế Blue Gem và nguồn giá/ảnh](blue-gem.md). Dữ liệu của toàn bộ 108 hòm trước đó được giữ nguyên.

- **8 hòm súng:** P2000, SG 553, AUG, G3SG1, SCAR-20, Nova, XM1014 và Negev.
- **8 hòm dao:** Huntsman, Bowie, Falchion, Shadow Daggers, Paracord, Survival, Nomad và Skeleton.
- **12 chủ đề:** Thành Phố Neo-Noir, Tay Đua Neon, Bơm Nhiên Liệu, Kẻ Hủy Diệt, Nhịp Xung, Hỏa Ngục, Safari Đêm, Phòng Arcade, Vườn Bí Mật, Ác Mộng, Nghệ Thuật Đường Phố và Xưởng Cơ Khí.
- **8 hòm phối hợp:** Song Đấu Súng Ngắn, Eco Rush, Đấu Trường Rifle, Đọ Sức Bắn Tỉa, Phá Cửa, SMG Tăng Tốc, Kho Đỏ và Leo Tháp Vũ Khí. Mỗi hòm phối hợp có phân bố vé riêng giữa các nhóm vật phẩm; bảng **Xem vật phẩm** công khai xác suất từng món. Tên nhóm phần thưởng không phải cam kết giá, lãi hoặc khả năng thắng Battle.

Giữ nguyên ID, thứ tự và bảng vật phẩm/xác suất của 72 hòm trước đó. Đợt bổ sung 24 hòm trước gồm:

- **12 hòm theo dòng súng:** P250, Five-SeveN, Tec-9, CZ75-Auto, Dual Berettas, UMP-45, P90, PP-Bizon, MP7, MP5-SD, Galil AR và FAMAS.
- **6 hòm theo bộ skin:** Biệt Đội Asiimov, Mecha Industries, Võ Đài Bloodsport, Bầy Quái Thú, Wasteland Rebel và Sắc Thép Tôi.
- **6 hòm dao/găng:** Karambit, Butterfly, M9 Bayonet, Bayonet, Talon và Găng Thể Thao.

Các chủ đề Long Hỏa, Băng Cực, Vũ Trụ, Anh Đào, Lăng Kính, Mật Mã, Cát Vàng, Vực Sâu, Nọc Độc, Hoàng Gia, Xổ Số Súng Ngắn, Bão Đấu Tay Đôi, Kho Báu và Hầm Găng tiếp tục có trong danh mục. Hòm theo dòng súng và độ hiếm giữ chủ đề riêng; các hòm chỉ dao/găng vẫn chỉ ra đồ vàng. Danh mục tự phân trang theo nhóm; lịch một trận tối đa 100 hòm và có thể xếp đan xen hòm mới với hòm cũ.

Mỗi hòm có ảnh PNG 1024 × 640 riêng trong `assets/cs2-battle-art/`. Đợt 36 hòm ngày 16/11/2026 dùng sáu bố cục theo chủ đề: tủ vũ khí, bản vẽ kỹ thuật, quỹ đạo, bệ trưng bày, neon và cặp vũ khí; các skin minh họa đều có trong bảng thưởng của hòm. Bot đọc ảnh cục bộ với bộ nhớ đệm giới hạn, tránh tải ảnh bìa qua mạng mỗi lần bấm. Nếu thiếu ảnh, giới hạn tệp quá nhỏ hoặc Discord từ chối tệp, giao diện chuyển sang ảnh dự phòng. Bảng chọn và phòng công khai luôn xóa ảnh đính kèm cũ khi đổi màn hình.

Ba hòm **Battle Săn Vàng**, **Săn Dao**, **Săn Găng** dành 99% vé cho nhóm súng phổ thông và 1% cho nhóm đồ vàng. Hòm Jackpot dành đúng 1%, 5% hoặc 10% vé cho nhóm giải lớn, phần còn lại cho nhóm phổ thông. Tỷ lệ nhóm giải lớn không đồng nghĩa với tỷ lệ lời: lời/lỗ phụ thuộc giá món so với phí tại thời điểm mở.

Mỗi hòm có 10.000 vé nguyên. Mỗi lượt bốc vé mới bằng `crypto.randomInt`; không điều chỉnh xác suất theo người chơi hay chuỗi thắng/thua. Bảng vật phẩm công khai từng biến thể, xác suất, giá và khoảng float. Các biến thể thêm từ catalogue phải có giá thật trong cache và giữ phân bố nhóm cũng như phía lời/lỗ của món gốc.

Bảng chọn hòm và **Xem vật phẩm** hiển thị riêng tỷ lệ lời, hòa vốn và lỗ từ giá vật phẩm so với phí đang xem; phòng đã đăng dùng giá đã khóa. Giá trị kỳ vọng khoảng 95% phí không phải tỷ lệ lời. Khi thiếu báo giá còn hạn, nút mở vẫn khóa đến khi đủ giá.

Vị trí không thay đổi tỷ lệ bốc vé hoặc cách tính điểm. Xem [kiểm tra công bằng vị trí Battle](battle-fairness-audit.md), gồm lần chạy mới nhất với 9,79 triệu trận giả lập trên 109 hòm, phân biệt thắng riêng, hòa chia thưởng và vòng phụ; có hướng dẫn chạy lại ngoại tuyến.

Phí = giá trị kỳ vọng chia 0,95, làm tròn lên đến 0,01 xu. Mức hoàn trả kỳ vọng khoảng 95% là trung bình toán học qua nhiều lượt, không phải khả năng thắng của mỗi lượt. Nhãn rủi ro và tỉ lệ lỗ được tính từ cùng bảng giá dùng để mở.

Giao diện hiển thị tỷ lệ lời, hòa vốn và lỗ theo bảng giá đang xem. Giá danh mục được dùng lại tối đa 5 giây khi thao tác; tạo lại luôn định giá mới. Backend vẫn kiểm tra toàn bộ giá và số dư khi đăng và bắt đầu trận.

## Giá, lưu trữ và khôi phục

Giá thường dùng cache BUFF đã đồng bộ của bot. Hòm Blue Gem và các seed có báo giá riêng trong phòng mới dùng cache CSFloat theo đúng seed, độ mòn và StatTrak từ OpenSkin. Bot đồng bộ mỗi 30 phút. Hòm Blue Gem chờ đủ báo giá riêng mới mở. Hòm thường dùng giá BUFF theo độ mòn cho các seed thiếu báo giá riêng và tính phí theo xác suất của mọi mức giá đã khóa. Nhóm súng phổ thông của Farm/Jackpot có thể dùng skin rẻ khác đang có giá hợp lệ. Khi giá hoặc bảng vật phẩm đổi trong lúc tạo trận, cần kiểm tra phí mới trước khi đăng lại.

Phòng đã đăng khóa bảng vật phẩm, giá và xác suất. Ví, phần thưởng và mọi kết quả được lưu trong cùng giao dịch PostgreSQL trước khi phát GIF. Xu được lưu bằng `NUMERIC` theo đơn vị 0,01 xu; ví và vật phẩm có bảng riêng. Lỗi hoạt ảnh không làm mất thưởng; kết quả chưa đăng được sẽ được khôi phục khi bot kết nối lại. Trận dài tự chuyển sang API sửa tin nhắn khi token tương tác hết hạn. Phòng cũ dùng bảng hòm trước cập nhật vẫn có thể quyết toán theo snapshot đã lưu trong PostgreSQL. Bản chuyển sang PostgreSQL bắt đầu trắng, không nhập dữ liệu JSON cũ.

**Tùy chọn → Lịch sử trận** lưu tối đa 30 trận gần nhất cho mỗi người tham gia, mỗi trang 5 trận, với thời hạn hiện tại **1 phút từ lúc tạo phòng**. Trong thời hạn đó, lịch sử vẫn đọc được sau khi khởi động lại hoặc phòng cũ được dọn. Mỗi bản ghi lưu lịch hòm, chế độ, luật hòa và kết quả tóm tắt. Nút **Tạo lại trận** trên kết quả dùng cấu hình riêng và cho phép người thật có mặt trong danh sách tham gia cuối cùng tạo lại trong thời hạn 1 phút của tin kết quả, kể cả trận dài đã hết lịch sử cá nhân. **Dùng lại cấu hình** và **Tạo lại trận** chỉ mở bản nháp riêng, tính giá hiện tại và chờ người chơi đăng; không tự thu tiền hay đăng phòng.

Xu nguyên hiển thị `1,000,000 xu`, không có `.00`; phần lẻ thật vẫn được giữ, ví dụ `1,000.50 xu`. Các ô nhập tiền nhận dấu phẩy phân cách hàng nghìn và hiển thị lại giá trị đã chuẩn hóa khi mở biểu mẫu. Discord không hỗ trợ định dạng trực tiếp trong lúc gõ. Dữ liệu lưu và phép tính vẫn chính xác đến 0,01 xu, kể cả giá trị lớn hơn giới hạn số nguyên của JavaScript.

## Nguồn tham khảo thiết kế

Đối chiếu ngày 14/11/2026:

- [Skin.Club Battle creator](https://skin.club/en/battles/new): lịch hòm, số vòng, tổng phí, format và các chế độ thắng.
- [Farm Gloves](https://skin.club/en/cases/open/farm-gloves), [Farm Knives](https://skin.club/en/cases/open/easy_knife), [Number One](https://skin.club/en/cases/open/number-one): nhiều món phổ thông và phần thưởng lớn với xác suất nhỏ; bảng giá và odds công khai.

Bot dùng danh mục, xác suất và mức hoàn trả riêng. Mỗi trận hỗ trợ tối đa 100 vòng trên giao diện Discord và web.

## Hiệu năng khi nhiều trận

Battle dùng GIF 25 fps thay cho 50 fps của mở nhiều thông thường. Thời gian quay, kích thước ảnh, thời điểm hiện món vàng và mọi vòng vẫn giữ nguyên. Mỗi lần dựng Battle dùng một trong hai lượt xử lý chung; FFmpeg được giới hạn thread cho đầu vào, filter và đầu ra. Hàng chờ tối đa 12 yêu cầu, Battle chờ tối đa 12 giây thay vì 4 giây; không tạo thêm tiến trình không giới hạn khi đông phòng.

Mỗi phòng chỉ chuẩn bị trước **một vòng kế tiếp** trong lúc GIF hiện tại đang phát. Bộ nhớ không chứa sẵn toàn bộ 50 GIF. Sau vòng đầu, mỗi vòng gửi một lần cập nhật kèm GIF; trận 50 vòng có đủ GIF cần 52 lần sửa tin thay vì 101. Nếu dựng một vòng lỗi, vòng đó vẫn có bảng kết quả chữ và các vòng sau tiếp tục. Kết toán và phần thưởng không phụ thuộc renderer.

Đo ngoại tuyến ngày 14/11/2026, bốn người mỗi vòng, 24 ảnh skin cục bộ khác nhau, không kết nối Discord. So sánh cấu hình mở nhiều 50 fps và cấu hình Battle 25 fps trên cùng bản mã:

| Phép đo | Mặc định 50 fps | Battle 25 fps |
| --- | --- | --- |
| Dung lượng một GIF | khoảng 4,40 MB | khoảng 2,39 MB |
| Dựng hai vòng đồng thời | 3,22 giây, 2/2 có GIF | 1,46 giây, 2/2 có GIF |
| Dựng bốn vòng đồng thời | 3/4 có GIF; một yêu cầu hết 4 giây chờ | 4/4 có GIF trong 2,90 giây |

Đây là số đo phần dựng ảnh trên máy phát triển, chưa gồm thời gian tải lên Discord, đường truyền VPS hay thời gian hiển thị trên thiết bị người chơi. Có thể chạy lại riêng từng lệnh, tránh chạy song song các benchmark:

```powershell
node scripts/benchmark-cs2-battles.js --profile=default --artwork=mixed --output=.runtime/battle-performance-mixed-default.json
node scripts/benchmark-cs2-battles.js --profile=battle --artwork=mixed --output=.runtime/battle-performance-mixed-after.json
```

Script dùng ảnh cục bộ, không đăng nhập Discord, không đọc ví hoặc tạo trận thật. Mặc định đo 1/2/4 yêu cầu; có thể dùng `--concurrency=2,4,8` và `--players=2`, `3` hoặc `4`.

## Kiểm thử

`npx jest --runInBand --testPathPatterns='(hom|cs2|management|coins)'`

Bao phủ số lượng và phí tự cập nhật, 50 vòng/200 lượt mở, xác suất theo vé nguyên, giá thiếu/đổi, khóa giá, tranh chấp tham gia, thanh toán một lần, luật hòa/chia xu/50-50, lịch sử và quyền tạo lại, phân trang, khôi phục snapshot cũ, bộ ảnh đầy đủ và định dạng xu.

Sau đợt bổ sung 36 hòm ngày 16/11/2026, tổng danh mục 108 hòm: **65 bộ / 810 ca kiểm thử đạt** trên PostgreSQL tạm; cơ sở dữ liệu tạm đã được dừng và dọn. Bao phủ đầy đủ vé của 108 hòm, giữ nguyên dữ liệu 72 hòm cũ, chủ đề và độ mòn hợp lệ, tám phân bố thưởng riêng, 108 ảnh bìa, phân trang và bộ lọc Hòm mới, lịch đan xen và tạo lại từ lịch sử. Kiểm tra công bằng ngoại tuyến với giá giả lập chạy **9,75 triệu trận / 63,95 triệu lượt bốc vé**, không phát hiện tỷ lệ nào vượt ngưỡng sai số đồng thời đã đặt.

Sau khi thêm Blue Gem thành 109 hòm: **66 bộ / 784 ca đạt** trong lần xác minh PostgreSQL tạm, tách ba bộ kiểm thử điểm danh đang lệch cấu hình khỏi phạm vi. Xem [chi tiết kiểm tra và giới hạn](blue-gem.md#kiểm-tra-ngày-16112026). Mô phỏng mới chạy 9,79 triệu trận, không có tỷ lệ nào vượt ngưỡng sai số đồng thời đã đặt.

Đợt Howl và collection ngày 17/11/2026 nâng tổng lên 169 hòm: **55 bộ / 771 ca đạt**, rà soát **1.690.000 vé / 0 lỗi**. Mô phỏng công bằng 747 cấu hình với 12,19 triệu Battle và 71,27 triệu lượt mở dùng giá giả lập: 0 cảnh báo theo kiểm định đã đặt. Xem [chi tiết skin, tỷ lệ và giới hạn](cs2-iconic-expansion.md).

Sau sửa lỗi tạo lại và điều hướng cùng ngày: **58 bộ / 795 ca đạt** trên PostgreSQL tạm, bao phủ toàn bộ nhóm kiểm thử hòm/CS2. Xem [nguyên nhân, cách sửa và phạm vi xác minh](battle-navigation-fixes-2026-11-17.md).
