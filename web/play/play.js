(() => {
    'use strict';
    function takeLoginLink() {
        if (!location.hash.startsWith('#login=')) return '';
        const fragment = location.hash.slice(1);
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        const value = new URLSearchParams(fragment).get('login') ?? '';
        if (value.length > 32) return '';
        const raw = value.replace(/[\s-]/g, '').toUpperCase();
        return /^[A-HJ-NP-Z2-9]{16}$/.test(raw) ? raw.match(/.{4}/g).join('-') : '';
    }
    let linkedLoginCode = takeLoginLink(), loginLinkReady = false;
    const $ = id => document.getElementById(id);
    const state = { catalogue: [], group: 'all', view: 'cases', authenticated: false, csrf: '', me: null,
        detail: null, count: 1, opening: false, upgradeBusy: false, inventorySelected: new Set(), upgradeSelected: new Set(),
        target: null, targetPage: 0, targetPages: 1, targetMin: '', targetSequence: 0, preview: null, previewSequence: 0,
        requestSequence: 0, caseSequence: 0, toastTimer: null, previousFocus: null, heroReady: false, pendingSale: null,
        battles: [], battle: null, battleRoundLimit: 100, battleSelected: new Map(), battleQuotes: new Map(), battleSequence: 0, battleBusy: false,
        battleCasePreview: null, battleCasePreviewSequence: 0, lastOpeningResults: [], lastOpeningDemo: false,
        battleAnimating: false, battlePlayback: null, battlePools: new Map(), battlePoll: null, battleCreateRequest: null, battleRequests: new Map(), battleSeen: new Set() };
    let battleCasePreviewFocus = null;
    const battlePresentation = window.MaySkinsBattlePresentation;
    const battleReel = Object.freeze({ winnerIndex: 2, steps: 28, itemCount: 33,
        minDuration: 7200, maxDuration: 9000, easing: [.16, .58, .12, 1] });
    const groups = { casual: 'Khởi đầu', theme: 'Chủ đề', gold: 'Dao & găng', rarity: 'Độ hiếm', weapon: 'Vũ khí' };
    const safeRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`may-skins:${key}`)) ?? fallback; } catch { return fallback; } };
    const safeWrite = (key, value) => { try { localStorage.setItem(`may-skins:${key}`, JSON.stringify(value)); } catch { /* Browsing remains usable without storage. */ } };
    const storedFavorites = safeRead('favorites', []);
    const favorites = new Set((Array.isArray(storedFavorites) ? storedFavorites : []).filter(id => typeof id === 'string'));
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const failedImages = { records: new Map(), has(url) { const until = this.records.get(url) ?? 0; if (until <= Date.now()) { this.records.delete(url); return false; } return true; }, add(url) { if (url) this.records.set(url, Date.now() + 30_000); } };
    function imageUrl(value) {
        if (typeof value !== 'string') return '';
        if (/^\/play\/art\/skins\/skin-(?:[a-f0-9]{12}|vanilla-weapon_[a-z0-9_]+)\/(?:base|wear-[0-4]|seed-\d{1,4})\.png$/.test(value)) return value;
        if (/^\/play\/art\/battle-[a-z0-9-]+\.png$/.test(value)) return value;
        if (/^\/play\/bot-avatars\/[a-z0-9-]+\.svg$/.test(value)) return value;
        try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; }
    }
    const image = (url, name, extra = '', fallback = '') => {
        const primary = imageUrl(url), backup = imageUrl(fallback);
        const src = primary && !failedImages.has(primary) ? primary : backup && !failedImages.has(backup) ? backup : '';
        const eager = extra.includes('data-eager');
        return `<span class="image-frame${src ? eager ? ' image-pending' : '' : ' image-failed'}"><span class="image-placeholder" aria-hidden="true"><span>◇</span><small>${escape(shortName(name))}</small><em>Hình ảnh chưa có sẵn</em></span>${src ? `<img src="${escape(src)}" alt="${escape(name)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${backup && backup !== src && !failedImages.has(backup) ? ` data-fallback="${escape(backup)}"` : ''} ${extra}>` : `<span class="sr-only">Hình ảnh ${escape(name)} chưa có sẵn</span>`}</span>`;
    };
    const minor = value => { try { return BigInt(value ?? 0); } catch { return 0n; } };
    function coins(value) {
        const amount = minor(value), positive = amount < 0n ? -amount : amount;
        const whole = (positive / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const decimals = positive % 100n;
        return `${amount < 0n ? '-' : ''}${whole}${decimals ? `.${decimals.toString().padStart(2, '0')}` : ''} xu`;
    }
    function formatChance(value) {
        const chance = Number(value);
        if (!Number.isFinite(chance) || chance < 0) return '—';
        return chance.toLocaleString('en-US', { minimumFractionDigits: chance < 1 ? 3 : 0, maximumFractionDigits: 8 });
    }
    function inputMinor(value) {
        const input = String(value ?? '').trim();
        if (/^0+[.,]\d{3}/.test(input)) return 0n;
        const match = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(input)
            ?? /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(input);
        return match ? BigInt(match[1].replace(/[.,]/g, '')) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')) : 0n;
    }
    const valueText = item => item?.valueFormatted ?? (item?.value != null ? coins(item.value) : 'Chưa có giá');
    const tierClass = item => item?.rarity === 'Contraband' ? 'contraband' : `t${Number.isInteger(item?.tier) && item.tier >= 0 && item.tier <= 4 ? item.tier : 0}`;
    function revealClasses(item, fee = 0) {
        const kind = window.MaySkinsAudio.revealKind(item, fee);
        return `${kind.major ? ' big-drop' : ''}${kind.spectacular || kind.tier === 4 || item?.rarity === 'Contraband' ? ' rare-drop' : ''}`;
    }
    const shortName = value => String(value ?? 'Skin').replace(/\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, '');
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let hiddenSince = document.hidden ? performance.now() : null, hiddenTime = 0;
    const animationStops = new Set();
    const visibleNow = () => (hiddenSince ?? performance.now()) - hiddenTime;
    document.addEventListener('visibilitychange', () => {
        const now = performance.now();
        if (document.hidden && hiddenSince == null) hiddenSince = now;
        else if (!document.hidden && hiddenSince != null) { hiddenTime += now - hiddenSince; hiddenSince = null; }
    });
    function runVisibleAnimation(duration, draw, { cancelled = () => false, onPause, onResume } = {}) {
        return new Promise((resolve, reject) => {
            const started = visibleNow();
            let frameId = null, done = false;
            const finish = error => {
                if (done) return;
                done = true; cancelAnimationFrame(frameId); clearInterval(cancelTimer);
                document.removeEventListener('visibilitychange', visibility); animationStops.delete(finish);
                if (error) reject(error); else resolve();
            };
            const frame = () => {
                if (done || cancelled()) return finish();
                if (document.hidden) return;
                const progress = duration <= 0 ? 1 : Math.min(1, Math.max(0, (visibleNow() - started) / duration));
                try { draw(progress); } catch (error) { finish(error); return; }
                if (progress >= 1) finish(); else frameId = requestAnimationFrame(frame);
            };
            const visibility = () => {
                cancelAnimationFrame(frameId);
                if (document.hidden) onPause?.();
                else { onResume?.(); frameId = requestAnimationFrame(frame); }
            };
            const cancelTimer = setInterval(() => { if (cancelled()) finish(); }, 250);
            animationStops.add(finish); document.addEventListener('visibilitychange', visibility);
            frameId = requestAnimationFrame(frame);
        });
    }
    const waitVisible = (duration, options) => runVisibleAnimation(duration, () => {}, options);
    const waitForVisible = (cancelled = () => false) => waitVisible(0, { cancelled });
    function spinProgress(progress, [x1, y1, x2, y2]) {
        if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
        const cubic = (a, b, t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
        let low = 0, high = 1;
        for (let index = 0; index < 18; index++) { const t = (low + high) / 2; if (cubic(x1, x2, t) < progress) low = t; else high = t; }
        return cubic(y1, y2, (low + high) / 2);
    }
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sound = window.MaySkinsAudio.create({ safeRead, safeWrite });
    const dateText = value => Number.isFinite(Number(value)) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(value))) : '';
    const userKey = () => `${state.me?.user?.guildId ?? ''}:${state.me?.user?.userId ?? ''}`;
    const uuid = () => crypto.randomUUID();
    function toast(message, error = false) {
        clearTimeout(state.toastTimer);
        $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
        state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 4500);
    }
    async function api(path, body) {
        const method = body === undefined ? 'GET' : 'POST';
        let response;
        try {
            response = await fetch(`/play/api${path}`, { method, credentials: 'same-origin', cache: 'no-store',
                headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        } catch { throw Object.assign(new Error('Kết nối chưa ổn định. Thử lại để kiểm tra cùng lượt, tránh mở thêm lần mới.'), { network: true }); }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401 && path !== '/login') signedOut();
            throw Object.assign(new Error(data.message ?? 'Chưa thể xử lý yêu cầu. Vui lòng thử lại.'), { status: response.status, data });
        }
        if (data.demo === true) {
            document.querySelector('.connection-strip > span:nth-child(2)').textContent = 'BẢN THỬ · Dữ liệu minh họa, không thay đổi kho thật';
        }
        if (data.csrfToken) state.csrf = data.csrfToken;
        return data;
    }
    function signedOut() {
        stopBattlePlayback();
        for (const stop of [...animationStops]) stop();
        state.requestSequence++; state.previewSequence++;
        state.battleSequence++; clearTimeout(state.battlePoll); state.battle = null; state.battles = []; state.battleRequests.clear(); state.battleCreateRequest = null;
        state.authenticated = false; state.csrf = ''; state.me = null;
        if ($('battle-case-preview-dialog').open) $('battle-case-preview-dialog').close();
        if ($('battle-create-dialog').open) $('battle-create-dialog').close();
        state.inventorySelected.clear(); state.upgradeSelected.clear(); state.preview = null; state.pendingSale = null;
        state.lastOpeningResults = []; state.lastOpeningDemo = false;
        updateAccount(); renderInventory(); renderUpgradeInputs(); renderHistory(); renderCollectionRail(); updateUpgradePlan();
        if (state.view === 'battles') renderBattles();
    }
    function updateAccount() {
        $('login-nav').hidden = state.authenticated; $('balance-box').hidden = !state.authenticated; $('profile-button').hidden = !state.authenticated;
        $('header-balance').textContent = state.me?.balanceFormatted ?? coins(state.me?.balance);
        $('profile-initial').textContent = (state.me?.user?.displayName ?? 'M').slice(0, 1).toUpperCase();
        $('profile-button').title = `${state.me?.user?.displayName ?? 'Tài khoản'} · Đăng xuất`;
        $('inventory-balance').textContent = state.me?.balanceFormatted ?? '—';
        updateOpenButton();
    }
    async function refreshMe(quiet = false) {
        if (!state.authenticated) return;
        const sequence = ++state.requestSequence;
        try {
            const result = await api('/me');
            if (sequence !== state.requestSequence || !state.authenticated) return;
            state.me = result;
            const owned = new Set((result.inventory ?? []).map(item => item.id));
            state.inventorySelected = new Set([...state.inventorySelected].filter(id => owned.has(id)));
            state.upgradeSelected = new Set([...state.upgradeSelected].filter(id => owned.has(id)));
            updateAccount(); renderInventory(); renderUpgradeInputs(); renderHistory(); renderPendingUpgrade(); renderCollectionRail();
        } catch (error) { if (!quiet) toast(error.message, true); }
    }
    function showLogin() {
        state.previousFocus = document.activeElement; $('login-error').textContent = '';
        if (!$('login-dialog').open) $('login-dialog').showModal();
        $('login-code').focus();
    }
    function showLinkedLogin(code) {
        if (!code) return;
        $('login-code').value = code; showLogin(); $('login-submit').focus();
    }
    function closeDialog(dialog) { dialog.close(); state.previousFocus?.focus?.(); }
    async function confirmAction(title, html, buttonText = 'Xác nhận') {
        $('confirm-title').textContent = title; $('confirm-content').innerHTML = html; $('confirm-ok').textContent = buttonText;
        state.previousFocus = document.activeElement;
        return new Promise(resolve => {
            const dialog = $('confirm-dialog');
            const done = answer => { dialog.removeEventListener('cancel', cancel); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; closeDialog(dialog); resolve(answer); };
            const cancel = event => { event.preventDefault(); done(false); };
            $('confirm-ok').onclick = () => done(true); $('confirm-cancel').onclick = () => done(false); dialog.addEventListener('cancel', cancel); dialog.showModal();
        });
    }
    function setView(view, { scroll = true } = {}) {
        if (state.opening || state.upgradeBusy || state.battleBusy || state.battleAnimating) { toast('Chờ lượt đang quay hoàn tất để chuyển trang.'); return false; }
        if (!['cases', 'case', 'inventory', 'upgrade', 'history', 'battles'].includes(view)) view = 'cases';
        clearTimeout(state.battlePoll);
        state.view = view; document.body.dataset.view = view;
        if (view !== 'case') state.caseSequence++;
        document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
        document.querySelectorAll('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.view === (view === 'case' ? 'cases' : view)));
        document.title = `${({ cases: 'Mở hòm', case: state.detail?.case?.name ?? 'Mở hòm', inventory: 'Kho đồ', upgrade: 'Upgrade', history: 'Lịch sử', battles: 'Case Battle' })[view]} · Happy house Scam Club`;
        if (scroll) window.scrollTo({ top: 0, behavior: reduced() ? 'instant' : 'smooth' });
        if (['inventory', 'history', 'upgrade'].includes(view)) void refreshMe(true);
        if (view === 'upgrade') { renderUpgradeInputs(); if (state.authenticated) void loadTargets(); else $('target-grid').innerHTML = '<p class="subtle-note">Đăng nhập để xem mục tiêu Upgrade và tỷ lệ theo giá hiện tại.</p>'; }
        if (view === 'battles') { renderBattles(); void loadBattles(); }
        if (view !== 'case') history.replaceState(null, '', `#${view}`);
        return true;
    }
    function renderCatalogue() {
        let items = state.catalogue.filter(item => state.group === 'all' || (state.group === 'favorites' ? favorites.has(item.id) : item.group === state.group));
        const query = $('case-search').value.trim().toLocaleLowerCase('vi');
        if (query) items = items.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase('vi').includes(query));
        const minimum = inputMinor($('case-min-price')?.value), maximumText = $('case-max-price')?.value.trim() ?? '';
        const maximum = inputMinor(maximumText), risk = $('case-risk-filter')?.value ?? 'all';
        if (minimum > 0n) items = items.filter(item => item.available && minor(item.fee) >= minimum);
        if (maximumText && maximum > 0n) items = items.filter(item => item.available && minor(item.fee) <= maximum);
        if (risk !== 'all') {
            const labels = { low: 'thấp', medium: 'vừa', high: 'cao', crazy: 'rất cao' };
            const wanted = labels[risk] ?? risk;
            items = items.filter(item => (item.riskLabel ?? '').toLocaleLowerCase('vi').includes(wanted));
        }
        const filtered = minimum > 0n || maximumText !== '' || risk !== 'all';
        if ($('reset-case-filters')) $('reset-case-filters').disabled = !filtered && !query && state.group === 'all';
        const sort = $('case-sort').value;
        if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        if (sort === 'low' || sort === 'high') items.sort((a, b) => {
            if (a.available !== b.available) return a.available ? -1 : 1;
            const delta = minor(a.fee) - minor(b.fee); return (delta < 0n ? -1 : delta > 0n ? 1 : 0) * (sort === 'low' ? 1 : -1);
        });
        $('case-count').textContent = `${items.length} / ${state.catalogue.length} hòm`;
        const card = item => `<article class="case-card"><button class="favorite-button ${favorites.has(item.id) ? 'saved' : ''}" data-favorite="${escape(item.id)}" aria-label="${favorites.has(item.id) ? 'Bỏ yêu thích' : 'Yêu thích'} ${escape(item.name)}" aria-pressed="${favorites.has(item.id)}">${favorites.has(item.id) ? '♥' : '♡'}</button>${!item.available ? '<span class="case-unavailable">CHỜ GIÁ</span>' : ''}<button class="case-card-main" data-case="${escape(item.id)}" aria-label="Xem hòm ${escape(item.name)}">${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}<h3>${escape(item.name)}</h3><span class="case-price">${escape(item.feeFormatted ?? (item.available ? coins(item.fee) : 'Đang chờ giá'))}</span></button></article>`;
        if (state.group === 'all' && !query && !filtered && sort === 'featured') {
            const categories = [...new Set(items.map(item => item.group))];
            $('cases-grid').innerHTML = categories.map((group, index) => `<section class="catalogue-group"><button class="category-heading" data-collapse-group="${escape(group)}" aria-expanded="true"><span class="category-number">${String(index + 1).padStart(2, '0')}</span><h3>${escape(groups[group] ?? group)}</h3><small>${items.filter(item => item.group === group).length} HÒM</small><span class="category-chevron">⌃</span></button><div class="category-cases">${items.filter(item => item.group === group).map(card).join('')}</div></section>`).join('');
        } else $('cases-grid').innerHTML = items.map(card).join('');
        $('catalogue-empty').hidden = items.length > 0;
    }
    async function loadCatalogue() {
        $('cases-grid').innerHTML = Array.from({ length: 10 }, () => '<div class="skeleton"></div>').join('');
        try {
            const result = await api('/catalogue'); state.catalogue = result.cases ?? [];
            const availableGroups = [...new Set(state.catalogue.map(item => item.group))];
            $('case-groups').innerHTML = '<button data-group="all" class="active">Tất cả hòm</button>' + availableGroups.map(group => `<button data-group="${escape(group)}">${escape(groups[group] ?? group)}</button>`).join('') + '<button data-group="favorites">♡ Yêu thích</button>';
            renderCatalogue();
            const featuredItems = [...state.catalogue].filter(item => /howl|dragon|fade|doppler|lore|legend/i.test(item.name)).slice(0, 10);
            const railItems = featuredItems.length ? featuredItems : state.catalogue.slice(0, 10);
            $('featured-rail').innerHTML = railItems.map(item => `<button class="featured-item" data-case="${escape(item.id)}">${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}<span><strong>${escape(item.name)}</strong><small>${escape(item.feeFormatted ?? 'Xem hòm →')}</small></span></button>`).join('');
            const featured = state.catalogue.find(item => item.id === 'battle-howl' && item.available) ?? state.catalogue.find(item => item.available);
            if (featured) {
                $('hero-skin').dataset.fallback = imageUrl(featured.image);
                $('hero-skin').src = imageUrl(featured.image); $('hero-skin').alt = featured.name; $('hero-skin').hidden = false;
                const detail = await api(`/cases/${encodeURIComponent(featured.id)}`).catch(() => null);
                const skin = detail?.entries?.find(item => /howl/i.test(item.name)) ?? detail?.entries?.at(-1);
                if (skin && imageUrl(skin.image)) { $('hero-skin').src = imageUrl(skin.image); $('hero-skin').alt = skin.name; $('hero-skin').hidden = false; $('hero-art-name').textContent = shortName(skin.name); }
            }
        } catch (error) { $('cases-grid').innerHTML = `<div class="empty-state"><h3>Chưa tải được danh mục</h3><p>${escape(error.message)}</p><button class="button button-purple" id="retry-catalogue">Thử lại</button></div>`; }
    }
    function skinInfo(item) {
        const facts = [];
        if (Number.isFinite(item.float) && item.float >= 0 && item.float <= 1) facts.push(`Float ${item.float.toFixed(6)}`);
        if (Number.isInteger(item.paintSeed) && item.paintSeed >= 0 && item.paintSeed <= 1000) facts.push(`Pattern #${item.paintSeed}`);
        return facts;
    }
    function skinInfoText(item, detailed = true) {
        return [item.name, item.wear, item.rarity, item.phase, item.priceVariant === 'blue-gem' ? 'Blue Gem' : '', ...(detailed ? skinInfo(item) : []), valueText(item)].filter(Boolean).join(' · ');
    }
    function skinDetails(item) {
        const tags = [{ text: item.rarity }, ...(item.statTrak ? [{ text: 'StatTrak™', kind: 'is-stattrak' }] : []),
            ...(item.phase ? [{ text: item.phase }] : []), ...(item.priceVariant === 'blue-gem' ? [{ text: 'Blue Gem', kind: 'is-blue-gem' }] : [])];
        const facts = skinInfo(item);
        return `<span class="skin-tags">${tags.filter(tag => tag.text).map(tag => `<span class="skin-tag ${tag.kind ?? ''}">${escape(tag.text)}</span>`).join('')}</span>` +
            (facts.length ? `<span class="skin-facts">${facts.map(fact => `<span>${escape(fact)}</span>`).join('')}</span>` : '');
    }
    function itemCard(item, { selected = false, selectable = false, chance = false, featured = false, idAttribute = 'item-id', mini = false } = {}) {
        const tag = selectable ? 'button' : 'article';
        return `<${tag} class="item-card ${tierClass(item)} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}${featured ? ' featured-drop-card' : ''}" title="${escape(skinInfoText(item, !chance))}" ${selectable ? `data-${idAttribute}="${escape(item.id)}" aria-pressed="${selected}" aria-label="Chọn ${escape(skinInfoText(item))}"` : ''}>${item.locked ? '<span class="item-lock" aria-label="Đang khóa">🔒</span>' : ''}${featured ? '<span class="item-featured">HIẾM NHẤT</span>' : ''}${chance ? `<span class="item-chance" aria-label="Cơ hội ${escape(formatChance(item.chance))} phần trăm"><small>CƠ HỘI</small><strong>${escape(formatChance(item.chance))}%</strong></span>` : ''}${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}<strong class="item-name">${escape(shortName(item.name))}</strong><span class="item-wear">${escape(item.wear ?? item.rarity ?? 'Skin CS2')}${!mini && item.statTrak && !item.name?.includes('StatTrak') ? ' · StatTrak™' : ''}</span>${!mini && !chance ? skinDetails(item) : ''}<span class="item-value">${escape(valueText(item))}</span></${tag}>`;
    }
    function exclusiveTriggerArt() {
        return '<span class="exclusive-trigger-art" aria-hidden="true"><span>✦</span></span>';
    }
    function exclusiveDropInfo(exclusive) {
        if (!exclusive?.available || !exclusive.items?.length) return '';
        const items = [...exclusive.items].sort((a, b) => Number(a.chance ?? 0) - Number(b.chance ?? 0));
        return `<section class="exclusive-drop-info exclusive-pool-section"><div class="exclusive-pool-heading">${exclusiveTriggerArt()}<div><span class="eyebrow">VÒNG QUAY ĐẶC BIỆT</span><h3>Exclusive Drop <span>${escape(formatChance(exclusive.chance))}%</span></h3><p>Trúng ô Exclusive Drop sẽ mở vòng quay thứ hai chỉ gồm các skin dưới đây. Mỗi hòm nhận một skin cuối cùng; giá hòm và tỷ lệ cuối cùng của từng món giữ nguyên.</p></div></div><p class="exclusive-odds-note">Tỷ lệ trên thẻ là cơ hội trong vòng đặc biệt. “Từ lượt mở hòm” là tỷ lệ nhận món đó tính từ đầu lượt.</p><div class="items-grid exclusive-items-grid exclusive-pool-grid">${items.map(item => `<div class="exclusive-item-odds">${itemCard(item, { chance: true })}<span class="exclusive-odds-overall">Trong vòng đặc biệt: <strong>${escape(formatChance(item.chance))}%</strong><br>Từ lượt mở hòm: <strong>${escape(formatChance(item.overallChance))}%</strong></span></div>`).join('')}</div></section>`;
    }
    function renderCaseOdds(detail) {
        const entries = [...(detail.entries ?? [])].sort((left, right) => {
            const chanceOrder = Number(left.chance ?? 0) - Number(right.chance ?? 0);
            if (chanceOrder) return chanceOrder;
            const leftValue = minor(left.value), rightValue = minor(right.value);
            return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
        });
        const featured = entries.slice(0, 3), remaining = entries.slice(3);
        $('featured-drops-grid').innerHTML = featured.map(item => itemCard(item, { chance: true, featured: true })).join('');
        $('featured-drop-section').hidden = !featured.length;
        $('odds-grid').innerHTML = remaining.map(item => itemCard(item, { chance: true })).join('');
        $('odds-rest-section').hidden = !remaining.length;
        const oddsTotal = entries.reduce((sum, item) => sum + Number(item.chance ?? 0), 0);
        $('odds-total').textContent = `${entries.length} phần thưởng · Tổng tỷ lệ cuối cùng ${formatChance(oddsTotal)}%`;
        const exclusiveContent = $('case-exclusive-content');
        if (exclusiveContent) {
            exclusiveContent.innerHTML = exclusiveDropInfo(detail.exclusive);
            exclusiveContent.hidden = !exclusiveContent.innerHTML;
        }
    }
    function openingExclusiveEnabled() {
        return Boolean(state.detail?.exclusive?.available && $('exclusive-opening')?.checked);
    }
    async function selectCase(id) {
        if (state.opening || state.upgradeBusy || state.battleBusy || state.battleAnimating) return;
        const sequence = ++state.caseSequence;
        $('opening-results').hidden = true; state.lastOpeningResults = [];
        document.querySelector('.reel-stage')?.classList.remove('is-demo', 'is-spinning', 'is-revealed');
        state.detail = null;
        if ($('case-exclusive-content')) { $('case-exclusive-content').replaceChildren(); $('case-exclusive-content').hidden = true; }
        $('case-title').textContent = state.catalogue.find(item => item.id === id)?.name ?? 'Đang tải hòm…';
        $('case-description').textContent = ''; $('featured-drops-grid').innerHTML = ''; $('odds-grid').innerHTML = ''; $('odds-total').textContent = ''; $('featured-drop-section').hidden = true; $('odds-rest-section').hidden = true; $('case-fee').textContent = ''; $('reel-track').innerHTML = '';
        setView('case'); $('open-button').disabled = true;
        history.replaceState(null, '', `#case/${encodeURIComponent(id)}`);
        try {
            const result = await api(`/cases/${encodeURIComponent(id)}`);
            if (sequence !== state.caseSequence || state.view !== 'case' || location.hash !== `#case/${encodeURIComponent(id)}`) return;
            state.detail = result;
            $('case-title').textContent = result.case.name;
            document.title = `${result.case.name} · Happy house Scam Club`;
            $('case-description').textContent = result.case.description;
            $('case-fee').textContent = `${result.case.feeFormatted ?? coins(result.fee)} / hòm`;
            renderCaseOdds(result);
            updateOpenButton(); renderIdleReel();
            $('opening-notice').textContent = result.case.available ? 'Kết quả được lưu vào kho trước khi vòng quay kết thúc.' : 'Hòm này đang thiếu giá. Hãy chọn hòm khác hoặc chờ đồng bộ.';
        } catch (error) { $('case-description').textContent = error.message; toast(error.message, true); }
    }
    function renderIdleReel() {
        const detail = state.detail;
        const exclusive = openingExclusiveEnabled();
        const entries = exclusive ? [...(detail?.entries ?? []).filter(item => !item.exclusiveEligible), detail.exclusive.trigger].filter(Boolean) : detail?.entries ?? [];
        const sample = entries.filter((item, index) => index % Math.max(1, Math.floor(entries.length / 11)) === 0).slice(0, 11);
        const repeated = sample.length ? Array.from({ length: 14 }, (_, index) => sample[index % sample.length]) : [];
        $('reels-container').classList.toggle('multi-reels', state.count > 1);
        $('reels-container').style.setProperty('--reels', Math.min(state.count, 5));
        $('reels-container').innerHTML = Array.from({ length: state.count }, (_, index) => reelMarkup(index, state.count, repeated.map(reelCard).join(''))).join('');
        document.querySelectorAll('#reels-container .reel-track').forEach(track => { track.style.transition = 'none'; track.style.transform = 'translateX(-70px)'; });
        if (state.count === 1 && state.detail?.case) {
            const item = state.detail.case;
            $('reel-window').classList.add('idle-case-window');
            $('reel-window').insertAdjacentHTML('beforeend', `<div class="idle-case-art">${image(item.image ?? state.catalogue.find(entry => entry.id === item.id)?.image, item.name, '', item.imageFallback ?? item.fallbackImage)}<span>${escape(item.name)}</span></div>`);
        }
        $('reel-status').textContent = 'Sẵn sàng'; $('reel-label').textContent = 'MÓN SKIN TIẾP THEO CỦA BẠN';
    }
    function reelMarkup(index, total, cards) { return `<div class="reel-window"${index === 0 ? ' id="reel-window"' : ''} aria-label="Vòng quay hòm ${index + 1} trên ${total}"><div class="reel-center-line"></div><span class="reel-marker marker-top"></span><span class="reel-marker marker-bottom"></span>${total > 1 ? `<span class="reel-number">${String(index + 1).padStart(2, '0')}</span>` : ''}<div class="reel-track"${index === 0 ? ' id="reel-track"' : ''}>${cards}</div><div class="reel-shade shade-left"></div><div class="reel-shade shade-right"></div></div>`; }
    function reelCard(item) {
        if (item.isExclusiveTrigger) return `<div class="reel-card t4 exclusive-reel-trigger exclusive-trigger-card" title="Exclusive Drop · Vòng quay tiếp theo chỉ có skin hiếm">${exclusiveTriggerArt()}<strong>EXCLUSIVE DROP</strong><small>Vòng quay skin hiếm</small></div>`;
        return `<div class="reel-card ${tierClass(item)}" title="${escape(skinInfoText(item))}">${image(item.image, item.name, 'data-eager', item.imageFallback ?? item.fallbackImage)}<strong>${escape(shortName(item.name))}</strong><small>${escape(item.wear ?? item.rarity ?? 'CS2')}</small></div>`;
    }
    async function prepareReelImages(container) {
        const images = [...container.querySelectorAll('img')];
        await Promise.race([Promise.allSettled(images.map(async img => {
            try { if (typeof img.decode === 'function') await img.decode(); else if (!img.complete) await new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); }); }
            catch { /* A failed image uses its visible skin label instead. */ }
            if (img.complete && img.naturalWidth > 0) img.closest('.image-frame')?.classList.remove('image-pending');
        })), wait(2200)]);
    }
    function openStorageKey() { return `open:${userKey()}:${state.detail?.case?.id ?? ''}`; }
    function pendingOpening() {
        const pending = state.authenticated ? safeRead(openStorageKey(), null) : null;
        return pending && /^[a-f0-9-]{36}$/i.test(pending.requestId ?? '') && pending.caseId === state.detail?.case?.id
            && [1, 3, 5, 10].includes(pending.count) ? pending : null;
    }
    function updateOpenButton() {
        const pending = pendingOpening();
        if (pending) state.count = pending.count;
        $('open-total').textContent = state.detail ? coins(minor(state.detail.fee ?? state.detail.case?.fee) * BigInt(state.count)) : '';
        $('open-button').disabled = state.opening || (!pending && !state.detail?.case?.available);
        if ($('demo-opening')) $('demo-opening').disabled = state.opening || !state.detail?.entries?.length;
        const text = state.opening ? 'Đang mở…' : !state.authenticated ? 'Đăng nhập để mở' : pending ? 'Kiểm tra lượt trước' : `Mở ${state.count > 1 ? `${state.count} hòm` : 'hòm'}`;
        $('open-button').firstChild.textContent = `${text} `;
        document.querySelectorAll('[data-count]').forEach(button => { button.disabled = state.opening || Boolean(pending); button.classList.toggle('active', Number(button.dataset.count) === state.count); });
        const exclusiveToggle = $('exclusive-opening');
        if (exclusiveToggle) {
            exclusiveToggle.disabled = state.opening || Boolean(pending) || !state.detail?.exclusive?.available;
            exclusiveToggle.checked = pending ? pending.exclusiveDrop !== false : safeRead('exclusive-opening', true) !== false;
            exclusiveToggle.closest('label')?.classList.toggle('unavailable', !state.detail?.exclusive?.available);
        }
    }
    function openingReelCards(pool, result, winningIndex = 32) {
        const available = pool.length ? pool : [result];
        const cards = Array.from({ length: winningIndex + 6 }, () => available[Math.floor(Math.random() * available.length)]);
        cards[winningIndex] = result;
        return cards.map(reelCard).join('');
    }
    async function spinOpeningReels(windows, duration, { stagger = 60, winningIndex = 32, cancelled = () => false } = {}) {
        const easing = [.16, .58, .12, 1];
        await waitForVisible(cancelled);
        if (cancelled()) return;
        const lanes = windows.map((windowElement, index) => {
            const track = windowElement.querySelector('.reel-track'), card = track.firstElementChild;
            const width = card.getBoundingClientRect().width, gap = parseFloat(getComputedStyle(track).gap) || 0;
            const start = windowElement.clientWidth / 2 - width / 2;
            track.style.transition = 'none'; track.style.transform = `translateX(${start}px)`;
            return { track, start, distance: winningIndex * (width + gap), duration: duration ? duration + index * stagger : 0 };
        });
        const totalDuration = Math.max(0, ...lanes.map(lane => lane.duration));
        let progress = 0, stopSound = null;
        const playSound = () => {
            stopSound?.();
            if (!cancelled() && duration > 0 && progress < 1) stopSound = sound.spin(duration, {
                elapsed: duration * progress, steps: winningIndex, easing });
        };
        playSound();
        try {
            await runVisibleAnimation(totalDuration, value => {
                const elapsed = value * totalDuration;
                progress = duration ? Math.min(1, elapsed / duration) : 1;
                for (const lane of lanes) {
                    const laneProgress = lane.duration ? Math.min(1, elapsed / lane.duration) : 1;
                    lane.track.style.transform = `translateX(${lane.start - lane.distance * spinProgress(laneProgress, easing)}px)`;
                }
            }, { cancelled, onPause: () => { stopSound?.(); stopSound = null; }, onResume: playSound });
        } finally { stopSound?.(); }
        await waitForVisible(cancelled);
        if (cancelled()) return;
        for (const lane of lanes) lane.track.children[winningIndex]?.classList.add('reel-winner');
    }
    async function animateOpening(results, entries, exclusive = state.detail?.exclusive, enabled = true, { demo = false } = {}) {
        const owner = userKey(), caseId = state.detail?.case?.id;
        const cancelled = () => state.detail?.case?.id !== caseId || state.view !== 'case' || (!demo && (!state.authenticated || owner !== userKey()));
        if (cancelled()) return;
        const stage = document.querySelector('.reel-stage');
        stage?.classList.remove('is-revealed'); stage?.classList.add('is-spinning'); stage?.classList.toggle('is-demo', demo);
        const triggered = results.map((result, index) => result.exclusiveDrop ? index : -1).filter(index => index >= 0);
        const useExclusive = triggered.length > 0 || enabled && exclusive?.available;
        const trigger = exclusive?.trigger ?? { id: 'exclusive-drop', name: 'Exclusive Drop', tier: 4, rarity: 'Exclusive Drop', isExclusiveTrigger: true };
        const all = entries?.length ? entries : results;
        const firstEntries = useExclusive ? all.filter(item => !item.exclusiveEligible && !item.exclusiveDrop) : all;
        const sampled = firstEntries.filter((item, index) => index % Math.max(1, Math.floor(firstEntries.length / 12)) === 0).slice(0, 12);
        const firstResults = results.map(result => result.exclusiveDrop ? trigger : result);
        const pool = [...sampled, ...firstResults, ...(useExclusive ? [trigger] : [])];
        $('reels-container').classList.toggle('multi-reels', results.length > 1);
        $('reels-container').style.setProperty('--reels', Math.min(results.length, 5));
        $('reels-container').innerHTML = firstResults.map((result, index) => reelMarkup(index, results.length, openingReelCards(pool, result))).join('');
        $('reel-status').textContent = 'Đang chuẩn bị hình ảnh';
        await prepareReelImages($('reels-container'));
        await waitForVisible(cancelled);
        if (cancelled()) return;
        $('reel-status').textContent = 'Đang quay'; $('reel-label').textContent = `MỞ ${results.length} HÒM · ${results.length} VÒNG QUAY`;
        const duration = reduced() ? 0 : $('fast-opening').checked ? 950 : 6800;
        const windows = [...document.querySelectorAll('#reels-container .reel-window')];
        await spinOpeningReels(windows, duration, { cancelled });
        if (cancelled()) return;
        if (triggered.length) {
            sound.reveal(trigger, { caseFee: state.detail?.fee ?? state.detail?.case?.fee });
            $('reel-status').textContent = '✦ Đã kích hoạt Exclusive Drop';
            $('reel-label').textContent = `${triggered.length} VÒNG QUAY ĐẶC BIỆT · CHỈ CÓ SKIN HIẾM`;
            await waitVisible(reduced() ? 0 : 1100, { cancelled });
            if (cancelled()) return;
            const rarePool = exclusive?.items?.length ? exclusive.items : results.filter(item => item.exclusiveDrop);
            const rareWindows = triggered.map(index => {
                const windowElement = windows[index], track = windowElement.querySelector('.reel-track');
                windowElement.classList.add('exclusive-opening-lane', 'is-exclusive-spin');
                track.style.transition = 'none'; track.style.transform = 'translateX(0)';
                track.innerHTML = openingReelCards(rarePool, results[index]);
                return windowElement;
            });
            await Promise.all(rareWindows.map(windowElement => prepareReelImages(windowElement)));
            await waitForVisible(cancelled);
            if (cancelled()) return;
            $('reel-status').textContent = 'Đang quay Exclusive Drop';
            await spinOpeningReels(rareWindows, reduced() ? 0 : 7800, { stagger: 0, cancelled });
            if (cancelled()) return;
            rareWindows.forEach(windowElement => windowElement.classList.remove('is-exclusive-spin'));
        }
        const revealItem = window.MaySkinsAudio.highestValueItem(results);
        const caseFee = state.detail?.fee ?? state.detail?.case?.fee;
        sound.reveal(revealItem, { caseFee });
        windows.forEach((element, index) => {
            const item = results[index], winner = element.querySelector('.reel-winner');
            if (winner) for (const name of revealClasses(item, caseFee).trim().split(/\s+/).filter(Boolean)) winner.classList.add(name);
        });
        stage?.classList.remove('is-spinning'); stage?.classList.add('is-revealed');
        await waitVisible(reduced() ? 0 : 1100, { cancelled });
        if (cancelled()) return;
        sound.result(true);
        $('reel-status').textContent = demo ? 'Xem thử hoàn tất' : 'Đã vào kho';
    }
    async function openCases() {
        void sound.unlock();
        if (!state.authenticated) return showLogin();
        if (state.opening || (!pendingOpening() && !state.detail?.case?.available)) return;
        const owner = userKey();
        const storageKey = openStorageKey();
        let body = pendingOpening();
        if (!body) {
            body = { requestId: uuid(), caseId: state.detail.case.id, count: state.count, quoteId: state.detail.quoteId,
                exclusiveDrop: openingExclusiveEnabled() };
            safeWrite(storageKey, body);
        }
        state.opening = true; updateOpenButton(); $('opening-results').hidden = true; $('opening-notice').textContent = 'Đang xác nhận lượt mở…';
        try {
            const result = await api('/open', body);
            if (!state.authenticated || owner !== userKey() || state.detail?.case?.id !== body.caseId) return;
            safeWrite(storageKey, null);
            const results = result.results ?? [];
            if (!results.length) throw new Error('Chưa nhận được danh sách skin. Mở kho để kiểm tra kết quả đã lưu.');
            try { await animateOpening(results, state.detail.entries, result.exclusive ?? state.detail.exclusive, body.exclusiveDrop !== false); }
            catch { $('reel-status').textContent = 'Đã vào kho'; }
            if (!state.authenticated || owner !== userKey() || state.detail?.case?.id !== body.caseId) return;
            renderOpeningResults(results);
            $('opening-notice').textContent = `${result.replayed ? 'Đã khôi phục lượt mở trước. ' : ''}Đã nhận ${results.length} skin vào kho. ${result.total ? `Chi phí ${coins(result.total)}.` : ''}`;
            toast(`Đã nhận ${results.length} skin vào kho Discord.`);
            if (state.me) { state.me.balance = result.balance; state.me.balanceFormatted = result.balanceFormatted ?? coins(result.balance); updateAccount(); }
            await refreshMe(true);
        } catch (error) {
            if (error.status && error.status < 500) safeWrite(storageKey, null);
            $('reel-status').textContent = 'Chưa hoàn tất'; $('opening-notice').textContent = error.message; toast(error.message, true);
            if (error.status === 409 && state.detail) {
                const detail = await api(`/cases/${encodeURIComponent(state.detail.case.id)}`).catch(() => null);
                if (detail) {
                    state.detail = detail; renderCaseOdds(detail);
                    $('case-fee').textContent = `${detail.case.feeFormatted ?? coins(detail.fee)} / hòm`;
                }
            }
        } finally { state.opening = false; document.querySelector('.reel-stage')?.classList.remove('is-spinning'); updateOpenButton(); }
    }
    function renderOpeningResults(results, demo = false) {
        state.lastOpeningResults = results; state.lastOpeningDemo = demo;
        $('results-grid').innerHTML = results.map(item => itemCard(item)).join('');
        $('opening-results').hidden = false;
        const title = $('opening-results').querySelector('h2');
        if (title) title.textContent = demo ? 'Kết quả xem thử · Không thêm vào kho' : 'Skin vừa nhận ✦';
        let actions = $('opening-result-actions');
        if (!actions) { actions = document.createElement('div'); actions.id = 'opening-result-actions'; actions.className = 'opening-result-actions'; $('opening-results').append(actions); }
        const total = results.reduce((sum, item) => sum + minor(item.value), 0n);
        actions.innerHTML = `<span>${demo ? 'Giá trị minh họa' : 'Tổng giá trị'} <strong>${escape(coins(total))}</strong></span><button class="button button-purple" data-opening-reopen>${demo ? 'Xem thử lần nữa' : 'Mở tiếp'}</button>${demo ? '<button class="button button-outline" data-login>Đăng nhập để mở hòm</button>' : '<button class="button button-outline" data-opening-upgrade>Upgrade skin vừa nhận ↗</button><button class="button button-lime" data-opening-sell>Bán skin vừa nhận</button>'}`;
    }
    async function demoOpening() {
        if (state.opening || state.upgradeBusy || state.battleAnimating || !state.detail?.entries?.length) return;
        void sound.unlock(); state.opening = true; updateOpenButton(); $('opening-results').hidden = true;
        $('opening-notice').textContent = 'ĐANG XEM THỬ · Không trừ xu, không thêm skin vào kho. Kết quả minh họa được chọn trên trình duyệt.';
        const entries = state.detail.entries, enabled = openingExclusiveEnabled();
        const total = entries.reduce((sum, item) => sum + Math.max(0, Number(item.chance) || 0), 0);
        const results = Array.from({ length: state.count }, () => {
            let ticket = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * total;
            const selected = entries.find(item => (ticket -= Math.max(0, Number(item.chance) || 0)) < 0) ?? entries.at(-1);
            return { ...selected, id: `demo-${uuid()}`, exclusiveDrop: enabled && selected.exclusiveEligible === true };
        });
        try {
            await animateOpening(results, entries, state.detail.exclusive, enabled, { demo: true });
            renderOpeningResults(results, true);
            $('opening-notice').textContent = 'Xem thử hoàn tất · Đây là hoạt ảnh minh họa. Số dư và kho Discord không thay đổi.';
        } catch { $('reel-status').textContent = 'Xem thử chưa hoàn tất'; toast('Không phát được hoạt ảnh xem thử. Hãy thử lại.', true); }
        finally { state.opening = false; document.querySelector('.reel-stage')?.classList.remove('is-spinning'); updateOpenButton(); }
    }
    function renderCollectionRail() {
        const rail = $('collection-rail'); if (!rail) return;
        const items = (state.me?.inventory ?? []).slice(0, 12);
        rail.innerHTML = items.length ? items.map(item => `<button class="collection-drop ${tierClass(item)}" data-view="inventory" title="${escape(skinInfoText(item))}">${image(item.image, item.name)}<span><strong>${escape(shortName(item.name))}</strong><small>${escape(valueText(item))}</small></span></button>`).join('') : '<div class="collection-rail-empty"><strong>Kho skin Discord của bạn</strong><span>Đăng nhập để xem những món vừa nhận</span><button class="text-button" data-login>Kết nối tài khoản ↗</button></div>';
    }
    function renderInventory() {
        $('inventory-auth').hidden = state.authenticated; $('inventory-content').hidden = !state.authenticated;
        const all = state.me?.inventory ?? [];
        $('inventory-count').textContent = state.authenticated ? String(state.me?.inventoryTotal ?? all.length) : '—';
        $('inventory-value').textContent = state.authenticated ? coins(all.reduce((total, item) => total + minor(item.value), 0n)) : '—';
        $('inventory-balance').textContent = state.me?.balanceFormatted ?? '—';
        const query = $('inventory-search').value.trim().toLocaleLowerCase('vi');
        const items = all.filter(item => item.name.toLocaleLowerCase('vi').includes(query));
        const sort = $('inventory-sort').value;
        if (sort === 'high' || sort === 'low') items.sort((a, b) => { const delta = minor(a.value) - minor(b.value); return (delta < 0n ? -1 : delta > 0n ? 1 : 0) * (sort === 'low' ? 1 : -1); });
        $('inventory-grid').innerHTML = items.map(item => itemCard(item, { selectable: true, selected: state.inventorySelected.has(item.id) })).join('');
        $('inventory-empty').hidden = all.length > 0;
        $('selected-count').textContent = `${state.inventorySelected.size} đã chọn`;
        $('inventory-limit').textContent = state.me?.inventoryTotal > all.length ? `Đang hiển thị ${all.length} món mới nhất trong ${state.me.inventoryTotal} skin. Xem toàn bộ kho bằng /hom trong Discord.` : '';
        ['inventory-sell', 'inventory-lock', 'inventory-unlock', 'inventory-upgrade'].forEach(id => { $(id).disabled = !state.inventorySelected.size; });
    }
    async function setLocks(locked) {
        const itemIds = [...state.inventorySelected];
        if (!itemIds.length) return;
        const button = $(locked ? 'inventory-lock' : 'inventory-unlock'); button.disabled = true;
        try { await api('/locks', { itemIds, locked }); toast(`Đã ${locked ? 'khóa' : 'mở khóa'} ${itemIds.length} món.`); state.inventorySelected.clear(); await refreshMe(); } catch (error) { toast(error.message, true); } finally { renderInventory(); }
    }
    async function sellSelected() {
        if (!state.inventorySelected.size) return;
        $('inventory-sell').disabled = true;
        try {
            const ids = [...state.inventorySelected].sort();
            let pending = state.pendingSale;
            if (!pending || JSON.stringify(pending.itemIds) !== JSON.stringify(ids)) {
                const quote = await api('/sell/quote', { itemIds: ids });
                if (!await confirmAction('Bán skin lấy xu?', `<p>Bán ${ids.length} skin đã chọn theo giá vừa được xác nhận. Các món sẽ rời kho Discord của bạn.</p><div class="confirm-total"><span>Xu nhận được</span><strong>${escape(quote.totalFormatted ?? coins(quote.total))}</strong></div>`, 'Bán skin')) return;
                pending = { requestId: uuid(), itemIds: ids, quoteId: quote.quoteId }; state.pendingSale = pending;
            }
            const result = await api('/sell', pending);
            state.pendingSale = null; state.inventorySelected.clear(); toast(result.message ?? `Đã bán skin, nhận ${result.totalFormatted ?? coins(result.total)}.`); await refreshMe();
        } catch (error) { if (error.status && error.status < 500) state.pendingSale = null; toast(error.message, true); } finally { renderInventory(); }
    }
    function selectedUpgradeItems() { return (state.me?.inventory ?? []).filter(item => state.upgradeSelected.has(item.id)); }
    function upgradeInputValue() { return selectedUpgradeItems().reduce((sum, item) => sum + minor(item.value), inputMinor($('upgrade-stake').value)); }
    function renderUpgradeInputs() {
        const query = $('upgrade-inventory-search').value.trim().toLocaleLowerCase('vi');
        const eligible = (state.me?.inventory ?? []).filter(item => !item.locked && item.upgradeEligible && item.value != null);
        const eligibleIds = new Set(eligible.map(item => item.id));
        state.upgradeSelected = new Set([...state.upgradeSelected].filter(id => eligibleIds.has(id)));
        $('upgrade-inventory-grid').innerHTML = eligible.filter(item => item.name.toLocaleLowerCase('vi').includes(query)).map(item => itemCard(item, { selectable: true, selected: state.upgradeSelected.has(item.id), idAttribute: 'upgrade-item', mini: true })).join('');
        $('upgrade-inventory-notice').textContent = !state.authenticated ? 'Đăng nhập để chọn skin trong kho, hoặc dùng xu sau khi đăng nhập.' : !eligible.length ? 'Chưa có skin mở khóa với giá còn hạn. Bạn có thể dùng xu hoặc mở thêm hòm.' : 'Chỉ hiện skin mở khóa có giá còn hạn. Chọn tối đa 10 món.';
        const selected = selectedUpgradeItems();
        $('upgrade-selected-count').textContent = `${selected.length} / 10`;
        $('upgrade-selected-chips').innerHTML = selected.map(item => `<button data-remove-upgrade="${escape(item.id)}" aria-label="Bỏ chọn ${escape(item.name)}">${escape(shortName(item.name))} ×</button>`).join('');
        $('upgrade-input-art').innerHTML = selected.length ? image(selected[0].image, selected[0].name) : '<span>+</span><p>Chọn skin từ kho hoặc thêm xu</p>';
        $('upgrade-input-value').textContent = coins(upgradeInputValue());
    }
    async function loadTargets() {
        const sequence = ++state.targetSequence;
        $('target-grid').classList.add('busy');
        try {
            const query = new URLSearchParams({ search: $('target-search').value.trim(), page: String(state.targetPage) });
            if (state.targetMin) query.set('minValue', state.targetMin);
            const result = await api(`/targets?${query}`);
            if (sequence !== state.targetSequence) return;
            state.targetPages = Math.max(1, result.pages ?? 1); state.targetPage = result.page ?? state.targetPage;
            $('target-grid').innerHTML = (result.items ?? []).map(item => itemCard(item, { selectable: true, selected: state.target?.id === item.id, idAttribute: 'target-id', mini: true })).join('') || '<p class="subtle-note">Không có skin phù hợp. Thử tên khác hoặc giảm mức giá.</p>';
            $('targets-count').textContent = `${result.total ?? 0} mục tiêu`;
            $('targets-page').textContent = `${state.targetPage + 1} / ${state.targetPages}`;
            $('targets-prev').disabled = state.targetPage <= 0; $('targets-next').disabled = state.targetPage >= state.targetPages - 1;
            $('target-grid').targetItems = result.items ?? [];
        } catch (error) { if (sequence === state.targetSequence) { $('target-grid').innerHTML = `<p class="subtle-note">${escape(error.message)}</p>`; } } finally { if (sequence === state.targetSequence) $('target-grid').classList.remove('busy'); }
    }
    function selectTarget(target) {
        if (state.upgradeBusy) return;
        state.target = target;
        $('upgrade-target-art').innerHTML = image(target.image, target.name);
        $('upgrade-target-name').textContent = shortName(target.name); $('upgrade-target-value').textContent = valueText(target);
        document.querySelectorAll('[data-target-id]').forEach(button => { const selected = button.dataset.targetId === target.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
        void updateUpgradePlan();
    }
    function upgradeBody() {
        return { inputIds: [...state.upgradeSelected], targetId: state.target?.id, coinStake: $('upgrade-stake').value.trim() || '0',
            clientSeed: $('client-seed').value.trim(), direction: $('upgrade-direction').value };
    }
    async function updateUpgradePlan() {
        const sequence = ++state.previewSequence;
        state.preview = null; $('upgrade-button').disabled = true;
        $('upgrade-input-value').textContent = coins(upgradeInputValue());
        if (!state.target || upgradeInputValue() <= 0n || !state.authenticated) {
            $('upgrade-chance').innerHTML = '—<span>%</span>'; $('wheel-chance').style.strokeDasharray = '0 100';
            $('upgrade-status').textContent = !state.authenticated ? 'Đăng nhập bằng mã /web để Upgrade với xu và kho Discord.' : 'Chọn nguyên liệu và skin đích để xem tỷ lệ.';
            return;
        }
        $('upgrade-status').textContent = 'Đang tính tỷ lệ theo bảng giá hiện tại…';
        try {
            const plan = await api('/upgrade/preview', upgradeBody());
            if (sequence !== state.previewSequence || state.upgradeBusy) return;
            state.preview = plan;
            const chance = Number(plan.chance ?? 0);
            $('upgrade-chance').innerHTML = `${escape(chance.toLocaleString('vi-VN', { maximumFractionDigits: 3 }))}<span>%</span>`;
            $('wheel-chance').style.strokeDasharray = `${Math.max(0, Math.min(100, chance))} 100`;
            $('wheel-chance').style.strokeDashoffset = $('upgrade-direction').value === 'over' ? String(chance) : '0';
            const targetValue = minor(plan.targetValue), stake = minor(plan.stake);
            $('upgrade-multiplier').textContent = stake > 0n ? `${(Number(targetValue) / Number(stake)).toFixed(2)}× GIÁ TRỊ` : 'CHỌN MỤC TIÊU';
            $('upgrade-status').textContent = 'Tỷ lệ đã sẵn sàng. Kiểm tra nguyên liệu trước khi xác nhận.'; $('upgrade-button').disabled = false;
        } catch (error) { if (sequence === state.previewSequence) { $('upgrade-chance').innerHTML = '—<span>%</span>'; $('wheel-chance').style.strokeDasharray = '0 100'; $('upgrade-status').textContent = error.message; } }
    }
    function renderPendingUpgrade() { $('upgrade-pending').hidden = !state.me?.upgrade?.pending; }
    function showProof(receipt) {
        const battle = receipt?.algorithm === 'HMAC-SHA256/rejection-v1';
        $('proof-dialog').querySelector('h2').textContent = battle ? 'Kiểm tra trận Battle' : 'Kiểm tra lượt Upgrade';
        $('proof-dialog').querySelector('p').textContent = battle
            ? 'Hash server seed được công bố từ lúc tạo phòng. Khi trận hoàn tất, biên nhận công bố seed và kết quả kiểm tra lại các vòng cùng phần thưởng.'
            : 'Máy chủ gửi hash cam kết trước khi quay. Sau khi hoàn tất, biên nhận chứa server seed, salt, client seed, nonce và vé kết quả để kiểm tra lại.';
        $('proof-content').textContent = receipt ? JSON.stringify(receipt, null, 2) : 'Tỷ lệ = giá trị nguyên liệu × 95% / giá skin mục tiêu. Tỷ lệ tối đa 90%, tối thiểu 1%. Máy chủ cam kết hash trước khi quay và công bố các seed cùng vé kết quả sau khi hoàn tất. Biên nhận của bạn được lưu trong lịch sử.';
        state.previousFocus = document.activeElement; $('proof-dialog').showModal();
    }
    async function settleUpgrade(attempt) {
        if (!attempt || state.upgradeBusy) return;
        const inputsCount = attempt.inputIds?.length ?? attempt.inputs?.length ?? 0;
        const accepted = await confirmAction('Xác nhận lượt Upgrade', `<p>Mục tiêu: <strong>${escape(shortName(attempt.target?.name ?? state.target?.name ?? 'Skin đã chọn'))}</strong></p><div class="confirm-total"><span>Giá trị tham gia</span><strong>${escape(coins(attempt.stake))}</strong></div><p><strong>Tỷ lệ thành công: ${escape(attempt.chance)}%.</strong> Thắng nhận skin đích; thua mất ${inputsCount} skin nguyên liệu và ${escape(coins(attempt.coinStake))} đã chọn.</p><p>Hash cam kết:</p><pre>${escape(attempt.hash)}</pre>`, 'Xác nhận & quay');
        if (!accepted) { await refreshMe(true); return; }
        state.upgradeBusy = true; $('upgrade-button').disabled = true; $('upgrade-status').textContent = 'Đang xác nhận kết quả…'; $('upgrade-result').hidden = true;
        try {
            const result = await api('/upgrade/settle', { attemptId: attempt.id, expectedHash: attempt.hash, expectedClientSeed: attempt.clientSeed });
            const receipt = result.receipt;
            if (!receipt) throw new Error('Chưa nhận được biên nhận. Xem lại lượt chờ hoặc lịch sử.');
            $('upgrade-status').textContent = 'Đang quay…';
            const duration = reduced() ? 0 : 3800;
            const stopSound = sound.spin(duration);
            const ticket = Number(receipt.ticket ?? 1), endingAngle = 360 * (ticket - 1) / 100000;
            $('wheel-needle').style.transition = 'none'; $('wheel-needle').style.transform = 'rotate(0deg)';
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            $('wheel-needle').style.transition = duration ? `transform ${duration}ms cubic-bezier(.12,.7,.1,1)` : 'none';
            $('wheel-needle').style.transform = `rotate(${1800 + endingAngle}deg)`;
            if (duration) await wait(duration + 70);
            const won = receipt.won === true;
            stopSound(); sound.result(won);
            $('upgrade-result').classList.toggle('lost', !won); $('upgrade-result').hidden = false;
            $('upgrade-result').innerHTML = `<h3>${won ? '✦ Upgrade thành công!' : 'Chưa trúng skin đích'}</h3><p>${won ? `${escape(shortName(receipt.drop?.name ?? receipt.target?.name))} đã được thêm vào kho.` : 'Lượt đã hoàn tất. Nguyên liệu và xu tham gia đã được sử dụng.'}</p><button class="text-button" id="result-proof">Xem biên nhận & seed →</button>`;
            $('result-proof').onclick = () => showProof(receipt);
            $('upgrade-status').textContent = result.replayed ? 'Đã khôi phục kết quả của lượt trước.' : 'Kết quả đã được lưu và đồng bộ với Discord.';
            state.upgradeSelected.clear(); $('upgrade-stake').value = '0'; state.preview = null;
            await refreshMe(true); toast(won ? 'Upgrade thành công! Skin đã vào kho.' : 'Lượt Upgrade đã hoàn tất.');
        } catch (error) { $('upgrade-status').textContent = error.message; toast(error.message, true); await refreshMe(true); }
        finally { state.upgradeBusy = false; $('upgrade-button').disabled = !state.preview; }
    }
    async function startUpgrade() {
        if (!state.authenticated) return showLogin();
        if (!state.preview || state.upgradeBusy) return;
        $('upgrade-button').disabled = true;
        try {
            const result = await api('/upgrade/prepare', { ...upgradeBody(), expectedSignature: state.preview.signature, expectedPrices: state.preview.prices });
            await settleUpgrade(result.attempt);
        } catch (error) { toast(error.message, true); await updateUpgradePlan(); }
        finally { if (!state.upgradeBusy) $('upgrade-button').disabled = !state.preview; }
    }
    function renderHistory() {
        if (!state.authenticated) { $('history-list').innerHTML = '<div class="auth-callout"><span>◷</span><h3>Mỗi lượt chơi đều có dấu ấn</h3><p>Đăng nhập để xem lịch sử mở hòm và Upgrade.</p><button class="button button-purple" data-login>Đăng nhập Discord ↗</button></div>'; return; }
        const web = (state.me?.history ?? []).map(item => ({ ...item, historyType: item.type ?? item.action ?? 'open', time: item.at ?? item.createdAt ?? item.timestamp }));
        const upgrades = (state.me?.upgrade?.history ?? []).map(item => ({ ...item, historyType: 'upgrade', time: item.at ?? item.createdAt }));
        const combined = [...web, ...upgrades].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 60);
        $('history-list').innerHTML = combined.map((entry, index) => {
            const upgrade = entry.historyType === 'upgrade', sale = /sell|sale/.test(entry.historyType), battle = /^battle-/.test(entry.historyType);
            const results = entry.results ?? entry.items ?? [];
            const first = results[0] ?? entry.drop;
            const title = upgrade ? `Upgrade · ${entry.won ? 'Thành công' : 'Chưa trúng'}` : battle ? ({ 'battle-create': 'Battle · Tạo phòng', 'battle-join': 'Battle · Tham gia phòng', 'battle-leave': 'Battle · Rời phòng', 'battle-cancel': 'Battle · Hủy phòng', 'battle-start': 'Battle · Bắt đầu trận', 'battle-seat': 'Battle · Đổi chỗ', 'battle-bot': 'Battle · Cập nhật Bot' })[entry.historyType] ?? 'Case Battle' : sale ? 'Bán skin lấy xu' : `Mở ${entry.count ?? results.length ?? 1} hòm · ${entry.caseName ?? state.catalogue.find(item => item.id === entry.caseId)?.name ?? 'Hòm CS2'}`;
            return `<article class="history-row"><span class="history-icon">${upgrade ? '↗' : battle ? '⚔' : sale ? '↔' : '◇'}</span>${first?.image ? image(first.image, first.name, '', first.imageFallback ?? first.fallbackImage) : ''}<div><h3>${escape(title)}</h3><p>${escape(upgrade ? shortName(entry.target?.name) : first?.name ?? entry.message ?? '')}</p></div><div class="history-meta">${upgrade ? `${escape(entry.chance ?? 0)}%` : escape(entry.totalFormatted ?? (entry.total && entry.total !== '0' ? coins(entry.total) : ''))}<small>${escape(dateText(entry.time))}</small></div>${upgrade ? `<button class="text-button" data-history-proof="${index}">Biên nhận →</button>` : battle && entry.roomId ? `<button class="text-button" data-history-battle="${escape(entry.roomId)}">Xem trận →</button>` : ''}</article>`;
        }).join('') || '<div class="empty-state"><span>◷</span><h3>Chưa có lượt chơi trên web</h3><p>Lượt mở hòm và Upgrade của bạn sẽ xuất hiện ở đây.</p></div>';
        $('history-list').receipts = combined;
    }
    const battleModeLabel = mode => ({ regular: 'Thường', crazy: 'Crazy', sharing: 'Chia đều' })[mode] ?? 'Thường';
    const battleStatusLabel = status => ({ waiting: 'Đang chờ', finished: 'Đã kết thúc', cancelled: 'Đã hủy', expired: 'Hết hạn' })[status] ?? status;
    const battleCases = room => (room.caseIds ?? []).map(id => room.cases?.find(item => item.id === id) ?? state.catalogue.find(item => item.id === id) ?? { id, name: 'Hòm CS2' });
    function battleFinalAmounts(room) {
        if (room.mode !== 'sharing') return battlePresentation.totals(room.players ?? [], room.rounds ?? []);
        return Object.fromEntries((room.players ?? []).map(player => [player.userId,
            minor(room.payouts?.[player.userId] ?? room.botPayouts?.[player.userId])]));
    }
    function battleSeats(room) {
        const slots = Array(room.capacity).fill(null), pending = [];
        for (const player of room.players ?? []) {
            const seat = room.seats?.[player.userId] ?? player.seat;
            if (Number.isInteger(seat) && seat >= 1 && seat <= slots.length && !slots[seat - 1]) slots[seat - 1] = player;
            else pending.push(player);
        }
        for (const player of pending) { const empty = slots.indexOf(null); if (empty >= 0) slots[empty] = player; }
        return slots;
    }
    function battleSeatControls(room, player, seat) {
        if (room.status !== 'waiting') return '';
        const mine = player?.userId === state.me?.user?.userId;
        const buttons = [];
        if (mine) buttons.push('<span class="battle-own-seat">✓ Chỗ của bạn</span>');
        else if (room.canChangeSeat || (!player && room.canJoin)) buttons.push(`<button class="button button-outline" data-battle-choose-seat="${seat}">${room.canChangeSeat ? player ? '⇄ Đổi chỗ' : 'Chuyển đến đây' : 'Ngồi chỗ này'}</button>`);
        if (!player && room.canAddBot) buttons.push(`<button class="button button-purple" data-battle-add-bot="${seat}">＋ Thêm Bot</button>`);
        if (player?.isBot && room.canRemoveBot) buttons.push(`<button class="text-button" data-battle-remove-bot="${seat}">Gỡ Bot</button>`);
        return buttons.length ? `<div class="battle-seat-controls">${buttons.join('')}</div>` : '';
    }
    function battlePlayer(player, { winner = false, total = null, seat = player.seat } = {}) {
        const name = player.displayName ?? player.userName ?? 'Người chơi';
        return `<div class="battle-player${winner ? ' is-winner' : ''}"><span class="battle-avatar">${player.avatar ? image(player.avatar, name) : escape(name.slice(0, 1).toUpperCase())}</span><span><strong>${escape(name)}${player.isBot ? ' <em class="battle-bot-badge">BOT</em>' : player.userId === state.me?.user?.userId ? ' <em>BẠN</em>' : ''}</strong><small class="battle-total-value" data-battle-total-small="${escape(player.userId)}">${total == null ? `${player.isBot ? 'Bot · ' : ''}Vị trí ${escape(seat ?? '—')}` : escape(coins(total))}</small></span>${winner ? '<span class="winner-crown" aria-label="Người thắng">♛</span>' : ''}</div>`;
    }
    function renderBattles() {
        $('view-battles').classList.toggle('battle-in-room', state.authenticated && !!state.battle);
        $('view-battles').classList.toggle('battle-detail-open', state.authenticated && !!state.battle);
        if (!state.authenticated) {
            $('battle-list').hidden = false; $('battle-detail').hidden = true;
            $('battle-list').innerHTML = '<div class="auth-callout"><span>⚔</span><h3>Vào trận cùng bạn bè</h3><p>Đăng nhập tài khoản Discord để tạo, tham gia và xem Battle trong máy chủ của bạn.</p><button class="button button-purple" data-login>Đăng nhập Discord ↗</button></div>';
            return;
        }
        $('battle-list').hidden = !!state.battle; $('battle-detail').hidden = !state.battle;
        if (state.battle) { renderBattleDetail(); return; }
        const rooms = state.battles.filter(room => ($('battle-status-filter').value === 'all' || room.status === $('battle-status-filter').value) && ($('battle-mode-filter').value === 'all' || room.mode === $('battle-mode-filter').value) && ($('battle-players-filter').value === 'all' || String(room.capacity) === $('battle-players-filter').value));
        $('battle-list').innerHTML = rooms.map(room => `<article class="battle-lobby-row"><div class="battle-round-badge"><strong>${room.caseIds?.length ?? 0}</strong><small>VÒNG</small></div><div class="battle-lobby-main"><div class="battle-lobby-top"><span class="battle-state ${escape(room.status)}">${escape(battleStatusLabel(room.status))}</span><span class="battle-mode">${escape(battleModeLabel(room.mode))}</span><strong>${room.caseIds?.length ?? room.cases?.length ?? 0} VÒNG</strong><small>${escape(dateText(room.createdAt))}</small></div><div class="battle-case-rail">${battleCases(room).slice(0, 7).map(item => `<span title="${escape(item.name)}">${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}</span>`).join('')}${(room.caseIds?.length ?? 0) > 7 ? `<b>+${room.caseIds.length - 7}</b>` : ''}</div></div><div class="battle-lobby-players">${(room.players ?? []).map(player => `<span class="lobby-avatar" title="${escape(player.displayName ?? player.userId)}">${player.avatar ? image(player.avatar, player.displayName ?? 'Người chơi') : escape((player.displayName ?? '?').slice(0, 1))}</span>`).join('')}${Array.from({ length: Math.max(0, room.capacity - (room.players?.length ?? 0)) }, () => '<span class="lobby-avatar empty">＋</span>').join('')}<small>${room.players?.length ?? 0} / ${room.capacity} người</small></div><div class="battle-lobby-price"><strong>${escape(room.feeFormatted ?? coins(room.fee))}</strong><small>MỖI NGƯỜI</small></div><button class="button ${room.canJoin ? 'button-lime' : 'button-outline'}" data-battle-open="${escape(room.id)}">${room.canJoin ? 'Vào phòng →' : 'Xem trận →'}</button></article>`).join('') || '<div class="empty-state"><span>⚔</span><h3>Chưa có trận Battle nào</h3><p>Chọn hòm, tạo phòng và rủ bạn bè Discord vào cùng.</p><button class="button button-purple" data-create-battle>Tạo trận đầu tiên →</button></div>';
    }
    function battleDrop(entry, roundIndex) {
        const item = { ...entry.item, value: entry.value, valueFormatted: entry.valueFormatted };
        return `<article class="battle-drop-item ${tierClass(item)}" title="Vòng ${roundIndex + 1}: ${escape(skinInfoText(item))}"><span class="battle-drop-round">${String(roundIndex + 1).padStart(2, '0')}</span>${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}<strong>${escape(shortName(item.name))}</strong><small>${escape(item.wear ?? item.rarity ?? '')}</small>${skinDetails(item)}<em>${escape(valueText(item))}</em></article>`;
    }
    function battleVerticalCard(item, landed = false, eager = false) {
        if (item.isExclusiveTrigger) return `<div class="battle-vertical-card t4 exclusive-trigger-card${landed ? ' is-landed' : ''}">${exclusiveTriggerArt()}<strong>Exclusive Drop</strong><small>VÒNG THƯỞNG CAO CẤP</small></div>`;
        return `<div class="battle-vertical-card ${tierClass(item)}${landed ? ' is-landed' : ''}" title="${escape(skinInfoText(item))}"><span class="battle-rarity-hex" aria-hidden="true"></span>${image(item.image, item.name, eager ? 'data-eager' : '', item.imageFallback ?? item.fallbackImage)}<strong>${escape(shortName(item.name))}</strong><small>${escape(item.wear ?? item.rarity ?? '')}</small><em>${escape(valueText(item))}</em></div>`;
    }
    function battleWindow(item, cards = [item]) {
        const landedIndex = cards.length > 1 ? battleReel.winnerIndex : 0;
        return `<div class="battle-vertical-window"><span class="battle-vertical-marker left"></span><span class="battle-vertical-marker right"></span><div class="battle-vertical-track">${cards.map((card, index) => battleVerticalCard(card, index === landedIndex, true)).join('')}</div></div>`;
    }
    function renderBattleDetail(revealed = null) {
        const room = state.battle; if (!room) return;
        const finished = room.status === 'finished', rounds = room.rounds ?? [], slots = battleSeats(room), players = slots.filter(Boolean);
        const playback = state.battlePlayback?.id === room.id ? state.battlePlayback : null;
        const phase = playback?.phase ?? (finished && state.battleSeen.has(room.id) ? 'finished' : finished ? 'ready' : 'waiting');
        const count = revealed ?? playback?.count ?? (phase === 'finished' ? rounds.length : 0);
        const complete = finished && count >= rounds.length && phase === 'finished';
        const totaling = phase === 'counting' || complete;
        const winners = complete && room.mode !== 'sharing' ? room.winners ?? [] : [];
        const totals = battlePresentation.totals(players, rounds, count);
        const displayed = playback?.displayTotals ?? (complete ? battleFinalAmounts(room) : totals);
        const sharingTotals = room.mode === 'sharing' && (complete || playback?.sharing);
        const colors = finished && count ? battlePresentation.standings(totals, room.mode, complete) : {};
        const caseList = battleCases(room);
        const currentIndex = Math.max(0, Math.min((['spinning', 'ready', 'trigger'].includes(phase) ? count : count - 1), caseList.length - 1));
        const currentCase = caseList[currentIndex];
        const status = playback?.stage === 'exclusive' && phase === 'spinning' ? '✦ EXCLUSIVE DROP · VÒNG THƯỞNG CAO CẤP' : phase === 'trigger' ? '✦ TRÚNG EXCLUSIVE DROP · CHUẨN BỊ VÒNG THƯỞNG' : complete ? 'TRẬN ĐÃ HOÀN TẤT' : phase === 'counting' ? playback?.sharing ? 'ĐANG CHIA ĐỀU PHẦN THƯỞNG' : 'ĐANG CỘNG TỔNG GIÁ TRỊ' : finished ? `VÒNG ${Math.min(count + (['spinning', 'ready', 'trigger'].includes(phase) ? 1 : 0), rounds.length)} / ${rounds.length}` : room.status === 'waiting' ? 'CHỌN CHỖ · THÊM BOT · BẮT ĐẦU TRẬN' : battleStatusLabel(room.status).toLocaleUpperCase('vi');
        const botWinner = players.some(player => player.isBot && winners.includes(player.userId));
        const payoutNote = room.payoutType === 'coins'
            ? `Phần thưởng đã chia thành xu vào ví người chơi.${minor(room.unclaimedPayout) > 0n ? ` Phần của Bot (${coins(room.unclaimedPayout)}) không cộng vào ví người chơi.` : ''}`
            : botWinner ? 'Bot thắng; phần thưởng của Bot không chuyển vào kho người chơi.' : 'Toàn bộ skin đã vào kho người thắng.';
        $('battle-detail').innerHTML = `<div class="battle-detail-top"><button class="back-link" data-battle-back>← Tất cả Battle</button><span class="battle-room-id">PHÒNG ${escape(room.id.slice(0, 8).toUpperCase())}</span>${complete ? '<button class="text-button" data-battle-replay>↻ Xem lại trận</button><button class="text-button" data-battle-proof>◎ Biên nhận</button>' : '<button class="text-button" data-battle-refresh>↻ Cập nhật</button>'}</div>
            <div class="battle-room-header"><div><span class="battle-state ${escape(room.status)}">${escape(battleStatusLabel(room.status))}</span><h2>${escape(battleModeLabel(room.mode))} BATTLE <span>· ${room.caseIds?.length ?? rounds.length} VÒNG</span>${room.exclusiveDrop ? ' <span class="battle-exclusive-badge">✦ Exclusive Drop</span>' : ''}</h2><p>${room.status === 'waiting' ? `Chọn chỗ bên dưới hoặc thêm Bot để đủ ${room.capacity} vị trí. Chủ phòng bấm Bắt đầu trận khi đã đủ người.` : finished ? 'Kết quả đã lưu trên máy chủ · Hoạt ảnh không thay đổi phần thưởng.' : 'Phòng đã đóng. Số dư được giữ nguyên.'}</p></div><div class="battle-room-actions">${room.canJoin ? '<button class="button button-lime" data-battle-action="join">Tham gia Battle →</button>' : ''}${room.canStart ? '<button class="button button-lime" data-battle-action="start">⚔ Bắt đầu trận</button>' : ''}${room.canLeave ? '<button class="button button-outline" data-battle-action="leave">Rời phòng</button>' : ''}${room.canCancel ? '<button class="button button-outline" data-battle-action="cancel">Hủy phòng</button>' : ''}</div></div>
            <div class="battle-stage-header"><div class="battle-stage-rounds"><small>VÒNG</small><strong data-battle-round-counter>${finished ? Math.min(currentIndex + 1, rounds.length) : 0} / ${room.caseIds?.length ?? rounds.length}</strong></div><div class="battle-stage-cases"><span class="battle-stage-mode">${room.mode === 'crazy' ? '↧' : room.mode === 'sharing' ? '♧' : '⚔'} ${escape(battleModeLabel(room.mode))}</span><strong class="battle-current-case-name">${escape(currentCase?.name ?? 'Hòm CS2')}</strong><div class="battle-round-track">${caseList.map((item, index) => `<span class="${index < count ? 'revealed' : ''}${index === currentIndex ? ' current' : ''}" title="Vòng ${index + 1}: ${escape(item.name)}">${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}<small>${index + 1}</small></span>`).join('')}</div></div><div class="battle-stage-cost"><small>TỔNG PHÍ / NGƯỜI</small><strong>${escape(room.feeFormatted ?? coins(room.fee))}</strong></div></div>
            ${room.status === 'waiting' && players.some(player => player.isBot) ? '<p class="battle-bot-note">Bot tham gia miễn phí. Bạn chỉ trả phí lượt của mình; phần thưởng Bot thắng không vào kho hoặc ví người chơi.</p>' : ''}<div id="battle-reveal-status" class="battle-reveal-status" role="status">${status}</div><div class="battle-arena" style="--players:${room.capacity}">${slots.map((player, index) => {
                const seat = index + 1;
                if (!player) return `<article class="battle-seat empty-seat"><small class="battle-seat-label">Vị trí ${seat}</small><span>＋</span><h3>Chỗ còn trống</h3><p>Ngồi vào chỗ này hoặc thêm một Bot để chơi cùng.</p>${battleSeatControls(room, null, seat)}</article>`;
                const spinning = phase === 'spinning' && Boolean(playback?.reels?.[player.userId]);
                const currentRound = ['spinning', 'trigger'].includes(phase);
                const entry = currentRound ? rounds[playback.spinRoundIndex]?.entries?.find(item => item.userId === player.userId) : count ? rounds[count - 1]?.entries?.find(item => item.userId === player.userId) : null;
                const item = currentRound && playback?.displayItems?.[player.userId] ? playback.displayItems[player.userId] : entry ? { ...entry.item, value: entry.value, valueFormatted: entry.valueFormatted } : null;
                const cards = spinning ? playback.reels?.[player.userId] : null;
                const color = colors[player.userId];
                const reward = player.isBot ? 'Không nhận vào ví / kho' : room.payoutType === 'coins' ? coins(room.payouts?.[player.userId] ?? '0') : winners.includes(player.userId) ? `${rounds.length * players.length} skin` : '0 skin';
                return `<article class="battle-seat${color ? ` is-${color}` : ''}${winners.includes(player.userId) ? ' winner' : ''}${spinning ? ' is-spinning' : ''}${spinning && playback.stage === 'exclusive' ? ' is-exclusive-spin' : ''}${count && !spinning ? ' is-revealed' : ''}" data-battle-seat="${escape(player.userId)}"><small class="battle-seat-label">Vị trí ${seat}</small><div class="battle-seat-drop">${totaling ? `<div class="battle-final-total${color ? ` is-${color}` : ''}"><small>${sharingTotals ? player.isBot ? 'PHẦN CHIA CỦA BOT' : 'PHẦN CHIA NHẬN ĐƯỢC' : 'TỔNG GIÁ TRỊ SKIN'}</small><strong data-battle-total="${escape(player.userId)}">${escape(coins(displayed[player.userId]))}</strong></div>` : item ? battleWindow(item, cards ?? [item]) : `<div class="battle-vertical-window battle-waiting-window"><span class="battle-wait-symbol">${finished ? '◇' : '⚔'}</span><p>${finished ? 'Đang chuẩn bị vòng quay…' : player.userId === room.hostId ? 'CHỦ PHÒNG' : 'ĐÃ SẴN SÀNG'}</p></div>`}</div>${item && !item.isExclusiveTrigger && !spinning && !totaling ? `<div class="battle-landed-info">${skinDetails(item)}</div>` : ''}${battlePlayer(player, { winner: winners.includes(player.userId), total: finished ? displayed[player.userId] ?? 0n : null, seat })}${battleSeatControls(room, player, seat)}${complete && room.mode === 'sharing' ? `<small class="battle-shared-note">Đã mở: ${escape(coins(totals[player.userId]))}</small>` : ''}${complete ? `<div class="battle-player-winnings"><small>${player.isBot ? 'PHẦN CỦA BOT' : 'PHẦN THƯỞNG NHẬN ĐƯỢC'}</small><strong>${escape(reward)}</strong></div>` : ''}</article>`;
            }).join('')}</div>
            ${count ? `<div class="battle-player-columns" style="--players:${room.capacity}">${players.map(player => `<section class="battle-player-drops"><h3>${escape(player.displayName ?? player.userId)} <span>${count} SKIN</span></h3><div class="battle-drops-grid">${rounds.slice(0, count).map((round, index) => { const entry = round.entries?.find(value => value.userId === player.userId); return entry ? battleDrop(entry, index) : ''; }).join('')}</div></section>`).join('')}</div>` : ''}
            ${complete ? `<div class="battle-outcome"><span>${room.mode === 'sharing' ? '♧' : '♛'}</span><h3>${room.mode === 'sharing' ? 'Mọi người cùng chia phần thưởng' : `${escape(players.filter(player => winners.includes(player.userId)).map(player => player.displayName ?? player.userId).join(' & '))} thắng trận!`}</h3><p>Tổng giá trị skin: <strong>${escape(room.poolFormatted ?? coins(room.pool))}</strong> · ${escape(payoutNote)}</p><button class="text-button" data-battle-replay>↻ Xem lại hoạt ảnh</button><button class="text-button" data-battle-proof>◎ Xem seed & biên nhận</button><button class="text-button" data-view="inventory">Mở kho đồ →</button></div>` : ''}<p class="battle-commitment">Hash cam kết trước trận: <code>${escape(room.commitment ?? '—')}</code></p>`;
        $('battle-detail').classList.toggle('battle-is-animating', state.battleAnimating);
        $('battle-detail').classList.toggle('battle-is-counting', phase === 'counting');
        const roundTrack = $('battle-detail').querySelector('.battle-round-track');
        if (roundTrack) {
            if (roundTrack.scrollWidth > roundTrack.clientWidth) roundTrack.style.justifyContent = 'flex-start';
            const activeRound = roundTrack.children[currentIndex];
            if (activeRound) {
                const bounds = roundTrack.getBoundingClientRect(), activeBounds = activeRound.getBoundingClientRect();
                roundTrack.scrollLeft += activeBounds.left - bounds.left - (roundTrack.clientWidth - activeBounds.width) / 2;
            }
        }
        $('battle-detail').querySelectorAll('.battle-vertical-track').forEach(track => {
            const windowElement = track.closest('.battle-vertical-window'), card = track.firstElementChild;
            if (!card) return;
            const cardHeight = card.getBoundingClientRect().height;
            const playbackSeat = playback && track.closest('.battle-seat')?.dataset.battleSeat;
            const spinning = phase === 'spinning' && playbackSeat && Object.hasOwn(playback.reels ?? {}, playbackSeat);
            track.style.transform = `translateY(${battlePresentation.center(windowElement.clientHeight, cardHeight, 0, spinning ? battleReel.winnerIndex + battleReel.steps : 0)}px)`;
        });
    }
    function scheduleBattlePoll() {
        clearTimeout(state.battlePoll);
        if (state.view !== 'battles' || !state.authenticated || state.battleAnimating || state.battleBusy || document.hidden) return;
        state.battlePoll = setTimeout(() => { void (state.battle ? loadBattle(state.battle.id, true) : loadBattles(true)); }, 4500);
    }
    async function loadBattles(quiet = false) {
        if (!state.authenticated) { renderBattles(); return; }
        if (state.battleBusy || state.battleAnimating) return;
        const sequence = ++state.battleSequence, owner = userKey();
        try {
            if (!quiet && !state.battles.length) $('battle-list').innerHTML = '<div class="battle-loading">Đang tải các phòng Battle…</div>';
            const result = await api('/battles');
            if (sequence !== state.battleSequence || owner !== userKey() || !state.authenticated || state.battleBusy || state.battleAnimating) return;
            state.battles = result.rooms ?? [];
            if (Number.isSafeInteger(result.limits?.rounds) && result.limits.rounds > 0) state.battleRoundLimit = result.limits.rounds;
            renderBattles();
        } catch (error) { if (!quiet) toast(error.message, true); }
        finally { scheduleBattlePoll(); }
    }
    function battleDelay(playback, duration) {
        if (playback.stopped || duration <= 0) return Promise.resolve();
        return waitVisible(duration, { cancelled: () => playback.stopped });
    }
    function stopBattlePlayback(settle = false) {
        const playback = state.battlePlayback;
        if (!playback) return;
        playback.stopped = true;
        for (const [timer, resolve] of playback.timers) { clearTimeout(timer); resolve(); }
        playback.timers.clear();
        playback.resolveFrame?.(); playback.resolveFrame = null;
        if (playback.raf != null) cancelAnimationFrame(playback.raf);
        for (const cancel of playback.preloadCancels ?? []) cancel();
        playback.preloadImages?.clear();
        playback.preloadCancels?.clear();
        playback.stopSound?.(); playback.stopSound = null;
        playback.stopCountSound?.(); playback.stopCountSound = null;
        if (settle && state.battle?.id === playback.id && state.battle.status === 'finished') {
            playback.phase = 'finished'; playback.count = state.battle.rounds?.length ?? 0;
            playback.sharing = state.battle.mode === 'sharing';
            playback.displayTotals = battleFinalAmounts(state.battle);
            playback.finalTotals = { ...playback.displayTotals };
            state.battleSeen.add(playback.id);
            renderBattleDetail();
        }
        state.battlePlayback = null;
        state.battleAnimating = false;
        $('battle-detail').classList.remove('battle-is-animating', 'battle-is-counting', 'revealing-round');
        scheduleBattlePoll();
    }
    async function battlePool(caseId) {
        if (state.battlePools.has(caseId)) return state.battlePools.get(caseId);
        const pending = api(`/cases/${encodeURIComponent(caseId)}`).then(result => (result.entries ?? []).filter(item => item.image).map(item => ({
            ...item, image: imageUrl(item.image), value: item.value ?? '0', valueFormatted: item.valueFormatted ?? coins(item.value)
        }))).catch(() => []);
        state.battlePools.set(caseId, pending);
        return pending;
    }
    async function preloadBattleImages(playback) {
        const room = state.battle;
        const caseIds = [...new Set((room.rounds ?? []).map(round => round.caseId))];
        const pools = new Map(await Promise.all(caseIds.map(async id => {
            const snapshot = room.cases?.find(item => item.id === id);
            return [id, snapshot?.reelEntries?.length ? snapshot.reelEntries : await battlePool(id)];
        })));
        if (playback.stopped) return;
        playback.pools = pools;
    }
    async function decodeBattleReelImages(playback) {
        const detail = $('battle-detail');
        const images = [...detail.querySelectorAll('.battle-vertical-track .is-landed img'), ...detail.querySelectorAll('.battle-vertical-track img')];
        const urls = [...new Set(images.map(img => imageUrl(img.getAttribute('src'))).filter(Boolean))];
        const deadline = performance.now() + 2200, concurrency = 4;
        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
            while (!playback.stopped && cursor < urls.length && performance.now() < deadline) {
                const url = urls[cursor++];
                await new Promise(resolve => {
                    const img = new Image(); let settled = false, timer;
                    const finish = () => {
                        if (settled) return;
                        settled = true; clearTimeout(timer); playback.preloadImages.delete(img); playback.preloadCancels.delete(cancel);
                        img.onload = img.onerror = null; resolve();
                    };
                    const cancel = () => { img.src = ''; finish(); };
                    timer = setTimeout(cancel, Math.max(0, deadline - performance.now()));
                    img.onload = img.onerror = finish;
                    playback.preloadImages.add(img); playback.preloadCancels.add(cancel); img.src = url;
                    if (img.complete) finish();
                });
            }
        });
        let timeoutId;
        const timeout = new Promise(resolve => {
            timeoutId = setTimeout(() => { playback.timers.delete(timeoutId); resolve(); }, Math.max(0, deadline - performance.now()));
            playback.timers.set(timeoutId, resolve);
        });
        await Promise.race([Promise.all(workers), timeout]);
        if (playback.timers.has(timeoutId)) { clearTimeout(timeoutId); playback.timers.delete(timeoutId); }
        if (playback.stopped || performance.now() >= deadline) {
            for (const cancel of [...playback.preloadCancels]) cancel();
            playback.preloadImages.clear();
            playback.preloadCancels.clear();
        }
        await Promise.all(workers);
    }
    function battleReels(room, playback, roundIndex, exclusive = false) {
        const round = room.rounds[roundIndex], snapshot = room.cases?.find(item => item.id === round.caseId);
        const descriptor = snapshot?.exclusive;
        const basePool = snapshot?.reelEntries ?? playback.pools?.get(round.caseId) ?? [];
        const enabled = room.exclusiveDrop && descriptor?.available;
        const regularPool = enabled ? [...basePool.filter(item => !item.exclusiveEligible), descriptor.trigger] : basePool;
        const pool = exclusive ? descriptor?.items ?? [] : regularPool;
        const { winnerIndex, itemCount } = battleReel;
        const reels = {}, displayItems = {};
        room.players.forEach((player, seat) => {
            const outcome = round.entries.find(entry => entry.userId === player.userId);
            if (!outcome) return;
            const actual = { ...outcome.item, value: outcome.value, valueFormatted: outcome.valueFormatted };
            const triggered = outcome.item.exclusiveDrop === true;
            const landed = !exclusive && triggered && enabled ? descriptor.trigger : actual;
            displayItems[player.userId] = landed;
            if (exclusive && !triggered) return;
            const samples = battlePresentation.indices(pool.length, itemCount, `${room.id}:${roundIndex}:${player.userId}:${seat}:${exclusive ? 'exclusive' : 'regular'}`);
            const cards = samples.map(index => pool[index]);
            while (cards.length < itemCount) cards.push(landed);
            cards[winnerIndex] = landed;
            reels[player.userId] = cards;
        });
        return { reels, displayItems, winnerIndex };
    }
    async function animateBattleTotals(playback, targets, duration, { from = null, sharing = false } = {}) {
        const players = state.battle.players, finalTotals = Object.fromEntries(players.map(player => [player.userId, targets[player.userId] ?? 0n]));
        const initialTotals = Object.fromEntries(players.map(player => [player.userId, from?.[player.userId] ?? 0n]));
        playback.phase = 'counting'; playback.sharing = sharing; playback.displayTotals = { ...initialTotals };
        playback.finalTotals = finalTotals; renderBattleDetail();
        await waitForVisible(() => playback.stopped);
        if (playback.stopped) return;
        let remaining = reduced() ? 0 : duration;
        const startSound = () => { playback.stopCountSound?.(); playback.stopCountSound = sound.count?.(remaining) ?? null; };
        startSound();
        await runVisibleAnimation(remaining, progress => {
            const units = Math.round((1 - (1 - progress) ** 3) * 1000);
            remaining = duration * (1 - progress);
            playback.displayTotals = Object.fromEntries(players.map(player => [player.userId,
                battlePresentation.interpolate(initialTotals[player.userId], finalTotals[player.userId], units)]));
            for (const player of players) {
                const value = playback.displayTotals[player.userId];
                const large = $('battle-detail').querySelector(`[data-battle-total="${CSS.escape(player.userId)}"]`);
                const small = $('battle-detail').querySelector(`[data-battle-total-small="${CSS.escape(player.userId)}"]`);
                if (large) large.textContent = coins(value);
                if (small) small.textContent = coins(value);
            }
        }, { cancelled: () => playback.stopped, onPause: () => playback.stopCountSound?.(), onResume: startSound });
        playback.stopCountSound?.(); playback.stopCountSound = null;
    }
    async function spinBattleStage(room, playback, roundIndex, exclusive = false) {
        const { reels, displayItems, winnerIndex } = battleReels(room, playback, roundIndex, exclusive);
        playback.phase = 'spinning'; playback.stage = exclusive ? 'exclusive' : 'regular';
        playback.count = roundIndex; playback.spinRoundIndex = roundIndex; playback.reels = reels; playback.displayItems = displayItems;
        renderBattleDetail();
        await decodeBattleReelImages(playback);
        await waitForVisible(() => playback.stopped);
        if (playback.stopped) return;
        const windows = [...$('battle-detail').querySelectorAll('.battle-seat.is-spinning .battle-vertical-window')];
        const duration = reduced() ? 0 : exclusive ? 8000 : Math.min(battleReel.maxDuration, battleReel.minDuration + roundIndex * 120);
        const stagger = duration ? 105 : 0, runDuration = duration + Math.max(0, windows.length - 1) * stagger;
        const lanes = windows.map((element, seat) => {
            const track = element.querySelector('.battle-vertical-track'), card = track?.firstElementChild;
            if (!track || !card) return null;
            const height = card.getBoundingClientRect().height;
            track.style.transition = 'none';
            return { element, track, delay: seat * stagger,
                start: battlePresentation.center(element.clientHeight, height, 0, winnerIndex + battleReel.steps),
                end: battlePresentation.center(element.clientHeight, height, 0, winnerIndex) };
        }).filter(Boolean);
        let remaining = runDuration;
        const startSound = () => {
            playback.stopSound?.();
            playback.stopSound = sound.spin?.(runDuration, { elapsed: runDuration - remaining, steps: battleReel.steps, easing: battleReel.easing });
        };
        startSound();
        await runVisibleAnimation(runDuration, progress => {
            const elapsed = progress * runDuration;
            remaining = Math.max(0, runDuration - elapsed);
            for (const lane of lanes) {
                const local = duration ? Math.max(0, Math.min(1, (elapsed - lane.delay) / duration)) : 1;
                const eased = spinProgress(local, battleReel.easing);
                lane.track.style.transform = `translateY(${lane.start + (lane.end - lane.start) * eased}px)`;
            }
        }, { cancelled: () => playback.stopped, onPause: () => playback.stopSound?.(), onResume: startSound });
        playback.stopSound?.(); playback.stopSound = null;
    }
    async function revealBattle(room, { replay = false } = {}) {
        if (state.battleAnimating || state.battle?.id !== room.id || !state.authenticated) return;
        const rounds = room.rounds ?? [];
        if (!rounds.length) return;
        state.battleAnimating = true; clearTimeout(state.battlePoll);
        state.battleSeen.add(room.id);
        const zero = Object.fromEntries((room.players ?? []).map(player => [player.userId, 0n]));
        const playback = { id: room.id, phase: 'ready', count: 0, spinRoundIndex: 0, reels: null, pools: null,
            displayTotals: { ...zero }, finalTotals: { ...zero }, stopped: false, timers: new Map(), raf: null, resolveFrame: null,
            preloadImages: new Set(), preloadCancels: new Set(), stopSound: null, stopCountSound: null };
        state.battlePlayback = playback;
        try {
            renderBattleDetail();
            await preloadBattleImages(playback);
            for (let index = 0; index < rounds.length; index++) {
                await waitForVisible(() => playback.stopped);
                if (playback.stopped || state.battle?.id !== room.id || !state.authenticated) break;
                await spinBattleStage(room, playback, index);
                if (playback.stopped) break;
                const exclusiveEntries = room.exclusiveDrop ? rounds[index].entries.filter(entry => entry.item.exclusiveDrop) : [];
                if (exclusiveEntries.length) {
                    playback.phase = 'trigger'; playback.reels = null; renderBattleDetail();
                    sound.reveal?.({ tier: 4 }, { caseFee: 0 });
                    await battleDelay(playback, reduced() ? 0 : 1300);
                    if (playback.stopped) break;
                    await spinBattleStage(room, playback, index, true);
                    if (playback.stopped) break;
                }
                const fee = BigInt(room.cases?.find(item => item.id === rounds[index].caseId)?.fee ?? '0');
                const outcome = window.MaySkinsAudio.highestValueItem(rounds[index].entries.map(entry => ({ ...entry.item, value: entry.value })));
                const cue = sound.reveal?.(outcome, { caseFee: fee });
                if (cue && !cue.major) sound.tick?.();
                playback.count = index + 1; playback.phase = 'revealed'; playback.reels = null; playback.displayItems = null;
                playback.displayTotals = battlePresentation.totals(room.players, rounds, playback.count);
                renderBattleDetail();
                await battleDelay(playback, reduced() ? 0 : cue?.major ? 1800 : 1200);
            }
            if (!playback.stopped && state.battle?.id === room.id && state.authenticated) {
                playback.count = rounds.length;
                const finalTotals = battlePresentation.totals(room.players, rounds, rounds.length);
                await animateBattleTotals(playback, finalTotals, 2300);
                let finalAmounts = finalTotals;
                if (!playback.stopped && room.mode === 'sharing') {
                    await battleDelay(playback, reduced() ? 0 : 650);
                    if (!playback.stopped) {
                        finalAmounts = battleFinalAmounts(room);
                        await animateBattleTotals(playback, finalAmounts, 1600, { from: finalTotals, sharing: true });
                    }
                }
                if (!playback.stopped) {
                    playback.phase = 'finished'; playback.finalTotals = { ...finalAmounts }; playback.displayTotals = { ...finalAmounts };
                    renderBattleDetail(); sound.result?.(room.mode === 'sharing' || (room.winners ?? []).includes(state.me?.user?.userId));
                    await refreshMe(true);
                }
            }
        } finally {
            if (state.battlePlayback === playback) {
                playback.stopSound?.(); playback.stopCountSound?.();
                state.battlePlayback = null; state.battleAnimating = false;
                $('battle-detail').classList.remove('battle-is-animating', 'battle-is-counting', 'revealing-round');
                scheduleBattlePoll();
            }
        }
    }
    async function loadBattle(id, quiet = false, { animate = true } = {}) {
        if (!state.authenticated || state.battleAnimating || state.battleBusy) return;
        const sequence = ++state.battleSequence, owner = userKey();
        try {
            const result = await api(`/battles/${encodeURIComponent(id)}`);
            if (sequence !== state.battleSequence || owner !== userKey() || !state.authenticated || state.view !== 'battles' || state.battleBusy || state.battleAnimating) return;
            state.battle = result.room; renderBattles();
            if (animate && result.room?.status === 'finished' && !state.battleSeen.has(id)) await revealBattle(result.room);
        } catch (error) { if (!quiet) toast(error.message, true); }
        finally { scheduleBattlePoll(); }
    }
    function renderBattleCasePicker() {
        const query = $('battle-case-search').value.trim().toLocaleLowerCase('vi');
        const items = state.catalogue.filter(item => item.available && `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('vi').includes(query));
        const count = [...state.battleSelected.values()].reduce((sum, value) => sum + value, 0);
        const picker = $('battle-case-picker'), scrollTop = picker.scrollTop;
        picker.innerHTML = items.map(item => {
            const quantity = state.battleSelected.get(item.id) ?? 0;
            return `<article class="battle-pick-case${quantity ? ' chosen' : ''}"><button type="button" class="battle-case-preview-trigger" data-battle-case-preview="${escape(item.id)}" aria-label="Xem bên trong hòm ${escape(item.name)}" ${state.battleBusy ? 'disabled' : ''}>${image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage)}${quantity ? `<span class="battle-pick-count">Đã chọn ${quantity}</span>` : ''}</button><strong class="battle-pick-name">${escape(item.name)}</strong><small class="battle-pick-price">${escape(item.feeFormatted ?? coins(item.fee))} / hòm</small><small class="battle-pick-meta">${escape(item.entryCount ?? 'Nhiều')} phần thưởng${item.riskLabel ? ` · ${escape(item.riskLabel)}` : ''}</small><button type="button" class="battle-case-inspect" data-battle-case-preview="${escape(item.id)}" ${state.battleBusy ? 'disabled' : ''}>Xem bên trong →</button><div class="battle-pick-quantity"><button type="button" data-battle-case-remove="${escape(item.id)}" aria-label="Bớt hòm ${escape(item.name)}" ${!quantity || state.battleBusy ? 'disabled' : ''}>−</button><span aria-label="Đã chọn ${quantity} hòm">${quantity}</span><button type="button" data-battle-case-add="${escape(item.id)}" aria-label="Thêm hòm ${escape(item.name)}" ${count >= state.battleRoundLimit || state.battleBusy ? 'disabled' : ''}>＋</button></div></article>`;
        }).join('') || '<p class="subtle-note">Không tìm thấy hòm có giá phù hợp.</p>';
        picker.scrollTop = scrollTop;
        const total = [...state.battleSelected].reduce((sum, [id, quantity]) => sum + minor(state.catalogue.find(item => item.id === id)?.fee) * BigInt(quantity), 0n);
        $('battle-round-count').textContent = `${count} / ${state.battleRoundLimit} vòng`; $('battle-create-total').textContent = `${coins(total)} / người`;
        $('battle-create-submit').disabled = !count || count > state.battleRoundLimit || state.battleBusy;
        updateBattleCasePreviewSelection();
    }
    function changeBattleCaseQuantity(id, delta) {
        if (!state.authenticated || state.battleBusy || !state.catalogue.some(item => item.id === id && item.available)) return;
        const total = [...state.battleSelected.values()].reduce((sum, value) => sum + value, 0);
        if (delta > 0 && total + delta > state.battleRoundLimit) return toast(`Một Battle có tối đa ${state.battleRoundLimit} vòng.`);
        const count = Math.max(0, (state.battleSelected.get(id) ?? 0) + delta);
        if (count) state.battleSelected.set(id, count); else state.battleSelected.delete(id);
        renderBattleCasePicker();
    }
    function updateBattleCasePreviewSelection() {
        const preview = state.battleCasePreview;
        if (!preview) return;
        const quantity = state.battleSelected.get(preview.id) ?? 0;
        const total = [...state.battleSelected.values()].reduce((sum, value) => sum + value, 0);
        $('battle-case-preview-selected').textContent = `Đã chọn ${quantity} hòm này · ${total} / ${state.battleRoundLimit} vòng`;
        $('battle-case-preview-dialog').querySelector('[data-battle-preview-add]').disabled =
            state.battleBusy || !state.authenticated || !preview.detail?.case?.available || total >= state.battleRoundLimit;
    }
    async function openBattleCasePreview(id) {
        if (state.battleBusy) return;
        const item = state.catalogue.find(entry => entry.id === id);
        if (!item) return;
        const dialog = $('battle-case-preview-dialog');
        const sequence = ++state.battleCasePreviewSequence;
        state.battleCasePreview = { id, detail: null };
        $('battle-case-preview-title').textContent = item.name;
        $('battle-case-preview-art').innerHTML = image(item.image, item.name, '', item.imageFallback ?? item.fallbackImage);
        $('battle-case-preview-description').textContent = 'Xem các skin có thể nhận và tỷ lệ trước khi chọn hòm cho trận.';
        $('battle-case-preview-status').textContent = 'Đang tải phần thưởng và tỷ lệ…';
        $('battle-case-preview-content').innerHTML = '';
        updateBattleCasePreviewSelection();
        if (!dialog.open) { battleCasePreviewFocus = document.activeElement; dialog.showModal(); }
        dialog.scrollTop = 0;
        try {
            const detail = await api(`/cases/${encodeURIComponent(id)}`);
            if (sequence !== state.battleCasePreviewSequence || !dialog.open || state.battleCasePreview?.id !== id) return;
            state.battleCasePreview.detail = detail;
            $('battle-case-preview-description').textContent = detail.case.description ?? '';
            const entries = [...(detail.entries ?? [])].sort((left, right) => {
                const chance = Number(left.chance ?? 0) - Number(right.chance ?? 0);
                if (chance) return chance;
                const a = minor(left.value), b = minor(right.value);
                return a === b ? 0 : a > b ? -1 : 1;
            });
            const totalChance = entries.reduce((sum, entry) => sum + Number(entry.chance ?? 0), 0);
            $('battle-case-preview-status').textContent = entries.length
                ? `${entries.length} phần thưởng · Tổng tỷ lệ cuối cùng ${formatChance(totalChance)}% · ${detail.case.feeFormatted ?? coins(detail.fee)} / hòm`
                : 'Hòm đang chờ cập nhật giá. Bạn có thể chọn một hòm khác.';
            const featured = entries.slice(0, 3), remaining = entries.slice(3);
            $('battle-case-preview-content').innerHTML = entries.length ?
                `${exclusiveDropInfo(detail.exclusive)}<section class="battle-preview-featured"><h3>Vật phẩm hiếm nhất</h3><p>Các món có tỷ lệ cuối cùng thấp nhất trong hòm.</p><div class="battle-preview-grid">${featured.map(entry => itemCard(entry, { chance: true, featured: true })).join('')}</div></section>${remaining.length ? `<section class="battle-preview-all"><h3>Các phần thưởng khác <span>(${remaining.length})</span></h3><div class="battle-preview-grid">${remaining.map(entry => itemCard(entry, { chance: true })).join('')}</div></section>` : ''}`
                : '<div class="empty-state"><span>◇</span><h3>Chưa có bảng phần thưởng còn hạn</h3><p>Quay lại danh sách và chọn một hòm đang có giá.</p></div>';
            updateBattleCasePreviewSelection();
        } catch (error) {
            if (sequence !== state.battleCasePreviewSequence || !dialog.open) return;
            $('battle-case-preview-status').textContent = error.message;
            $('battle-case-preview-content').innerHTML = '<button type="button" class="button button-outline" data-battle-preview-retry>↻ Tải lại phần thưởng</button>';
        }
    }
    function openBattleCreate() {
        if (!state.authenticated) return showLogin();
        if (state.battleBusy || state.battleAnimating) return;
        state.previousFocus = document.activeElement; renderBattleCasePicker(); $('battle-create-dialog').showModal();
    }
    async function createBattle() {
        if (state.battleBusy || !state.authenticated) return;
        const caseIds = [...state.battleSelected].flatMap(([id, count]) => Array(count).fill(id));
        if (!caseIds.length || caseIds.length > state.battleRoundLimit) return;
        const capacity = Number($('battle-capacity').value), mode = $('battle-mode').value, owner = userKey();
        const exclusiveDrop = $('battle-exclusive').checked;
        const key = JSON.stringify({ caseIds, capacity, mode, exclusiveDrop }), storage = `battle-create:${owner}`;
        state.battleSequence++; clearTimeout(state.battlePoll); state.battleBusy = true; renderBattleCasePicker(); $('battle-create-notice').textContent = 'Đang xác nhận giá các hòm và tạo phòng…';
        try {
            let pending = safeRead(storage, null);
            if (pending?.key !== key || !/^[a-f0-9-]{36}$/i.test(pending?.body?.requestId ?? '')) {
                const details = await Promise.all([...new Set(caseIds)].map(id => api(`/cases/${encodeURIComponent(id)}`)));
                if (owner !== userKey() || !state.authenticated) return;
                pending = { key, body: { requestId: uuid(), caseIds, capacity, mode, exclusiveDrop, quoteIds: Object.fromEntries(details.map(detail => [detail.case.id, detail.quoteId])) } };
                safeWrite(storage, pending);
            }
            const result = await api('/battles', pending.body);
            safeWrite(storage, null);
            if (owner !== userKey() || !state.authenticated) return;
            closeDialog($('battle-create-dialog')); state.battle = result.room; state.battleSelected.clear();
            setView('battles'); renderBattles(); toast('Đã tạo phòng. Mời bạn bè vào Case Battle cùng máy chủ Discord.');
        } catch (error) { if (error.status && error.status < 500) safeWrite(storage, null); $('battle-create-notice').textContent = error.message; toast(error.message, true); }
        finally { state.battleBusy = false; renderBattleCasePicker(); scheduleBattlePoll(); }
    }
    async function battleAction(action, options = {}) {
        const room = state.battle;
        if (!room || !state.authenticated || state.battleBusy || state.battleAnimating) return;
        const owner = userKey(), storage = `battle:${owner}:${room.id}:${action}:${JSON.stringify(options)}`;
        if (action === 'start' && !await confirmAction('Bắt đầu Case Battle?', `<p>${room.players.filter(player => !player.isBot).length} người chơi${room.players.some(player => player.isBot) ? ` và ${room.players.filter(player => player.isBot).length} Bot` : ''} sẽ cùng mở ${room.caseIds.length} hòm. Bot tham gia miễn phí.</p><div class="confirm-total"><span>Chi phí mỗi người</span><strong>${escape(room.feeFormatted ?? coins(room.fee))}</strong></div><p>Luật <strong>${escape(battleModeLabel(room.mode))}</strong>. Xu sẽ được trừ và trận được quyết toán ngay trên máy chủ.</p>`, 'Bắt đầu trận')) return;
        if (action === 'cancel' && !await confirmAction('Hủy phòng Battle?', '<p>Phòng đang chờ sẽ đóng. Chưa có xu nào bị trừ.</p>', 'Hủy phòng')) return;
        if (owner !== userKey() || state.battle?.id !== room.id) return;
        state.battleSequence++; clearTimeout(state.battlePoll); state.battleBusy = true; $('battle-detail').classList.add('busy');
        let request = safeRead(storage, null);
        if (!/^[a-f0-9-]{36}$/i.test(request?.requestId ?? '')) { request = { requestId: uuid(), ...options }; safeWrite(storage, request); }
        try {
            const result = await api(`/battles/${encodeURIComponent(room.id)}/${action}`, request);
            safeWrite(storage, null);
            if (owner !== userKey() || !state.authenticated) return;
            state.battle = result.room; $('battle-detail').classList.remove('busy'); renderBattles();
            if (result.room?.status === 'finished' && !state.battleSeen.has(room.id)) await revealBattle(result.room);
            else toast(({ join: 'Đã tham gia phòng Battle.', leave: 'Đã rời phòng Battle.', cancel: 'Đã hủy phòng Battle.', seat: 'Đã đổi vị trí trong Battle.', bot: options.remove ? 'Đã gỡ Bot khỏi Battle.' : 'Đã thêm Bot vào Battle.' })[action] ?? 'Đã cập nhật Battle.');
            await refreshMe(true);
        } catch (error) { if (error.status && error.status < 500) safeWrite(storage, null); toast(error.message, true); }
        finally { state.battleBusy = false; $('battle-detail').classList.remove('busy'); scheduleBattlePoll(); }
    }
    function debounce(callback, ms = 300) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), ms); }; }
    document.addEventListener('click', event => {
        const oddsLink = event.target.closest('[data-scroll-odds]');
        if (oddsLink) { $('case-odds-section').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); return; }
        const viewButton = event.target.closest('[data-view]'); if (viewButton) setView(viewButton.dataset.view);
        if (event.target.closest('[data-login]')) showLogin();
        const close = event.target.closest('[data-close]'); if (close && !(state.battleBusy && close.closest('dialog')?.id === 'battle-create-dialog')) closeDialog(close.closest('dialog'));
        if (event.target.closest('[data-create-battle]')) openBattleCreate();
    });
    document.addEventListener('error', event => {
        if (!(event.target instanceof HTMLImageElement)) return;
        failedImages.add(event.target.getAttribute('src') ?? '');
        const fallback = event.target.dataset.fallback;
        if (fallback && !event.target.dataset.fallbackUsed && !failedImages.has(fallback)) { event.target.dataset.fallbackUsed = 'true'; event.target.src = fallback; }
        else { event.target.hidden = true; event.target.closest('.image-frame')?.classList.add('image-failed'); }
    }, true);
    document.addEventListener('load', event => { if (event.target instanceof HTMLImageElement) event.target.closest('.image-frame')?.classList.remove('image-pending'); }, true);
    $('login-nav').addEventListener('click', showLogin);
    $('login-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (state.opening || state.upgradeBusy || state.battleBusy || state.battleAnimating) {
            $('login-error').textContent = 'Chờ lượt đang quay hoàn tất rồi đăng nhập.'; return;
        }
        $('login-submit').disabled = true; $('login-error').textContent = '';
        try {
            const session = await api('/login', { code: $('login-code').value.trim() });
            if (session.authenticated !== true) throw new Error('Chưa đăng nhập được. Lấy mã mới bằng /web.');
            if (state.authenticated && userKey() !== `${session.user?.guildId ?? ''}:${session.user?.userId ?? ''}`) signedOut();
            state.authenticated = true; state.csrf = session.csrfToken ?? '';
            $('login-code').value = ''; closeDialog($('login-dialog')); await refreshMe(); toast('Đã kết nối tài khoản Discord.');
            if (state.view === 'upgrade') { void loadTargets(); void updateUpgradePlan(); }
            if (state.view === 'battles') void loadBattles();
        } catch (error) { $('login-error').textContent = error.message; } finally { $('login-submit').disabled = false; }
    });
    $('profile-button').addEventListener('click', async () => {
        if (state.opening || state.upgradeBusy || state.battleBusy || state.battleAnimating) return toast('Chờ lượt đang quay hoàn tất.');
        if (!await confirmAction('Đăng xuất tài khoản?', `<p>${escape(state.me?.user?.displayName ?? 'Tài khoản Discord')} sẽ được đăng xuất trên trình duyệt này. Kho skin và xu vẫn được giữ trong bot.</p>`, 'Đăng xuất')) return;
        try { await api('/logout', {}); signedOut(); toast('Đã đăng xuất.'); } catch (error) { toast(error.message, true); }
    });
    $('hero-button').addEventListener('click', () => $('case-catalogue').scrollIntoView({ behavior: reduced() ? 'instant' : 'smooth', block: 'start' }));
    $('history-nav').addEventListener('click', () => setView('history'));
    $('back-to-cases').addEventListener('click', () => setView('cases'));
    $('case-groups').addEventListener('click', event => { const button = event.target.closest('[data-group]'); if (!button) return; state.group = button.dataset.group; document.querySelectorAll('[data-group]').forEach(item => item.classList.toggle('active', item === button)); renderCatalogue(); });
    $('case-search').addEventListener('input', renderCatalogue); $('case-sort').addEventListener('change', renderCatalogue);
    $('cases-grid').addEventListener('click', event => {
        const collapse = event.target.closest('[data-collapse-group]');
        if (collapse) { const open = collapse.getAttribute('aria-expanded') !== 'true'; collapse.setAttribute('aria-expanded', String(open)); collapse.nextElementSibling.hidden = !open; return; }
        const favorite = event.target.closest('[data-favorite]');
        if (favorite) { const id = favorite.dataset.favorite; if (favorites.has(id)) favorites.delete(id); else favorites.add(id); safeWrite('favorites', [...favorites]); renderCatalogue(); return; }
        const button = event.target.closest('[data-case]'); if (button) void selectCase(button.dataset.case);
        if (event.target.closest('#retry-catalogue')) void loadCatalogue();
    });
    $('featured-rail').addEventListener('click', event => { const button = event.target.closest('[data-case]'); if (button) void selectCase(button.dataset.case); });
    $('opening-counts').addEventListener('click', event => { const button = event.target.closest('[data-count]'); if (!button || state.opening) return; state.count = Number(button.dataset.count); renderIdleReel(); updateOpenButton(); });
    $('open-button').addEventListener('click', () => void openCases());
    $('fast-opening').checked = safeRead('fast', false) === true; $('fast-opening').addEventListener('change', event => safeWrite('fast', event.target.checked));
    if ($('exclusive-opening')) {
        $('exclusive-opening').checked = safeRead('exclusive-opening', true) !== false;
        $('exclusive-opening').addEventListener('change', event => {
            if (state.opening || pendingOpening()) { updateOpenButton(); return; }
            safeWrite('exclusive-opening', event.target.checked); updateOpenButton(); renderIdleReel();
        });
    }
    $('inventory-grid').addEventListener('click', event => { const button = event.target.closest('[data-item-id]'); if (!button) return; const id = button.dataset.itemId; if (state.inventorySelected.has(id)) state.inventorySelected.delete(id); else { if (state.inventorySelected.size >= 50) return toast('Mỗi lần chọn tối đa 50 món.'); state.inventorySelected.add(id); } state.pendingSale = null; renderInventory(); });
    $('inventory-search').addEventListener('input', renderInventory); $('inventory-sort').addEventListener('change', renderInventory);
    $('inventory-clear').addEventListener('click', () => { state.inventorySelected.clear(); state.pendingSale = null; renderInventory(); });
    $('refresh-inventory').addEventListener('click', () => void refreshMe()); $('refresh-history').addEventListener('click', () => void refreshMe());
    $('inventory-lock').addEventListener('click', () => void setLocks(true)); $('inventory-unlock').addEventListener('click', () => void setLocks(false)); $('inventory-sell').addEventListener('click', () => void sellSelected());
    $('inventory-upgrade').addEventListener('click', () => { const valid = (state.me?.inventory ?? []).filter(item => state.inventorySelected.has(item.id) && item.upgradeEligible && !item.locked); if (!valid.length) return toast('Chọn skin mở khóa có giá còn hạn để Upgrade.'); if (valid.length > 10) return toast('Upgrade dùng tối đa 10 skin.'); state.upgradeSelected = new Set(valid.map(item => item.id)); setView('upgrade'); void updateUpgradePlan(); });
    $('upgrade-inventory-grid').addEventListener('click', event => { const button = event.target.closest('[data-upgrade-item]'); if (!button || state.upgradeBusy) return; const id = button.dataset.upgradeItem; if (state.upgradeSelected.has(id)) state.upgradeSelected.delete(id); else { if (state.upgradeSelected.size >= 10) return toast('Mỗi lượt Upgrade chọn tối đa 10 skin.'); state.upgradeSelected.add(id); } renderUpgradeInputs(); void updateUpgradePlan(); });
    $('upgrade-selected-chips').addEventListener('click', event => { const button = event.target.closest('[data-remove-upgrade]'); if (!button || state.upgradeBusy) return; state.upgradeSelected.delete(button.dataset.removeUpgrade); renderUpgradeInputs(); void updateUpgradePlan(); });
    $('upgrade-inventory-search').addEventListener('input', renderUpgradeInputs);
    const debouncedPlan = debounce(() => void updateUpgradePlan(), 350);
    const invalidatePlan = () => { state.preview = null; state.previewSequence++; $('upgrade-button').disabled = true; $('upgrade-input-value').textContent = coins(upgradeInputValue()); debouncedPlan(); };
    $('upgrade-stake').addEventListener('input', invalidatePlan); $('client-seed').addEventListener('input', invalidatePlan); $('upgrade-direction').addEventListener('change', () => void updateUpgradePlan());
    $('target-search').addEventListener('input', debounce(() => { state.targetPage = 0; state.targetMin = ''; void loadTargets(); }));
    $('target-grid').addEventListener('click', event => { const button = event.target.closest('[data-target-id]'); if (!button || state.upgradeBusy) return; const target = ($('target-grid').targetItems ?? []).find(item => item.id === button.dataset.targetId); if (target) selectTarget(target); });
    $('targets-prev').addEventListener('click', () => { if (state.targetPage > 0) { state.targetPage--; void loadTargets(); } }); $('targets-next').addEventListener('click', () => { if (state.targetPage < state.targetPages - 1) { state.targetPage++; void loadTargets(); } });
    $('target-multipliers').addEventListener('click', event => { const button = event.target.closest('[data-multiplier]'); if (!button || state.upgradeBusy) return; const stake = upgradeInputValue(); if (stake <= 0n) return toast('Chọn skin hoặc nhập xu trước khi lọc mục tiêu.'); state.targetMin = String(stake * BigInt(Math.round(Number(button.dataset.multiplier) * 100)) / 100n); state.targetPage = 0; void loadTargets(); });
    $('upgrade-button').addEventListener('click', () => void startUpgrade());
    $('resume-upgrade').addEventListener('click', () => void settleUpgrade(state.me?.upgrade?.pending));
    $('upgrade-proof-button').addEventListener('click', () => showProof());
    $('history-list').addEventListener('click', event => { const button = event.target.closest('[data-history-proof]'); if (button) showProof($('history-list').receipts?.[Number(button.dataset.historyProof)]); const battle = event.target.closest('[data-history-battle]'); if (battle) { setView('battles'); void loadBattle(battle.dataset.historyBattle); } });
    $('create-battle-button').addEventListener('click', openBattleCreate);
    ['battle-status-filter', 'battle-mode-filter', 'battle-players-filter'].forEach(id => $(id).addEventListener('change', renderBattles));
    $('refresh-battles').addEventListener('click', () => { if (state.battleAnimating || state.battleBusy) return; if (state.battle) void loadBattle(state.battle.id); else void loadBattles(); });
    $('battle-list').addEventListener('click', event => { const button = event.target.closest('[data-battle-open]'); if (button) void loadBattle(button.dataset.battleOpen); });
    $('battle-detail').addEventListener('click', event => {
        if (state.battleAnimating || state.battleBusy) return;
        if (event.target.closest('[data-battle-back]')) { state.battleSequence++; state.battle = null; renderBattles(); void loadBattles(); }
        if (event.target.closest('[data-battle-refresh]') && state.battle) void loadBattle(state.battle.id);
        const action = event.target.closest('[data-battle-action]'); if (action) void battleAction(action.dataset.battleAction);
        const seat = event.target.closest('[data-battle-choose-seat]'); if (seat) void battleAction('seat', { seat: Number(seat.dataset.battleChooseSeat) });
        const addBot = event.target.closest('[data-battle-add-bot]'); if (addBot) void battleAction('bot', { seat: Number(addBot.dataset.battleAddBot) });
        const removeBot = event.target.closest('[data-battle-remove-bot]'); if (removeBot) void battleAction('bot', { seat: Number(removeBot.dataset.battleRemoveBot), remove: true });
        if (event.target.closest('[data-battle-replay]') && state.battle?.status === 'finished') void revealBattle(state.battle, { replay: true });
        if (event.target.closest('[data-battle-proof]')) showProof(state.battle?.proof);
    });
    $('battle-case-search').addEventListener('input', renderBattleCasePicker);
    $('battle-case-picker').addEventListener('click', event => {
        if (state.battleBusy) return;
        const preview = event.target.closest('[data-battle-case-preview]');
        if (preview) { void openBattleCasePreview(preview.dataset.battleCasePreview); return; }
        const add = event.target.closest('[data-battle-case-add]'), remove = event.target.closest('[data-battle-case-remove]');
        const id = add?.dataset.battleCaseAdd ?? remove?.dataset.battleCaseRemove; if (!id) return;
        changeBattleCaseQuantity(id, add ? 1 : -1);
    });
    $('battle-case-preview-dialog').addEventListener('click', event => {
        if (event.target.closest('[data-battle-preview-close]')) $('battle-case-preview-dialog').close();
        if (event.target.closest('[data-battle-preview-retry]') && state.battleCasePreview) void openBattleCasePreview(state.battleCasePreview.id);
        if (event.target.closest('[data-battle-preview-add]') && state.battleCasePreview?.detail?.case?.available) {
            changeBattleCaseQuantity(state.battleCasePreview.id, 1);
        }
    });
    $('battle-case-preview-dialog').addEventListener('close', () => {
        const id = state.battleCasePreview?.id;
        state.battleCasePreviewSequence++; state.battleCasePreview = null;
        const target = battleCasePreviewFocus?.isConnected ? battleCasePreviewFocus
            : id ? $('battle-case-picker').querySelector(`[data-battle-case-preview="${CSS.escape(id)}"]`) : null;
        if ($('battle-create-dialog').open) (target ?? $('battle-case-search')).focus();
        battleCasePreviewFocus = null;
    });
    $('battle-mode').addEventListener('change', () => { $('battle-mode-note').textContent = ({ regular: 'Tổng giá trị cao nhất thắng toàn bộ skin. Nếu hòa, những người thắng chia phần thưởng thành xu.', crazy: 'Tổng giá trị thấp nhất thắng toàn bộ skin. Nếu hòa, những người thắng chia phần thưởng thành xu.', sharing: 'Tổng giá trị tất cả skin được chia đều thành xu cho mọi người chơi.' })[$('battle-mode').value]; });
    $('battle-create-submit').addEventListener('click', () => void createBattle());
    $('battle-create-dialog').addEventListener('cancel', event => { if (state.battleBusy) event.preventDefault(); });
    window.addEventListener('beforeunload', event => { if (state.opening || state.upgradeBusy || state.battleBusy || state.battleAnimating) { event.preventDefault(); event.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { sound.stopAll?.(); clearTimeout(state.battlePoll); return; }
        if (!state.opening && !state.upgradeBusy && !state.battleAnimating) { void refreshMe(true); if (state.view === 'battles') scheduleBattlePoll(); }
    });
    window.addEventListener('hashchange', () => {
        const code = takeLoginLink();
        if (loginLinkReady) showLinkedLogin(code); else if (code) linkedLoginCode = code;
    });
    async function init() {
        $('client-seed').value = uuid();
        const cataloguePromise = loadCatalogue();
        try { const session = await api('/session'); state.authenticated = session.authenticated === true; state.csrf = session.csrfToken ?? ''; if (state.authenticated) await refreshMe(true); else updateAccount(); } catch (error) { toast(error.message, true); }
        loginLinkReady = true;
        if (linkedLoginCode) { showLinkedLogin(linkedLoginCode); linkedLoginCode = ''; }
        await cataloguePromise;
        const route = location.hash.slice(1);
        if (route.startsWith('case/')) void selectCase(decodeURIComponent(route.slice(5)));
        else setView(['inventory', 'upgrade', 'history', 'battles'].includes(route) ? route : 'cases', { scroll: false });
        setInterval(() => { if (!document.hidden && !state.opening && !state.upgradeBusy && !state.battleAnimating) void refreshMe(true); }, 25000);
    }
    void init();
})();
