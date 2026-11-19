const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// These are the same 44.1 kHz stereo PCM cues used by the Discord case reel.
const CUES = new Set(['case_unlock_01', 'crate_item_scroll', 'case_reveal_rare_01',
    'case_reveal_mythical_01', 'case_reveal_legendary_01', 'case_reveal_ancient_01']);
const directory = path.join(__dirname, '..', 'assets', 'csgo-case-audio');
const pending = new Map();
const fail = (status, message) => Object.assign(new Error(message), { status });

function wavFromPcm(pcm) {
    if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 4 !== 0 || pcm.length > 2 * 1024 * 1024) {
        throw new Error('Invalid case PCM audio.');
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22); header.writeUInt32LE(44100, 24); header.writeUInt32LE(176400, 28);
    header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function getCaseAudio(name) {
    if (!CUES.has(name)) throw fail(404, 'Không tìm thấy âm thanh.');
    if (!pending.has(name)) {
        pending.set(name, fs.readFile(path.join(directory, `${name}.pcm`)).then(pcm => {
            const buffer = wavFromPcm(pcm);
            return { buffer, etag: `"${createHash('sha256').update(buffer).digest('hex')}"` };
        }).catch(error => { pending.delete(name); throw error; }));
    }
    return pending.get(name);
}

async function handlePlayerAudio(req, res, pathname) {
    if (!pathname?.startsWith('/play/audio/')) return false;
    if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Phương thức không được hỗ trợ.');
    const match = /^\/play\/audio\/([a-z0-9_]+)\.wav$/.exec(pathname);
    if (!match || !CUES.has(match[1])) throw fail(404, 'Không tìm thấy âm thanh.');
    const { buffer, etag } = await getCaseAudio(match[1]);
    const headers = { 'Content-Type': 'audio/wav', 'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', ETag: etag };
    if (req.headers?.['if-none-match'] === etag) {
        delete headers['Content-Length']; res.writeHead(304, headers); res.end();
    } else {
        res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : buffer);
    }
    return true;
}

module.exports = { getCaseAudio, handlePlayerAudio, wavFromPcm };
