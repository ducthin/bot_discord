const { createHealthServer, startHealthServer } = require('../utils/runtime');

const close = server => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
});

test('HTTP can bind only to loopback behind a local reverse proxy', async () => {
    const server = createHealthServer({ isReady: () => true, guilds: { cache: new Map() } });
    try {
        await startHealthServer(server, 0, 0, '127.0.0.1');
        expect(server.address()).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
        expect(response.status).toBe(200);
        expect((await response.json()).status).toBe('healthy');
    } finally {
        await close(server);
    }
});

test('health reports Discord readiness, and an occupied port rejects cleanly', async () => {
    let ready = false;
    const client = { isReady: () => ready, guilds: { cache: new Map() } };
    const active = createHealthServer(client);
    const duplicate = createHealthServer(client);
    try {
        await startHealthServer(active, 0);
        const port = active.address().port;
        const healthUrl = `http://127.0.0.1:${port}/health`;
        const starting = await fetch(healthUrl);
        expect(starting.status).toBe(503);
        expect((await starting.json()).status).toBe('unavailable');
        const root = await fetch(`http://127.0.0.1:${port}/?check=1`);
        expect(root.status).toBe(503);
        expect(await root.json()).toMatchObject({ status: 'offline', bot: 'Starting...', uptime: expect.any(Number) });
        expect(root.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(root.headers.get('x-powered-by')).toBeNull();
        ready = true;
        const online = await fetch(healthUrl);
        expect(online.status).toBe(200);
        expect((await online.json()).status).toBe('healthy');
        const head = await fetch(`${healthUrl}/?check=1`, { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
        expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
        expect((await fetch(`http://127.0.0.1:${port}/missing`)).status).toBe(404);
        expect((await fetch(healthUrl, { method: 'POST' })).status).toBe(404);
        await expect(startHealthServer(duplicate, port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
        await Promise.all([close(active), close(duplicate)]);
    }
});
