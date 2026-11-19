# Battle cộng dồn và âm thanh Upgrade

Nghiên cứu frontend công khai Skin.Club ngày **18/11/2026** để tham khảo cách trình bày. Chỉ đọc trang và bundle công khai; không đăng nhập hoặc thực hiện lượt chơi. Các chi tiết dưới đây xác nhận được từ mã frontend, không phải đánh giá nghe thử hay quy tắc giao dịch của Skin.Club.

## Battle: đếm lại sau vòng cuối

- [Trang Battle](https://skin.club/en/battles) dùng [bundle chính](https://cfdn.skin.club/_nuxt/Bq33z664.js); route xem trận tải [bundle battle-view](https://cfdn.skin.club/_nuxt/rKD1hujo.js).
- Trong giai đoạn tính kết quả, mỗi người có bộ đếm từ 0. Frontend lần lượt cộng giá skin vào bộ đếm và phát cue `battle:total-count` ở mỗi bước.
- Khoảng cách giữa các bước là **750 ms**, được suy ra trực tiếp từ `Ye * 1000 * index` và hằng số `0.75` export trong [module hằng số](https://cfdn.skin.club/_nuxt/Ca7YZ73z.js).
- Tối đa 8 món được cộng riêng từng món. Nhiều hơn 8 món được hàm `rebuildRoundsCalculation` trong bundle chính gộp thành tối đa 8 đợt để giữ màn tổng kết ngắn.
- Chữ số là các dải số cuộn dọc; mỗi chữ số chuyển trong **200 ms**, easing `ease-in-out`, trễ thêm **50 ms** theo thứ tự chữ số.
- Sau mỗi bước, frontend tính lại vị trí dẫn đầu theo chế độ trận. Khi chuyển sang dẫn đầu, nó phát cue `battle:change-count-status` và đổi màu trạng thái.
- Sau bước cuối, frontend đợi **1000 ms** trước khi hoàn tất giai đoạn tính. Âm kết quả `battle:user-won` / `battle:user-lost` tách riêng khỏi âm cộng dồn.
- Các cue được khai báo riêng dưới `/assets/sounds/battle/`: `battle-total-count`, `battle-change-count-status`, `user-won`, `user-lost`.

## Upgrade: hệ âm thanh riêng

- [Trang Upgrade](https://skin.club/en/upgrade) tại thời điểm nghiên cứu liên kết [bundle Upgrade hiện tại](https://cfdn.skin.club/_nuxt/BJBMmRT1.js).
- Có hai kiểu theo cài đặt âm thanh: tick chuyên cho Upgrade hoặc nhạc riêng cho Upgrade. Nhóm `upgrade:open-music` khai báo **29 bản**, chọn ngẫu nhiên trước lượt; đây không phải âm cuộn hòm.
- Các đường dẫn được khai báo: `/assets/sounds/upgrade/classic-sounds/upgrade-tick`, các biến thể tick 8 giây và 6 giây, `upgrade-win`, `upgrade-lose`, và `/assets/sounds/upgrade/music/1` đến `29`.
- Timing mặc định trong bundle là **12 giây / 5 vòng**; các nhánh thử nghiệm có **8 giây / 4 vòng** hoặc **6 giây / 3 vòng**. Không coi một timing duy nhất là hành vi áp dụng cho mọi tài khoản.
- Âm quay bắt đầu cùng hoạt ảnh kim. Ở chế độ tick, âm thắng/thua phát khi hoạt ảnh kết thúc; chuyển trang sẽ dừng âm đang phát. Các hiệu ứng Rush có nhóm cue riêng.

## Cách áp dụng cho bot

Thiết kế triển khai của bot tham khảo cấu trúc trải nghiệm trên, với âm thanh **tự tổng hợp bằng Web Audio**. Không tải hoặc đưa bản ghi âm Skin.Club vào mã nguồn.

- Battle ngắn cộng từng món ở nhịp khoảng **750 ms/món**, làm nổi bật món đang cộng, hiển thị phần tăng và đồng bộ một cue với đúng bước đó. Trận dài dùng nhịp thích ứng để phần đếm giữ khoảng **12 giây trở xuống**; đây là lựa chọn của bot, khác cách gộp tối đa 8 đợt của nguồn tham khảo.
- Cập nhật người dẫn đầu trong lúc cộng dồn, phát âm đổi dẫn đầu khi phù hợp, rồi mới phát âm chốt kết quả.
- Trong lúc đếm lại, tổng từng người bắt đầu từ 0; chưa hiện vương miện hoặc phần thưởng đã chốt. Sau bước cuối giữ 850 ms, công bố người thắng rồi chạy bộ đếm phần thưởng trong 850 ms. Nút bỏ qua hiện ngay giá trị cuối.
- Upgrade dùng bản phối tổng hợp riêng khoảng **6 giây**, với arpeggio và lớp quét cao độ, sau đó âm kết riêng cho thắng/thua. Không gọi lại âm cuộn mở hòm.

Kết quả đã được máy chủ chốt trước khi trình diễn; hiệu ứng không sửa tiền, kho, người thắng hay proof. Cần dừng bộ hẹn giờ và âm khi bỏ qua, phát lại, ẩn trang hoặc rời màn; giữ công tắc tắt tiếng và chế độ giảm chuyển động.

## Kết quả kiểm tra triển khai

Đã kiểm tra trên bản build ngày **18/11/2026**:

- **7 bộ / 98 kiểm thử đạt** với PostgreSQL thử nghiệm tách biệt: playerBattles, playerWeb, playerService, playerAudio, playerAudioRoutes, playerBattlePresentation và playerUpgradeUi. Các ca gồm BigInt, thứ tự từng skin, ảnh chụp tổng từng người theo mỗi bước, Crazy/Sharing/hòa/bot, cue đổi dẫn đầu, nhạc Upgrade riêng và hủy âm.
- `node scripts/build-play.mjs` thành công.
- Trình duyệt thật trên dữ liệu thử: Battle 12 món phát đúng 12 cue cộng; tổng tiền chạy qua các giá trị trung gian rồi khớp tổng cuối. Khi đang đếm chưa có vương miện hoặc ô phần thưởng; chỉ hiện sau khi chốt. Bỏ qua, phát lại và rời trang hủy đúng lịch/âm.
- Upgrade qua API thật dùng nhạc quay riêng 6 giây và âm kết riêng. Số vật phẩm sau lượt khớp kết quả đã lưu; không phát lại tiếng cuộn hòm.
- Điện thoại rộng 390 px không tràn ngang; chế độ giảm chuyển động hiện kết quả ngay; không có lỗi JavaScript ở các luồng thử.
- Kết xuất âm thực bằng Chrome OfflineAudioContext 44,1 kHz: Upgrade peak **0,0444**, RMS **0,00567**; Battle peak **0,0375**, RMS **0,00246**; âm thắng/thua Upgrade cũng có tín hiệu và không clipping. Chỉ kết xuất âm do mã này sinh, không thu âm hệ thống.

Ảnh QA: `outputs/battle-tally-desktop-qa-20261118.png` và `outputs/battle-tally-mobile-qa-20261118.png`. Mẫu WAV và mã nghiên cứu thô chỉ nằm trong `.runtime`, không phải tài sản âm thanh Skin.Club được phân phối lại.
