const Genius = require('genius-lyrics');

// Khởi tạo Genius client (có thể cần API key sau này)
const genius = new Genius.Client();

// Làm sạch tên bài hát để tìm kiếm tốt hơn
function cleanSongTitle(title) {
    // Loại bỏ các từ khóa thường gặp trong title YouTube
    return title
        .replace(/\[(.*?)\]/g, '') // Loại bỏ [Official Video], [Lyrics], etc.
        .replace(/\((.*?)\)/g, '') // Loại bỏ (Official), (Audio), etc.
        .replace(/official|video|music|audio|mv|lyrics|hd|4k/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Tìm kiếm và lấy lời bài hát
async function getLyrics(songTitle, artist = '') {
    try {
        const cleanTitle = cleanSongTitle(songTitle);
        const searchQuery = artist ? `${artist} ${cleanTitle}` : cleanTitle;
        
        console.log(`Tìm kiếm lyrics cho: "${searchQuery}"`);
        
        // Tìm kiếm bài hát trên Genius
        const songs = await genius.songs.search(searchQuery);
        
        if (!songs || songs.length === 0) {
            return { success: false, message: 'Không tìm thấy bài hát nào trên Genius.' };
        }
        
        // Lấy bài hát đầu tiên
        const song = songs[0];
        
        // Lấy lyrics 
        const lyrics = await song.lyrics();
        
        if (!lyrics) {
            return { success: false, message: 'Bài hát này chưa có lời hoặc không thể lấy lời.' };
        }
        
        // Đoạn xem trước phải vừa giới hạn 1024 ký tự của một embed field.
        const truncatedLyrics = lyrics.length > 1000
            ? lyrics.substring(0, 1000) + '…'
            : lyrics;
        
        return {
            success: true,
            title: song.title,
            artist: song.artist.name,
            lyrics: truncatedLyrics,
            thumbnail: song.thumbnail,
            url: song.url
        };
        
    } catch (error) {
        console.error('Lỗi khi lấy lyrics:', error);
        return { success: false, message: `Lỗi hệ thống: ${error.message}` };
    }
}

// Tách artist và title từ string
function parseArtistTitle(fullTitle) {
    // Các pattern thường gặp
    const patterns = [
        /^(.*?)\s*-\s*(.*)$/, // Artist - Title
        /^(.*?)\s*\|\s*(.*)$/, // Artist | Title
        /^(.*?)\s*:\s*(.*)$/, // Artist : Title
        /^(.*?)\s*by\s*(.*)$/i, // Title by Artist
    ];
    
    for (const pattern of patterns) {
        const match = fullTitle.match(pattern);
        if (match) {
            return {
                artist: match[1].trim(),
                title: match[2].trim()
            };
        }
    }
    
    // Nếu không match pattern nào, return title gốc
    return {
        artist: '',
        title: fullTitle
    };
}

module.exports = {
    getLyrics,
    parseArtistTitle,
    cleanSongTitle
};
