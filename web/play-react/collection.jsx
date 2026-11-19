import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageFrame, ItemCard, Modal, PageTitle, coins, amount, chance, shortName, makeRequestId } from './shared';
import { TICKETS, normalizeStart, startTicketFor, ticketAtPoint, moveWinRegion, winningRanges, suitableTarget } from './upgrade';
import './collection.css';

const PAGE_SIZE = 24;
function minorInput(value) {
  const match = /^(\d{1,36})(?:[.,](\d{1,2}))?$/.exec(String(value).trim());
  return match ? BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0')) : null;
}
function plainCoins(value) { const n = amount(value); return String(n / 100n) + '.' + String(n % 100n).padStart(2, '0'); }
function eligible(item) { return !item.locked && item.upgradeEligible === true && item.value != null; }
function Pager({ page, pages, onChange, busy = false }) {
  return <div className="ci-pager"><button className="ghost-button" disabled={busy || page <= 0} onClick={() => onChange(page - 1)} aria-label="Trang trước">←</button><span>{page + 1} / {Math.max(1, pages)}</span><button className="ghost-button" disabled={busy || page >= pages - 1} onClick={() => onChange(page + 1)} aria-label="Trang sau">→</button></div>;
}
function AuthCollection({ onLogin, upgrade = false }) {
  return <main className="app-main ci-page"><PageTitle eyebrow={upgrade ? 'AIM A LITTLE HIGHER' : 'YOUR COLLECTION'} title={upgrade ? 'UPGRADE' : 'KHO SKIN'} copy="Kết nối tài khoản Discord để sử dụng kho skin và ví xu của bạn." /><div className="auth-panel"><span>{upgrade ? '⟐' : '▱'}</span><h2>{upgrade ? 'Nâng tầm bộ sưu tập' : 'Bộ sưu tập của bạn đang chờ'}</h2><p>Lấy mã đăng nhập bằng lệnh /web trong máy chủ Discord.</p><button className="primary-button" onClick={onLogin}>Đăng nhập Discord ↗</button></div></main>;
}

export function InventoryPage({ me, authenticated, onLogin, api, refreshMe, showToast, onUpgrade }) {
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const busyRef = useRef(false);
  const inventory = me?.inventory ?? [];
  const idsKey = inventory.map(item => item.id).join('|');
  useEffect(() => { const ids = new Set(inventory.map(item => item.id)); setSelected(previous => new Set([...previous].filter(id => ids.has(id)))); }, [idsKey]);
  useEffect(() => { setPage(0); }, [query, filter, sort]);
  const filtered = useMemo(() => {
    const values = inventory.filter(item => item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')) && (filter === 'all' || (filter === 'locked' ? item.locked : !item.locked)));
    if (sort !== 'new') values.sort((a, b) => { const delta = amount(a.value) - amount(b.value); return delta === 0n ? 0 : (delta < 0n ? -1 : 1) * (sort === 'low' ? 1 : -1); });
    return values;
  }, [inventory, query, filter, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const chosen = inventory.filter(item => selected.has(item.id));
  const sellable = chosen.length > 0 && chosen.every(item => !item.locked && item.value != null);
  const upgradeable = chosen.length > 0 && chosen.every(eligible);
  const allUpgradeable = inventory.filter(eligible);
  function toggle(item) {
    if (busyRef.current) return;
    setSelected(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else if (next.size < 50) next.add(item.id); else showToast('Chọn tối đa 50 skin trong một thao tác.'); return next; });
  }
  function selectPage() {
    if (busyRef.current) return;
    setSelected(previous => { const next = new Set(previous), all = visible.every(item => next.has(item.id)); for (const item of visible) { if (all) next.delete(item.id); else if (next.size < 50) next.add(item.id); } return next; });
  }
  async function lock(locked) {
    if (busyRef.current || !chosen.length) return;
    busyRef.current = true; setBusy(true);
    try { await api('/locks', { itemIds: chosen.map(item => item.id), locked }); setSelected(new Set()); await refreshMe(); showToast(locked ? 'Đã khóa các skin đã chọn.' : 'Đã mở khóa các skin đã chọn.'); }
    catch (error) { showToast(error.message, true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function getSale() {
    if (busyRef.current || !sellable) return;
    busyRef.current = true; setBusy(true);
    try { const itemIds = chosen.map(item => item.id); const result = await api('/sell/quote', { itemIds }); setQuote({ ...result, itemIds, requestId: makeRequestId() }); }
    catch (error) { showToast(error.message, true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function sell() {
    if (busyRef.current || !quote) return;
    busyRef.current = true; setBusy(true);
    try { const result = await api('/sell', { requestId: quote.requestId, itemIds: quote.itemIds, quoteId: quote.quoteId }); setQuote(null); setSelected(new Set()); await refreshMe(); showToast('Đã cộng ' + result.totalFormatted + ' vào ví.'); }
    catch (error) { if (error.status && error.status < 500) setQuote(null); showToast(error.message, true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (!authenticated) return <AuthCollection onLogin={onLogin} />;
  return <main className="app-main ci-page"><PageTitle eyebrow="YOUR COLLECTION" title="KHO SKIN" copy="Bộ sưu tập của bạn · Đồng bộ cùng Discord" action={<button className="ghost-button" disabled={busy} onClick={refreshMe}>↻ Làm mới</button>} />
    <section className="ci-stats"><article><small>SKIN TRONG KHO</small><strong>{me?.inventoryTotal ?? inventory.length}</strong></article><article><small>GIÁ TRỊ CÓ BÁO GIÁ</small><strong>{coins(inventory.reduce((sum, item) => sum + amount(item.value), 0n))}</strong></article><article><small>SỐ DƯ KHẢ DỤNG</small><strong>{me?.balanceFormatted}</strong></article></section>
    <div className="ci-toolbar"><div className="ci-tabs">{[['all', 'Tất cả'], ['unlocked', 'Đã mở khóa'], ['locked', 'Đang khóa']].map(([value, title]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{title}</button>)}</div><input aria-label="Tìm skin" placeholder="Tìm skin trong kho..." value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Sắp xếp kho đồ" value={sort} onChange={event => setSort(event.target.value)}><option value="new">Mới nhất</option><option value="high">Giá cao đến thấp</option><option value="low">Giá thấp đến cao</option></select></div>
    <div className="ci-selection-bar"><button className="ghost-button" disabled={busy || !visible.length} onClick={selectPage}>{visible.length && visible.every(item => selected.has(item.id)) ? 'Bỏ chọn trang' : 'Chọn trang này'}</button><span>{selected.size} / 50 đã chọn <b>{coins(chosen.reduce((sum, item) => sum + amount(item.value), 0n))}</b></span><button className="ghost-button" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Bỏ chọn</button><button className="ghost-button" disabled={busy || !selected.size} onClick={() => lock(!chosen.every(item => item.locked))}>{chosen.length && chosen.every(item => item.locked) ? 'Mở khóa' : 'Khóa skin'}</button><button className="ghost-button" disabled={busy || !upgradeable} onClick={() => onUpgrade(chosen)}>⟐ Upgrade</button><button className="ghost-button" disabled={busy || !allUpgradeable.length} onClick={() => onUpgrade(allUpgradeable)}>Upgrade toàn bộ kho · {allUpgradeable.length}</button><button className="primary-button" disabled={busy || !sellable} onClick={getSale}>{busy ? 'Đang xử lý...' : 'Bán lấy xu'}</button></div>
    <div className="ci-inventory-grid">{visible.map(item => <div key={item.id} className="ci-inventory-item"><ItemCard item={item} selected={selected.has(item.id)} onClick={() => toggle(item)} />{item.locked && <span className="ci-lock" title="Skin đang khóa">▣ Đã khóa</span>}{item.exclusiveDrop && <span className="ci-exclusive">✦ EXCLUSIVE</span>}<small className="ci-float">{item.float != null ? 'Float ' + Number(item.float).toFixed(5) : item.wear || 'CS2'}{item.paintSeed != null ? ' · #' + item.paintSeed : ''}</small></div>)}</div>
    {!visible.length && <div className="empty-panel">{inventory.length ? 'Không tìm thấy skin phù hợp.' : 'Kho đồ còn trống. Mở hòm để bắt đầu bộ sưu tập.'}</div>}
    <Pager page={currentPage} pages={pages} onChange={setPage} busy={busy} />
    {Number(me?.inventoryTotal) > inventory.length && <p className="ci-note">Đang hiển thị {inventory.length} skin mới nhất trong {me.inventoryTotal} món. Dùng /hom trong Discord để xem toàn bộ kho.</p>}
    <Modal open={Boolean(quote)} title="Bán skin lấy xu" eyebrow="KIỂM TRA LỰA CHỌN" onClose={() => { if (!busyRef.current) setQuote(null); }} actions={<><button className="ghost-button" disabled={busy} onClick={() => setQuote(null)}>Quay lại</button><button className="primary-button" disabled={busy} onClick={sell}>{busy ? 'Đang bán...' : 'Xác nhận bán'}</button></>}><p>Bán {quote?.itemIds?.length} skin đã chọn và cộng xu vào ví.</p><div className="ci-confirm-value"><span>Bạn nhận được</span><strong>{quote?.totalFormatted}</strong></div><div className="ci-sale-items">{quote?.items?.map(item => <div key={item.id}><ImageFrame item={item} /><span>{shortName(item.name)}</span><strong>{item.valueFormatted}</strong></div>)}</div></Modal>
  </main>;
}

function marketPageCount(data) { return Math.max(1, Number(data?.pages ?? (data?.total ? Math.ceil(Number(data.total) / 24) : 1)) || 1); }
function MarketListingCard({ listing, onBuy, onCancel, busy }) {
  const item = listing.item ?? listing.drop;
  return <article className="cm-listing-card"><div className="cm-listing-art"><ImageFrame item={item} /></div><div className="cm-listing-info"><strong>{shortName(item?.name ?? 'Skin')}</strong><small>{item?.wear ?? item?.rarity ?? 'CS2'}{item?.paintSeed != null ? ' · #' + item.paintSeed : ''}</small><span>{listing.own ? 'Tin của bạn' : 'Người bán: ' + (listing.sellerName ?? listing.sellerId ?? 'Người chơi')}</span></div><div className="cm-listing-price"><strong>{listing.priceFormatted ?? coins(listing.price)}</strong>{listing.marketValueFormatted && <small>Giá tham khảo {listing.marketValueFormatted}</small>}{listing.own ? <button className="ghost-button" disabled={busy} onClick={() => onCancel(listing)}>Hủy bán</button> : <button className="primary-button" disabled={busy} onClick={() => onBuy(listing)}>Mua skin</button>}</div></article>;
}

export function MarketPage({ me, authenticated, onLogin, api, refreshMe, showToast }) {
  const [tab, setTab] = useState('browse');
  const [listings, setListings] = useState([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listingItem, setListingItem] = useState(null);
  const [listingPrice, setListingPrice] = useState('');
  const [buying, setBuying] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [recipientId, setRecipientId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferQuote, setTransferQuote] = useState(null);
  const inventory = me?.inventory ?? [];
  const sellable = inventory.filter(item => !item.locked && item.value != null);
  const load = async () => {
    if (!authenticated) return;
    setLoading(true);
    try { const data = await api('/market?page=' + page + '&mine=' + (tab === 'mine' ? '1' : '0')); setListings(data.listings ?? []); setPages(marketPageCount(data)); }
    catch (error) { showToast(error.message, true); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [authenticated, tab, page]);
  useEffect(() => { setPage(0); }, [tab]);
  const openListing = item => { setListingItem(item); setListingPrice(item.value == null ? '' : plainCoins(item.value)); };
  const listItem = async () => {
    if (!listingItem || !listingPrice.trim() || busy) return;
    setBusy(true);
    try { await api('/market/list', { requestId: makeRequestId(), itemId: listingItem.id, price: listingPrice.trim(), expectedMarketValue: listingItem.value }); setListingItem(null); await refreshMe(); await load(); showToast('Đã đăng skin lên Chợ người chơi.'); }
    catch (error) { showToast(error.message, true); }
    finally { setBusy(false); }
  };
  const buy = async () => {
    if (!buying || busy) return;
    setBusy(true);
    try { const data = await api('/market/buy', { requestId: makeRequestId(), listingId: buying.listingId }); setBuying(null); await refreshMe(); await load(); showToast(data.replayed ? 'Giao dịch mua skin đã được xác nhận trước đó.' : 'Đã mua skin thành công.'); }
    catch (error) { showToast(error.message, true); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!cancelling || busy) return;
    setBusy(true);
    try { await api('/market/cancel', { requestId: makeRequestId(), listingId: cancelling.listingId }); setCancelling(null); await refreshMe(); await load(); showToast('Đã hủy tin đăng và trả skin về kho.'); }
    catch (error) { showToast(error.message, true); }
    finally { setBusy(false); }
  };
  const quoteTransfer = async event => {
    event.preventDefault();
    if (!recipientId.trim() || !transferAmount.trim() || busy) return;
    setBusy(true);
    try { setTransferQuote(await api('/transfer/quote', { recipientId: recipientId.trim(), amount: transferAmount.trim() })); }
    catch (error) { showToast(error.message, true); }
    finally { setBusy(false); }
  };
  const transfer = async () => {
    if (!transferQuote || busy) return;
    setBusy(true);
    try { await api('/transfer', { requestId: makeRequestId(), recipientId: transferQuote.recipientId, amount: transferQuote.amountInput }); setTransferQuote(null); setRecipientId(''); setTransferAmount(''); await refreshMe(); showToast('Đã chuyển xu cho ' + (transferQuote.recipientName ?? 'người chơi') + '.'); }
    catch (error) { await refreshMe(); showToast(error.message, true); }
    finally { setBusy(false); }
  };
  if (!authenticated) return <AuthCollection onLogin={onLogin} />;
  return <main className="app-main ci-page"><PageTitle eyebrow="PLAYER MARKET" title="CHỢ NGƯỜI CHƠI" copy="Mua bán skin và chuyển xu trong cùng máy chủ Discord." action={<button className="ghost-button" disabled={loading || busy} onClick={load}>↻ Làm mới</button>} />
    <section className="cm-wallet-bar"><div><small>SỐ DƯ CỦA BẠN</small><strong>{me?.balanceFormatted}</strong></div><form onSubmit={quoteTransfer} className="cm-transfer-form"><label><span>ID Discord người nhận</span><input inputMode="numeric" pattern="[0-9]*" value={recipientId} onChange={event => setRecipientId(event.target.value.replace(/\D/g, ''))} placeholder="Ví dụ: 123456789012345678" maxLength={20} /></label><label><span>Số xu</span><input inputMode="decimal" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} placeholder="0,00" maxLength={40} /></label><button className="primary-button" disabled={busy || !recipientId || !transferAmount}>Kiểm tra chuyển xu</button></form></section>
    <div className="cm-tabs"><button className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}>Đang rao bán</button><button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>Tin của tôi</button><button className="ghost-button" onClick={() => setListingItem(sellable[0] ?? null)} disabled={!sellable.length || busy}>＋ Đăng skin</button></div>
    <p className="ci-note">Skin được giữ trong tin đăng cho đến khi bán hoặc hủy. Mọi giao dịch đều kiểm tra lại quyền sở hữu, số dư và giá trước khi hoàn tất.</p>
    <div className="cm-listings">{loading ? <div className="empty-panel">Đang tải Chợ người chơi...</div> : listings.map(listing => <MarketListingCard key={listing.listingId} listing={listing} onBuy={setBuying} onCancel={setCancelling} busy={busy} />)}</div>
    {!loading && !listings.length && <div className="empty-panel">{tab === 'mine' ? 'Bạn chưa có tin đăng nào.' : 'Chưa có skin nào đang được rao bán.'}</div>}
    {pages > 1 && <Pager page={page} pages={pages} onChange={setPage} busy={loading || busy} />}
    <Modal open={Boolean(listingItem)} title="Đăng skin lên Chợ" eyebrow="BÁN CHO NGƯỜI CHƠI KHÁC" onClose={() => { if (!busy) setListingItem(null); }} actions={<><button className="ghost-button" disabled={busy} onClick={() => setListingItem(null)}>Quay lại</button><button className="primary-button" disabled={busy || !listingPrice.trim()} onClick={listItem}>{busy ? 'Đang đăng...' : 'Đăng bán'}</button></>}><label className="cm-price-field">Chọn skin<select value={listingItem?.id ?? ''} disabled={busy} onChange={event => openListing(sellable.find(item => item.id === event.target.value))}>{sellable.map(item => <option key={item.id} value={item.id}>{shortName(item.name)} · {item.valueFormatted}</option>)}</select></label><div className="cm-modal-item"><ImageFrame item={listingItem} /><strong>{shortName(listingItem?.name ?? 'Skin')}</strong></div><div className="cm-confirm-market"><span>Giá thị trường hiện tại</span><strong>{listingItem?.valueFormatted ?? coins(listingItem?.value)}</strong></div><label className="cm-price-field">Giá bán của bạn (xu)<input autoFocus inputMode="decimal" value={listingPrice} onChange={event => setListingPrice(event.target.value)} placeholder="Nhập giá, ví dụ 1250,00" maxLength={40} /></label><p>Skin sẽ tạm rời kho và chỉ trở lại khi bạn hủy tin đăng. Giá tham khảo sẽ được kiểm tra lại trước khi đăng.</p></Modal>
    <Modal open={Boolean(buying)} title="Xác nhận mua skin" eyebrow="GIAO DỊCH CHỢ NGƯỜI CHƠI" onClose={() => { if (!busy) setBuying(null); }} actions={<><button className="ghost-button" disabled={busy} onClick={() => setBuying(null)}>Quay lại</button><button className="primary-button" disabled={busy} onClick={buy}>{busy ? 'Đang mua...' : 'Xác nhận mua'}</button></>}><p>Bạn muốn mua <strong>{shortName(buying?.item?.name ?? buying?.drop?.name ?? 'skin')}</strong> với giá <strong>{buying?.priceFormatted}</strong>?</p><p>Xu sẽ chuyển cho người bán và skin được đưa vào kho của bạn ngay sau giao dịch.</p></Modal>
    <Modal open={Boolean(cancelling)} title="Hủy tin đăng" eyebrow="TRẢ SKIN VỀ KHO" onClose={() => { if (!busy) setCancelling(null); }} actions={<><button className="ghost-button" disabled={busy} onClick={() => setCancelling(null)}>Quay lại</button><button className="primary-button" disabled={busy} onClick={cancel}>{busy ? 'Đang hủy...' : 'Xác nhận hủy'}</button></>}><p>Hủy tin <strong>{shortName(cancelling?.item?.name ?? cancelling?.drop?.name ?? 'skin')}</strong> và trả skin về kho?</p></Modal>
    <Modal open={Boolean(transferQuote)} title="Xác nhận chuyển xu" eyebrow="CHUYỂN TRONG CÙNG MÁY CHỦ" onClose={() => { if (!busy) setTransferQuote(null); }} actions={<><button className="ghost-button" disabled={busy} onClick={() => setTransferQuote(null)}>Quay lại</button><button className="primary-button" disabled={busy} onClick={transfer}>{busy ? 'Đang chuyển...' : 'Xác nhận chuyển'}</button></>}><div className="cm-transfer-summary"><div><span>Người nhận</span><strong>{transferQuote?.recipientName ?? transferQuote?.recipientId}</strong></div><div><span>Số dư hiện tại</span><strong>{transferQuote?.balanceFormatted}</strong></div><div><span>Số xu chuyển</span><strong>{transferQuote?.amountFormatted}</strong></div>{transferQuote?.feeFormatted && <div><span>Phí</span><strong>{transferQuote.feeFormatted}</strong></div>}<div><span>Số dư sau giao dịch</span><strong>{transferQuote?.balanceAfterFormatted ?? transferQuote?.balanceFormatted}</strong></div></div><p>Kiểm tra đúng người nhận trước khi xác nhận. Chuyển xu đã hoàn tất sẽ không tự hoàn tác.</p></Modal>
  </main>;
}

export function UpgradePage({ me, authenticated, onLogin, api, refreshMe, showToast, initialInputs = [], audio }) {
  const [selected, setSelected] = useState(() => new Set(initialInputs.filter(item => !item.locked).map(item => item.id)));
  const [target, setTarget] = useState(null);
  const [targets, setTargets] = useState({ items: [], total: 0, pages: 1, page: 0 });
  const [targetQuery, setTargetQuery] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [targetPage, setTargetPage] = useState(0);
  const [inventoryPage, setInventoryPage] = useState(0);
  const [multiplier, setMultiplier] = useState(2);
  const [stake, setStake] = useState('0');
  const [direction, setDirection] = useState('under');
  const [startTicket, setStartTicket] = useState(0);
  const [autoSelecting, setAutoSelecting] = useState(false);
  const [autoStatus, setAutoStatus] = useState('');
  const [seed, setSeed] = useState(makeRequestId);
  const [preview, setPreview] = useState(null);
  const [previewStatus, setPreviewStatus] = useState('Chọn nguyên liệu và mục tiêu để xem tỷ lệ.');
  const [targetBusy, setTargetBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [result, setResult] = useState(null);
  const [proof, setProof] = useState(null);
  const [angle, setAngle] = useState(0);
  const [wheelDuration, setWheelDuration] = useState(0);
  const [spinPlan, setSpinPlan] = useState(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const busyRef = useRef(false), mounted = useRef(true), stopAudio = useRef(null), settleTimer = useRef(null), settleResolve = useRef(null);
  const targetVersion = useRef(0), drag = useRef(null);
  const inventory = me?.inventory ?? [];
  const eligibleItems = inventory.filter(eligible);
  const eligibleKey = eligibleItems.map(item => item.id).join('|');
  useEffect(() => { const ids = new Set(eligibleItems.map(item => item.id)); setSelected(previous => { const next = new Set([...previous].filter(id => ids.has(id))); return next.size === previous.size ? previous : next; }); }, [eligibleKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopAudio.current?.(); clearTimeout(settleTimer.current); settleResolve.current?.(); }; }, []);
  const inputItems = eligibleItems.filter(item => selected.has(item.id));
  const inputValue = inputItems.reduce((sum, item) => sum + amount(item.value), 0n);
  const coinValue = minorInput(stake.trim() || '0');
  const totalValue = inputValue + (coinValue ?? 0n);
  const minimumTarget = totalValue > 0n ? totalValue + 1n : 0n;
  const maximumTarget = totalValue > 0n ? totalValue * 95n : 0n;
  const desiredTarget = totalValue * BigInt(multiplier || 2);
  const body = { inputIds: [...selected], targetId: target?.id, coinStake: stake.trim() || '0', clientSeed: seed.trim(), direction, startTicket };
  const bodyKey = JSON.stringify(body);
  const quoteKey = JSON.stringify([body.inputIds, body.targetId, body.coinStake]);
  const currentValueKey = inputItems.map(item => item.id + ':' + item.value).join('|');
  const autoKey = JSON.stringify([authenticated, currentValueKey, totalValue.toString(), multiplier]);
  useEffect(() => { if (!busy && !result) { setWheelDuration(0); setAngle(0); } }, [bodyKey, busy, result]);
  useEffect(() => { setTargetPage(0); }, [targetQuery, minimumTarget.toString()]);
  useEffect(() => { setInventoryPage(0); }, [inventoryQuery]);
  useEffect(() => {
    let cancelled = false;
    if (!authenticated) return undefined;
    setTargetBusy(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search: targetQuery, page: String(targetPage), minValue: minimumTarget.toString(), ...(totalValue > 0n ? { maxValue: maximumTarget.toString(), ...(multiplier ? { desiredValue: desiredTarget.toString() } : {}) } : {}) });
      api('/targets?' + params).then(data => { if (!cancelled) setTargets(data); }).catch(error => { if (!cancelled) showToast(error.message, true); }).finally(() => { if (!cancelled) setTargetBusy(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, authenticated, targetQuery, targetPage, minimumTarget.toString(), maximumTarget.toString(), desiredTarget.toString(), multiplier, showToast]);
  useEffect(() => {
    const version = ++targetVersion.current;
    if (!authenticated || totalValue <= 0n || coinValue == null || busyRef.current || attempt || result) { setAutoSelecting(false); return undefined; }
    setTarget(null); setAutoSelecting(true); setAutoStatus('Đang tự chọn skin phù hợp...');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ minValue: minimumTarget.toString(), maxValue: maximumTarget.toString(), desiredValue: desiredTarget.toString() });
      api('/targets?' + params).then(data => {
        if (targetVersion.current !== version) return;
        const next = data.items.find(item => suitableTarget(item, totalValue)) ?? null;
        setTarget(next); setAutoStatus(next ? 'Đã tự chọn theo giá trị nguyên liệu. Bạn có thể chọn skin khác bên dưới.' : 'Không có skin đích đủ giá trị cho lựa chọn này. Hãy giảm nguyên liệu hoặc xu.');
      }).catch(error => { if (targetVersion.current === version) setAutoStatus(error.message); })
        .finally(() => { if (targetVersion.current === version) setAutoSelecting(false); });
    }, 180);
    return () => { clearTimeout(timer); if (targetVersion.current === version) targetVersion.current++; };
    // Only changes to ingredients, their prices, or multiplier replace a chosen target.
  }, [api, autoKey]);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    if (!authenticated || !target || totalValue <= 0n || busy) { if (!busy) setPreviewStatus('Chọn skin hoặc thêm xu, sau đó chọn mục tiêu.'); return undefined; }
    if (coinValue == null) { setPreviewStatus('Nhập số xu không âm, tối đa 2 chữ số thập phân.'); return undefined; }
    if (coinValue > amount(me?.balance)) { setPreviewStatus('Số dư xu không đủ cho lượt này.'); return undefined; }
    setPreviewStatus('Đang tính tỷ lệ...');
    const timer = setTimeout(() => {
      api('/upgrade/preview', body).then(plan => { if (!cancelled) { setPreview({ ...plan, quoteKey }); setPreviewStatus('Tỷ lệ đã sẵn sàng.'); } }).catch(error => { if (!cancelled) setPreviewStatus(error.message); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, authenticated, quoteKey, currentValueKey, me?.balance, busy, previewRevision]);
  useEffect(() => { if (direction === 'over' && preview?.winTickets && !attempt && !busy && !result) setStartTicket(TICKETS - preview.winTickets); }, [direction, preview?.winTickets, attempt, busy, result]);
  function choose(item) {
    if (busyRef.current || preparing || attempt) return;
    setResult(null);
    setSelected(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
  }
  function chooseAll() {
    if (busyRef.current || preparing || attempt) return;
    setResult(null); setSelected(previous => previous.size === eligibleItems.length ? new Set() : new Set(eligibleItems.map(item => item.id)));
  }
  function selectTarget(item) {
    if (busyRef.current || preparing || attempt || targetBusy) return;
    targetVersion.current++; setAutoSelecting(false); setAutoStatus('Đã chọn skin mục tiêu của bạn.'); setTarget(item); setResult(null);
  }
  function moveRegion(value) { setDirection('under'); setStartTicket(normalizeStart(value)); setResult(null); }
  function pointerDown(event) {
    if (busyRef.current || preparing || attempt || result || !preview || event.button !== 0) return;
    const point = ticketAtPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    if (point == null) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, point, start: startTicket };
  }
  function pointerMove(event) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const point = ticketAtPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    if (point != null) moveRegion(moveWinRegion(drag.current.start, drag.current.point, point));
  }
  function pointerEnd(event) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyRegion(event) {
    if (busyRef.current || preparing || attempt || result || !preview) return;
    const step = event.shiftKey ? 10000 : 1000;
    const value = { ArrowRight: startTicket + step, ArrowUp: startTicket + step, ArrowLeft: startTicket - step, ArrowDown: startTicket - step, Home: 0, End: TICKETS - 1 }[event.key];
    if (value !== undefined) { event.preventDefault(); moveRegion(value); }
  }
  async function prepare() {
    if (!authenticated) return onLogin();
    if (!preview || preview.quoteKey !== quoteKey || busyRef.current || autoSelecting || attempt) return;
    busyRef.current = true; setPreparing(true);
    try { const data = await api('/upgrade/prepare', { ...body, expectedSignature: preview.signature, expectedPrices: preview.prices }); setAttempt(data.attempt); }
    catch (error) { showToast(error.message, true); setPreviewRevision(value => value + 1); }
    finally { busyRef.current = false; setPreparing(false); }
  }
  async function settle() {
    if (!attempt || busyRef.current) return;
    const confirmed = attempt;
    busyRef.current = true; setBusy(true); setResult(null); setSpinPlan(confirmed); setAttempt(null); setPreviewStatus('Đang xác nhận lượt Upgrade...');
    try {
      const data = await api('/upgrade/settle', { attemptId: confirmed.id, expectedHash: confirmed.hash, expectedClientSeed: confirmed.clientSeed });
      if (!data.receipt) throw new Error('Chưa nhận được biên nhận. Hãy kiểm tra lượt chờ và lịch sử.');
      if (!mounted.current) { await refreshMe(); return; }
      const receipt = data.receipt, duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 6000;
      setPreviewStatus('Đang quay...'); setWheelDuration(0); setAngle(0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!mounted.current) { await refreshMe(); return; }
      setWheelDuration(duration); setAngle(1800 + 360 * (Number(receipt.ticket) - 1) / 100000);
      stopAudio.current?.(); audio?.unlock?.(); stopAudio.current = audio?.upgradeSpin?.(duration);
      if (duration) await new Promise(resolve => { settleResolve.current = resolve; settleTimer.current = setTimeout(resolve, duration + 80); });
      stopAudio.current?.(); stopAudio.current = null;
      if (mounted.current) {
        stopAudio.current = audio?.upgradeResult?.(receipt.won === true); setResult(receipt); setSelected(new Set()); setStake('0'); setPreview(null);
        showToast(receipt.won ? 'Upgrade thành công! Skin đã vào kho.' : 'Lượt Upgrade đã hoàn tất.');
      }
      await refreshMe();
    } catch (error) { if (mounted.current) { showToast(error.message, true); setAttempt(!error.status || error.status >= 500 ? confirmed : null); } await refreshMe(); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); setPreviewRevision(value => value + 1); } }
  }
  if (!authenticated) return <AuthCollection upgrade onLogin={onLogin} />;
  const working = busy || preparing;
  const locked = working || Boolean(attempt);
  const plan = busy || result ? (result ?? spinPlan) : preview;
  const percent = Math.max(0, Math.min(100, Number(plan?.chance ?? 0)));
  const ringStart = busy || result ? startTicketFor(plan) : startTicket;
  const ring = `conic-gradient(from ${ringStart * 360 / TICKETS}deg, #c6f481 0% ${percent}%, #302b44 ${percent}% 100%)`;
  const ringDisabled = locked || Boolean(result) || !preview || preview.quoteKey !== quoteKey;
  const visibleInputs = eligibleItems.filter(item => item.name.toLocaleLowerCase('vi').includes(inventoryQuery.toLocaleLowerCase('vi')));
  const inputPages = Math.max(1, Math.ceil(visibleInputs.length / PAGE_SIZE)), actualInputPage = Math.min(inventoryPage, inputPages - 1);
  const pending = me?.upgrade?.pending;
  return <main className="app-main ci-page"><PageTitle eyebrow="AIM A LITTLE HIGHER" title="UPGRADE" copy="Chọn skin của bạn. Nhắm tới món tiếp theo." action={<button className="ghost-button" onClick={() => setProof('rules')}>◇ Tỷ lệ & công bằng</button>} />
    {pending && pending.id !== result?.id && <div className="ci-pending"><span>Bạn có một lượt đang chờ xác nhận.</span><button className="ghost-button" disabled={locked} onClick={() => { targetVersion.current++; setAutoSelecting(false); setAutoStatus('Đã khôi phục mục tiêu của lượt chờ.'); setAttempt(pending); setTarget(pending.target); setSelected(new Set(pending.inputIds)); setStake(plainCoins(pending.coinStake)); setDirection(pending.direction); setStartTicket(startTicketFor(pending)); setSeed(pending.clientSeed); setResult(null); }}>Xem lượt chờ →</button></div>}
    <section className="ci-arena"><article className="ci-stage ci-source"><div className="ci-stage-label"><span>01 / SKIN CỦA BẠN</span><b>{inputItems.length} SKIN</b></div><div className="ci-stage-art">{inputItems.length ? <ImageFrame item={inputItems[0]} /> : <span className="ci-plus">＋</span>}</div><h3>{inputItems.length ? shortName(inputItems[0].name) : 'Chọn skin hoặc thêm xu'}{inputItems.length > 1 && <small>và {inputItems.length - 1} skin khác</small>}</h3><strong className="ci-stage-value">{coins(totalValue)}</strong><label className="ci-coin-input"><span>Xu bổ sung</span><input aria-label="Xu bổ sung" inputMode="decimal" value={stake} disabled={locked} onChange={event => { setStake(event.target.value); setResult(null); }} maxLength={40} /><button disabled={locked} onClick={() => { setStake(plainCoins(me?.balance)); setResult(null); }}>MAX</button></label><div className="ci-selected-chips">{inputItems.slice(0, 12).map(item => <button key={item.id} disabled={locked} onClick={() => choose(item)} title={item.name}>{shortName(item.name)} ×</button>)}{inputItems.length > 12 && <span>và {inputItems.length - 12} skin khác đã chọn</span>}</div></article>
      <div className="ci-wheel-column"><div className={'ci-wheel ' + (busy ? 'is-spinning' : '') + (result ? result.won ? ' is-won' : ' is-lost' : '')} role="slider" tabIndex={ringDisabled ? -1 : 0} aria-label="Vị trí vùng thắng Upgrade" aria-valuemin={0} aria-valuemax={99.999} aria-valuenow={ringStart / 1000} aria-valuetext={'Bắt đầu tại ' + chance(ringStart / 1000) + '%. Tỷ lệ thắng ' + chance(percent) + '%'} aria-disabled={ringDisabled} aria-describedby="ci-wheel-help" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={keyRegion}><div className="ci-wheel-ticks" /><div className="ci-wheel-ring" style={{ background: ring }} /><div className="ci-wheel-handle" style={{ transform: `rotate(${ringStart * 360 / TICKETS}deg)` }}><i /></div><div className="ci-wheel-center"><small>{result ? result.won ? 'THÀNH CÔNG' : 'CHƯA TRÚNG' : 'TỶ LỆ THÀNH CÔNG'}</small><strong>{plan ? chance(percent) : '—'}<em>%</em></strong><span>{plan ? Number(plan.multiplier ?? 0).toFixed(2) + '× GIÁ TRỊ' : 'CHỌN MỤC TIÊU'}</span></div><div className="ci-wheel-needle" style={{ transform: 'rotate(' + angle + 'deg)', transition: wheelDuration ? 'transform ' + wheelDuration + 'ms cubic-bezier(.12,.7,.1,1)' : 'none' }}><i /></div></div><button className="primary-button ci-upgrade-button" disabled={locked || autoSelecting || !preview || preview.quoteKey !== quoteKey} onClick={prepare}>{busy ? 'ĐANG QUAY...' : preparing ? 'ĐANG CHUẨN BỊ...' : 'UPGRADE NGAY ↗'}</button><p className="ci-status" role="status">{result ? 'Kết quả đã lưu trong lịch sử.' : autoSelecting || !target && autoStatus ? autoStatus : previewStatus}</p><p className="ci-wheel-help" id="ci-wheel-help">Kéo vùng xanh quanh vòng tròn để đặt vùng thắng.<br />Dùng phím mũi tên để điều chỉnh.</p><div className="ci-direction"><button className={ringStart === 0 ? 'active' : ''} disabled={ringDisabled} onClick={() => { setDirection('under'); setStartTicket(0); }}>↶ Vùng đầu</button><button className={preview && ringStart === TICKETS - preview.winTickets ? 'active' : ''} disabled={ringDisabled} onClick={() => { setDirection('over'); setStartTicket(TICKETS - preview.winTickets); }}>Vùng cuối ↷</button></div></div>
      <article className="ci-stage ci-target"><div className="ci-stage-label"><span>02 / SKIN MỤC TIÊU</span><b>⟐</b></div><div className="ci-stage-art">{target ? <ImageFrame item={target} /> : <span className="ci-plus">◇</span>}</div><h3>{target ? shortName(target.name) : autoSelecting ? 'Đang chọn skin phù hợp...' : 'Bạn muốn skin nào?'}<small>{target?.wear || 'Tự chọn khi bạn thêm nguyên liệu'}</small></h3><strong className="ci-stage-value">{target?.valueFormatted || '—'}</strong><div className="ci-multipliers">{[0, 2, 5, 10, 20].map(value => <button disabled={locked} key={value} className={multiplier === value ? 'active' : ''} onClick={() => setMultiplier(value)}>{value ? value + '×' : 'Tất cả'}</button>)}</div><p className="ci-note" role="status">{autoStatus || 'Tự gợi ý skin theo giá trị nguyên liệu. Có thể chọn mục tiêu khác bên dưới.'}</p></article></section>
    {result && <div className={'ci-result ' + (result.won ? 'won' : 'lost')}><span>{result.won ? '✦' : '◇'}</span><div><strong>{result.won ? 'UPGRADE THÀNH CÔNG' : 'LƯỢT UPGRADE ĐÃ HOÀN TẤT'}</strong><p>{result.won ? shortName(result.drop?.name ?? result.target?.name) + ' đã vào kho của bạn.' : 'Nguyên liệu và xu tham gia đã được sử dụng.'}</p></div><button className="ghost-button" onClick={() => setProof(result)}>Biên nhận & seed →</button></div>}
    <section className="ci-pickers"><div className="ci-picker"><div className="ci-picker-title"><h2>KHO SKIN CỦA BẠN</h2><span>{eligibleItems.length} món</span></div><input aria-label="Tìm nguyên liệu Upgrade" placeholder="Tìm skin trong kho..." value={inventoryQuery} onChange={event => setInventoryQuery(event.target.value)} /><p className="ci-note">Skin đã mở khóa, có báo giá và đủ điều kiện Upgrade.</p><div className="ci-input-actions"><button className="ghost-button" disabled={locked || !eligibleItems.length} onClick={chooseAll}>{selected.size === eligibleItems.length && eligibleItems.length ? 'Bỏ chọn toàn bộ' : 'Chọn toàn bộ kho'}</button><span>{selected.size} / {eligibleItems.length} skin đã chọn</span></div><div className="ci-picker-grid">{visibleInputs.slice(actualInputPage * PAGE_SIZE, (actualInputPage + 1) * PAGE_SIZE).map(item => <ItemCard key={item.id} item={item} compact selected={selected.has(item.id)} onClick={() => choose(item)} />)}</div>{!visibleInputs.length && <div className="ci-empty">Chưa có skin phù hợp. Bạn vẫn có thể dùng xu để Upgrade.</div>}<Pager page={actualInputPage} pages={inputPages} onChange={setInventoryPage} busy={locked} /></div>
      <div className="ci-picker"><div className="ci-picker-title"><h2>SKIN MỤC TIÊU</h2><span>{targets.total ?? 0} món</span></div><input aria-label="Tìm mục tiêu" placeholder="Tìm Howl, Fade, Dragon Lore..." value={targetQuery} disabled={locked} onChange={event => setTargetQuery(event.target.value)} /><p className="ci-note">{targetBusy ? 'Đang tìm skin...' : 'Giá từ ' + coins(minimumTarget)}</p><div className={'ci-picker-grid ' + (targetBusy ? 'is-loading' : '')}>{targets.items.map(item => <ItemCard key={item.id} item={item} compact selected={target?.id === item.id} onClick={() => selectTarget(item)} />)}</div>{!targets.items.length && !targetBusy && <div className="ci-empty">Không có mục tiêu phù hợp. Thử tên khác hoặc giảm nguyên liệu / xu.</div>}<Pager page={targets.page ?? 0} pages={targets.pages ?? 1} onChange={setTargetPage} busy={locked || targetBusy} /></div></section>
    <details className="ci-seed"><summary>Cài đặt client seed</summary><label>Client seed<input aria-label="Client seed" value={seed} maxLength={128} disabled={locked} onChange={event => setSeed(event.target.value)} /></label><p>Seed của bạn được ghi vào biên nhận của mỗi lượt.</p></details>
    <Modal open={Boolean(attempt)} title="Xác nhận Upgrade" eyebrow="KIỂM TRA TRƯỚC KHI QUAY" onClose={() => { if (!busyRef.current) { setAttempt(null); void refreshMe(); } }} actions={<><button className="ghost-button" disabled={working} onClick={() => { setAttempt(null); void refreshMe(); }}>Quay lại</button><button className="primary-button" disabled={working} onClick={settle}>Xác nhận & quay</button></>}><p>Mục tiêu: <strong>{attempt?.target?.name}</strong></p><div className="ci-confirm-value"><span>Giá trị tham gia</span><strong>{coins(attempt?.stake)}</strong></div><div className="ci-confirm-value"><span>Tỷ lệ thành công</span><strong>{chance(attempt?.chance)}%</strong></div><div className="ci-confirm-value"><span>Vé thuộc vùng thắng</span><strong className="ci-ticket-range">{winningRanges(startTicketFor(attempt), attempt?.winTickets).map(([first, last]) => `${first.toLocaleString('vi-VN')}–${last.toLocaleString('vi-VN')}`).join(' / ')}</strong></div><p>Lượt này sử dụng toàn bộ <strong>{attempt?.inputIds?.length ?? 0} skin</strong> và {coins(attempt?.coinStake)} đã chọn. Thắng nhận skin mục tiêu; thua không nhận skin đích.</p><small>Hash cam kết trước lượt quay</small><code className="ci-hash">{attempt?.hash}</code></Modal>
    <Modal open={Boolean(proof)} title="Tỷ lệ & biên nhận" eyebrow="PROVABLY FAIR" onClose={() => setProof(null)}><p>Tỷ lệ = giá trị tham gia × 95% / giá skin mục tiêu, giới hạn từ 1% đến 90%. Kéo vùng xanh chỉ đổi vị trí vùng thắng, không đổi tỷ lệ. Vùng thắng có thể đi qua mốc 100% về 0%. Máy chủ công bố hash trước lượt quay; biên nhận sau lượt chứa seed, nonce và vé kết quả.</p>{proof !== 'rules' && proof && <><div className="ci-proof-state">{proof.verified ? '✓ Biên nhận đã được máy chủ kiểm tra lại' : 'Biên nhận kết quả'}</div><pre className="ci-proof-json">{JSON.stringify(proof, null, 2)}</pre></>}</Modal>
  </main>;
}
