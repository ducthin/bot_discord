#!/usr/bin/env bash
set -euo pipefail

# Run on Linux/WSL. Every service, HTTP request and application path is mocked.
# DEPLOY_TEST_NODE may name a Linux Node executable when node is not on PATH.
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_bin=${DEPLOY_TEST_NODE:-$(command -v node || true)}
if [[ -z $node_bin || ! -x $node_bin ]]; then
    echo 'A Linux Node executable is required. Set DEPLOY_TEST_NODE, for example:' >&2
    echo 'DEPLOY_TEST_NODE=/usr/bin/node bash tests/deployUbuntu.test.sh' >&2
    exit 1
fi
if [[ ! -d $repo/node_modules/dotenv ]]; then
    echo 'Missing node_modules/dotenv. Install the project dependencies before running deployment tests.' >&2
    exit 1
fi
test_root=$(mktemp -d /tmp/discord-deploy-test.XXXXXX)
test_pid=
finish() {
    if [[ -n $test_pid ]]; then kill "$test_pid" 2>/dev/null || true; fi
    /bin/rm -rf -- "$test_root"
}
trap finish EXIT
export PATH="$test_root/bin:$PATH"
mkdir "$test_root/bin"

cat > "$test_root/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -eu
case $1 in
    cat) exit 0 ;;
    show)
        state=$(cat "$fixture/state")
        printf 'ActiveState=%s\nControlPID=%s\n' "$state" "${TEST_CONTROL_PID:-0}"
        if [[ $state == inactive ]]; then echo MainPID=0
        else echo "MainPID=${TEST_SERVICE_PID:-2147483647}"; fi
        echo ControlGroup=
        ;;
    stop)
        echo stop >> "$fixture/actions"
        count=$(grep -c '^stop$' "$fixture/actions")
        if [[ ${TEST_STOP_MODE:-} == hang || ${TEST_STOP_MODE:-} == rollback-hang && $count -gt 1 ]]; then
            echo deactivating > "$fixture/state"
            sleep 30
        elif [[ ${TEST_STOP_MODE:-} == unconfirmed ]]; then
            echo deactivating > "$fixture/state"
        else echo inactive > "$fixture/state"; fi
        ;;
    start)
        echo start >> "$fixture/actions"
        echo active > "$fixture/state"
        if [[ ${TEST_START_HANG:-} == first && $(grep -c '^start$' "$fixture/actions") == 1 ]]; then sleep 30; fi
        ;;
    *) exit 1 ;;
esac
MOCK
cat > "$test_root/bin/curl" <<'MOCK'
#!/usr/bin/env bash
echo curl >> "$fixture/http"
[[ $* == *"http://127.0.0.1:${TEST_EXPECT_PORT:-32001}/health"* ]] || exit 1
[[ ${TEST_HEALTH:-up} == up ]] || exit 22
echo '{"status":"healthy"}'
MOCK
cat > "$test_root/bin/journalctl" <<'MOCK'
#!/usr/bin/env bash
echo unexpected-journal >> "$fixture/journal"
exit 99
MOCK
cat > "$test_root/bin/runuser" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == -u && $3 == -- ]] || exit 1
shift 3
exec "$@"
MOCK
cat > "$test_root/bin/rm" <<'MOCK'
#!/usr/bin/env bash
if [[ ${TEST_CLEANUP_HANG:-} == work && $* == *'/work.'* ]]; then
    [[ ! -e /proc/$$/fd/9 ]] || echo lock-leaked >> "$fixture/fds"
    [[ $(readlink /proc/$$/fd/0) == /dev/null && $(readlink /proc/$$/fd/1) == /dev/null && $(readlink /proc/$$/fd/2) == /dev/null ]] || echo stream-leaked >> "$fixture/fds"
    echo checked >> "$fixture/fds"
    trap '' TERM
    sleep 30
fi
exec /bin/rm "$@"
MOCK
chmod +x "$test_root/bin/"*
ln -s "$node_bin" "$test_root/bin/node"

setup() {
    local name=$1
    export fixture=$test_root/$name
    unset TEST_STOP_MODE TEST_START_HANG TEST_CLEANUP_HANG TEST_CONTROL_PID TEST_SERVICE_PID TEST_HEALTH TEST_EXPECT_PORT
    mkdir -p "$fixture/app/"{commands,utils,handlers,assets,config,scripts,web/admin,node_modules,data} "$fixture/release/"{commands,utils,handlers,assets,config,scripts,web/admin}
    cp -R "$repo/node_modules/dotenv" "$fixture/app/node_modules/"
    printf 'PORT=32001\nDUMMY_SECRET=must-not-leak\n' > "$fixture/app/.env"
    echo retained > "$fixture/app/data/wallet"
    echo '// old index' > "$fixture/app/index.js"
    echo '{"serverManagement":true}' > "$fixture/app/config/features.json"
    echo '{}' > "$fixture/app/package.json"
    echo '{}' > "$fixture/app/package-lock.json"
    cp "$fixture/app/"package*.json "$fixture/release/"
    echo '// new index' > "$fixture/release/index.js"
    echo '{"serverManagement":false}' > "$fixture/release/config/features.json"
    echo '// new command' > "$fixture/release/commands/new.js"
    echo '<!doctype html><title>Old panel</title>' > "$fixture/app/web/admin/index.html"
    echo '<!doctype html><title>Admin panel</title>' > "$fixture/release/web/admin/index.html"
    echo '// new admin client' > "$fixture/release/web/admin/app.js"
    echo "require('node:fs').accessSync('.env'); require('node:fs').accessSync('node_modules/dotenv'); if (require('../config/features.json').serverManagement !== false) throw new Error('Local feature configuration missing');" > "$fixture/release/scripts/preflight.js"
    echo active > "$fixture/state"
    : > "$fixture/actions"
    : > "$fixture/http"
    sed -e "s|^app=/opt/discord-bot$|app=$fixture/app|" \
        -e "s|^account=discordbot$|account=$(id -un)|" \
        -e 's|^if \[\[ ! \$archive =~ .*|if [[ ! -f $archive ]]; then|' \
        -e "s|/run/lock/discord-bot-deploy.lock|$fixture/lock|" \
        -e "s|/opt/.discord-bot-deploy.XXXXXX|$fixture/work.XXXXXX|" \
        -e "s|/usr/local/bin/node|$test_root/bin/node|g" \
        -e 's|^SERVICE_ACTION_SECONDS=45$|SERVICE_ACTION_SECONDS=1|' \
        -e 's|^HEALTH_WAIT_SECONDS=60$|HEALTH_WAIT_SECONDS=2|' \
        -e 's|^CLEANUP_SECONDS=15$|CLEANUP_SECONDS=1|' \
        "$repo/scripts/deploy-ubuntu.sh" > "$fixture/deploy.sh"
    tar -czf "$fixture/release.tar.gz" -C "$fixture/release" index.js package.json package-lock.json commands utils handlers assets config scripts web
}
deploy() { bash "$fixture/deploy.sh" "$fixture/release.tar.gz" > "$fixture/output" 2>&1; }
old_code() {
    grep -qx '// old index' "$fixture/app/index.js"
    grep -qx '{"serverManagement":true}' "$fixture/app/config/features.json"
    grep -qx '<!doctype html><title>Old panel</title>' "$fixture/app/web/admin/index.html"
}
new_code() {
    grep -qx '// new index' "$fixture/app/index.js"
    grep -qx '{"serverManagement":false}' "$fixture/app/config/features.json"
    grep -qx '<!doctype html><title>Admin panel</title>' "$fixture/app/web/admin/index.html"
    grep -qx '// new admin client' "$fixture/app/web/admin/app.js"
}
retained() {
    grep -qx retained "$fixture/app/data/wallet"
    ! grep -q 'must-not-leak' "$fixture/output"
    [[ ! -e $fixture/journal ]]
}
preserved() { compgen -G "$fixture/work.*" >/dev/null; }

setup dotenv-port
deploy
new_code
retained
[[ $(grep -c '^stop$' "$fixture/actions") == 1 && $(grep -c '^start$' "$fixture/actions") == 1 ]]
echo 'PASS staged local feature config, promotion, dotenv PORT, retained data and secrets'

setup inherited-port
PORT=33001 sleep 60 &
test_pid=$!
export TEST_SERVICE_PID=$test_pid TEST_EXPECT_PORT=33001
deploy
new_code
kill "$test_pid"
wait "$test_pid" 2>/dev/null || true
test_pid=
echo 'PASS inherited PORT takes precedence over .env'

setup default-port
echo DUMMY_SECRET=must-not-leak > "$fixture/app/.env"
export TEST_EXPECT_PORT=3001
deploy
new_code
retained
echo 'PASS missing PORT defaults to 3001'

setup invalid-port
echo 'PORT=32001/health?secret=must-not-leak' > "$fixture/app/.env"
if deploy; then exit 1; fi
old_code
retained
[[ ! -s $fixture/http ]]
echo 'PASS invalid PORT never reaches curl and rolls back safely'

setup unhealthy
export TEST_HEALTH=down
began=$SECONDS
if deploy; then exit 1; fi
(( SECONDS - began < 7 ))
old_code
retained
[[ $(cat "$fixture/state") == active ]]
echo 'PASS health deadline restores previous code and restarts it'

setup stop-unconfirmed
export TEST_STOP_MODE=unconfirmed
if deploy; then exit 1; fi
old_code
preserved
[[ ! -e $fixture/app/commands/new.js && $(grep -c '^start$' "$fixture/actions" || true) == 0 ]]
echo 'PASS unconfirmed stop leaves application files untouched'

setup stop-timeout
export TEST_STOP_MODE=hang
began=$SECONDS
if deploy; then exit 1; fi
(( SECONDS - began < 6 ))
old_code
preserved
echo 'PASS stop timeout is bounded and preserves staging'

setup control-process
export TEST_CONTROL_PID=777
if deploy; then exit 1; fi
old_code
preserved
echo 'PASS inactive service with a control process cannot switch files'

setup rollback-stop-timeout
export TEST_STOP_MODE=rollback-hang TEST_HEALTH=down
if deploy; then exit 1; fi
new_code
preserved
grep -qx '// old index' "$fixture"/work.*/backup/index.js
retained
echo 'PASS rollback never moves files until the new service is confirmed stopped'

setup start-timeout
export TEST_START_HANG=first
if deploy; then exit 1; fi
old_code
[[ $(cat "$fixture/state") == active ]]
echo 'PASS start timeout rolls back after confirming the service stopped'

setup slow-cleanup
export TEST_CLEANUP_HANG=work
began=$SECONDS
deploy
(( SECONDS - began < 11 ))
new_code
preserved
retained
grep -qx checked "$fixture/fds"
[[ $(wc -l < "$fixture/fds") == 1 ]]
grep -q 'Hoan don file tam' "$fixture/output"
[[ $(grep -c '^stop$' "$fixture/actions") == 1 && $(grep -c '^start$' "$fixture/actions") == 1 ]]
flock --nonblock "$fixture/lock" true
echo 'PASS slow cleanup releases lock/SSH streams and retains the healthy release'
