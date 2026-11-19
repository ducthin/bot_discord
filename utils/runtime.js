const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');

function createHealthServer(client, { handler } = {}) {
    return createServer((req, res) => {
        void handle(req, res).catch(error => {
            console.error('Lỗi HTTP server:', error.code ?? error.name);
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            if (!res.writableEnded) res.end('Internal Server Error');
        });
    });

    async function handle(req, res) {
        if (handler && await handler(req, res)) return;
        const path = req.url?.split('?')[0];
        const health = /^\/health\/?$/i.test(path);
        if (!['GET', 'HEAD'].includes(req.method) || (path !== '/' && !health)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(req.method === 'HEAD' ? undefined : 'Not Found');
            return;
        }
        const ready = client.isReady();
        const payload = health
            ? { status: ready ? 'healthy' : 'unavailable', guilds: client.guilds.cache.size, uptime: process.uptime() }
            : { status: ready ? 'online' : 'offline', bot: client.user?.tag ?? 'Starting...', uptime: process.uptime(), timestamp: new Date().toISOString() };
        const body = JSON.stringify(payload);
        res.writeHead(ready ? 200 : 503, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body)
        });
        res.end(req.method === 'HEAD' ? undefined : body);
    }
}

async function startHealthServer(server, port, retryDelay = 0, host) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid health server port');
    const bind = () => new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
    try {
        await bind();
    } catch (error) {
        if (error.code !== 'EADDRINUSE' || !retryDelay) throw error;
        await delay(retryDelay);
        await bind();
    }
}

function watchLauncher(pidValue, onExit) {
    const pid = Number(pidValue);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return () => {};
    const timer = setInterval(() => {
        try { process.kill(pid, 0); }
        catch (error) {
            if (error.code !== 'ESRCH') return;
            clearInterval(timer);
            onExit();
        }
    }, 2000);
    timer.unref();
    return () => clearInterval(timer);
}

module.exports = { createHealthServer, startHealthServer, watchLauncher };
