const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Hướng dẫn /hom, Tiệm Bánh và các lệnh của Tèo'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#5865f2')
            .setTitle('Hướng dẫn Tèo')
            .addFields(
                {
                    name: '📦 /hom · Hòm CS2',
                    value: 'Chọn hòm → mua hòm và chìa hoặc **Mua theo bộ** → mở lẻ hoặc 3/5/10 hòm.\n**Kho đồ**: xem giá, sắp xếp, khóa, bán skin và mở **Upgrade**. Món khóa không bị bán hoặc dùng trong Trade Up/Upgrade.\n**Upgrade**: chọn skin/xu, xem tỷ lệ và xác nhận lượt có thể kiểm chứng. **Trade Up**: chọn nguyên liệu hoặc chọn nhanh. **Chợ skin**: mua bán giữa người chơi. **Battle**: tạo trận, chọn vị trí hoặc đổi đội khi phòng đang chờ.'
                },
                {
                    name: '🍰 /tiembanh · Tiệm Bánh Mây',
                    value: '`/tiembanh play` — đến bàn chơi\n`/tiembanh wallet` — xem ví dùng chung với /hom\n`/tiembanh daily` — nhận 5,000,000 xu mỗi 8 giờ\n`/tiembanh top` — xếp hạng\n`/tiembanh history` — lịch sử cược cá nhân\n`/tiembanh dice` — kết quả xúc xắc của server\nQuản trị viên dùng `/setup tiembanh` để chọn kênh bàn tự động.'
                },
                {
                    name: '🎵 Nhạc',
                    value: '`/play` (`/p`) — tên bài, link video, playlist hoặc Mix; thêm `next:true` để phát tiếp\n`/nowplaying` (`/np`) — bảng điều khiển\n`/queue` (`/q`) — xem, chọn, chuyển hoặc xóa bài\n`/pause` · `/resume` · `/skip` · `/stop` · `/leave`\n`/volume` (`/v`) · `/loop` (`/lp`) · `/shuffle` · `/autoplay`\nTừ 3 người nghe, skip cần quá nửa số phiếu; DJ bỏ qua ngay.'
                },
                {
                    name: '❤️ Nhạc cá nhân',
                    value: '`/favorites` — bài đã yêu thích\n`/playlist-save save|load|list|delete` — playlist cá nhân\n`/history show|clear` (`/his`) — lịch sử nhạc\n`/lyrics` — lời bài hát\n`/trending play|auto` — nhạc thịnh hành và tự phát khi hết hàng đợi'
                },
                {
                    name: '⚙️ Thiết lập và trạng thái',
                    value: '`/setup tiembanh` — chọn kênh bàn tự động\n`/setup status` — xem thiết lập Tiệm Bánh\n`/setup disable` — tắt bàn tự động\n`/botstatus` — kiểm tra kết nối và quyền phát nhạc (quản trị viên)'
                }
            );
        return interaction.reply({ embeds: [embed] });
    }
};
