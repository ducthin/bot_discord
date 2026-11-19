#!/usr/bin/env bash
set -euo pipefail

app=/opt/discord-bot
service=discord-bot.service
account=discordbot
SERVICE_ACTION_SECONDS=45
HEALTH_WAIT_SECONDS=60
CLEANUP_SECONDS=15
archive=${1:-}
if [[ ! $archive =~ ^/root/discord-bot-[a-f0-9]{32}\.tar\.gz$ || ! -f $archive ]]; then
    echo 'Goi cap nhat khong hop le.' >&2
    exit 1
fi

work=
promoting=0
was_active=0
old_files=()
new_files=()
preserve_work=0

service_action() {
    local status=0
    timeout --kill-after=5s "${SERVICE_ACTION_SECONDS}s" systemctl "$1" "$service" \
        </dev/null >/dev/null 2>&1 9>&- || status=$?
    if (( status )); then echo "Lenh systemctl $1 khong hoan tat (ma $status)." >&2; fi
    return "$status"
}

query_service() {
    local details line
    active_state= main_pid= control_pid= control_group=
    details=$(timeout --kill-after=1s "${1:-3}s" systemctl show "$service" \
        --property=ActiveState --property=MainPID --property=ControlPID --property=ControlGroup 9>&-) || return 1
    while IFS= read -r line; do
        case $line in
            ActiveState=*) active_state=${line#*=} ;;
            MainPID=*) main_pid=${line#*=} ;;
            ControlPID=*) control_pid=${line#*=} ;;
            ControlGroup=*) control_group=${line#*=} ;;
        esac
    done <<< "$details"
}

service_is_stopped() {
    local processes
    query_service || return 1
    [[ $active_state == inactive || $active_state == failed ]] &&
        [[ $main_pid == 0 && $control_pid == 0 ]] || return 1
    # A failed unit can still have children. Do not replace their code while
    # its cgroup contains any process (Ubuntu's unified cgroup hierarchy).
    if [[ $control_group == /* && -f /sys/fs/cgroup$control_group/cgroup.procs ]]; then
        processes=$(timeout --kill-after=1s 3s cat -- "/sys/fs/cgroup$control_group/cgroup.procs" 9>&-) || return 1
        [[ ! $processes =~ [0-9] ]] || return 1
    fi
}

stop_service() {
    local status=0
    service_action stop || status=$?
    if service_is_stopped; then return 0; fi
    echo "Chua xac nhan bot da dung (systemctl: $status). Giu nguyen ma nguon va ban du phong." >&2
    return 1
}

cleanup() {
    local status=$? restored=1 file
    trap - EXIT
    set +e
    if (( promoting )); then
        echo 'Cap nhat that bai. Dang khoi phuc ban truoc...' >&2
        if stop_service; then
            for file in "${new_files[@]}"; do
                mv -T -- "$app/$file" "$work/staged/$file" || restored=0
            done
            for file in "${old_files[@]}"; do
                mv -T -- "$work/backup/$file" "$app/$file" || restored=0
            done
        else
            restored=0
        fi
        if (( restored && was_active )); then
            service_action start || restored=0
        fi
        if (( !restored )); then
            echo "Khoi phuc chua xong. Cac file du phong nam o $work" >&2
            status=1
        fi
    fi
    # A filesystem in uninterruptible I/O can leave rm alive after SIGKILL.
    # Close the deployment lock and SSH streams in that child so the caller
    # can finish and a healthy release is never rolled back for slow cleanup.
    if [[ -n $work ]] && (( restored && !preserve_work )); then
        if ! timeout --kill-after=5s "${CLEANUP_SECONDS}s" rm -rf -- "$work" </dev/null >/dev/null 2>&1 9>&-; then
            echo "Bot van giu trang thai hien tai. Hoan don file tam tai $work (I/O cham)." >&2
        fi
    fi
    if ! timeout --kill-after=5s "${CLEANUP_SECONDS}s" rm -f -- "$archive" </dev/null >/dev/null 2>&1 9>&-; then
        echo "Hoan xoa goi cap nhat $archive (I/O cham)." >&2
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -d $app || ! -f $app/.env ]] || ! timeout --kill-after=1s 5s systemctl cat "$service" >/dev/null; then
    echo 'Chua tim thay bot va dich vu Ubuntu. Hay cai dat bot tren VPS truoc.' >&2
    exit 1
fi

exec 9>/run/lock/discord-bot-deploy.lock
flock -w 120 9
work=$(mktemp -d /opt/.discord-bot-deploy.XXXXXX)
chgrp "$account" "$work"
chmod 750 "$work"
stage=$work/staged
backup=$work/backup
mkdir "$stage" "$backup"

echo 'Dang kiem tra ban moi tren VPS...'
tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions
files=(index.js package.json package-lock.json commands utils handlers assets config scripts web)
for file in "${files[@]}"; do
    [[ -e $stage/$file ]] || { echo "Goi cap nhat thieu $file." >&2; exit 1; }
done
chown -R "$account:$account" "$stage"
ln -s "$app/.env" "$stage/.env"

if [[ -d $app/node_modules ]] &&
    cmp -s "$app/package.json" "$stage/package.json" &&
    cmp -s "$app/package-lock.json" "$stage/package-lock.json"; then
    ln -s "$app/node_modules" "$stage/node_modules"
else
    (cd "$stage" && runuser -u "$account" -- /usr/local/bin/npm ci --omit=dev)
    files+=(node_modules)
fi

(
    cd "$stage"
    for directory in commands utils handlers scripts web; do
        find "$directory" -type f -name '*.js' -print0 | xargs -0 -r -n 1 /usr/local/bin/node --check
    done
    /usr/local/bin/node --check index.js
    runuser -u "$account" -- /usr/local/bin/node scripts/preflight.js
)

health_port() {
    timeout --kill-after=1s "${2:-3}s" /usr/local/bin/node - "$1" "$app" 9>&- <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
try {
    const [pid, app] = process.argv.slice(2);
    if (!/^[1-9][0-9]*$/.test(pid)) throw new Error();
    let value;
    let inherited = false;
    try {
        const entry = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find(item => item.startsWith('PORT='));
        if (entry !== undefined) { value = entry.slice(5); inherited = true; }
    } catch { /* The environment file remains the fallback for an inaccessible proc entry. */ }
    if (!inherited) {
        const dotenv = require(path.join(app, 'node_modules', 'dotenv'));
        value = dotenv.parse(fs.readFileSync(path.join(app, '.env'))).PORT;
    }
    const port = Number(value || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    process.stdout.write(String(port));
} catch {
    process.exitCode = 1;
}
NODE
}

wait_for_bot() {
    local started=$SECONDS deadline=$((SECONDS + HEALTH_WAIT_SECONDS)) next_progress=$SECONDS
    local remaining budget pid= port= health
    while (( SECONDS < deadline )); do
        if (( SECONDS >= next_progress )); then
            echo "Dang doi bot ket noi Discord... $((SECONDS - started))/${HEALTH_WAIT_SECONDS}s"
            next_progress=$((SECONDS + 5))
        fi
        remaining=$((deadline - SECONDS))
        budget=$((remaining < 3 ? remaining : 3))
        if query_service "$budget" && [[ $active_state == active && $main_pid =~ ^[1-9][0-9]*$ ]]; then
            if [[ $pid != "$main_pid" ]]; then pid=$main_pid; port=; fi
            remaining=$((deadline - SECONDS))
            if (( remaining <= 0 )); then break; fi
            if [[ -z $port ]]; then
                budget=$((remaining < 3 ? remaining : 3))
                port=$(health_port "$pid" "$budget") || port=
            fi
            remaining=$((deadline - SECONDS))
            if (( remaining <= 0 )); then break; fi
            budget=$((remaining < 2 ? remaining : 2))
            if [[ $port =~ ^[0-9]+$ ]] &&
                health=$(curl --fail --silent --max-time "$budget" "http://127.0.0.1:$port/health") &&
                [[ $health == *'"status":"healthy"'* ]]; then
                return 0
            fi
        fi
        if (( SECONDS < deadline )); then sleep 1; fi
    done
    echo "Bot chua san sang sau ${HEALTH_WAIT_SECONDS}s (trang thai: ${active_state:-khong ro})." >&2
    return 1
}

echo 'Dang chuyen sang ban moi...'
if ! query_service; then
    echo 'Khong doc duoc trang thai dich vu. Chua thay doi ma nguon.' >&2
    exit 1
fi
if [[ $active_state == active ]]; then was_active=1; fi
echo "Dang dung bot cu (toi da ${SERVICE_ACTION_SECONDS}s)..."
if ! stop_service; then
    preserve_work=1
    echo "Ban moi duoc giu tai $work; chua thay doi file cua bot." >&2
    exit 1
fi
promoting=1
echo 'Bot da dung. Dang thay ma nguon...'
for file in "${files[@]}"; do
    if [[ -e $app/$file || -L $app/$file ]]; then
        mv -T -- "$app/$file" "$backup/$file"
        old_files+=("$file")
    fi
    mv -T -- "$stage/$file" "$app/$file"
    new_files+=("$file")
done
echo "Dang khoi dong bot moi (toi da ${SERVICE_ACTION_SECONDS}s)..."
service_action start
if ! wait_for_bot; then
    exit 1
fi
promoting=0
echo 'Cap nhat xong. Bot da ket noi Discord.'
