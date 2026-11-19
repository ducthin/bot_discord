import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const groups = { casual: 'Khởi đầu', theme: 'Chủ đề', gold: 'Dao & găng', rarity: 'Độ hiếm', weapon: 'Vũ khí' };
const views = ['cases', 'battles', 'upgrade', 'inventory', 'history'];
const openingCounts = [1, 3, 5, 10];

function makeRequestId() { return crypto.randomUUID(); }
function safeRead(key, fallback) { try { return JSON.parse(localStorage.getItem(`may-skins:${key}`)) ?? fallback; } catch { return fallback; } }
function safeWrite(key, value) { try { localStorage.setItem(`may-skins:${key}`, JSON.stringify(value)); } catch {} }
function amount(value) { try { return BigInt(value ?? 0); } catch { return 0n; } }
function coins(value) {
  const numeric = amount(value), positive = numeric < 0n ? -numeric : numeric;
  const whole = (positive / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = positive % 100n;
  return `${numeric < 0n ? '-' : ''}${whole}${decimals ? `.${decimals.toString().padStart(2, '0')}` : ''} xu`;
}
function shortName(value) { return String(value ?? '').replace(/^StatTrak™\s*/u, '').split(' · ')[0]; }
function formatDate(value) { return Number.isFinite(Number(value)) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(value))) : ''; }
function chance(value) { const numeric = Number(value); return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) : '—'; }
function tierClass(item) { return `tier-${Math.max(0, Math.min(4, Number(item?.tier) || 0))}`; }
function imageSource(value) {
  if (typeof value !== 'string') return '';
  if (/^\/play\/(?:art\/(?:skins\/skin-(?:[a-f0-9]{12}|vanilla-weapon_[a-z0-9_]+)\/(?:base|wear-[0-4]|seed-\d{1,4})\.png|battle-[a-z0-9-]+\.png)|bot-avatars\/[a-z0-9-]+\.svg)$/.test(value)) return value;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; }
}

function ImageFrame({ item, className = '' }) {
  const [failed, setFailed] = useState(false);
  const source = imageSource(item?.image);
  return <span className={`app-image ${failed || !source ? 'is-failed' : ''} ${className}`}>
    {source && !failed ? <img src={source} alt={item?.name ?? 'CS2 skin'} loading="lazy" onError={() => setFailed(true)} /> : <span className="image-fallback"><b>◇</b><small>{shortName(item?.name ?? 'CS2')}</small></span>}
  </span>;
}

function ItemCard({ item, selected = false, onClick, compact = false, chanceValue }) {
  const content = <>
    <ImageFrame item={item} />
    <strong>{shortName(item?.name)}</strong>
    <small>{item?.wear ?? item?.rarity ?? 'CS2'}</small>
    {chanceValue != null && <em className="item-chance">{chance(chanceValue)}%</em>}
    <span className="item-price">{item?.valueFormatted ?? coins(item?.value)}</span>
  </>;
  return onClick ? <button className={`item-card ${tierClass(item)} ${compact ? 'is-compact' : ''} ${selected ? 'is-selected' : ''}`} onClick={onClick} aria-pressed={selected}>{content}</button>
    : <article className={`item-card ${tierClass(item)} ${compact ? 'is-compact' : ''}`}>{content}</article>;
}

function Modal({ open, title, eyebrow, onClose, children, actions, className = '' }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`app-modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-close" onClick={onClose} aria-label="Đóng">×</button>
      {eyebrow && <span className="app-eyebrow">{eyebrow}</span>}
      {title && <h2>{title}</h2>}
      <div className="modal-body">{children}</div>
      {actions && <div className="modal-actions">{actions}</div>}
    </section>
  </div>;
}

function Header({ view, navigate, authenticated, me, onLogin, onLogout, audio, onAudioChange, onMenu }) {
  const muted = audio?.status?.().muted === true;
  return <>
    <div className="app-utility"><span>CS2 COMMUNITY · HAPPY HOUSE SCAM CLUB</span><span>Skin ảo · Chơi bằng xu trong bot Discord</span></div>
    <header className="app-header">
      <button className="app-brand" onClick={() => navigate('cases')} aria-label="Trang chủ"><span className="brand-mark">H</span><span><b>Happy house</b><small>Scam Club · CS2</small></span></button>
      <nav className="app-nav" aria-label="Điều hướng"><button className={view === 'cases' || view === 'case' ? 'active' : ''} onClick={() => navigate('cases')}>◇ Mở hòm</button><button className={view === 'battles' ? 'active' : ''} onClick={() => navigate('battles')}>♞ Battle <i>MỚI</i></button><button className={view === 'upgrade' ? 'active' : ''} onClick={() => navigate('upgrade')}>⟐ Upgrade</button><button className={view === 'inventory' ? 'active' : ''} onClick={() => navigate('inventory')}>▱ Kho đồ</button></nav>
      <div className="app-account"><button className="sound-button" id="sound-toggle" onClick={() => onAudioChange()}>{muted ? '♩ Tắt' : '♫ Bật'}</button>{authenticated && <strong className="account-balance">{me?.balanceFormatted ?? '0 xu'}</strong>}{authenticated ? <button className="avatar-button" onClick={onLogout}>{(me?.user?.displayName ?? 'M').slice(0, 1).toUpperCase()}</button> : <button className="sign-button" onClick={onLogin}>Đăng nhập Discord ↗</button>}<button className="menu-button" onClick={onMenu} aria-label="Mở menu">☰</button></div>
    </header>
  </>;
}

function LiveFeed({ catalogue }) {
  const items = catalogue.filter(item => item.available).slice(0, 8);
  return <section className="live-feed"><div className="live-label"><span></span><b>LIVE</b><small>DROP FEED</small></div><div className="live-track">{(items.length ? items : catalogue.slice(0, 4)).map((item, index) => <article className="live-item" key={`${item.id}-${index}`}><ImageFrame item={item} /><div><strong>{item.name}</strong><small>{item.feeFormatted ?? 'CS2 DROP'}</small></div></article>)}</div></section>;
}

function CasesPage({ catalogue, favorites, setFavorites, onSelectCase, onNavigate, authenticated, onLogin }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [sort, setSort] = useState('featured');
  const [slide, setSlide] = useState(0);
  const slides = [
    { title: 'THE GRAND DROP', copy: 'Bộ sưu tập skin hiếm đã cập bến. Mở hòm, săn món rơi đặc biệt.', label: 'LIMITED EVENT' },
    { title: 'PICK YOUR LEGEND', copy: 'Dragon Lore, Howl và những món skin biểu tượng đang chờ bạn.', label: 'ICONIC COLLECTION' },
    { title: 'BATTLE WITH FRIENDS', copy: 'Chọn hòm, lấp đầy phòng và xem kết quả cùng bạn bè Discord.', label: 'PLAY TOGETHER' }
  ];
  const filtered = useMemo(() => {
    let items = catalogue.filter(item => group === 'all' || (group === 'favorites' ? favorites.has(item.id) : item.group === group));
    if (query) items = items.filter(item => `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
    if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (sort === 'low' || sort === 'high') items.sort((a, b) => { const delta = amount(a.fee) - amount(b.fee); return delta === 0n ? 0 : (delta < 0n ? -1 : 1) * (sort === 'low' ? 1 : -1); });
    return items;
  }, [catalogue, favorites, group, query, sort]);
  const toggleFavorite = item => setFavorites(previous => { const next = new Set(previous); next.has(item.id) ? next.delete(item.id) : next.add(item.id); safeWrite('favorites', [...next]); return next; });
  const featured = catalogue.filter(item => item.available).slice(0, 8);
  return <>
    <LiveFeed catalogue={catalogue} />
    <main className="app-main">
      <section className="event-banner"><div className="event-art"><div className="event-crate"><small>CS2</small><b>DROP</b></div><span>✦</span><i></i></div><div className="event-copy"><span className="app-eyebrow">{slides[slide].label}</span><h1>{slides[slide].title}</h1><p>{slides[slide].copy}</p><button className="primary-button" onClick={() => slide === 2 ? onNavigate('battles') : document.getElementById('case-catalogue')?.scrollIntoView({ behavior: 'smooth' })}>Khám phá ngay ↗</button></div><div className="event-dots">{slides.map((_, index) => <button key={index} className={slide === index ? 'active' : ''} onClick={() => setSlide(index)} aria-label={`Banner ${index + 1}`} />)}</div></section>
      <section className="app-hero"><div className="hero-copy"><span className="app-eyebrow">● THE LEGENDS COLLECTION</span><h1>MỞ HÒM.<br /><b>SĂN HUYỀN THOẠI.</b></h1><p>Howl. Dragon Lore. Những skin bạn luôn muốn có.<br />Mở hòm, Upgrade và đấu Battle cùng bạn bè.</p><div className="hero-actions"><button className="primary-button" onClick={() => document.getElementById('case-catalogue')?.scrollIntoView({ behavior: 'smooth' })}>Khám phá hòm ↓</button><button className="ghost-button" onClick={() => onNavigate('battles')}>♞ Vào Case Battle</button></div></div><div className="hero-visual"><div className="hero-glow"></div>{featured[slide % Math.max(1, featured.length)] && <ImageFrame item={featured[slide % featured.length]} />}<span className="hero-tag">THE ICONIC COLLECTION</span><div className="hero-particle p1">✦</div><div className="hero-particle p2">+</div></div></section>
      <section className="catalogue" id="case-catalogue"><div className="section-head"><div><span className="app-eyebrow">CASE COLLECTION</span><h2>CHỌN HÒM CỦA BẠN<span>.</span></h2></div><strong>{filtered.length} / {catalogue.length} hòm</strong></div><div className="catalogue-toolbar"><div className="filter-tabs"><button className={group === 'all' ? 'active' : ''} onClick={() => setGroup('all')}>Tất cả hòm</button>{Object.entries(groups).filter(([key]) => catalogue.some(item => item.group === key)).slice(0, 3).map(([key, label]) => <button key={key} className={group === key ? 'active' : ''} onClick={() => setGroup(key)}>{label}</button>)}<button className={group === 'favorites' ? 'active' : ''} onClick={() => setGroup('favorites')}>♡ Yêu thích</button></div><div className="catalogue-tools"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm Howl, AWP, Dragon..." aria-label="Tìm hòm" /><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sắp xếp"><option value="featured">Nổi bật</option><option value="low">Giá thấp đến cao</option><option value="high">Giá cao đến thấp</option><option value="name">Tên A – Z</option></select></div></div><div className="case-grid">{filtered.map(item => <article className="case-tile" key={item.id}><button className={`favorite ${favorites.has(item.id) ? 'saved' : ''}`} onClick={() => toggleFavorite(item)} aria-label="Yêu thích">{favorites.has(item.id) ? '♥' : '♡'}</button><button className="case-tile-main" onClick={() => onSelectCase(item.id)}><ImageFrame item={item} /><span className="case-group">{groups[item.group] ?? 'CS2 CASE'}</span><h3>{item.name}</h3><strong>{item.feeFormatted ?? 'Chờ giá'}</strong></button></article>)}</div>{!filtered.length && <div className="empty-panel">Chưa tìm thấy hòm phù hợp.</div>}</section>
      <section className="feature-row"><article><b>↔</b><strong>Một tài khoản, một kho đồ</strong><span>Skin nhận trên web đồng bộ với bot Discord.</span></article><article><b>◎</b><strong>Tỷ lệ luôn hiển thị</strong><span>Xem phần thưởng và cơ hội trước mỗi lượt.</span></article><article><b>⟐</b><strong>Upgrade theo cách của bạn</strong><span>Chọn skin, mục tiêu và xem tỷ lệ thực tế.</span></article></section>
      {!authenticated && <div className="login-strip"><span>✦</span><div><strong>Đăng nhập để mở hòm thật</strong><small>Dùng mã một lần từ lệnh /web trong Discord. Bạn vẫn có thể xem toàn bộ danh mục.</small></div><button className="primary-button" onClick={onLogin}>Đăng nhập ↗</button></div>}
    </main>
  </>;
}

function ReelLane({ result, pool, duration, spinning, onDone }) {
  const trackRef = useRef(null);
  const [transform, setTransform] = useState(0);
  const winnerIndex = 32;
  const cards = useMemo(() => { const source = pool.length ? pool : [result]; const output = Array.from({ length: 38 }, (_, index) => source[index % source.length]); output[winnerIndex] = result; return output; }, [pool, result]);
  useEffect(() => {
    if (!spinning) { setTransform(0); return undefined; }
    const animationFrame = requestAnimationFrame(() => {
      const card = trackRef.current?.firstElementChild;
      if (!card) return;
      const width = card.getBoundingClientRect().width, gap = parseFloat(getComputedStyle(trackRef.current).gap) || 0;
      const viewport = trackRef.current.parentElement?.clientWidth ?? 0;
      setTransform(-(winnerIndex * (width + gap) - viewport / 2 + width / 2));
    });
    const timer = setTimeout(onDone, duration + 110);
    return () => { cancelAnimationFrame(animationFrame); clearTimeout(timer); };
  }, [duration, onDone, spinning]);
  return <div className={`reel-lane ${spinning ? 'is-spinning' : ''}`}><span className="reel-pointer">▼</span><div className="reel-window"><div ref={trackRef} className="reel-track" style={{ transform: `translate3d(${transform}px,0,0)`, transition: spinning ? `transform ${duration}ms cubic-bezier(.16,.58,.12,1)` : 'none' }}>{cards.map((item, index) => <div className={`reel-card ${tierClass(item)} ${index === winnerIndex ? 'winner' : ''}`} key={`${item?.id ?? item?.name}-${index}`}><ImageFrame item={item} /><strong>{shortName(item?.name)}</strong><small>{item?.wear ?? item?.rarity ?? 'CS2'}</small></div>)}</div></div></div>;
}

function CasePage({ detail, count, setCount, authenticated, onLogin, api, refreshMe, audio, showToast, onBack }) {
  const [exclusive, setExclusive] = useState(safeRead('exclusive-opening', true) !== false);
  const [fast, setFast] = useState(safeRead('fast', false) === true);
  const [phase, setPhase] = useState('ready');
  const [openResult, setOpenResult] = useState(null);
  const [doneLanes, setDoneLanes] = useState(0);
  const runId = useRef(0);
  const duration = fast ? 1100 : 6200;
  const pool = useMemo(() => (detail?.entries ?? []).filter(item => !item.exclusiveEligible).slice(0, 14), [detail]);
  const finishLane = useCallback(() => setDoneLanes(value => value + 1), []);
  useEffect(() => { if (phase === 'spinning' && openResult?.results?.length && doneLanes >= openResult.results.length) { audio?.reveal?.(openResult.results[0], { caseFee: detail?.fee }); setPhase('revealed'); refreshMe(); } }, [audio, detail?.fee, doneLanes, openResult, phase, refreshMe]);
  const openCase = async () => {
    if (!authenticated) return onLogin();
    if (!detail?.case?.available || phase === 'spinning') return;
    const currentRun = ++runId.current; setOpenResult(null); setDoneLanes(0); setPhase('requesting');
    try {
      const result = await api('/open', { requestId: makeRequestId(), caseId: detail.case.id, count, quoteId: detail.quoteId, exclusiveDrop: exclusive });
      if (currentRun !== runId.current) return;
      setOpenResult(result); setPhase('spinning'); audio?.unlock?.(); audio?.spin?.(duration, { steps: 32, easing: [.16, .58, .12, 1] });
    } catch (error) { setPhase('ready'); showToast(error.message, true); }
  };
  if (!detail) return <main className="app-main"><div className="empty-panel">Đang tải chi tiết hòm...</div></main>;
  return <main className="app-main case-page"><button className="back-link" onClick={onBack}>← Tất cả hòm</button><div className="case-title-row"><div><span className="app-eyebrow">CASE OPENING</span><h1>{detail.case.name}</h1><p>{detail.case.description}</p></div><strong className="case-fee">{detail.case.feeFormatted} <small>/ hòm</small></strong></div><section className="opening-panel"><div className="opening-top"><span>{phase === 'spinning' ? `MỞ ${count} HÒM · ĐANG QUAY` : phase === 'revealed' ? 'KẾT QUẢ ĐÃ VÀO KHO' : 'MÓN SKIN TIẾP THEO CỦA BẠN'}</span><small>{phase === 'requesting' ? 'Đang khóa kết quả trên server...' : phase === 'spinning' ? 'Âm thanh và reel đang chạy' : phase === 'revealed' ? 'Mỗi lượt có biên nhận provably fair' : 'Sẵn sàng'}</small></div><div className="reel-stack">{phase === 'spinning' && openResult ? openResult.results.map((result, index) => <ReelLane key={`${result.id}-${index}`} result={result} pool={pool} duration={duration + index * 80} spinning onDone={finishLane} />) : <div className="idle-reel"><div className="idle-crate">{detail.case.name}</div><span>Chọn số hòm và bắt đầu lượt quay</span></div>}</div>{phase === 'revealed' && <div className="opening-results"><div className="section-head"><div><span className="app-eyebrow">DROP RESULTS</span><h2>Skin vừa nhận ✦</h2></div><strong>{coins(openResult?.total)}</strong></div><div className="item-grid">{openResult?.results?.map(item => <ItemCard item={item} key={item.id} />)}</div></div>}<div className="opening-controls"><div className="count-picker">{openingCounts.map(value => <button key={value} className={count === value ? 'active' : ''} disabled={phase === 'spinning' || phase === 'requesting'} onClick={() => setCount(value)}>{value}</button>)}</div><button className="primary-button open-button" disabled={phase === 'spinning' || phase === 'requesting' || !detail.case.available} onClick={openCase}>{phase === 'requesting' ? 'Đang xác nhận...' : phase === 'spinning' ? 'Đang quay...' : authenticated ? `Mở ${count} hòm · ${coins(amount(detail.fee) * BigInt(count))}` : 'Đăng nhập để mở'}</button><label><input type="checkbox" checked={fast} onChange={event => { setFast(event.target.checked); safeWrite('fast', event.target.checked); }} /> Quay nhanh</label><label><input type="checkbox" checked={exclusive} disabled={!detail.exclusive?.available} onChange={event => { setExclusive(event.target.checked); safeWrite('exclusive-opening', event.target.checked); }} /> ✦ Exclusive Drop</label></div></section><section className="odds-section"><div className="section-head"><div><span className="app-eyebrow">TỶ LỆ RƠI CỦA HÒM</span><h2>Skin và cơ hội nhận được</h2></div><strong>{detail.entries?.length ?? 0} món</strong></div><div className="item-grid">{detail.entries?.map(item => <ItemCard key={item.id} item={item} chanceValue={item.chance} />)}</div></section></main>;
}

function InventoryPage({ me, authenticated, onLogin, api, refreshMe, showToast, onUpgrade }) {
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState('');
  const inventory = me?.inventory ?? [];
  const visible = inventory.filter(item => item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  const toggle = item => setSelected(previous => { const next = new Set(previous); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; });
  const lock = async locked => { if (!selected.size) return showToast('Chọn skin trước.'); try { await api('/locks', { itemIds: [...selected], locked }); setSelected(new Set()); await refreshMe(); showToast(locked ? 'Đã khóa skin.' : 'Đã mở khóa skin.'); } catch (error) { showToast(error.message, true); } };
  const sell = async () => { if (!selected.size) return showToast('Chọn skin trước.'); try { const quote = await api('/sell/quote', { itemIds: [...selected] }); if (!window.confirm(`Bán ${selected.size} skin lấy ${quote.totalFormatted}?`)) return; await api('/sell', { requestId: makeRequestId(), itemIds: [...selected], quoteId: quote.quoteId }); setSelected(new Set()); await refreshMe(); showToast(`Đã cộng ${quote.totalFormatted}.`); } catch (error) { showToast(error.message, true); } };
  if (!authenticated) return <main className="app-main"><PageTitle eyebrow="YOUR COLLECTION" title="Kho đồ của bạn." copy="Skin và số dư được đồng bộ trực tiếp với Discord." /><div className="auth-panel"><span>▱</span><h2>Kho skin đang chờ bạn</h2><p>Đăng nhập bằng mã một lần từ lệnh /web để xem kho.</p><button className="primary-button" onClick={onLogin}>Đăng nhập Discord ↗</button></div></main>;
  return <main className="app-main"><PageTitle eyebrow="YOUR COLLECTION" title="Kho đồ của bạn." copy="Skin nhận từ opening và Battle nằm ở đây." action={<button className="ghost-button" onClick={refreshMe}>↻ Làm mới</button>} /><section className="stat-row"><article><small>SKIN TRONG KHO</small><strong>{me?.inventoryTotal ?? inventory.length}</strong></article><article><small>GIÁ TRỊ ĐÃ CÓ GIÁ</small><strong>{coins(inventory.reduce((sum, item) => sum + amount(item.value), 0n))}</strong></article><article><small>VÍ XU DISCORD</small><strong>{me?.balanceFormatted ?? '0 xu'}</strong></article></section><div className="inventory-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm skin trong kho..." aria-label="Tìm skin" /><span>{selected.size} đã chọn</span><button className="ghost-button" onClick={() => lock(true)}>Khóa</button><button className="ghost-button" onClick={() => lock(false)}>Mở khóa</button><button className="primary-button" onClick={() => onUpgrade(inventory.filter(item => selected.has(item.id)))}>Upgrade</button><button className="danger-button" onClick={sell}>Bán lấy xu</button></div><div className="item-grid inventory-grid">{visible.map(item => <ItemCard item={item} key={item.id} selected={selected.has(item.id)} onClick={() => toggle(item)} />)}</div>{!visible.length && <div className="empty-panel">Kho đồ còn trống.</div>}</main>;
}

function PageTitle({ eyebrow, title, copy, action }) { return <div className="page-title"><div><span className="app-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>; }

function UpgradePage({ me, authenticated, onLogin, api, refreshMe, showToast, initialInputs = [], audio }) {
  const [selected, setSelected] = useState(new Set(initialInputs.map(item => item.id)));
  const [targets, setTargets] = useState([]);
  const [target, setTarget] = useState(null);
  const [query, setQuery] = useState('');
  const [stake, setStake] = useState('0');
  const [seed, setSeed] = useState(makeRequestId());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const inputItems = (me?.inventory ?? []).filter(item => selected.has(item.id));
  useEffect(() => { if (!authenticated) return; let cancelled = false; api(`/targets?search=${encodeURIComponent(query)}&page=0`).then(data => { if (!cancelled) setTargets(data.items ?? []); }).catch(error => showToast(error.message, true)); return () => { cancelled = true; }; }, [api, authenticated, query, showToast]);
  const body = { inputIds: [...selected], targetId: target?.id, coinStake: stake.trim() || '0', clientSeed: seed, direction: 'under' };
  const refreshPreview = useCallback(async () => { setPreview(null); if (!authenticated || !target || !inputItems.length) return; try { setPreview(await api('/upgrade/preview', body)); } catch (error) { showToast(error.message, true); } }, [api, authenticated, inputItems.length, selected, showToast, stake, target, seed]);
  useEffect(() => { void refreshPreview(); }, [refreshPreview]);
  const runUpgrade = async () => { if (!preview || busy) return onLogin(); setBusy(true); setResult(null); try { const prepared = await api('/upgrade/prepare', { ...body, expectedSignature: preview.signature, expectedPrices: preview.prices }); if (!window.confirm(`Xác nhận Upgrade với tỷ lệ ${chance(prepared.attempt.chance)}%?`)) { setBusy(false); return; } const settled = await api('/upgrade/settle', { attemptId: prepared.attempt.id, expectedHash: prepared.attempt.hash, expectedClientSeed: prepared.attempt.clientSeed }); audio?.unlock?.(); const stop = audio?.spin?.(3200, { steps: 30, easing: [.12, .7, .1, 1] }); await new Promise(resolve => setTimeout(resolve, 3250)); stop?.(); audio?.result?.(settled.receipt?.won === true); setResult(settled.receipt); await refreshMe(); setSelected(new Set()); setPreview(null); } catch (error) { showToast(error.message, true); } finally { setBusy(false); } };
  if (!authenticated) return <main className="app-main"><PageTitle eyebrow="AIM A LITTLE HIGHER" title="Upgrade." copy="Đăng nhập để dùng skin và xu từ kho Discord." /><div className="auth-panel"><span>⟐</span><h2>Chọn skin để nâng tầm</h2><button className="primary-button" onClick={onLogin}>Đăng nhập Discord ↗</button></div></main>;
  return <main className="app-main"><PageTitle eyebrow="AIM A LITTLE HIGHER" title="Chọn skin. Nâng tầm." copy="Dùng tối đa 10 skin hoặc xu để thử nhận món giá trị cao hơn." /><section className="upgrade-arena"><article className="upgrade-box"><span className="step-label">01 / NGUYÊN LIỆU</span><div className="selected-summary">{inputItems.length ? inputItems.map(item => <ItemCard item={item} compact key={item.id} />) : <span>Chọn skin từ kho bên dưới</span>}</div><label>Xu bổ sung<input value={stake} onChange={event => setStake(event.target.value)} inputMode="decimal" /></label><strong>Tổng tham gia: {coins((preview?.stake ?? inputItems.reduce((sum, item) => sum + amount(item.value), 0n)) + amount(preview?.coinStake))}</strong></article><div className="upgrade-wheel"><div className={`wheel ${busy ? 'is-spinning' : ''}`}><div><small>TỶ LỆ THÀNH CÔNG</small><strong>{preview ? chance(preview.chance) : '—'}<em>%</em></strong><span>{preview ? `${Number(preview.multiplier ?? 0).toFixed(2)}× GIÁ TRỊ` : 'CHỌN MỤC TIÊU'}</span></div></div><button className="primary-button" disabled={!preview || busy} onClick={runUpgrade}>{busy ? 'Đang quay...' : 'Upgrade ngay ↗'}</button>{result && <div className={`upgrade-result ${result.won ? '' : 'lost'}`}><b>{result.won ? '✦ Upgrade thành công' : 'Chưa trúng skin đích'}</b><span>{result.won ? result.drop?.name : 'Nguyên liệu đã được quyết toán.'}</span></div>}</div><article className="upgrade-box target-box"><span className="step-label">02 / MỤC TIÊU CỦA BẠN</span>{target ? <ItemCard item={target} /> : <div className="target-empty">Chọn một skin bên dưới</div>}<strong>{target?.valueFormatted ?? '—'}</strong></article></section><section className="upgrade-picker"><div className="picker-column"><div className="section-head"><h2>Kho skin của bạn</h2><strong>{selected.size} / 10</strong></div><div className="item-grid compact-grid">{(me?.inventory ?? []).map(item => <ItemCard item={item} compact selected={selected.has(item.id)} onClick={() => setSelected(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else if (next.size < 10) next.add(item.id); return next; })} key={item.id} />)}</div></div><div className="picker-column"><div className="section-head"><h2>Skin mục tiêu</h2><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm Howl, Fade..." aria-label="Tìm mục tiêu" /></div><div className="item-grid compact-grid">{targets.map(item => <ItemCard item={item} compact selected={target?.id === item.id} onClick={() => setTarget(item)} key={item.id} />)}</div></div></section></main>;
}

function BattlePage({ catalogue, authenticated, onLogin, api, refreshMe, audio, showToast }) {
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState(null);
  const [selected, setSelected] = useState(new Map());
  const [creating, setCreating] = useState(false);
  const [capacity, setCapacity] = useState(2);
  const [mode, setMode] = useState('regular');
  const [exclusiveDrop, setExclusiveDrop] = useState(true);
  const [revealIndex, setRevealIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const loadRooms = useCallback(async () => { if (!authenticated) return; try { const data = await api('/battles'); setRooms(data.rooms ?? []); } catch (error) { showToast(error.message, true); } }, [api, authenticated, showToast]);
  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => { if (!room || room.status !== 'finished') return; setRevealIndex(0); const timer = setInterval(() => setRevealIndex(value => value < (room.rounds?.length ?? 0) ? value + 1 : value), 1150); return () => clearInterval(timer); }, [room]);
  useEffect(() => { if (room?.status === 'finished' && revealIndex > 0) { audio?.reveal?.(room.rounds?.[revealIndex - 1]?.entries?.[0]?.item ?? {}, { caseFee: room.fee }); if (revealIndex === 1) audio?.spin?.(8500, { steps: 28, easing: [.16, .58, .12, 1] }); if (revealIndex >= (room.rounds?.length ?? 0)) audio?.result?.(true); } }, [audio, revealIndex, room]);
  const changeQuantity = (id, delta) => setSelected(previous => { const next = new Map(previous), value = Math.max(0, (next.get(id) ?? 0) + delta); value ? next.set(id, value) : next.delete(id); if ([...next.values()].reduce((sum, count) => sum + count, 0) > 20) return previous; return next; });
  const createRoom = async () => { const caseIds = [...selected].flatMap(([id, count]) => Array(count).fill(id)); if (!caseIds.length) return showToast('Chọn ít nhất một hòm.'); setBusy(true); try { const details = await Promise.all([...new Set(caseIds)].map(id => api(`/cases/${encodeURIComponent(id)}`))); const quoteIds = Object.fromEntries(details.map(detail => [detail.case.id, detail.quoteId])); const data = await api('/battles', { requestId: makeRequestId(), caseIds, capacity, mode, exclusiveDrop, quoteIds }); setRoom(data.room); setCreating(false); setSelected(new Map()); showToast('Đã tạo phòng Battle.'); } catch (error) { showToast(error.message, true); } finally { setBusy(false); } };
  const action = async (name, options = {}) => { if (!room || busy) return; if ((name === 'start' || name === 'cancel') && !window.confirm(name === 'start' ? 'Bắt đầu Battle và quyết toán xu?' : 'Hủy phòng Battle?')) return; setBusy(true); try { const data = await api(`/battles/${room.id}/${name}`, { requestId: makeRequestId(), ...options }); setRoom(data.room); await refreshMe(); await loadRooms(); if (data.room.status === 'finished') { audio?.unlock?.(); audio?.spin?.(8500, { steps: 28, easing: [.16, .58, .12, 1] }); } } catch (error) { showToast(error.message, true); } finally { setBusy(false); } };
  if (!authenticated) return <main className="app-main"><PageTitle eyebrow="PLAY TOGETHER" title="CASE BATTLE." copy="Mở cùng hòm với 2–4 người chơi và xem reel từng vị trí." /><div className="auth-panel"><span>♞</span><h2>Vào trận cùng bạn bè</h2><button className="primary-button" onClick={onLogin}>Đăng nhập Discord ↗</button></div></main>;
  const totalSelected = [...selected.values()].reduce((sum, value) => sum + value, 0);
  if (room) return <main className="app-main battle-page"><div className="page-title"><div><button className="back-link" onClick={() => setRoom(null)}>← Tất cả Battle</button><span className="app-eyebrow">PHÒNG {room.id.slice(0, 8).toUpperCase()}</span><h1>{mode === 'crazy' ? 'CRAZY' : mode === 'sharing' ? 'SHARING' : 'REGULAR'} BATTLE</h1><p>{room.status === 'waiting' ? `Đủ ${room.capacity} người để bắt đầu.` : room.status === 'finished' ? 'Kết quả đã được quyết toán trên server.' : 'Phòng Battle'}</p></div><div className="battle-room-actions">{room.canStart && <button className="primary-button" disabled={busy} onClick={() => action('start')}>Bắt đầu trận</button>}{room.canCancel && <button className="danger-button" disabled={busy} onClick={() => action('cancel')}>Hủy phòng</button>}{room.canJoin && <button className="primary-button" disabled={busy} onClick={() => action('join')}>Vào phòng</button>}</div></div>{room.status === 'finished' ? <BattlePlayback room={room} revealIndex={revealIndex} /> : <BattleLobby room={room} action={action} busy={busy} />}</main>;
  return <main className="app-main battle-page"><PageTitle eyebrow="PLAY TOGETHER" title="CASE BATTLE." copy="Chọn hòm, lấp đầy phòng và mở cùng bạn bè." action={<button className="primary-button" onClick={() => setCreating(true)}>＋ Tạo Battle</button>} /><div className="room-list">{rooms.map(entry => <button className="room-row" key={entry.id} onClick={async () => { const data = await api(`/battles/${entry.id}`); setRoom(data.room); }}><span className="room-rounds"><b>{entry.caseIds?.length ?? 0}</b><small>VÒNG</small></span><span><strong>{entry.mode?.toUpperCase()} BATTLE</strong><small>{entry.players?.length ?? 0} / {entry.capacity} người · {formatDate(entry.createdAt)}</small></span><em>{entry.feeFormatted}</em><b>{entry.canJoin ? 'Vào phòng →' : 'Xem trận →'}</b></button>)}</div>{!rooms.length && <div className="empty-panel">Chưa có phòng Battle đang mở.</div>}{creating && <Modal open title="Tạo Case Battle" eyebrow="BUILD YOUR BATTLE" onClose={() => setCreating(false)} actions={<><button className="ghost-button" onClick={() => setCreating(false)}>Quay lại</button><button className="primary-button" disabled={!totalSelected || busy} onClick={createRoom}>{busy ? 'Đang tạo...' : 'Tạo phòng →'}</button></>}><div className="battle-config"><label>Số người<select value={capacity} onChange={event => setCapacity(Number(event.target.value))}><option value="2">2 người</option><option value="3">3 người</option><option value="4">4 người</option></select></label><label>Luật chơi<select value={mode} onChange={event => setMode(event.target.value)}><option value="regular">Thường · Cao nhất thắng</option><option value="crazy">Crazy · Thấp nhất thắng</option><option value="sharing">Chia đều phần thưởng</option></select></label><label className="check-row"><input type="checkbox" checked={exclusiveDrop} onChange={event => setExclusiveDrop(event.target.checked)} /> ✦ Exclusive Drop</label></div><div className="battle-case-picker">{catalogue.filter(item => item.available).map(item => <article className="battle-case-choice" key={item.id}><ImageFrame item={item} /><strong>{item.name}</strong><small>{item.feeFormatted}</small><div><button onClick={() => changeQuantity(item.id, -1)} disabled={!selected.get(item.id)}>−</button><b>{selected.get(item.id) ?? 0}</b><button onClick={() => changeQuantity(item.id, 1)}>＋</button></div></article>)}</div></Modal>}</main>;
}

function BattleLobby({ room, action, busy }) { return <section className="battle-lobby"><div className="seat-grid">{Array.from({ length: room.capacity }, (_, index) => { const player = room.players?.find(entry => entry.seat === index + 1); return <article className={`battle-seat ${player ? '' : 'empty'}`} key={index}><small>VỊ TRÍ {index + 1}</small>{player ? <><div className="seat-avatar">{player.avatar ? <ImageFrame item={{ image: player.avatar, name: player.displayName }} /> : player.displayName.slice(0, 1)}</div><strong>{player.displayName}</strong>{player.isBot && <em>BOT</em>}</> : <><b>＋</b><span>Chỗ trống</span>{room.canJoin && <button className="ghost-button" disabled={busy} onClick={() => action('seat', { seat: index + 1 })}>Ngồi chỗ này</button>}{room.canAddBot && <button className="ghost-button" disabled={busy} onClick={() => action('bot', { seat: index + 1 })}>＋ Thêm Bot</button>}</>}</article>; })}</div><div className="battle-case-track">{(room.cases ?? []).map((item, index) => <span key={`${item.id}-${index}`}><ImageFrame item={item} /><small>{index + 1}</small></span>)}</div></section>; }

function BattlePlayback({ room, revealIndex }) { const rounds = room.rounds ?? []; return <section className="battle-playback"><div className="battle-progress"><span>ROUND {Math.min(revealIndex, rounds.length)} / {rounds.length}</span><i style={{ width: `${rounds.length ? Math.min(100, (revealIndex / rounds.length) * 100) : 0}%` }} /></div><div className="battle-lanes">{(room.players ?? []).map(player => <article className="battle-lane" key={player.userId}><header><span className="seat-avatar">{player.displayName.slice(0, 1)}</span><strong>{player.displayName}</strong><small>{coins(Object.values(room.totals ?? {})[0] ?? 0)}</small></header><div className="battle-vertical-reel">{rounds.slice(0, Math.max(1, revealIndex)).map((round, index) => { const entry = round.entries?.find(item => item.userId === player.userId); return <div className={`battle-drop ${tierClass(entry?.item)}`} key={`${round.caseId}-${index}`}><ImageFrame item={entry?.item} /><strong>{shortName(entry?.item?.name ?? 'Đang quay')}</strong><small>{entry?.valueFormatted ?? '...'}</small></div>; })}</div></article>)}</div>{revealIndex >= rounds.length && <div className="battle-finished">✦ TRẬN ĐÃ HOÀN TẤT · KẾT QUẢ ĐÃ LƯU</div>}</section>; }

function HistoryPage({ me, authenticated, onLogin }) { if (!authenticated) return <main className="app-main"><PageTitle eyebrow="YOUR RECENT ACTIVITY" title="Lịch sử của bạn." copy="Các lượt mở hòm, bán skin, Upgrade và Battle." /><div className="auth-panel"><span>◷</span><h2>Đăng nhập để xem lịch sử</h2><button className="primary-button" onClick={onLogin}>Đăng nhập Discord ↗</button></div></main>; const entries = [...(me?.history ?? []), ...(me?.upgrade?.history ?? [])].sort((a, b) => (b.at ?? b.createdAt ?? 0) - (a.at ?? a.createdAt ?? 0)); return <main className="app-main"><PageTitle eyebrow="YOUR RECENT ACTIVITY" title="Lịch sử của bạn." copy="Biên nhận và các lượt chơi gần đây." /><div className="history-list">{entries.map((entry, index) => <article key={`${entry.requestId ?? entry.id ?? index}-${index}`}><span>{entry.action?.startsWith('battle') ? '♞' : entry.action === 'upgrade' ? '⟐' : '◇'}</span><div><strong>{entry.action ?? 'Mở hòm'}</strong><small>{entry.message ?? entry.caseName ?? entry.target?.name ?? ''}</small></div><em>{entry.totalFormatted ?? (entry.chance ? `${chance(entry.chance)}%` : '')}<small>{formatDate(entry.at ?? entry.createdAt)}</small></em></article>)}</div>{!entries.length && <div className="empty-panel">Chưa có lượt chơi trên web.</div>}</main>; }

function App() {
  const csrfRef = useRef('');
  const audioRef = useRef(null);
  const [catalogue, setCatalogue] = useState([]);
  const [view, setView] = useState('cases');
  const [caseId, setCaseId] = useState('');
  const [detail, setDetail] = useState(null);
  const [count, setCount] = useState(1);
  const [authenticated, setAuthenticated] = useState(false);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set(safeRead('favorites', [])));
  const [upgradeInputs, setUpgradeInputs] = useState([]);
  const [, forceAudioRefresh] = useState(0);
  const notify = useCallback((message, error = false) => { setToast({ message, error }); window.setTimeout(() => setToast(null), error ? 6500 : 4000); }, []);
  const api = useCallback(async (path, body) => {
    const response = await fetch(`/play/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfRef.current }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401 && path !== '/login') { setAuthenticated(false); setMe(null); csrfRef.current = ''; } throw Object.assign(new Error(data.message ?? 'Không thể xử lý yêu cầu.'), { status: response.status }); }
    if (data.csrfToken) csrfRef.current = data.csrfToken;
    return data;
  }, []);
  const refreshMe = useCallback(async () => { if (!authenticated) return null; try { const data = await api('/me'); setMe(data); return data; } catch (error) { notify(error.message, true); return null; } }, [api, authenticated, notify]);
  const navigate = useCallback(next => {
    setMenuOpen(false);
    if (!views.includes(next)) next = 'cases';
    setView(next); setDetail(null); setCaseId(''); setUpgradeInputs([]);
    history.replaceState(null, '', `#${next}`);
    document.title = `${({ cases: 'Mở hòm', battles: 'Case Battle', upgrade: 'Upgrade', inventory: 'Kho đồ', history: 'Lịch sử' })[next]} · Happy house Scam Club`;
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (next !== 'cases' && authenticated) void refreshMe();
  }, [authenticated, refreshMe]);
  const selectCase = useCallback(async id => {
    try { const data = await api(`/cases/${encodeURIComponent(id)}`); setDetail(data); setCaseId(id); setView('case'); history.replaceState(null, '', `#case/${encodeURIComponent(id)}`); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (error) { notify(error.message, true); }
  }, [api, notify]);
  useEffect(() => {
    audioRef.current = window.MaySkinsAudio?.create({ safeRead, safeWrite });
    const initialHash = decodeURIComponent(location.hash.slice(1));
    const match = /^case\/(battle-[a-z0-9-]+)$/.exec(initialHash);
    if (match) { void selectCase(match[1]); }
    else if (views.includes(initialHash)) setView(initialHash);
    Promise.all([api('/catalogue'), api('/session')]).then(async ([cases, session]) => {
      setCatalogue(cases.cases ?? []); setAuthenticated(session.authenticated === true); csrfRef.current = session.csrfToken ?? '';
      if (session.authenticated) setMe(await api('/me'));
    }).catch(error => notify(error.message, true)).finally(() => setLoading(false));
    const onHash = () => { const hash = decodeURIComponent(location.hash.slice(1)); const target = /^case\/(battle-[a-z0-9-]+)$/.exec(hash); if (target) void selectCase(target[1]); else if (views.includes(hash)) { setView(hash); setDetail(null); } };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); audioRef.current?.destroy?.(); };
  }, []);
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(null), toast.error ? 6500 : 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (!authenticated) return undefined; const timer = window.setInterval(() => { if (!document.hidden) void refreshMe(); }, 25000); return () => clearInterval(timer); }, [authenticated, refreshMe]);
  const openLogin = () => { setLoginError(''); const fragment = location.hash.startsWith('#login=') ? new URLSearchParams(location.hash.slice(1)).get('login') : ''; if (fragment && /^[A-HJ-NP-Z2-9-]{16,19}$/i.test(fragment)) setLoginCode(fragment.toUpperCase()); setLoginOpen(true); };
  const submitLogin = async event => { event.preventDefault(); if (!/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/i.test(loginCode.trim())) { setLoginError('Nhập mã 16 ký tự lấy từ lệnh /web trong Discord.'); return; } setLoginBusy(true); setLoginError(''); try { const session = await api('/login', { code: loginCode.trim().toUpperCase() }); csrfRef.current = session.csrfToken ?? ''; setAuthenticated(true); setMe(await api('/me')); setLoginOpen(false); setLoginCode(''); notify('Đã kết nối tài khoản Discord.'); } catch (error) { setLoginError(error.message); } finally { setLoginBusy(false); } };
  const logout = async () => { if (!window.confirm('Đăng xuất khỏi tài khoản Discord?')) return; try { await api('/logout', {}); setAuthenticated(false); setMe(null); csrfRef.current = ''; notify('Đã đăng xuất.'); } catch (error) { notify(error.message, true); } };
  const audio = audioRef.current;
  const refreshAudio = () => { audioRef.current?.toggle?.(); forceAudioRefresh(value => value + 1); };
  const startUpgradeWith = items => { setUpgradeInputs(items); navigate('upgrade'); };
  if (loading) return <div className="app-loading"><span className="brand-symbol">H</span><strong>HAPPY HOUSE SCAM CLUB</strong><span>Đang tải sảnh CS2...</span></div>;
  return <div className="app-shell"><Header view={view} navigate={navigate} authenticated={authenticated} me={me} onLogin={openLogin} onLogout={logout} audio={audio} onAudioChange={refreshAudio} onMenu={() => setMenuOpen(true)} /><div className="connection-line"><span></span>Xu và kho skin đồng bộ với bot Discord<span>Chơi bằng xu ảo · Không phải vật phẩm Steam</span></div>
    {view === 'cases' && <CasesPage catalogue={catalogue} favorites={favorites} setFavorites={setFavorites} onSelectCase={selectCase} onNavigate={navigate} authenticated={authenticated} onLogin={openLogin} />}
    {view === 'case' && <CasePage detail={detail} count={count} setCount={setCount} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} audio={audio} showToast={notify} onBack={() => navigate('cases')} />}
    {view === 'inventory' && <InventoryPage me={me} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} showToast={notify} onUpgrade={startUpgradeWith} />}
    {view === 'upgrade' && <UpgradePage key={upgradeInputs.map(item => item.id).join(':')} me={me} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} showToast={notify} initialInputs={upgradeInputs} audio={audio} />}
    {view === 'battles' && <BattlePage catalogue={catalogue} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} audio={audio} showToast={notify} />}
    {view === 'history' && <HistoryPage me={me} authenticated={authenticated} onLogin={openLogin} />}
    <footer className="app-footer"><b>Happy house Scam Club</b><span>Skin mô phỏng · Xu ảo · Đồng bộ với bot Discord</span></footer>
    <nav className="mobile-nav">{[['cases', '⌂', 'MAIN'], ['battles', '♞', 'BATTLES'], ['upgrade', '⟐', 'UPGRADE'], ['inventory', '▱', 'KHO'], ['menu', '☰', 'MENU']].map(([name, icon, label]) => <button key={name} className={(view === name || name === 'cases' && view === 'case') ? 'active' : ''} onClick={() => name === 'menu' ? setMenuOpen(true) : navigate(name)}><span>{icon}</span><small>{label}</small></button>)}</nav>
    {toast && <div className={`app-toast ${toast.error ? 'error' : ''}`} role="status">{toast.message}</div>}
    <Modal open={loginOpen} title="Kết nối với Discord" eyebrow="MỘT TÀI KHOẢN · MỘT KHO ĐỒ" onClose={() => setLoginOpen(false)}><form className="login-form" onSubmit={submitLogin}><p>Dùng lệnh <strong>/web</strong> trong Discord để lấy mã một lần. Không nhập mật khẩu hoặc Discord token.</p><label>Mã đăng nhập<input autoFocus value={loginCode} onChange={event => setLoginCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH-JKLM-NPQR" maxLength={19} autoComplete="one-time-code" /></label>{loginError && <p className="form-error">{loginError}</p>}<button className="primary-button" disabled={loginBusy}>{loginBusy ? 'Đang kết nối...' : 'Vào kho của tôi ↗'}</button></form></Modal>
    <Modal open={menuOpen} title="MENU" eyebrow="HAPPY HOUSE SCAM CLUB" onClose={() => setMenuOpen(false)} className="menu-modal"><div className="menu-links">{[['cases', '⌂', 'Main'], ['battles', '♞', 'Battles'], ['upgrade', '⟐', 'Upgrade'], ['inventory', '▱', 'Kho đồ'], ['history', '◷', 'Lịch sử']].map(([target, icon, label]) => <button key={target} onClick={() => navigate(target)}><span>{icon}</span>{label} →</button>)}</div><div className="menu-balance"><span>● Hệ thống hoạt động</span><strong>{authenticated ? me?.balanceFormatted : 'Chơi bằng xu ảo'}</strong></div></Modal>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);


