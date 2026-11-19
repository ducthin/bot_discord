const path = require('path');

function playlistPath(directory, name) {
    if (typeof name !== 'string' || !name.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name === '.' || name === '..') {
        throw new Error('Tên playlist không hợp lệ. Không được chứa đường dẫn hoặc ký tự đặc biệt.');
    }
    const root = path.resolve(directory);
    const target = path.resolve(root, `${name}.json`);
    if (path.dirname(target) !== root) throw new Error('Đường dẫn playlist không hợp lệ.');
    return target;
}
module.exports = { playlistPath };
