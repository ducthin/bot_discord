const { isPlaylistUrl, isValidYouTubeUrl } = require('../utils/youtubeUtils');

describe('isValidYouTubeUrl', () => {
  test('returns true for typical video URLs', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  test('returns true for playlist URLs', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890')).toBe(true);
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890')).toBe(true);
  });

  test('returns false for invalid URLs', () => {
    expect(isValidYouTubeUrl('https://www.google.com')).toBe(false);
    expect(isValidYouTubeUrl('not a url')).toBe(false);
  });
});

describe('isPlaylistUrl', () => {
  test('returns true for playlist URLs', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PL1234567890')).toBe(true);
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890')).toBe(true);
  });

  test('returns false for video URLs without playlist', () => {
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isPlaylistUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
  });

  test('returns false for invalid URLs', () => {
    expect(isPlaylistUrl('https://www.google.com')).toBe(false);
    expect(isPlaylistUrl('not a url')).toBe(false);
  });
});
