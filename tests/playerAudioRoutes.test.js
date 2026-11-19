const fs = require('node:fs/promises');
const path = require('node:path');
const { getCaseAudio, handlePlayerAudio, wavFromPcm } = require('../utils/playerAudio');

test('browser WAV carries the exact Discord PCM with its correct stereo format', async () => {
    for (const name of ['case_unlock_01', 'crate_item_scroll', 'case_reveal_rare_01',
        'case_reveal_mythical_01', 'case_reveal_legendary_01', 'case_reveal_ancient_01']) {
        const pcm = await fs.readFile(path.join(__dirname, '../assets/csgo-case-audio', `${name}.pcm`));
        const { buffer } = await getCaseAudio(name);
        expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
        expect(buffer.toString('ascii', 8, 16)).toBe('WAVEfmt ');
        expect(buffer.readUInt16LE(22)).toBe(2);
        expect(buffer.readUInt32LE(24)).toBe(44100);
        expect(buffer.readUInt16LE(34)).toBe(16);
        expect(buffer.readUInt32LE(40)).toBe(pcm.length);
        expect(buffer.subarray(44)).toEqual(pcm);
    }
}, 30_000);

test('audio URLs are whitelisted and cannot read arbitrary files', async () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    for (const route of ['/play/audio/../.env', '/play/audio/unknown.wav', '/play/audio/case_unlock_01.pcm', '/play/audio/%2e%2e.wav']) {
        await expect(handlePlayerAudio({ method: 'GET' }, res, route)).rejects.toMatchObject({ status: 404 });
    }
    expect(await handlePlayerAudio({ method: 'GET' }, res, '/play/play.js')).toBe(false);
    expect(res.end).not.toHaveBeenCalled();
    await expect(getCaseAudio('../.env')).rejects.toMatchObject({ status: 404 });
    expect(() => wavFromPcm(Buffer.alloc(3))).toThrow();
});

test('WAV endpoint handles HEAD and conditional cache validation without sending audio bodies', async () => {
    const response = () => ({ writeHead: jest.fn(), end: jest.fn() });
    const res = response();
    await handlePlayerAudio({ method: 'GET', headers: {} }, res, '/play/audio/crate_item_scroll.wav');
    const [status, headers] = res.writeHead.mock.calls[0];
    expect(status).toBe(200);
    expect(headers).toMatchObject({ 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400' });
    expect(res.end.mock.calls[0][0].length).toBe(headers['Content-Length']);
    const head = response();
    await handlePlayerAudio({ method: 'HEAD' }, head, '/play/audio/crate_item_scroll.wav');
    expect(head.writeHead.mock.calls[0][0]).toBe(200);
    expect(head.end).toHaveBeenCalledWith(undefined);
    const cached = response();
    await handlePlayerAudio({ method: 'GET', headers: { 'if-none-match': headers.ETag } }, cached, '/play/audio/crate_item_scroll.wav');
    expect(cached.writeHead.mock.calls[0][0]).toBe(304);
    expect(cached.writeHead.mock.calls[0][1]['Content-Length']).toBeUndefined();
    expect(cached.end).toHaveBeenCalledWith();
});
