// Fallback playlist khi YouTube search không hoạt động
const fallbackSongs = [
    {
        title: 'SƠN TÙNG M-TP | HÃY TRAO CHO ANH ft. Snoop Dogg | Official MV',
        url: 'https://www.youtube.com/watch?v=knW7-x7Y7RE',
        duration: '4:23',
        thumbnail: 'https://i.ytimg.com/vi/knW7-x7Y7RE/hqdefault.jpg'
    },
    {
        title: 'LẠC TRÔI | OFFICIAL MUSIC VIDEO | SƠN TÙNG M-TP',
        url: 'https://www.youtube.com/watch?v=Llw9Q6akRo4',
        duration: '4:46',
        thumbnail: 'https://i.ytimg.com/vi/Llw9Q6akRo4/hqdefault.jpg'
    },
    {
        title: 'CHẠY NGAY ĐI | RUN NOW | SƠN TÙNG M-TP | Official Music Video',
        url: 'https://www.youtube.com/watch?v=32sYGCOYJUM',
        duration: '4:01',
        thumbnail: 'https://i.ytimg.com/vi/32sYGCOYJUM/hqdefault.jpg'
    },
    {
        title: 'SÓNG GIÓ | ICM x JACK | OFFICIAL MUSIC VIDEO',
        url: 'https://www.youtube.com/watch?v=j8U06veqxdU',
        duration: '5:51',
        thumbnail: 'https://i.ytimg.com/vi/j8U06veqxdU/hqdefault.jpg'
    },
    {
        title: 'BẠC PHẬN | ICM x JACK | OFFICIAL MV',
        url: 'https://www.youtube.com/watch?v=WX7dUj14Z00',
        duration: '4:12',
        thumbnail: 'https://i.ytimg.com/vi/WX7dUj14Z00/hqdefault.jpg'
    }
];

// Tìm kiếm fallback
function searchFallback(query) {
    const normalizedQuery = query.toLowerCase();
    
    // Tìm bài hát phù hợp với query
    const found = fallbackSongs.find(song => 
        song.title.toLowerCase().includes(normalizedQuery) ||
        normalizedQuery.includes(song.title.toLowerCase().split(' ')[0]) ||
        normalizedQuery.includes('sơn tùng') ||
        normalizedQuery.includes('jack') ||
        normalizedQuery.includes('icm')
    );
    
    if (found) {
        return { ...found };
    }
    
    // Nếu không tìm thấy, trả về bài đầu tiên
    return { ...fallbackSongs[0] };
}

// Lấy playlist ngẫu nhiên
function getRandomPlaylist(count = 5) {
    const shuffled = [...fallbackSongs].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, fallbackSongs.length));
}

// Lấy tất cả bài hát
function getAllSongs() {
    return [...fallbackSongs];
}

module.exports = {
    searchFallback,
    getRandomPlaylist,
    getAllSongs,
    fallbackSongs
};
