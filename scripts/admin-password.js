const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { hashPassword } = require('../utils/adminAuth');

async function promptPassword() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Chạy lệnh trong terminal để nhập mật khẩu riêng tư.');
    const output = new Writable({ write(_chunk, _encoding, next) { next(); } });
    const terminal = readline.createInterface({ input: process.stdin, output, terminal: true });
    const question = text => new Promise(resolve => {
        process.stdout.write(text);
        terminal.question('', answer => { process.stdout.write('\n'); resolve(answer); });
    });
    terminal.on('SIGINT', () => { terminal.close(); process.exitCode = 130; process.stdin.destroy(); });
    try {
        const password = await question('Mật khẩu quản trị (ít nhất 12 ký tự, nhập sẽ ẩn): ');
        const confirm = await question('Nhập lại mật khẩu: ');
        if (password !== confirm) throw new Error('Hai mật khẩu chưa khớp.');
        return password;
    } finally { terminal.close(); }
}

async function configure(file, hash, origin) {
    const url = new URL(origin);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw new Error('--origin cần HTTPS hoặc HTTP localhost, không kèm đường dẫn.');
    let source = '', previous;
    try {
        previous = await fs.lstat(file);
        if (!previous.isFile() || previous.isSymbolicLink()) throw new Error('Tệp cấu hình phải là tệp thường.');
        source = await fs.readFile(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const values = { ADMIN_ENABLED: 'true', ADMIN_ORIGIN: url.origin, ADMIN_PASSWORD_HASH: hash,
        ADMIN_COOKIE_SECURE: String(url.protocol === 'https:') };
    const lines = source.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?ADMIN_(?:ENABLED|ORIGIN|PASSWORD_HASH|COOKIE_SECURE)\s*=/.test(line));
    while (lines.at(-1) === '') lines.pop();
    const updated = [...lines, '', '# Web administration', ...Object.entries(values).map(([key, value]) => `${key}=${value}`), ''].join(newline);
    // Write atomically in the same directory; do not leave a plaintext backup.
    const temporary = `${file}.admin-${process.pid}.tmp`;
    try {
        await fs.writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
        if (previous && process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) {
            await fs.chown(temporary, previous.uid, previous.gid);
        }
        await fs.rename(temporary, file);
        if (process.platform !== 'win32') await fs.chmod(file, 0o600);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) {
        console.log('node scripts/admin-password.js [--configure /opt/discord-bot/.env] [--origin http://127.0.0.1:3001]');
        return;
    }
    let file, origin = 'http://127.0.0.1:3001';
    for (let index = 0; index < args.length; index++) {
        if (args[index] === '--configure' && args[index + 1]) file = path.resolve(args[++index]);
        else if (args[index] === '--origin' && args[index + 1]) origin = args[++index];
        else throw new Error('Tham số không hợp lệ. Dùng --help để xem cách chạy.');
    }
    const password = await promptPassword();
    const hash = await hashPassword(password);
    if (file) {
        await configure(file, hash, origin);
        console.log('Đã lưu cấu hình quản trị. Khởi động lại bot để áp dụng.');
    } else console.log(`ADMIN_PASSWORD_HASH=${hash}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { configure };
