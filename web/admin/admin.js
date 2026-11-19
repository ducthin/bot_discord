'use strict';

(() => {
    const API = '/admin/api';
    const $ = id => document.getElementById(id);
    const state = { csrfToken: '', overview: null, guild: null, guildId: '', page: 'overview', loading: false, timer: null, toastTimer: null, sessionVersion: 0 };
    const memberPicker = { selected: null, results: [], open: false, active: -1, sequence: 0, timer: null, loading: false, notice: '', failed: false };
    const pages = {
        overview: ['TRẠNG THÁI HỆ THỐNG', 'Tổng quan', 'Bot đang hoạt động thế nào? Mọi thứ ở ngay đây.'],
        music: ['PHIÊN NGHE HIỆN TẠI', 'Âm nhạc', 'Điều khiển trình phát và theo dõi hàng đợi trên máy chủ.'],
        battles: ['HÒM & VẬT PHẨM', 'Case Battle', 'Theo dõi các phòng đang chờ và những trận đang diễn ra.'],
        economy: ['VÍ & TRÒ CHƠI', 'Ví & Tiệm Bánh', 'Cấp xu cho thành viên và quản lý bàn chơi tự động.'],
        settings: ['THIẾT LẬP VẬN HÀNH', 'Cấu hình', 'Thông tin máy chủ và trạng thái các chức năng của bot.'],
        activity: ['LỊCH SỬ QUẢN TRỊ', 'Nhật ký thao tác', 'Theo dõi các thay đổi được thực hiện qua bảng điều khiển.'],
        catalogue: ['DANH MỤC HÒM', 'Danh mục hòm', 'Xem các hòm Battle, tỷ lệ giá và trạng thái đồng bộ.']
    };
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
    const safeUrl = value => { if (typeof value !== 'string' || !value.trim()) return ''; try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
    const number = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value) || 0);
    const empty = (title, description, name = 'activity') => `<div class="empty-state">${icon(name)}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
    const duration = seconds => { seconds = Math.max(0, Number(seconds) || 0); const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60); return days ? `${days} ngày ${hours} giờ` : hours ? `${hours} giờ ${minutes} phút` : `${minutes} phút`; };
    const date = value => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(parsed); };

    async function api(path, options = {}) {
        const method = options.method ?? 'GET';
        const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && state.csrfToken ? { 'X-CSRF-Token': state.csrfToken } : {}) };
        const response = await fetch(`${API}${path}`, { method, credentials: 'same-origin', headers, cache: 'no-store', ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
        let result;
        try { result = await response.json(); } catch { throw new Error('Máy chủ chưa phản hồi đúng. Hãy thử lại sau.'); }
        if (!response.ok) {
            if (response.status === 401 && path !== '/login') showLogin();
            throw new Error(result.error?.message ?? result.message ?? result.error ?? `Không thể thực hiện thao tác (${response.status}).`);
        }
        if (result.csrfToken) state.csrfToken = result.csrfToken;
        return result;
    }

    function showLogin() {
        clearTimeout(state.timer);
        state.sessionVersion++;
        resetMemberPicker();
        state.coinRequest = null;
        state.csrfToken = '';
        $('app').hidden = true;
        $('initial-loading').hidden = true;
        $('login-screen').hidden = false;
        $('password').focus();
    }

    function showApp() {
        state.sessionVersion++;
        $('login-screen').hidden = true;
        $('initial-loading').hidden = true;
        $('app').hidden = false;
    }

    function toast(message, error = false) {
        clearTimeout(state.toastTimer);
        const element = $('toast');
        element.textContent = message;
        element.classList.toggle('error', error);
        element.hidden = false;
        state.toastTimer = setTimeout(() => { element.hidden = true; }, error ? 7000 : 4500);
    }

    function showPage(page) {
        if (!pages[page]) return;
        state.page = page;
        const [eyebrow, title, description] = pages[page];
        $('page-eyebrow').textContent = eyebrow;
        $('page-title').textContent = title;
        $('page-description').textContent = description;
        $('breadcrumb-current').textContent = title;
        document.title = `${title} · Bot Studio`;
        document.querySelectorAll('.page-section').forEach(element => { element.hidden = element.id !== `page-${page}`; });
        document.querySelectorAll('.nav-item').forEach(element => { element.classList.toggle('active', element.dataset.page === page); element.setAttribute('aria-current', element.dataset.page === page ? 'page' : 'false'); });
        $('sidebar').classList.remove('open');
        $('menu-button').setAttribute('aria-expanded', 'false');
        if (page !== 'economy') closeMemberPicker();
        if (page === 'catalogue' && !state.catalogue) void loadCatalogue();
    }

    async function refresh(silent = false) {
        if (state.loading) { state.refreshPending = true; return; }
        if ($('app').hidden || document.hidden) return;
        state.loading = true;
        $('refresh-button').disabled = true;
        try {
            const overview = await api('/overview');
            state.overview = overview;
            const guilds = overview.guilds ?? [];
            if (!guilds.some(guild => guild.id === state.guildId)) {
                const nextGuild = guilds[0]?.id ?? '';
                if (nextGuild !== state.guildId) { resetMemberPicker(); state.coinRequest = null; }
                state.guildId = nextGuild;
            }
            renderOverview();
            const requestedGuildId = state.guildId;
            const guildDetail = requestedGuildId ? await api(`/guilds/${encodeURIComponent(requestedGuildId)}`) : null;
            // A server selection can change while its response is in flight.
            // Never show one server's details under another server's controls.
            if (requestedGuildId !== state.guildId) { state.refreshPending = true; return; }
            state.guild = guildDetail;
            renderGuild();
            if (state.page === 'catalogue' && !state.catalogue) await loadCatalogue();
            $('connection-banner').hidden = true;
            $('refresh-status').textContent = `Cập nhật ${new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())}`;
        } catch (error) {
            $('connection-banner').textContent = `Chưa lấy được dữ liệu mới. ${error.message}`;
            $('connection-banner').hidden = false;
            $('refresh-status').textContent = 'Mất kết nối cập nhật';
            if (!silent) toast(error.message, true);
        } finally {
            state.loading = false;
            $('refresh-button').disabled = false;
            clearTimeout(state.timer);
            if (!$('app').hidden && !document.hidden) {
                const wait = state.refreshPending ? 0 : 5000;
                state.refreshPending = false;
                state.timer = setTimeout(() => refresh(true), wait);
            }
        }
    }

    function renderOverview() {
        const { bot = {}, system = {}, guilds = [], catalogue = {}, activity = [] } = state.overview ?? {};
        $('preview-banner').hidden = !(state.overview?.demo || state.overview?.preview);
        const ready = !!bot.ready;
        $('stat-status').textContent = ready ? 'Online' : 'Offline';
        $('stat-status').style.color = ready ? 'var(--mint)' : 'var(--red)';
        $('stat-bot-name').textContent = bot.tag ?? bot.name ?? 'Chưa kết nối Discord';
        $('stat-ping').textContent = bot.ping >= 0 ? number(Math.round(bot.ping)) : '—';
        $('stat-uptime').textContent = duration(bot.uptimeSeconds ?? bot.uptime);
        $('stat-memory').textContent = number(Math.round(system.rssMb ?? system.memoryMb ?? 0));
        $('sidebar-status').textContent = ready ? 'Bot đang hoạt động' : 'Chưa kết nối Discord';
        $('sidebar-dot').classList.toggle('offline', !ready);
        $('status-dot').classList.toggle('offline', !ready);
        $('footer-bot').textContent = bot.tag ?? bot.name ?? 'Discord control center';
        $('guild-select').innerHTML = guilds.length ? guilds.map(guild => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</option>`).join('') : '<option value="">Chưa có máy chủ</option>';
        $('guild-select').value = state.guildId;
        const current = guilds.find(guild => guild.id === state.guildId);
        $('guild-initial').textContent = (current?.name ?? 'D').slice(0, 1).toUpperCase();
        $('case-count').textContent = number(catalogue.caseCount ?? catalogue.cases ?? 0);
        $('recent-activity').innerHTML = activityTable(activity.slice(0, 5));
        $('activity-list').innerHTML = activityTable(activity);
        $('system-details').innerHTML = details([
            ['Tên bot', bot.tag ?? bot.name ?? '—'], ['Kết nối', ready ? 'Đã kết nối Discord' : 'Đang mất kết nối'],
            ['Máy chủ', `${guilds.length} máy chủ`], ['Danh mục Battle', `${catalogue.caseCount ?? catalogue.cases ?? '—'} hòm`],
            ['Bộ nhớ', `${number(Math.round(system.rssMb ?? system.memoryMb ?? 0))} MB`], ['Thời gian hoạt động', duration(bot.uptimeSeconds ?? bot.uptime)]
        ]);
    }

    async function loadCatalogue() {
        try {
            const result = await api('/catalogue');
            state.catalogue = result;
            const cases = result.cases ?? [];
            const groups = [...new Set(cases.map(item => item.group).filter(Boolean))];
            $('catalogue-group').innerHTML = '<option value="all">Tất cả nhóm</option>' + groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('');
            renderCatalogue();
        } catch (error) { $('catalogue-grid').innerHTML = empty('Chưa lấy được danh mục', error.message, 'box'); toast(error.message, true); }
    }

    function renderCatalogue() {
        const result = state.catalogue ?? { cases: [] };
        const query = $('catalogue-search').value.trim().toLocaleLowerCase('vi');
        const group = $('catalogue-group').value;
        const cases = (result.cases ?? []).filter(item => (!query || `${item.name} ${item.description ?? ''} ${item.id}`.toLocaleLowerCase('vi').includes(query)) && (group === 'all' || item.group === group));
        $('catalogue-summary').textContent = `${cases.length} / ${(result.cases ?? []).length} hòm đang hiển thị`;
        $('catalogue-price-status').textContent = result.pricedAt ? `Cập nhật ${date(result.pricedAt)}${result.nextRefreshAt ? ` · tiếp theo ${date(result.nextRefreshAt)}` : ''}` : 'Giá lấy từ bộ nhớ đệm của bot';
        $('catalogue-grid').innerHTML = cases.length ? cases.map(item => {
            const image = safeUrl(item.image);
            const fee = item.feeFormatted ?? item.fee;
            return `<article class="case-card"><div class="case-image">${image ? `<img loading="lazy" src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" referrerpolicy="no-referrer">` : `<div class="case-fallback">${icon('box')}</div>`}</div><div class="case-copy"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description ?? item.group ?? 'Hòm Battle')}</p><div class="case-card-footer"><span class="case-fee">${escapeHtml(fee ?? 'Chưa có giá')}<small>${fee ? ' / vòng' : ''}</small></span><span class="badge ${item.available === false ? 'warning' : 'success'}">${item.available === false ? 'Thiếu giá' : item.riskLabel ? escapeHtml(item.riskLabel) : item.risk ? escapeHtml(item.risk) : 'Sẵn sàng'}</span></div></div></article>`;
        }).join('') : empty('Không tìm thấy hòm', 'Thử đổi từ khóa hoặc bộ lọc.', 'box');
    }

    function activityTable(items) {
        if (!items.length) return empty('Chưa có thao tác nào', 'Các thao tác quản trị qua trang web sẽ xuất hiện ở đây.');
        return `<div class="table-scroll"><table class="activity-table"><thead><tr><th>Thao tác</th><th>Máy chủ</th><th>Trạng thái</th><th>Thời gian</th></tr></thead><tbody>${items.map(item => {
            const failed = item.status === 'error' || item.success === false;
            const kind = /music|nhạc/i.test(item.action) ? 'music' : /coin|xu/i.test(item.action) ? 'coins' : /battle/i.test(item.action) ? 'box' : 'settings';
            return `<tr><td><div class="activity-cell"><span class="quick-icon ${failed ? 'peach' : 'purple'}">${icon(kind)}</span><span><strong>${escapeHtml(item.label ?? item.action ?? 'Thao tác quản trị')}</strong>${item.detail || item.message ? `<small>${escapeHtml(item.detail ?? item.message)}</small>` : ''}</span></div></td><td>${escapeHtml(item.guildName ?? item.guildId ?? 'Hệ thống')}</td><td><span class="badge ${failed ? 'error' : 'success'}">${failed ? 'Chưa thành công' : 'Hoàn tất'}</span></td><td>${escapeHtml(date(item.at ?? item.createdAt ?? item.timestamp))}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }

    function memberName(member) { return String(member?.userName ?? member?.username ?? 'Thành viên Discord').trim() || 'Thành viên Discord'; }
    function memberAvatar(member) {
        const name = memberName(member), avatar = safeUrl(member?.avatar);
        return `<span class="member-avatar" aria-hidden="true"><span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>${avatar ? `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}</span>`;
    }
    function resetMemberPicker() {
        clearTimeout(memberPicker.timer);
        memberPicker.sequence++;
        Object.assign(memberPicker, { selected: null, results: [], active: -1, loading: false, notice: '', failed: false });
        $('coins-user').value = ''; $('coins-member-search').value = '';
        $('coins-member-selected').hidden = true; $('coins-member-selected').innerHTML = '';
        $('coins-member-options').innerHTML = ''; $('coins-member-status').textContent = '';
        closeMemberPicker();
    }
    function closeMemberPicker() {
        memberPicker.open = false;
        $('coins-member-dropdown').hidden = true;
        $('coins-member-search').setAttribute('aria-expanded', 'false');
        $('coins-member-search').removeAttribute('aria-activedescendant');
        memberPicker.active = -1;
    }
    function selectMember(member) {
        if (!member || !/^[1-9]\d{0,19}$/.test(member.userId ?? '')) return;
        clearTimeout(memberPicker.timer); memberPicker.sequence++;
        memberPicker.selected = { ...member };
        $('coins-user').value = member.userId;
        $('coins-member-search').value = memberName(member);
        $('coins-member-selected').innerHTML = `${memberAvatar(member)}<span class="member-identity"><strong>${escapeHtml(memberName(member))}</strong><small>ID: ${escapeHtml(member.userId)}</small>${member.unverified ? '<em>Chưa xác minh tên · Bot sẽ kiểm tra thành viên trước khi cấp xu.</em>' : ''}</span><button type="button" class="member-clear" aria-label="Đổi thành viên nhận xu">×</button>`;
        $('coins-member-selected').hidden = false;
        closeMemberPicker();
    }
    function renderMemberOptions() {
        $('coins-member-options').innerHTML = memberPicker.results.map((member, index) => `<div class="member-option${index === memberPicker.active ? ' active' : ''}" id="coin-member-option-${index}" role="option" aria-selected="${index === memberPicker.active}" data-member-index="${index}">${memberAvatar(member)}<span class="member-identity"><strong>${escapeHtml(memberName(member))}</strong><small>${member.unverified ? 'Dùng ID thủ công · ' : member.username && member.username !== member.userName ? `@${escapeHtml(member.username)} · ` : ''}${escapeHtml(member.userId)}</small></span>${member.unverified ? '<span class="badge warning">Chưa xác minh</span>' : ''}</div>`).join('');
        $('coins-member-status').textContent = memberPicker.loading ? 'Đang tìm thành viên…' : memberPicker.notice || (memberPicker.results.length ? 'Chọn người nhận · ↑ ↓ để di chuyển, Enter để chọn.' : 'Không tìm thấy thành viên. Thử tên khác hoặc nhập đầy đủ ID.');
        if (memberPicker.open) {
            $('coins-member-dropdown').hidden = false;
            $('coins-member-search').setAttribute('aria-expanded', 'true');
        }
        if (memberPicker.active >= 0) $('coins-member-search').setAttribute('aria-activedescendant', `coin-member-option-${memberPicker.active}`);
        else $('coins-member-search').removeAttribute('aria-activedescendant');
    }
    function manualMember(query) {
        return /^[1-9]\d{0,19}$/.test(query) ? { userId: query, userName: 'Thành viên theo ID', username: '', avatar: null, unverified: true } : null;
    }
    async function searchMembers() {
        if (!memberPicker.open || !state.guildId || $('app').hidden) return;
        const sequence = ++memberPicker.sequence, guildId = state.guildId, sessionVersion = state.sessionVersion;
        const query = $('coins-member-search').value.trim();
        memberPicker.loading = true; memberPicker.notice = ''; memberPicker.results = []; memberPicker.active = -1;
        renderMemberOptions();
        try {
            const result = await api(`/guilds/${encodeURIComponent(guildId)}/members?search=${encodeURIComponent(query)}`);
            if (sequence !== memberPicker.sequence || guildId !== state.guildId || sessionVersion !== state.sessionVersion || $('app').hidden) return;
            memberPicker.results = (Array.isArray(result.members) ? result.members : []).filter(member => /^[1-9]\d{0,19}$/.test(member?.userId ?? ''));
            memberPicker.failed = false;
            memberPicker.notice = result.notice ?? (result.hasMore ? 'Còn nhiều thành viên. Nhập thêm tên hoặc ID để thu hẹp kết quả.' : '');
            const manual = manualMember(query);
            if (manual && !memberPicker.results.some(member => member.userId === query)) {
                memberPicker.results.push(manual);
                memberPicker.notice = 'Chưa tra cứu được tên cho ID này. Nếu dùng ID thủ công, bot sẽ xác minh trước khi cấp xu.';
            }
        } catch (error) {
            if (sequence !== memberPicker.sequence || guildId !== state.guildId || sessionVersion !== state.sessionVersion || $('app').hidden) return;
            memberPicker.failed = true; memberPicker.results = [];
            const manual = manualMember(query); if (manual) memberPicker.results.push(manual);
            memberPicker.notice = `${error.message} Bạn có thể nhập đầy đủ ID Discord và chọn “Thành viên theo ID”; bot vẫn kiểm tra người nhận.`;
        } finally {
            if (sequence === memberPicker.sequence && guildId === state.guildId && sessionVersion === state.sessionVersion) { memberPicker.loading = false; renderMemberOptions(); }
        }
    }
    function openMemberPicker() {
        if (!state.guildId || $('app').hidden) return;
        if (memberPicker.open) return;
        memberPicker.open = true;
        $('coins-member-dropdown').hidden = false;
        $('coins-member-search').setAttribute('aria-expanded', 'true');
        if (memberPicker.selected) $('coins-member-search').value = '';
        void searchMembers();
    }
    function details(rows) { return `<dl class="detail-list">${rows.map(([key, value]) => `<div class="detail-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`; }

    function renderGuild() {
        const detail = state.guild ?? {};
        const guild = detail.guild ?? state.overview?.guilds?.find(item => item.id === state.guildId) ?? {};
        const music = detail.music ?? {};
        const current = music.current ?? music.currentSong;
        const hasMusic = !!current;
        const activeMusic = hasMusic && !music.paused;
        $('music-state').textContent = hasMusic ? music.paused ? 'Tạm dừng' : 'Đang phát' : 'Chưa phát';
        $('music-state').className = `badge${activeMusic ? ' success' : ''}`;
        $('track-title').textContent = current?.title ?? 'Chưa có bài hát';
        $('track-description').textContent = current ? current.artist ?? current.author ?? 'Đang phát trên máy chủ đã chọn' : 'Thêm nhạc từ Discord để bắt đầu phiên nghe.';
        for (const id of ['music-pause', 'music-resume', 'music-skip', 'music-stop']) $(id).disabled = !hasMusic;
        const volume = Math.max(0, Math.min(100, music.volume ?? 50));
        if (document.activeElement !== $('music-volume')) $('music-volume').value = String(volume);
        $('volume-value').textContent = `${$('music-volume').value}%`;
        if (document.activeElement !== $('music-loop')) $('music-loop').value = music.loopMode ?? 'off';
        const queue = music.queue ?? [];
        $('queue-count').textContent = `${queue.length} bài`;
        $('music-shuffle').disabled = queue.length < (current ? 3 : 2);
        $('music-disconnect').disabled = !music.connected;
        if (document.activeElement !== $('music-autoplay')) $('music-autoplay').checked = music.autoplay === true;
        $('queue-list').innerHTML = queue.length ? queue.map((song, index) => {
            const isCurrent = song.current === true;
            return `<div class="queue-item"><span class="queue-number">${String(song.position ?? index + 1).padStart(2, '0')}</span><div class="queue-song"><strong>${escapeHtml(song.title ?? 'Bài hát')}</strong><small>${escapeHtml(song.artist ?? song.author ?? song.duration ?? '')}</small></div>${isCurrent ? '<span class="badge success">Đang phát</span>' : `<button class="queue-remove" data-remove-position="${song.position ?? index + 1}" data-expected-url="${escapeHtml(song.url ?? '')}" aria-label="Xóa ${escapeHtml(song.title ?? 'bài hát')} khỏi hàng đợi">×</button>`}</div>`;
        }).join('') : empty('Hàng đợi đang trống', 'Dùng /play trong Discord để thêm bài hát.', 'music');
        const artwork = safeUrl(current?.thumbnail);
        $('music-overview-content').innerHTML = current ? `<div class="compact-track"><div class="compact-art">${artwork ? `<img src="${escapeHtml(artwork)}" alt="" referrerpolicy="no-referrer">` : icon('music')}</div><div><h3>${escapeHtml(current.title)}</h3><p>${escapeHtml(current.artist ?? current.author ?? guild.name ?? 'Discord')}</p><p>${queue.length} bài trong hàng đợi</p></div></div><div class="compact-player-footer"><span class="playing-label">${activeMusic ? '<span class="playing-indicator"><i></i><i></i><i></i><i></i></span>' : ''}${music.paused ? 'Đang tạm dừng' : 'Đang phát trên Discord'}</span><div class="inline-controls"><button class="icon-button" data-music-action="${music.paused ? 'resume' : 'pause'}" aria-label="${music.paused ? 'Tiếp tục' : 'Tạm dừng'}">${icon(music.paused ? 'play' : 'pause')}</button><button class="icon-button" data-music-action="skip" aria-label="Bỏ qua">${icon('skip')}</button></div></div>` : empty('Một chút yên tĩnh', 'Chưa có nhạc trên máy chủ này. Bắt đầu bằng /play trong Discord.', 'music');
        const battles = detail.battles ?? [];
        const activeBattles = battles.filter(room => ['waiting', 'revealing'].includes(room.status));
        $('nav-battle-count').textContent = String(activeBattles.length);
        $('battle-count').textContent = `${battles.length} phòng`;
        $('battle-list').innerHTML = battles.length ? battles.map(room => {
            const status = { waiting: 'Chờ người', revealing: 'Đang quay', finished: 'Hoàn tất', cancelled: 'Đã hủy', expired: 'Hết hạn' }[room.status] ?? room.status;
            const players = Array.isArray(room.players) ? room.players.length : room.playerCount ?? 0;
            return `<article class="battle-card"><span class="quick-icon purple">${icon('box')}</span><div class="battle-info"><h3>Battle #${escapeHtml(room.id)}</h3><p>${escapeHtml(room.roundCount ?? room.caseIds?.length ?? 0)} vòng · ${players}/${escapeHtml(room.capacity ?? room.playerLimit ?? room.format ?? '?')} người</p><p>${escapeHtml(room.channelName ? `#${room.channelName}` : room.channelId ?? '')}${room.fee != null ? ` · ${escapeHtml(room.feeFormatted ?? room.fee)}/người` : ''}</p></div><div class="battle-meta"><span class="badge ${room.status === 'revealing' ? 'success' : room.status === 'waiting' ? 'warning' : ''}">${escapeHtml(status)}</span>${room.status === 'waiting' ? `<button class="button danger small" data-cancel-battle="${escapeHtml(room.id)}">Hủy phòng</button>` : ''}</div></article>`;
        }).join('') : empty('Chưa có phòng Battle', 'Tạo trận bằng /hom → Battle trong Discord. Các phòng sẽ xuất hiện tại đây.', 'box');
        const settings = detail.settings ?? {};
        const game = settings.taixiuRoom ?? { channelId: settings.taixiuChannelId };
        const enabled = settings.taixiuEnabled === false ? false : !!(game.channelId ?? settings.taixiuChannelId);
        $('taixiu-status').textContent = enabled ? 'Đang bật' : 'Chưa thiết lập';
        $('taixiu-status').className = `badge${enabled ? ' success' : ''}`;
        const channels = (detail.channels ?? []).filter(channel => channel.type === 'text' || channel.type === 0 || channel.type === 'GuildText');
        const gameFormFocused = $('game-settings-form').contains(document.activeElement);
        if (!gameFormFocused) {
            $('game-channel').innerHTML = '<option value="">Chọn kênh chữ…</option>' + channels.map(channel => `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`).join('');
            $('game-channel').value = game.channelId ?? '';
            $('game-enabled').checked = enabled;
        }
        $('guild-details').innerHTML = details([
            ['Tên máy chủ', guild.name ?? 'Chưa chọn'], ['ID máy chủ', guild.id ?? '—'], ['Thành viên', number(guild.memberCount ?? 0)],
            ['Kênh', number(detail.channels?.length ?? guild.channelCount ?? 0)], ['Bàn Tiệm Bánh', enabled ? `#${channels.find(channel => channel.id === game.channelId)?.name ?? game.channelId}` : 'Chưa thiết lập']
        ]);
        const wallets = detail.wallets ?? [];
        $('wallet-list').innerHTML = wallets.length ? wallets.slice(0, 100).map(wallet => {
            const available = wallet.memberAvailable !== false;
            const identity = `${memberAvatar(wallet)}<span class="member-identity"><strong>${escapeHtml(memberName(wallet))}</strong><small>${wallet.username && wallet.username !== wallet.userName ? `@${escapeHtml(wallet.username)} · ` : ''}ID: ${escapeHtml(wallet.userId)}</small>${!available ? '<em>Không tìm thấy thành viên hiện tại</em>' : ''}</span>`;
            return `<div class="wallet-row">${available ? `<button type="button" class="wallet-user wallet-select" data-wallet-user="${escapeHtml(wallet.userId)}" aria-label="Chọn ${escapeHtml(memberName(wallet))} để cấp xu">${identity}</button>` : `<span class="wallet-user">${identity}</span>`}<strong class="wallet-balance">${escapeHtml(wallet.balanceFormatted ?? wallet.balance ?? '0 xu')}</strong></div>`;
        }).join('') : empty('Chưa có ví', 'Các ví sẽ xuất hiện sau khi có người chơi.', 'coins');
        const disabled = !state.guildId;
        document.querySelectorAll('#coins-form input, #coins-form button, #game-settings-form input, #game-settings-form select, #game-settings-form button, #volume-form button, #music-loop, #music-autoplay').forEach(element => { element.disabled = disabled; });
    }

    function confirmAction(title, message) {
        const dialog = $('confirm-dialog');
        $('confirm-title').textContent = title;
        $('confirm-message').textContent = message;
        return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.returnValue = ''; dialog.showModal(); });
    }

    async function perform(button, path, body, success) {
        if (!state.guildId) return toast('Hãy chọn một máy chủ trước.', true);
        if (button) button.disabled = true;
        try { const result = await api(path, { method: 'POST', body }); toast(result.message ?? success); await refresh(true); return true; }
        catch (error) { toast(error.message, true); return false; }
        finally { if (button) button.disabled = false; }
    }

    async function musicAction(action, button, options = {}) {
        const guildId = state.guildId;
        if (action === 'stop' && !await confirmAction('Dừng phiên nghe?', 'Bot sẽ dừng bài hiện tại và xóa hàng đợi của máy chủ đang chọn.')) return;
        if (action === 'disconnect' && !await confirmAction('Rời phòng thoại?', 'Bot sẽ dừng phát và rời phòng thoại trên máy chủ đang chọn.')) return;
        if (guildId !== state.guildId) return toast('Máy chủ đã thay đổi. Hãy thực hiện lại trên máy chủ muốn điều khiển.', true);
        await perform(button, `/guilds/${encodeURIComponent(guildId)}/music`, { action, ...options }, 'Đã cập nhật trình phát.');
    }

    $('login-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button');
        button.disabled = true;
        $('login-error').hidden = true;
        try { await api('/login', { method: 'POST', body: { password: $('password').value } }); $('password').value = ''; showApp(); await refresh(); }
        catch (error) { $('login-error').textContent = error.message; $('login-error').hidden = false; $('password').focus(); }
        finally { button.disabled = false; }
    });
    $('logout-button').addEventListener('click', async () => { try { await api('/logout', { method: 'POST', body: {} }); showLogin(); } catch (error) { toast(error.message, true); } });
    $('refresh-button').addEventListener('click', () => refresh());
    $('guild-select').addEventListener('change', async event => { resetMemberPicker(); state.coinRequest = null; state.guildId = event.target.value; state.guild = null; renderGuild(); await refresh(); });
    document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
    document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.go)));
    $('menu-button').addEventListener('click', () => { const open = $('sidebar').classList.toggle('open'); $('menu-button').setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', event => { if (event.target.closest('[data-music-action]')) { const button = event.target.closest('[data-music-action]'); void musicAction(button.dataset.musicAction, button); } });
    for (const action of ['pause', 'resume', 'skip', 'stop']) $(`music-${action}`).addEventListener('click', event => musicAction(action, event.currentTarget));
    $('music-volume').addEventListener('input', event => { $('volume-value').textContent = `${event.target.value}%`; });
    $('volume-form').addEventListener('submit', event => { event.preventDefault(); void musicAction('volume', event.currentTarget.querySelector('button'), { volume: Number($('music-volume').value) }); });
    $('music-loop').addEventListener('change', event => musicAction('loop', event.currentTarget, { mode: event.target.value }));
    $('music-autoplay').addEventListener('change', event => musicAction('autoplay', event.currentTarget, { enabled: event.target.checked }));
    $('music-disconnect').addEventListener('click', event => musicAction('disconnect', event.currentTarget));
    $('music-shuffle').addEventListener('click', event => musicAction('shuffle', event.currentTarget));
    $('queue-list').addEventListener('click', event => { const button = event.target.closest('[data-remove-position]'); if (button) void musicAction('remove', button, { position: Number(button.dataset.removePosition), expectedUrl: button.dataset.expectedUrl || null }); });
    $('battle-list').addEventListener('click', async event => { const button = event.target.closest('[data-cancel-battle]'); const guildId = state.guildId; if (!button || !await confirmAction('Hủy phòng Battle?', 'Chỉ hủy phòng đang chờ. Trận đã bắt đầu không bị ảnh hưởng.')) return; if (guildId !== state.guildId) return toast('Máy chủ đã thay đổi. Hãy chọn lại phòng muốn hủy.', true); await perform(button, `/guilds/${encodeURIComponent(guildId)}/battles/${encodeURIComponent(button.dataset.cancelBattle)}/cancel`, {}, 'Đã hủy phòng chờ.'); });
    $('coins-member-search').addEventListener('focus', openMemberPicker);
    $('coins-member-search').addEventListener('click', openMemberPicker);
    $('coins-member-search').addEventListener('input', () => {
        memberPicker.selected = null; $('coins-user').value = ''; $('coins-member-selected').hidden = true;
        clearTimeout(memberPicker.timer); memberPicker.sequence++;
        memberPicker.open = true; memberPicker.loading = true; memberPicker.results = []; memberPicker.active = -1; memberPicker.notice = '';
        renderMemberOptions();
        memberPicker.timer = setTimeout(() => { void searchMembers(); }, 250);
    });
    $('coins-member-search').addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); closeMemberPicker(); return; }
        if (event.key === 'Tab') { closeMemberPicker(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!memberPicker.open) { openMemberPicker(); return; }
            if (!memberPicker.results.length) return;
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            memberPicker.active = memberPicker.active < 0 ? direction > 0 ? 0 : memberPicker.results.length - 1 : (memberPicker.active + direction + memberPicker.results.length) % memberPicker.results.length;
            document.querySelectorAll('[data-member-index]').forEach((option, index) => { option.classList.toggle('active', index === memberPicker.active); option.setAttribute('aria-selected', String(index === memberPicker.active)); });
            const active = $(`coin-member-option-${memberPicker.active}`);
            $('coins-member-search').setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Enter' && memberPicker.open) {
            event.preventDefault();
            if (memberPicker.active >= 0) selectMember(memberPicker.results[memberPicker.active]);
            else if (memberPicker.results.length === 1) selectMember(memberPicker.results[0]);
        }
    });
    $('coins-member-options').addEventListener('pointerdown', event => { if (event.target.closest('[data-member-index]')) event.preventDefault(); });
    $('coins-member-options').addEventListener('click', event => { const option = event.target.closest('[data-member-index]'); if (option) selectMember(memberPicker.results[Number(option.dataset.memberIndex)]); });
    $('coins-member-selected').addEventListener('click', event => { if (!event.target.closest('.member-clear')) return; resetMemberPicker(); $('coins-member-search').focus(); });
    document.addEventListener('pointerdown', event => { if (!event.target.closest('#coins-member-picker')) closeMemberPicker(); });
    document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && event.target.closest('.member-avatar')) event.target.hidden = true; }, true);
    $('wallet-list').addEventListener('click', event => {
        const button = event.target.closest('[data-wallet-user]');
        const member = (state.guild?.wallets ?? []).find(wallet => wallet.userId === button?.dataset.walletUser && wallet.memberAvailable !== false);
        if (!member) return;
        selectMember(member);
        $('coins-form').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
        $('coins-amount').focus({ preventScroll: true });
    });
    $('coins-form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const guildId = state.guildId;
        const sessionVersion = state.sessionVersion;
        const userId = $('coins-user').value.trim(), amount = $('coins-amount').value.trim(), reason = $('coins-reason').value.trim();
        const selected = memberPicker.selected;
        if (!selected || selected.userId !== userId || !/^[1-9]\d{0,19}$/.test(userId)) { toast('Hãy chọn người nhận từ danh sách tên hoặc tùy chọn ID đã nhập.', true); $('coins-member-search').focus(); return; }
        if (!await confirmAction('Xác nhận cấp xu', `Cộng ${amount} xu cho ${memberName(selected)} (ID: ${userId}) trên máy chủ đang chọn?${selected.unverified ? ' Chưa tra cứu được tên; bot sẽ kiểm tra ID này thuộc một thành viên thật trước khi cộng xu.' : ''}`)) return;
        if (guildId !== state.guildId || sessionVersion !== state.sessionVersion || $('app').hidden) return toast('Máy chủ hoặc phiên đăng nhập đã thay đổi. Hãy kiểm tra và cấp xu lại.', true);
        const key = JSON.stringify([guildId, userId, amount, reason]);
        if (state.coinRequest?.key !== key) state.coinRequest = { key, requestId: crypto.randomUUID() };
        const requestId = state.coinRequest.requestId;
        if (await perform(form.querySelector('button[type="submit"]'), `/guilds/${encodeURIComponent(guildId)}/coins`, { userId, amount, reason, requestId }, 'Đã cấp xu.')) {
            if (guildId === state.guildId && sessionVersion === state.sessionVersion) { form.reset(); resetMemberPicker(); }
            if (state.coinRequest?.requestId === requestId) state.coinRequest = null;
        }
    });
    $('game-settings-form').addEventListener('submit', async event => { event.preventDefault(); const enabled = $('game-enabled').checked; const channelId = $('game-channel').value; if (enabled && !channelId) return toast('Hãy chọn kênh chữ để bật bàn tự động.', true); await perform(event.currentTarget.querySelector('button'), `/guilds/${encodeURIComponent(state.guildId)}/settings`, { taixiuChannelId: channelId || null, taixiuEnabled: enabled }, 'Đã lưu thiết lập bàn chơi.'); });
    $('catalogue-search').addEventListener('input', () => renderCatalogue());
    $('catalogue-group').addEventListener('change', () => renderCatalogue());
    $('prices-refresh').addEventListener('click', async event => { if (await perform(event.currentTarget, '/prices/refresh', {}, 'Đã yêu cầu đồng bộ giá.')) { state.catalogue = null; await loadCatalogue(); } });
    document.addEventListener('visibilitychange', () => { clearTimeout(state.timer); if (!document.hidden && !$('app').hidden) void refresh(true); });

    async function start() {
        try {
            const session = await api('/session');
            if (!session.authenticated) {
                showLogin();
                if (session.configured === false) { $('login-error').textContent = 'Trang quản trị chưa được cấu hình mật khẩu trên máy chủ. Hãy thiết lập mật khẩu trước khi đăng nhập.'; $('login-error').hidden = false; }
                return;
            }
            state.csrfToken = session.csrfToken ?? '';
            showApp();
            await refresh();
        }
        catch (error) { showLogin(); if (!/401/.test(error.message)) { $('login-error').textContent = error.message; $('login-error').hidden = false; } }
    }
    void start();
})();
