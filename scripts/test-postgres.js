const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const PREFIX = 'discord-bot-test-pg-';
const projectRoot = path.resolve(__dirname, '..');
let activeChild;
let interrupted = false;
let cleaningUp = false;

function run(file, args, { inherit = false, env = process.env, timeoutMs = 60_000 } = {}) {
    if (interrupted && !cleaningUp) return Promise.reject(new Error('Test run interrupted.'));
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { cwd: projectRoot, env, windowsHide: true,
            stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
        activeChild = { process: child, interruptible: inherit };
        let output = '';
        const collect = chunk => { output = (output + chunk.toString()).slice(-65_536); };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.once('error', error => {
            clearTimeout(timer);
            if (activeChild?.process === child) activeChild = undefined;
            reject(error);
        });
        // On Windows a started PostgreSQL server can inherit a capture pipe.
        // pg_ctl's exit confirms completion; waiting for pipe closure would hang
        // until that background server stops.
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            if (activeChild?.process === child) activeChild = undefined;
            child.stdout?.destroy();
            child.stderr?.destroy();
            if (code === 0) return resolve();
            const error = new Error(`${path.basename(file)} failed (${signal ?? code}).${output ? `\n${output.trim()}` : ''}`);
            error.exitCode = Number.isInteger(code) && code > 0 ? code : 1;
            reject(error);
        });
    });
}

async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

async function exists(file) {
    try { await fs.access(file); return true; } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

async function main() {
    const requested = process.argv.slice(2);
    const probe = requested.includes('--probe');
    const jestArgs = requested.filter(argument => argument !== '--probe' && argument !== '--');
    if (probe && jestArgs.length) throw new Error('Use --probe alone, or pass Jest arguments without --probe.');
    const bin = process.env.POSTGRES_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin' : '');
    const executable = name => bin ? path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
    const initdb = executable('initdb');
    const pgCtl = executable('pg_ctl');
    if (bin) {
        if (!await exists(initdb) || !await exists(pgCtl)) throw new Error('PostgreSQL binaries were not found. Set POSTGRES_BIN to their directory.');
    }
    const tempParent = path.resolve(os.tmpdir());
    const temporary = await fs.mkdtemp(path.join(tempParent, PREFIX));
    const data = path.join(temporary, 'data');
    const log = path.join(temporary, 'postgres.log');
    const interrupt = () => {
        interrupted = true;
        if (!cleaningUp && activeChild?.interruptible) activeChild.process.kill();
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    let preserve = false;
    try {
        console.log(`[test-postgres] Initializing fresh cluster in ${temporary}.`);
        await run(initdb, ['-D', data, '-A', 'trust', '-U', 'codex_test', '-E', 'UTF8', '--no-locale']);
        const port = await freePort();
        console.log('[test-postgres] Starting temporary PostgreSQL.');
        await run(pgCtl, ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start']);
        const connectionString = `postgresql://codex_test@127.0.0.1:${port}/postgres`;
        console.log(`[test-postgres] Disposable PostgreSQL ready on 127.0.0.1:${port}.`);
        if (probe) {
            const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
            try {
                await client.connect();
                await client.query('SELECT 1');
                console.log('[test-postgres] SELECT 1 passed.');
            } finally { await client.end(); }
        } else {
            const testEnv = { ...process.env, TEST_DATABASE_URL: connectionString };
            delete testEnv.DATABASE_URL;
            console.log('[test-postgres] Running Jest against the temporary database.');
            await run(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', '--silent', ...jestArgs],
                { inherit: true, env: testEnv, timeoutMs: 30 * 60_000 });
        }
        if (interrupted) throw new Error('Test run interrupted.');
    } finally {
        cleaningUp = true;
        try {
            if (await exists(path.join(data, 'postmaster.pid'))) {
                console.log('[test-postgres] Stopping temporary PostgreSQL.');
                try { await run(pgCtl, ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']); } catch (error) {
                    preserve = true;
                    console.error(`[test-postgres] Could not stop the temporary cluster; preserved ${temporary}.`);
                    throw error;
                }
            }
        } finally {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
            // This exact directory was created above; never remove another cluster.
            if (!preserve) {
                if (path.dirname(temporary) !== tempParent || !path.basename(temporary).startsWith(PREFIX)) {
                    throw new Error('Refusing to remove a path outside the disposable test directory.');
                }
                await fs.rm(temporary, { recursive: true, force: true });
                console.log('[test-postgres] Temporary cluster stopped and removed.');
            }
        }
    }
}

main().catch(error => {
    console.error(`[test-postgres] ${error.message}`);
    process.exitCode = error.exitCode ?? 1;
});
