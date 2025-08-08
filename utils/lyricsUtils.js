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
            return null;
        }
        
        // Lấy bài hát đầu tiên
        const song = songs[0];
        
        // Lấy lyrics 
        const lyrics = await song.lyrics();
        
        if (!lyrics) {
            return null;
        }
        
        // Chỉ lấy 5000 ký tự đầu để hiển thị (tránh vi phạm bản quyền)
        const truncatedLyrics = lyrics.length > 5000
            ? lyrics.substring(0, 5000) + '...\n\n[Xem đầy đủ tại Genius.com]'
            : lyrics;
        
        return truncatedLyrics;
        
    } catch (error) {
        console.error('Lỗi khi lấy lyrics:', error);
        return null;
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