# Upgrade trong /hom

Tài liệu nghiên cứu ngày 16/11/2026 và đặc tả chuyển cơ chế Upgrade sang skin/xu ảo của bot. Đây là tính năng lấy cảm hứng từ Skin.Club; không phải tích hợp tài khoản, giá giao dịch hay dịch vụ của Skin.Club. Bot không nạp/rút tiền, không gửi skin Steam và không có cashback tiền thật.

## Những gì đã xác minh từ nguồn chính thức

- [FAQ Skin.Club](https://skin.club/en/faq): chọn một hoặc nhiều skin đầu vào, chọn skin mong muốn có giá cao hơn rồi xác nhận Upgrade. Xác suất phụ thuộc tỷ lệ giá đầu vào/đầu ra; FAQ công bố khoảng **1–90%**.
- [Trang Upgrade](https://skin.club/en/upgrade): cần đăng nhập để dùng inventory. [Bản được lập chỉ mục của chính trang này](https://skin.club/en/upgrade?msockid=25b1bb3578646ebb388aadc4794c6fef) hiển thị Random, Select All, xác suất dạng `0.000%` và các mốc **1.05×, 1.5×, 2×, 5×, 10×, 20×**.
- [Validator chính thức](https://roll.skin.club/) liên kết trực tiếp đến [mã nguồn skinclub-tech](https://github.com/skinclub-tech/provably-fair-validator). Trang này giải thích public hash được công bố trước lượt chơi; server seed và secret salt chỉ được tiết lộ sau đó; client seed có thể do người chơi chọn; nonce phân biệt các lượt.
- [Frontend công khai của trang Upgrade tại thời điểm nghiên cứu](https://cfdn.skin.club/_nuxt/BuT1ixAW.js) lấy `estimated_chance` từ backend, gửi `from_drops`, `to_items`, `start_ticket`, `estimated_chance` khi chơi. Frontend có vùng thắng di chuyển được và hiển thị cả khoảng vé đi qua mốc 100,000. Đây là bằng chứng về UI/request; không chứng minh cách backend tính xác suất hay xử lý biên thắng.

Giới hạn xác minh: chưa có nguồn chính thức công khai xác nhận **hệ số 0.95**, cách làm tròn xác suất, số skin đầu vào tối đa, khả năng dùng balance thay skin hoặc quy tắc so sánh biên thắng của Upgrade. Không coi các lựa chọn của bot bên dưới là quy tắc chính thức Skin.Club. Frontend có `upgradeItemPriceCoefficient` phục vụ lọc giá target tối thiểu; không thể dùng trường này để suy ra house factor. Không tìm được bài Community chính thức mô tả đầy đủ “Upgrade 2.0”; thông tin từ trang tổng hợp mạng xã hội không được dùng làm căn cứ triển khai.

## RNG và bằng chứng kiểm tra

Nguồn cố định: [index.php, commit 8035f272](https://github.com/skinclub-tech/provably-fair-validator/blob/8035f272c75af9bd7ce7b2d7fe79d21f3e8d5883/index.php#L21-L44), [test vectors cùng commit](https://github.com/skinclub-tech/provably-fair-validator/blob/8035f272c75af9bd7ce7b2d7fe79d21f3e8d5883/tests/run-tests.php#L32-L57) và [các mẫu bổ sung](https://github.com/skinclub-tech/provably-fair-validator/blob/8035f272c75af9bd7ce7b2d7fe79d21f3e8d5883/tests/run-tests.php#L230-L237).

```text
public_hash = HMAC-SHA256(key = secret_salt, message = server_seed)
digest      = HMAC-SHA512(key = client_seed + "-" + nonce, message = server_seed)
prefix      = 15 ký tự hex đầu của digest
ticket      = (integer(prefix, base 16) mod 100000) + 1
```

Chuỗi seed/salt là chuỗi UTF-8 nguyên trạng; không giải mã các chuỗi trông giống hex thành byte. Chiều `key`/`message` phải đúng như trên. Mã validator gọi định dạng này là **regular roll**, có nhánh riêng cho battle; không có nhánh Upgrade riêng để xác minh toàn bộ luật Upgrade hiện tại. Bot tái sử dụng RNG đã công bố, đồng thời tự công bố odds/range của mình.

15 ký tự hex chứa 60 bit, vượt độ chính xác số nguyên của JavaScript `Number`. Phải chuyển bằng `BigInt('0x' + prefix)` rồi mới lấy modulo; chỉ chuyển kết quả nhỏ cuối cùng sang `Number`. Đây là phép modulo theo nguồn chính thức, không phải rejection sampling.

| Server seed | Secret salt | Client seed | Nonce | Public hash | Ticket |
| --- | --- | --- | ---: | --- | ---: |
| `c4ca4238a0b92382` | `0dcc509a6f75849b` | `my_seed` | 4 | `dc883b29588c1204fcad00984aaa2404c2251f9a0e5300106eb39aaebcc0f493` | 21752 |
| `0d2ade1251ce04077d6020a5fb081c36` | `b07bbd68cf0ba687` | `my_seed` | 7 | `924ef42387a290388c5258d00660a7885cb27e3a7bd15bacee2f0242d9615b77` | 10477 |
| `0d2ade1251ce04077d6020a5fb081c36` | `b07bbd68cf0ba687` | `my_seed` | 6 | `924ef42387a290388c5258d00660a7885cb27e3a7bd15bacee2f0242d9615b77` | 89384 |

Các mẫu này do repository chính thức cung cấp dưới dạng dữ liệu giả lập, không phải lịch sử giao dịch người dùng. Tính độc lập bằng Node `crypto` cho đúng cả ba vé. Với mẫu đầu, prefix là `c9fd6a369550297`, số nguyên là `909681647087321751`; dùng `parseInt`/`Number` sẽ trả vé sai `21729`.

## Quy tắc bot

- Trên web, mỗi lượt có thể dùng **toàn bộ kho skin đủ điều kiện**, kể cả kho trên 500 món; nút **Chọn toàn bộ kho** không bị giới hạn theo trang hoặc bộ lọc tìm kiếm. Chỉ chọn skin chưa khóa, chưa niêm yết, có báo giá và còn thuộc đúng người chơi. Menu Discord giữ tối đa **10 skin** để phù hợp với bảng điều khiển. Có thể thêm xu ảo hoặc chơi chỉ bằng xu; tổng stake phải dương.
- `stakeCoins` bằng tổng giá skin đầu vào cộng xu đã chọn. Giá đầu vào và target phải cùng đơn vị xu nguyên, có quote BUFF hợp lệ/còn mới. Target phải có giá **lớn hơn tổng stake**. Quote thay đổi hoặc skin đã bị sử dụng làm xác nhận cũ hết hiệu lực.
- Skin đầu vào và xu cược bị tiêu thụ ở cả thắng lẫn thua. Thắng thêm đúng mẫu skin, wear và StatTrak của target vào kho; thua không nhận target. Float cụ thể không được chọn trước: khi thắng, engine sinh float theo seed trong khoảng wear hợp lệ ở độ chính xác sáu số thập phân; paint seed cũng được sinh tất định để có thể kiểm chứng lại.
- Các nút multiplier **1.05×, 1.5×, 2×, 5×, 10×, 20×** giúp lọc/chọn target theo giá; không cam kết có target đúng mức nhân hay quyết định kết quả RNG.

**Chính sách odds riêng của bot**, không tuyên bố đây là hệ số chính thức Skin.Club:

```text
rawTickets    = floor(stakeCoins * 95000 / targetCoins)
winTickets    = min(rawTickets, 90000)
```

Tính bằng `BigInt`. Chỉ cho chơi khi `winTickets >= 1000`; không nâng xác suất thấp hơn mức tối thiểu lên 1%. Một lượt dùng 100,000 vé, nên khoảng hợp lệ là **1.000–90.000%**, bước **0.001%**. UI hiển thị `winTickets / 1000` với ba số thập phân; luật thắng dùng số vé nguyên, không dùng số phần trăm đã làm tròn. Receipt/JSON dùng tên trường `winTickets`.

| Chọn vùng | Vé thắng, bao gồm cả hai đầu |
| --- | --- |
| Under · Vùng thắng: Đầu | `1 .. winTickets` |
| Over · Vùng thắng: Cuối | `100001 - winTickets .. 100000` |

Hai vùng có cùng số vé và xác suất. Under/Over là cách đơn giản hóa cho Discord; không tuyên bố trùng hoàn toàn vùng thắng di chuyển/vòng tròn của website.

Trên web, kéo vùng xanh bằng chuột hoặc cảm ứng để đặt vùng thắng ở bất kỳ vị trí nào trên vòng; phím mũi tên dịch 1%, giữ Shift dịch 10%, Home/End về hai đầu. `startTicket` là offset nguyên **0..99999**, được lưu trước khi xác nhận. Vé thắng khi `(ticket - 1 - startTicket + 100000) % 100000 < winTickets`, kể cả vùng đi qua mốc cuối vòng. Di chuyển vùng không đổi tỷ lệ. Khi không có `startTicket`, các lượt cũ tiếp tục dùng Under/Over như trước.

Khi thay đổi skin nguyên liệu, xu hoặc hệ số nhân trên web, hệ thống tự chọn skin đích có giá gần mức mong muốn nhất trong khoảng hợp lệ **lớn hơn tổng stake, không quá 95 lần stake**. Có thể chọn lại mục tiêu thủ công; tìm kiếm, đổi trang và kéo vòng không ghi đè mục tiêu đã chọn. Nếu không có skin đích phù hợp, giao diện thông báo để giảm nguyên liệu hoặc xu. Nút Upgrade chỉ mở màn xác nhận, chưa tiêu thụ kho đồ.

## Cách dùng

1. Mở **`/hom`**, bấm **Upgrade** trên bảng. Không có slash command `/hom upgrade` riêng.
2. Chọn tối đa 10 skin trong kho. Dùng **Xu & Client seed** để nhập xu bổ sung và client seed trước khi mở màn xác nhận; có thể dùng riêng xu. Bảng hiển thị tổng stake và những món sẽ bị tiêu thụ.
3. Bấm **Chọn skin đích**, chọn mẫu qua **Tìm / Lọc**, phân trang hoặc multiplier. Bộ lọc gồm tên, wear, StatTrak và giá; có thể sắp xếp giá. Dùng **Vùng thắng: Đầu/Cuối** để đổi Under/Over.
4. Bấm **Xem xác nhận** để tạo lượt chờ và thấy public hash, client seed, nonce, vé thắng, giá trị và hạn xác nhận **5 phút**. Chưa trừ tài sản ở bước này. Sau khi thấy hash, có thể bấm **Đổi client seed** để chọn seed riêng mà không thay hash. Đây là bước để client seed do người chơi chọn đến sau cam kết server.
5. Xác nhận một lần. Bot kiểm tra lại quyền sở hữu, trạng thái skin, xu, quote và phiên xác nhận; sau đó ghi kết quả cùng thay đổi kho/ví trong **một transaction**. Hoạt ảnh chỉ trình bày kết quả đã commit.
6. Xem kết quả; bấm **Kiểm chứng / JSON** để xem seed/salt đã reveal và tải receipt khi Discord cho phép đính kèm. **Lịch sử** lưu 30 lượt gần nhất; **Lượt chờ** mở lại xác nhận chưa hết hạn, kể cả sau khi mở lại bảng hoặc bot restart. Gửi lại tương tác hoặc bấm xác nhận cũ không được trừ vật phẩm/xu lần nữa. Lỗi hoạt ảnh/gửi tin không quay lại lượt hay hủy kết quả đã lưu.

Phiên điều khiển trên Discord hết hạn sau 20 phút; mở lại `/hom` → **Upgrade** để dùng bảng mới. Lịch sử và lượt chờ được lưu bền vững, độc lập với phiên điều khiển.

## Commit–reveal an toàn cho bot

Mỗi lượt có seed/salt bí mật ngẫu nhiên bằng CSPRNG, public hash được công bố trên bảng xác nhận trước lần bấm **UPGRADE**. Client seed mặc định được tạo sẵn; để client seed do người chơi chọn đến sau commitment, dùng **Đổi client seed** trên chính bảng xác nhận. Engine chỉ đổi client seed trong pending còn hạn, giữ nguyên server seed, salt, hash, nonce, stake, target và giá. Server seed/salt và kết quả của lượt chưa chốt không được gửi ra panel, custom ID hay dữ liệu kiểm chứng.

Phiên xác nhận gắn với người chơi/máy chủ, input ID và revision, xu stake, target, quote, odds nguyên, vùng thắng, client seed và nonce. Xác nhận lại toàn bộ các điều kiện này trong transaction; lưu proof và kết quả cùng lúc với tiêu thụ input/xu và cấp target. Dùng khóa/dedupe bền vững để hai lượt xác nhận đồng thời không thể dùng cùng tài sản.

Chỉ tiết lộ seed/salt của lượt đã settle; seed đó phải ngừng sử dụng hoàn toàn. Lượt sau dùng bí mật mới và commitment mới, nên dữ liệu chứng minh lượt cũ không dự đoán được vé tương lai. Sau restart phải dùng kết quả/proof đã lưu, không sinh lại RNG để thay kết quả. Hủy/expire phiên cũng không được tái sử dụng bí mật đã tiết lộ cho một lượt có thể chơi trong tương lai.

Proof công khai gồm phiên bản thuật toán, public hash trước lượt, server seed/salt đã reveal, client seed, nonce, giá stake/target, `winTickets`, Under/Over, ticket và win/loss; khi thắng có cả drop nhận được để tính lại float/paint seed. Người chơi kiểm tra cả commitment, RNG lẫn so sánh khoảng vé. Provably fair chỉ giúp kiểm chứng đầu vào/kết quả đã công bố; không tự chứng minh giá thị trường hoặc lợi thế kinh tế của odds.

## Kiểm tra triển khai

Chạy toàn bộ bằng `node scripts/test-postgres.js`: **56 bộ / 640 kiểm thử qua**, gồm PostgreSQL tạm tự tạo và tự dọn. Kiểm thử phủ giới hạn xác suất, vé biên hai hướng, quote hết hạn/đổi giá, skin khóa/đã niêm yết/quay lại từ chợ, sửa seed giữ hash, xác nhận cũ, hai kết nối cùng xác nhận, lỗi commit và khởi động lại. Kiểm tra luồng Discord bao gồm giới hạn hàng/nút/menu/embed, phân trang, bộ lọc, khôi phục lượt chờ và lỗi gửi tin/hoạt ảnh.

Renderer dùng chung giới hạn xử lý ảnh của `/hom`, bỏ qua khi bận, không gọi mạng và có giới hạn 2 MB. Hoạt ảnh mẫu 400×360, 3 giây được render thực bằng FFmpeg, khoảng 20 KB; kết quả tĩnh khoảng 8 KB. Preflight dependencies qua mà không kết nối Discord; schema 40 slash command giữ nguyên. Chưa kiểm tra bằng tài khoản Discord/Steam thật hoặc khởi động lại bot đang chạy.
