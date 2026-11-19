import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageFrame, Modal, PageTitle, coins, amount, chance, formatDate, shortName, itemDetails, tierClass, makeRequestId } from './shared';
import { ROUND_LIMIT } from '../../utils/cs2BattleLimits';
import { MODES as MODE_RULES, FORMATS, teamForSeat, scoreBattle, jackpotWeights } from '../../utils/playerBattleModes';
import './battles.css';

const MODES = Object.fromEntries(Object.entries(MODE_RULES).map(([id, mode]) => [id, [mode.name, mode.description, mode.icon]]));
const STATUS = { waiting: 'Đang chờ', finished: 'Đã kết thúc', cancelled: 'Đã hủy', expired: 'Hết hạn' };
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function roundTotals(room, count) { const totals = Object.fromEntries(room.players.map(player => [player.userId, 0n])); for (const round of (room.rounds ?? []).slice(0, count)) for (const entry of round.entries) totals[entry.userId] = (totals[entry.userId] ?? 0n) + amount(entry.value); return totals; }
const formatName = room => (room.format ?? 'solo') === 'solo' ? 'Đấu đơn · ' + room.capacity + ' người' : FORMATS[room.format]?.name ?? room.format;
const teamAt = (room, seat) => teamForSeat(room.format ?? 'solo', seat);
const seatName = (room, seat) => { const team = teamAt(room, seat); return team ? 'ĐỘI ' + team + ' · ' + team + ((seat - 1) % FORMATS[room.format].teamSize + 1) : 'VỊ TRÍ ' + seat; };
const BattleScoreSummary = React.memo(function BattleScoreSummary({ room, count = 0, finished = false, states, drawProgress = null }) {
  const rule = MODE_RULES[room.mode] ?? MODE_RULES.regular;
  const scores = scoreBattle(room, count);
  const groups = rule.base === 'jackpot' ? jackpotWeights(scores.groups, rule.inverse) : scores.groups;
  const totalWeight = rule.base === 'jackpot' ? groups.reduce((sum, group) => sum + group.weight, 0n) : 0n;
  const scoreLabel = rule.base === 'terminal' ? 'VÒNG CUỐI' : rule.base === 'clutch' ? rule.inverse ? 'VÒNG THẤP NHẤT' : 'VÒNG CAO NHẤT' : 'TỔNG ĐÃ MỞ';
  const drawing = drawProgress !== null && !finished;
  const jackpotDecision = room.decision;
  const railGroups = (drawing || finished) && jackpotDecision?.groups?.length ? jackpotDecision.groups : groups;
  const railTotal = railGroups.reduce((sum, group) => sum + amount(group.weight), 0n);
  const marker = drawProgress === null || !jackpotDecision ? null : window.MaySkinsBattlePresentation.jackpotPosition(jackpotDecision, drawProgress);
  const repeatedRail = railGroups.length ? Array.from({ length: 4 }, (_, repeat) => <div className="bb-jackpot-copy" key={repeat}>{railGroups.map((group, index) => <div key={repeat + ':' + group.id} className="bb-jackpot-segment" style={{ width: (railTotal ? Number(amount(group.weight) * 1000000000000n / railTotal) / 10000000000 : 0) + '%', '--bb-jackpot-color': ['#bc8aff', '#f291bc', '#74d8cb', '#d7bd75', '#8ea7f7', '#ed9b73'][index % 6] }} title={group.label} />)}</div>) : [];
  return <section className={'bb-score-summary mode-' + rule.base} aria-label="Luật và điểm Battle">
    <div className="bb-score-rule"><span>{rule.icon}</span><div><strong>{formatName(room)} · {rule.name}</strong><p>{rule.description}{(room.format ?? 'solo') !== 'solo' && room.mode !== 'sharing' ? '. Điểm tính theo cả đội; đội thắng chia đều phần thưởng.' : ''}</p>{rule.base === 'terminal' && count < (room.rounds?.length ?? 0) && <small>Chưa tính điểm quyết định cho đến khi mở xong vòng cuối.</small>}{rule.base === 'jackpot' && <small>{finished ? 'Đã bốc thăm theo tỷ trọng cuối trận.' : 'Tỷ trọng tạm tính từ các vòng đã hé lộ; chỉ công bố người thắng khi trận hoàn tất.'}</small>}</div></div>
    {rule.base === 'jackpot' && <div className={'bb-jackpot-draw' + (drawing ? ' is-drawing' : '')} role="status" aria-label={drawing ? 'Đang bốc thăm Jackpot' : finished ? 'Kết quả Jackpot' : 'Tỷ trọng Jackpot'}>
      <div className="bb-jackpot-draw-label"><strong>{drawing ? 'ĐANG BỐC THĂM JACKPOT' : finished ? 'JACKPOT ĐÃ CHỐT' : 'TỶ TRỌNG BỐC THĂM'}</strong><span>{drawing ? 'Cùng một lượt chọn cho cả phòng' : finished ? 'Theo kết quả đã xác minh của máy chủ' : 'Cập nhật sau mỗi vòng đã hé lộ'}</span></div>
      <div className="bb-jackpot-rail"><div className="bb-jackpot-rail-track" style={marker === null ? undefined : { transform: 'translateX(' + ((.5 - marker) / 4 * 100) + '%)' }}>{repeatedRail}</div>{marker !== null && <i className="bb-jackpot-marker" />}</div>
    </div>}
    <div className="bb-score-groups">{groups.map(group => {
      const state = states[group.userIds[0]] ?? 'tied';
      const percentage = totalWeight ? Number(group.weight * 10000n / totalWeight) / 100 : 0;
      return <article className={'bb-score-group ' + state} key={group.id} data-team={group.id.startsWith('team:') ? group.id.slice(5) : undefined}>
        <strong>{group.label}</strong><small>{scoreLabel}</small><b>{rule.base === 'terminal' && count < (room.rounds?.length ?? 0) ? '—' : coins(group.score)}</b>
        {rule.base === 'jackpot' && <div className="bb-jackpot-chance"><span>{percentage === 0 && group.weight > 0n ? '<0,01' : chance(percentage)}% cơ hội</span><div><i style={{ width: percentage + '%' }} /></div></div>}
        {finished && room.winners?.includes(group.userIds[0]) && <em>{room.mode === 'sharing' ? 'CHIA ĐỀU' : 'THẮNG'}</em>}
      </article>;
    })}</div>
  </section>;
});
function Avatar({ player }) { return <span className="bb-avatar">{player?.avatar ? <ImageFrame item={{ image: player.avatar, name: player.displayName }} /> : (player?.displayName ?? '?').slice(0, 1).toUpperCase()}</span>; }
function CaseTrack({ room, current = -1 }) {
  const track = useRef(null);
  useEffect(() => {
    const rail = track.current, active = rail?.children[current];
    if (!rail || !active) return;
    const railBounds = rail.getBoundingClientRect(), activeBounds = active.getBoundingClientRect();
    rail.scrollTo({ left: rail.scrollLeft + activeBounds.left - railBounds.left - (rail.clientWidth - activeBounds.width) / 2, behavior: reduced() ? 'auto' : 'smooth' });
  }, [room.id, current]);
  return <div className="bb-case-track" ref={track} aria-label="Thứ tự các vòng">{room.caseIds.map((id, index) => { const item = room.cases?.find(entry => entry.id === id); return <span className={index === current ? 'active' : index < current ? 'done' : ''} aria-current={index === current ? 'step' : undefined} key={index} title={item?.name ?? id}><ImageFrame item={item} /><small>{index + 1}</small></span>; })}</div>;
}

export default function BattlePage({ catalogue, authenticated, onLogin, api, refreshMe, audio, showToast, onBattleRoomChange, onBattlePlaybackComplete }) {
  const [rooms, setRooms] = useState([]), [room, setRoom] = useState(null), [creating, setCreating] = useState(false), [rematchConfig, setRematchConfig] = useState(null);
  const [filter, setFilter] = useState('all'), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [confirm, setConfirm] = useState(null);
  const locked = useRef(false), generation = useRef(0), activeRoom = useRef(null), activeStatus = useRef(null);
  activeRoom.current = room?.id ?? null; activeStatus.current = room?.status ?? null;
  const showRoom = useCallback(next => { onBattleRoomChange?.(next); setRoom(next); }, [onBattleRoomChange]);
  useEffect(() => () => { activeRoom.current = null; onBattleRoomChange?.(null); }, [onBattleRoomChange]);
  useEffect(() => { if (!authenticated) onBattleRoomChange?.(null); }, [authenticated, onBattleRoomChange]);
  const loadRooms = useCallback(async () => { if (!authenticated) { setLoading(false); return; } try { const data = await api('/battles'); setRooms(data.rooms ?? []); } catch (error) { showToast(error.message, true); } finally { setLoading(false); } }, [api, authenticated, showToast]);
  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => { if (!authenticated) return; let disposed = false, pending = false; const poll = async () => { if (document.hidden || pending || locked.current || (activeRoom.current && activeStatus.current !== 'waiting')) return; pending = true; const id = activeRoom.current; try { const data = await api(id ? '/battles/' + id : '/battles'); if (!disposed && id === activeRoom.current && !locked.current) { if (id) showRoom(data.room); else setRooms(data.rooms ?? []); } } catch (error) { if (!disposed && error.status === 401) showToast(error.message, true); } finally { pending = false; } }; const timer = setInterval(poll, 4500); return () => { disposed = true; clearInterval(timer); }; }, [api, authenticated, showToast, showRoom]);
  useEffect(() => () => { generation.current++; audio?.stopAll?.(); }, [audio]);
  const selectRoom = async id => { const token = ++generation.current; try { const data = await api('/battles/' + id); if (token === generation.current) { showRoom(data.room); window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); } } catch (error) { showToast(error.message, true); } };
  const act = async (action, options = {}) => { if (!room || locked.current) return; if (action === 'start' || action === 'cancel') { setConfirm({ action, options }); return; } await execute(action, options); };
  const execute = async (action, options = {}) => { if (!room || locked.current) return; const id = room.id; locked.current = true; setBusy(true); setConfirm(null); try { await audio?.unlock?.(); const data = await api('/battles/' + id + '/' + action, { requestId: makeRequestId(), ...options }); if (activeRoom.current === id) showRoom(data.room); await refreshMe(); await loadRooms(); } catch (error) { showToast(error.message, true); } finally { locked.current = false; setBusy(false); } };
  const rematch = useCallback(next => {
    generation.current++;
    audio?.stopAll?.();
    onBattleRoomChange?.(null);
    setRoom(null);
    setRematchConfig(next);
    setCreating(true);
  }, [audio, onBattleRoomChange]);
  const back = () => { generation.current++; audio?.stopAll?.(); showRoom(null); void refreshMe(); void loadRooms(); };
  if (!authenticated) return <main className="app-main bb-page"><PageTitle eyebrow="PLAY TOGETHER" title="CASE BATTLES" copy="Cùng một hòm. Cùng một cơ hội. Ai sẽ nhận skin huyền thoại?" /><div className="bb-welcome"><span className="bb-welcome-icon">⚔</span><h2>ĐẤU HÒM CÙNG BẠN BÈ</h2><p>Tạo phòng 2–6 người hoặc đấu đội, chọn đến {ROUND_LIMIT} hòm. Thường, Crazy, Sharing, Terminal, Clutch và Jackpot — chọn cách chơi của bạn.</p><button className="primary-button" onClick={onLogin}>Đăng nhập để tham gia ↗</button><div className="bb-mode-preview">{Object.entries(MODES).map(([key, [name, desc, icon]]) => <article key={key}><b>{icon}</b><strong>{name}</strong><span>{desc}</span></article>)}</div></div></main>;
  if (room) return <main className="app-main bb-page"><button className="back-link" onClick={back}>← Tất cả Battle</button><div className="bb-heading"><div><span className="app-eyebrow">CASE BATTLE · {room.id.slice(0, 8).toUpperCase()}</span><h1>{MODES[room.mode]?.[0] ?? 'CASE'} BATTLE <i className={'bb-status ' + room.status}>{STATUS[room.status]}</i></h1><p><span className="bb-format-label">{formatName(room)}</span> · {MODES[room.mode]?.[1]}{room.exclusiveDrop ? ' · Exclusive Drop' : ''}</p></div><div className="bb-heading-price"><small>CHI PHÍ MỖI NGƯỜI</small><strong>{room.feeFormatted}</strong></div></div>{room.status === 'finished' ? <BattlePlayback key={room.id} room={room} audio={audio} onComplete={onBattlePlaybackComplete} onRematch={() => rematch({ caseIds: room.caseIds, capacity: room.capacity, format: room.format ?? 'solo', mode: room.mode, exclusive: room.exclusiveDrop !== false })} /> : <><div className="bb-stage-bar"><span><b>{room.caseIds.length}</b> VÒNG</span><CaseTrack room={room} /><span><b>{room.players.length}/{room.capacity}</b> NGƯỜI</span></div><BattleLobby room={room} act={act} busy={busy} /><div className="bb-lobby-actions">{room.canStart && <button className="primary-button" disabled={busy} onClick={() => act('start')}>⚔ Bắt đầu Battle · {room.feeFormatted}</button>}{room.canJoin && <button className="primary-button" disabled={busy} onClick={() => act('join')}>Vào phòng · {room.feeFormatted}</button>}{room.canLeave && <button className="ghost-button" disabled={busy} onClick={() => act('leave')}>Rời phòng</button>}{room.canCancel && <button className="ghost-button" disabled={busy} onClick={() => act('cancel')}>Hủy phòng</button>}</div><p className="bb-note">{room.status === 'waiting' ? 'Phí được trừ khi chủ phòng bắt đầu. ' + ((room.format ?? 'solo') !== 'solo' ? 'Vị trí quyết định đội của bạn. ' : '') + MODES[room.mode]?.[1] + '.' : 'Phòng này đã đóng. Quay lại danh sách để tạo trận mới.'}</p></>}<Fairness room={room} /><Modal open={!!confirm} title={confirm?.action === 'start' ? 'Sẵn sàng vào trận?' : 'Hủy phòng Battle?'} onClose={() => setConfirm(null)} actions={<><button className="ghost-button" onClick={() => setConfirm(null)}>Quay lại</button><button className="primary-button" onClick={() => execute(confirm.action, confirm.options)}>{confirm?.action === 'start' ? 'Bắt đầu trận' : 'Hủy phòng'}</button></>}><p>{confirm?.action === 'start' ? 'Mỗi người chơi sẽ dùng ' + room.feeFormatted + ' cho ' + room.caseIds.length + ' vòng. ' + MODES[room.mode]?.[1] + '.' : 'Phòng sẽ đóng và không trừ xu.'}</p></Modal></main>;
  const visible = rooms.filter(entry => filter === 'all' || entry.status === filter);
  return <main className="app-main bb-page"><PageTitle eyebrow="PLAY TOGETHER" title="CASE BATTLES" copy="Cùng mở hòm. So tài cùng bạn bè." action={<button className="primary-button" onClick={() => { setRematchConfig(null); setCreating(true); }}>＋ Tạo Battle</button>} /><div className="bb-list-toolbar"><div className="bb-tabs">{[['all', 'Tất cả Battle'], ['waiting', 'Đang chờ'], ['finished', 'Đã kết thúc']].map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}<small>{rooms.filter(item => id === 'all' || item.status === id).length}</small></button>)}</div><button className="ghost-button" onClick={loadRooms}>↻ Làm mới</button></div><div className="bb-room-list">{visible.map(entry => <button className="bb-room-row" key={entry.id} onClick={() => selectRoom(entry.id)}><span className="bb-round-count"><b>{entry.caseIds?.length ?? 0}</b><small>VÒNG</small></span><span className="bb-room-info"><strong>{MODES[entry.mode]?.[2]} {MODES[entry.mode]?.[0]} BATTLE</strong><small className="bb-room-format">{formatName(entry)}</small><small className={'bb-status ' + entry.status}>{STATUS[entry.status]}</small></span><span className="bb-mini-cases">{entry.caseIds.slice(0, 5).map((id, i) => <ImageFrame key={i} item={entry.cases?.find(item => item.id === id)} />)}{entry.caseIds.length > 5 && <small>+{entry.caseIds.length - 5}</small>}</span><span className="bb-room-players">{entry.players.map(player => <Avatar player={player} key={player.userId} />)}{Array.from({ length: Math.max(0, entry.capacity - entry.players.length) }, (_, i) => <span className="bb-avatar bb-empty-avatar" key={i}>＋</span>)}</span><span className="bb-room-price"><strong>{entry.feeFormatted}</strong><small>{entry.canJoin ? 'THAM GIA →' : 'XEM TRẬN →'}</small></span></button>)}</div>{!visible.length && <div className="empty-panel"><span className="bb-empty-swords">⚔</span><h2>{loading ? 'Đang tải Battle...' : 'Chưa có Battle ở đây'}</h2><p>Tạo trận mới, chọn hòm và mời bạn bè cùng tham gia.</p><button className="primary-button" onClick={() => { setRematchConfig(null); setCreating(true); }}>＋ Tạo Battle đầu tiên</button></div>}{creating && <BattleCreator catalogue={catalogue} api={api} initialConfig={rematchConfig} onClose={() => { setCreating(false); setRematchConfig(null); }} onCreated={created => { showRoom(created); setCreating(false); setRematchConfig(null); void loadRooms(); }} showToast={showToast} />}</main>;
}

function BattleLobby({ room, act, busy }) {
  return <div className={'bb-seats' + (room.capacity > 4 ? ' bb-many-players' : '')} data-format={room.format ?? 'solo'} style={{ '--players': room.capacity }}>{Array.from({ length: room.capacity }, (_, index) => {
    const seat = index + 1, player = room.players.find(entry => entry.seat === seat), team = teamAt(room, seat);
    return <article className={'bb-seat ' + (player ? 'occupied' : '')} data-team={team ?? undefined} key={seat}>
      <span className="bb-seat-number">{seatName(room, seat)}</span>
      {player ? <><Avatar player={player} /><h3>{player.displayName}</h3><span className="bb-player-type">{player.isBot ? 'BOT' : room.hostId === player.userId ? 'CHỦ PHÒNG' : 'NGƯỜI CHƠI'}</span><div className="bb-seat-actions">{room.canChangeSeat && <button disabled={busy} onClick={() => act('seat', { seat })}>Đổi sang vị trí này</button>}{player.isBot && room.canRemoveBot && <button disabled={busy} onClick={() => act('bot', { seat, remove: true })}>Gỡ Bot</button>}</div></> : <><span className="bb-empty-seat">＋</span><h3>Đang chờ người chơi</h3><div className="bb-seat-actions">{(room.canJoin || room.canChangeSeat) && <button disabled={busy} onClick={() => act('seat', { seat })}>Ngồi vị trí này</button>}{room.canAddBot && <button className="bb-add-bot" disabled={busy} onClick={() => act('bot', { seat })}>＋ Gọi Bot</button>}</div></>}
    </article>;
  })}</div>;
}

function BattleCreator({ catalogue, api, initialConfig, onClose, onCreated, showToast }) {
  const initialFormat = initialConfig?.format && FORMATS[initialConfig.format] ? initialConfig.format : 'solo';
  const initialCapacity = Number.isInteger(initialConfig?.capacity) && FORMATS[initialFormat].capacities.includes(initialConfig.capacity) ? initialConfig.capacity : FORMATS[initialFormat].capacities[0];
  const [caseIds, setCaseIds] = useState(() => Array.isArray(initialConfig?.caseIds) ? initialConfig.caseIds.filter(id => catalogue.some(item => item.id === id)).slice(0, ROUND_LIMIT) : []), [capacity, setCapacity] = useState(initialCapacity), [format, setFormat] = useState(initialFormat), [mode, setMode] = useState(initialConfig?.mode && MODE_RULES[initialConfig.mode] ? initialConfig.mode : 'regular'), [exclusive, setExclusive] = useState(initialConfig?.exclusive !== false), [query, setQuery] = useState(''), [sort, setSort] = useState('featured'), [busy, setBusy] = useState(false), [prices, setPrices] = useState({});
  const [preview, setPreview] = useState(null);
  const previewTrigger = useRef(null), pickerScroll = useRef(0), previewBack = useRef(null);
  const guard = useRef(false);
  const changeFormat = next => { setFormat(next); if (!FORMATS[next].capacities.includes(capacity)) setCapacity(FORMATS[next].capacities[0]); };
  const byId = useMemo(() => new Map(catalogue.map(item => [item.id, item])), [catalogue]);
  const feeFor = id => amount(prices[id] ?? byId.get(id)?.fee);
  const total = caseIds.reduce((sum, id) => sum + feeFor(id), 0n);
  const filtered = useMemo(() => { const items = catalogue.filter(item => item.available && item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))); if (sort !== 'featured') items.sort((a,b) => { const delta = amount(a.fee) - amount(b.fee); return (delta < 0 ? -1 : delta > 0 ? 1 : 0) * (sort === 'low' ? 1 : -1); }); return items; }, [catalogue, query, sort]);
  const add = id => setCaseIds(previous => previous.length < ROUND_LIMIT ? [...previous, id] : previous);
  const remove = id => setCaseIds(previous => { const next = [...previous], index = next.lastIndexOf(id); if (index >= 0) next.splice(index, 1); return next; });
  const openPreview = (item, event) => {
    previewTrigger.current = event.currentTarget;
    pickerScroll.current = event.currentTarget.closest('.modal-body')?.scrollTop ?? 0;
    setPreview(item);
  };
  const closePreview = () => {
    setPreview(null);
    requestAnimationFrame(() => {
      const trigger = previewTrigger.current;
      if (!trigger?.isConnected) return;
      const body = trigger.closest('.modal-body');
      if (body) body.scrollTop = pickerScroll.current;
      trigger.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!preview) return;
    const back = previewBack.current, body = back?.closest('.modal-body');
    if (body) body.scrollTop = 0;
    back?.focus({ preventScroll: true });
  }, [preview]);
  const create = async () => { if (!caseIds.length || caseIds.length > ROUND_LIMIT || guard.current) return; guard.current = true; setBusy(true); try { const details = await Promise.all([...new Set(caseIds)].map(id => api('/cases/' + encodeURIComponent(id)))); const fresh = Object.fromEntries(details.map(detail => [detail.case.id, detail.fee])); const nextTotal = caseIds.reduce((sum,id) => sum + amount(fresh[id]), 0n); if (nextTotal !== total) { setPrices(fresh); showToast('Giá hòm vừa cập nhật. Hãy xem lại tổng phí trước khi tạo phòng.'); return; } const quoteIds = Object.fromEntries(details.map(detail => [detail.case.id, detail.quoteId])); const result = await api('/battles', { requestId: makeRequestId(), caseIds, capacity, format, mode, exclusiveDrop: exclusive, quoteIds }); onCreated(result.room); } catch (error) { showToast(error.message, true); } finally { guard.current = false; setBusy(false); } };
  return <Modal open title={preview ? preview.name : 'TẠO CASE BATTLE'} eyebrow={preview ? 'XEM TRƯỚC HÒM BATTLE' : 'BUILD YOUR BATTLE'} className={'bb-create-modal' + (preview ? ' bb-case-preview-modal' : '')} onClose={() => { if (!busy) { if (preview) closePreview(); else onClose(); } }} actions={<><span className="bb-create-total"><small>{caseIds.length}/{ROUND_LIMIT} VÒNG · CHI PHÍ MỖI NGƯỜI</small><strong>{coins(total)}</strong></span>{preview ? <button className="ghost-button" onClick={closePreview}>← Quay lại tạo Battle</button> : <button className="primary-button" disabled={!caseIds.length || caseIds.length > ROUND_LIMIT || busy} onClick={create}>{busy ? 'Đang tạo...' : 'Tạo Battle →'}</button>}</>}>
    <div hidden={!!preview}>
      <div className="bb-format-config"><span className="bb-field-label">THỂ THỨC</span><div className="bb-format-options">{Object.entries(FORMATS).map(([id, info]) => <button key={id} disabled={busy} aria-pressed={format === id} className={format === id ? 'active' : ''} onClick={() => changeFormat(id)}><strong>{info.name}</strong><small>{info.description}</small></button>)}</div></div>
      <div className="bb-create-config"><div><span className="bb-field-label">NGƯỜI CHƠI</span><div className="bb-segment">{FORMATS[format].capacities.map(value => <button key={value} disabled={busy || format !== 'solo'} aria-pressed={capacity === value} className={capacity === value ? 'active' : ''} onClick={() => setCapacity(value)}>{value} người</button>)}</div></div><label className="bb-exclusive"><input type="checkbox" checked={exclusive} disabled={busy} onChange={event => setExclusive(event.target.checked)} /><span>✦ Exclusive Drop<small>Thêm lượt hé lộ đặc biệt cho skin hiếm</small></span></label></div>
      <span className="bb-field-label">LUẬT TÍNH THẮNG</span>
      <div className="bb-modes">{Object.entries(MODES).map(([id, [name, description, icon]]) => <button key={id} disabled={busy} aria-pressed={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}><b>{icon}</b><strong>{name}</strong><small>{description}</small></button>)}</div>
      <div className="bb-selected-rule"><strong>{FORMATS[format].name} · {MODES[mode][0]}</strong><p>{MODES[mode][1]}.{mode === 'sharing' ? ' Mọi người nhận phần bằng nhau, không phụ thuộc đội.' : MODE_RULES[mode].base === 'jackpot' ? format !== 'solo' ? ' Bốc thăm theo đội; thành viên đội được chọn chia đều phần thưởng.' : ' Bốc thăm chọn một người thắng.' : format !== 'solo' ? ' Điểm so theo đội; thành viên các đội thắng chia đều phần thưởng.' : ' Nếu bằng điểm, các bên dẫn đầu cùng chia phần thưởng.'}</p></div>
      {caseIds.length > 0 && <div className="bb-selected-rounds" aria-label="Hòm đã chọn theo thứ tự">{caseIds.map((id, index) => <button key={index} disabled={busy} onClick={() => setCaseIds(previous => previous.filter((_, i) => i !== index))} title={'Bỏ vòng ' + (index + 1) + ': ' + byId.get(id)?.name}><small>{index + 1}</small><ImageFrame item={byId.get(id)} /><span>×</span></button>)}</div>}
      <div className="bb-picker-toolbar"><input placeholder="Tìm hòm cho Battle..." aria-label="Tìm hòm Battle" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Sắp xếp hòm Battle" value={sort} onChange={event => setSort(event.target.value)}><option value="featured">Nổi bật</option><option value="low">Giá thấp đến cao</option><option value="high">Giá cao đến thấp</option></select></div>
      <p className="bb-picker-hint">Bấm vào ảnh hoặc tên hòm để xem skin và tỷ lệ rơi.</p>
      <div className="bb-case-picker">{filtered.map(item => { const quantity = caseIds.filter(id => id === item.id).length; return <article className={'bb-case-choice ' + (quantity ? 'selected' : '')} key={item.id}><button className="bb-case-preview-trigger" disabled={busy} onClick={event => openPreview(item, event)} aria-label={'Xem skin và tỷ lệ ' + item.name}><ImageFrame item={item} /><strong>{item.name}</strong><span>ⓘ Xem skin & tỷ lệ</span></button><small>{coins(feeFor(item.id))}</small><div><button disabled={!quantity || busy} onClick={() => remove(item.id)} aria-label={'Bỏ ' + item.name}>−</button><b>{quantity || 'THÊM HÒM'}</b><button disabled={caseIds.length >= ROUND_LIMIT || busy} onClick={() => add(item.id)} aria-label={'Thêm ' + item.name}>＋</button></div></article>; })}</div>
      {!filtered.length && <div className="empty-panel">Không có hòm phù hợp.</div>}
    </div>
    {preview && <BattleCasePreview key={preview.id} item={preview} api={api} onBack={closePreview} backRef={previewBack} />}
  </Modal>;
}

function BattleCasePreview({ item, api, onBack, backRef }) {
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setDetail(null); setError('');
    (async () => {
      try {
        const data = await api('/cases/' + encodeURIComponent(item.id));
        if (!disposed) setDetail(data);
      } catch (failure) { if (!disposed) setError(failure.message || 'Không tải được thông tin hòm.'); }
    })();
    return () => { disposed = true; };
  }, [api, item.id, attempt]);
  const entries = useMemo(() => [...(detail?.entries ?? [])].sort((a, b) => Number(a.chance) - Number(b.chance)), [detail]);
  return <div className="bb-case-preview">
    <button className="back-link" ref={backRef} onClick={onBack}>← Quay lại chọn hòm</button>
    <div className="bb-preview-summary"><ImageFrame item={detail?.case ?? item} /><div><span className="bb-field-label">NỘI DUNG & XÁC SUẤT</span><h3>{item.name}</h3><strong>{detail?.case.feeFormatted ?? item.feeFormatted}</strong>{detail && <p>{detail.case.description}</p>}</div></div>
    {error ? <div className="empty-panel" role="alert"><p>{error}</p><button className="ghost-button" onClick={() => setAttempt(value => value + 1)}>Thử tải lại</button></div> : !detail ? <div className="empty-panel" role="status">Đang tải skin và tỷ lệ rơi...</div> : <>
      <div className="bb-preview-odds-heading"><h3>SKIN TRONG HÒM</h3><small>{entries.length} KẾT QUẢ · TỶ LỆ TỪ THẤP ĐẾN CAO</small></div>
      <p className="bb-preview-note">Tỷ lệ hiển thị cho từng kết quả trong một lượt mở.{detail.exclusive?.available && <> Exclusive Drop ({chance(detail.exclusive.chance)}%) chỉ thêm hiệu ứng hé lộ, không làm thay đổi tỷ lệ rơi skin.</>}</p>
      <div className="item-grid bb-preview-items">{entries.map(entry => <article className={'item-card ' + tierClass(entry)} key={entry.id}><ImageFrame item={entry} /><strong title={entry.name}>{entry.name}</strong><small>{itemDetails(entry) || entry.rarity}</small><em className="item-chance">{chance(entry.chance)}%</em><span className="item-price" title={entry.marketRangeNote ?? undefined}>{entry.marketRangeFormatted ? `${entry.marketRangeLabel ? `${entry.marketRangeLabel}: ` : ''}${entry.marketRangeFormatted}` : entry.valueFormatted ?? coins(entry.value)}</span></article>)}</div>
      {!entries.length && <div className="empty-panel">Hòm đang chờ đồng bộ giá. Vui lòng thử lại sau.<br /><button className="ghost-button" onClick={() => setAttempt(value => value + 1)}>Thử tải lại</button></div>}
    </>}
  </div>;
}

function VerticalReel({ item, pool, seed, progress, spinning, exclusive = false }) {
  const view = useRef(null), track = useRef(null);
  const [geometry, setGeometry] = useState({ height: 300, cardHeight: 154, gap: 8 });
  const targetIndex = 24;
  const cards = useMemo(() => {
    const source = pool.length ? pool : [item];
    const indices = window.MaySkinsBattlePresentation?.indices(source.length, 29, seed) ?? Array.from({ length: 29 }, (_, index) => index % source.length);
    return indices.map((index, at) => at === targetIndex ? item : source[index]);
  }, [pool, item, seed]);
  useEffect(() => {
    const measure = () => {
      const height = view.current?.clientHeight ?? 300, card = track.current?.firstElementChild;
      setGeometry({ height, cardHeight: card?.getBoundingClientRect().height ?? 154,
        gap: track.current ? parseFloat(getComputedStyle(track.current).gap) || 0 : 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (view.current) observer.observe(view.current);
    return () => observer.disconnect();
  }, [seed]);
  const start = geometry.height / 2 - geometry.cardHeight / 2;
  const finish = window.MaySkinsBattlePresentation.center(geometry.height, geometry.cardHeight, geometry.gap, targetIndex);
  const eased = window.MaySkinsBattlePresentation.ease(progress);
  const offset = spinning ? start + (finish - start) * eased : finish;
  return <div className={'bb-reel ' + (!spinning ? 'revealed' : '')} ref={view} data-reel-phase={exclusive ? 'exclusive' : 'normal'}>
    <div className="bb-reel-center" /><i className="bb-reel-pointer">▸</i>
    <div className="bb-reel-track" ref={track} style={{ transform: 'translate3d(0,' + offset + 'px,0)' }}>
      {cards.map((entry, index) => <div className={'bb-reel-item ' + tierClass(entry) + (entry?.isExclusiveTrigger ? ' is-exclusive-trigger' : '') + (index === targetIndex ? ' bb-winning-item' : '')} key={index}>
        {entry?.isExclusiveTrigger ? <><span className="bb-exclusive-symbol" aria-hidden="true">✦</span><strong>EXCLUSIVE DROP</strong><small>Hé lộ skin đặc biệt</small></> : <><ImageFrame item={entry} eager /><strong title={entry?.name}>{entry?.name}</strong><small className="bb-reel-item-details">{itemDetails(entry) || 'CS2'}</small></>}
      </div>)}
    </div>
  </div>;
}

function BattlePlayback({ room, audio, onComplete, onRematch }) {
  const [replay, setReplay] = useState(0), [playback, setPlayback] = useState({ phase: 'rounds', stage: 'waiting', roundIndex: 0, completed: 0, progress: 0, elapsedInStage: 0, duration: 0, tallyCount: 0 });
  const [visibleVersion, setVisibleVersion] = useState(0);
  const finishPlayback = useRef(() => {}), completion = useRef(onComplete), completionReported = useRef(false);
  const manualFinish = useRef(false), timelineEnded = useRef(false), playbackEpoch = useRef(null), previousLeader = useRef(null);
  completion.current = onComplete;
  const rounds = room.rounds ?? [];
  const plan = useMemo(() => window.MaySkinsBattlePresentation.playbackPlan(room), [room.id]);
  const { phase, stage, roundIndex, completed, progress, elapsedInStage, tallyCount } = playback;
  const finished = phase === 'finished', resultVisible = phase !== 'rounds';
  const reducedMotion = reduced();
  const tally = plan.tally;
  const activeStep = phase === 'tally' && stage !== 'jackpot-draw' && tallyCount > 0 && tallyCount <= tally.steps.length ? tally.steps[tallyCount - 1] : null;
  const counter = window.MaySkinsBattlePresentation.tallyAt(plan, playback);
  const countedPool = finished ? amount(room.pool) : counter.pool;
  const exclusive = useMemo(() => window.MaySkinsBattlePresentation.exclusiveRound(room, Math.min(roundIndex, rounds.length - 1)), [room.id, roundIndex]);
  const poolByCase = useMemo(() => Object.fromEntries((room.cases ?? []).map(item => [item.id, (item.reelEntries ?? []).filter(entry => !entry.exclusiveEligible)])), [room.id]);
  const fallbackPool = useMemo(() => rounds.flatMap(round => round.entries.map(entry => entry.item)).slice(0, 60), [room.id]);
  const roundValues = roundTotals(room, completed);
  const roundBefore = stage === 'revealed' ? roundTotals(room, Math.max(0, completed - 1)) : roundValues;
  const roundFraction = stage === 'revealed' ? 1 - (1 - Math.min(1, elapsedInStage / 650)) ** 3 : 1;
  const roundUnits = Math.round(roundFraction * 1000);
  const totals = phase === 'tally' ? counter.totals : Object.fromEntries(room.players.map(player => [player.userId,
    window.MaySkinsBattlePresentation.interpolate(roundBefore[player.userId], roundValues[player.userId], roundUnits)]));
  const modeRule = MODE_RULES[room.mode] ?? MODE_RULES.regular;
  const isTeam = (room.format ?? 'solo') !== 'solo';
  const states = useMemo(() => window.MaySkinsBattlePresentation.rankings(room, completed, finished), [room, completed, finished]);
  const round = rounds[roundIndex];
  const serverNow = () => {
    const clock = room.playbackClock;
    return Number.isFinite(clock?.serverNow) && Number.isFinite(clock?.receivedAt)
      ? clock.serverNow + performance.now() - clock.receivedAt : Date.now();
  };

  useEffect(() => {
    let disposed = false, frame = 0, lastPaint = 0;
    const sharedEpoch = Number.isFinite(room.playbackStartedAt) ? room.playbackStartedAt
      : Number.isFinite(room.finishedAt) ? room.finishedAt + 6000 : null;
    const startAt = replay ? serverNow() : sharedEpoch ?? serverNow();
    playbackEpoch.current = startAt;
    manualFinish.current = false;
    timelineEnded.current = false;
    previousLeader.current = null;
    const sample = () => window.MaySkinsBattlePresentation.playbackAt(plan, serverNow() - startAt);
    const publish = (force = false) => {
      if (disposed) return;
      const now = performance.now();
      if (force || now - lastPaint >= 40) { lastPaint = now; const next = sample(); setPlayback(next);
        if (next.stage === 'finished') {
          timelineEnded.current = true;
          if (!completionReported.current) { completionReported.current = true; completion.current?.(room.id); }
        }
      }
    };
    const schedule = () => { if (!disposed && !manualFinish.current && !timelineEnded.current && !document.hidden) frame = requestAnimationFrame(() => { publish(); schedule(); }); };
    const cancel = () => { disposed = true; cancelAnimationFrame(frame); audio?.stopAll?.(); };
    const finishNow = () => {
      manualFinish.current = true;
      cancelAnimationFrame(frame); audio?.stopAll?.();
      setPlayback({ phase: 'finished', stage: 'finished', roundIndex: Math.max(0, rounds.length - 1), completed: rounds.length, progress: 1, elapsedInStage: 0, duration: 0, tallyCount: tally.steps.length });
      if (!completionReported.current) { completionReported.current = true; completion.current?.(room.id); }
    };
    finishPlayback.current = finishNow;
    publish(true);
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(frame); audio?.stopAll?.(); }
      else if (!manualFinish.current) { publish(true); schedule(); setVisibleVersion(value => value + 1); }
    };
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => { cancel(); document.removeEventListener('visibilitychange', visibility); };
  }, [room.id, replay, audio, plan]);

  useEffect(() => {
    if (document.hidden || reducedMotion || manualFinish.current) { audio?.stopAll?.(); return undefined; }
    audio?.stopAll?.();
    let stop = null;
    const elapsed = Math.max(0, playback.elapsedInStage);
    const elapsedFromStart = playbackEpoch.current == null ? Infinity : serverNow() - playbackEpoch.current;
    if (stage === 'spinning' || stage === 'exclusive-spinning') {
      const duration = stage === 'spinning' ? 4200 : 3600;
      stop = audio?.spin?.(duration, { steps: 24, easing: [.16,.58,.12,1], elapsed });
    } else if (stage === 'exclusive-trigger' && elapsed < 250) {
      const hit = round?.entries.find(entry => entry.exclusive?.triggered === true);
      audio?.reveal?.(exclusive.trigger, { caseFee: room.fee });
      if (hit) audio?.battleLead?.();
    } else if (stage === 'revealed' && elapsed < 180) {
      const top = round?.entries.reduce((best, entry) => amount(entry.value) > amount(best?.value) ? entry : best, null);
      audio?.reveal?.(top?.item ?? {}, { caseFee: room.fee });
    } else if (stage === 'tally' && activeStep && elapsed < 140) {
      stop = audio?.battleTally?.({ index: activeStep.index, count: tally.steps.length, duration: activeStep.duration, final: activeStep.index === tally.steps.length - 1, elapsed });
      const leader = !isTeam && modeRule.base === 'regular' ? window.MaySkinsBattlePresentation.uniqueLeader(activeStep.totals, room.mode) : null;
      if (leader !== null && previousLeader.current !== null && leader !== previousLeader.current) audio?.battleLead?.();
      if (leader !== null) previousLeader.current = leader;
    } else if (stage === 'finished' && elapsedFromStart <= plan.duration + 1600) stop = audio?.battleFinish?.() ?? audio?.result?.(true);
    return () => { stop?.(); };
  }, [room.id, audio, stage, roundIndex, tallyCount, visibleVersion, reducedMotion]);

  const revealed = stage === 'revealed' || phase === 'tally' || finished;
  const exclusiveActive = stage === 'exclusive-trigger' || stage === 'exclusive-spinning';
  const jackpotDrawing = stage === 'jackpot-draw';
  const sharedProgress = reducedMotion ? (stage === 'revealed' || stage === 'exclusive-trigger' || phase === 'tally' || finished ? 1 : 0) : progress;
  const battleProgress = finished || phase === 'tally' ? rounds.length : exclusiveActive ? completed + 1
    : stage === 'spinning' ? completed + progress : completed;
  return <section className={'bb-playback phase-' + phase} data-mode={room.mode} data-format={room.format ?? 'solo'} data-round-stage={stage} data-round-index={roundIndex} data-completed-rounds={completed} data-stage-progress={progress.toFixed(3)} data-replay={replay}>
    {!finished && <div className="bb-playback-controls"><span>{jackpotDrawing ? 'Đang bốc thăm Jackpot theo mốc chung của phòng' : phase === 'tally' ? 'Đang cộng giá trị từng skin vào phần thưởng' : stage === 'waiting' ? 'Đang đồng bộ nhịp quay Battle' : 'Hoạt ảnh các vòng Battle'}</span><button className="ghost-button" onClick={() => finishPlayback.current()}>{jackpotDrawing ? 'Bỏ qua bốc thăm →' : phase === 'tally' ? 'Bỏ qua cộng dồn →' : 'Xem kết quả ngay →'}</button></div>}
    <div className="bb-stage-bar"><span><small>VÒNG</small><b>{Math.min(roundIndex + 1, rounds.length)}<em>/{rounds.length}</em></b></span><CaseTrack room={room} current={roundIndex} /><span className="bb-round-name"><small>{finished ? 'TRẬN HOÀN TẤT' : jackpotDrawing ? 'ĐANG BỐC THĂM JACKPOT' : phase === 'tally' ? 'ĐANG CỘNG PHẦN THƯỞNG' : stage === 'waiting' ? 'ĐỒNG BỘ TRẬN' : exclusiveActive ? 'EXCLUSIVE DROP' : revealed ? 'KẾT QUẢ VÒNG' : 'ĐANG MỞ HÒM'}</small><b>{room.cases.find(item => item.id === round?.caseId)?.name}</b></span></div>
    <div className="bb-progress"><i style={{ width: (rounds.length ? battleProgress / rounds.length * 100 : 0) + '%' }} /></div>
    {exclusiveActive && exclusive.hasExclusive && <div className="bb-exclusive-banner" role="status" data-stage={stage}><span className="bb-exclusive-emblem">✦</span><div><small>EXCLUSIVE DROP · VÒNG {roundIndex + 1}</small><strong>{stage === 'exclusive-trigger' ? 'ĐÃ KÍCH HOẠT!' : 'ĐANG HÉ LỘ SKIN'}</strong><span>{stage === 'exclusive-trigger' ? 'Lượt quay đặc biệt bắt đầu ngay sau đây' : 'Kết quả được chốt đồng bộ cho cả phòng'}</span></div><div className="bb-exclusive-progress"><i style={{ transform: 'scaleX(' + progress + ')' }} /></div></div>}
    {resultVisible && <div className={'bb-tally-summary ' + (finished ? 'is-complete' : '')}>
      <div className="bb-tally-heading"><small>{finished ? 'TỔNG GIÁ TRỊ PHẦN THƯỞNG' : 'CỘNG DỒN TỪNG SKIN'}</small><span>{tallyCount} / {tally.steps.length} món</span></div>
      <div className="bb-tally-item" key={activeStep?.index ?? 'complete'}>{activeStep ? <><ImageFrame item={activeStep.item} /><span><small>VÒNG {activeStep.roundIndex + 1} · {room.players.find(player => player.userId === activeStep.userId)?.displayName}</small><strong title={activeStep.item?.name}>{activeStep.item?.name}</strong><small className="bb-tally-item-details">{itemDetails(activeStep.item)}</small></span><em>+{coins(activeStep.value)}</em></> : <span>{finished ? 'Đã cộng đủ toàn bộ vật phẩm trong trận' : 'Đang gom chiến lợi phẩm...'}</span>}</div>
      <div className="bb-tally-pool"><span>{finished ? 'TỔNG PHẦN THƯỞNG' : 'ĐANG CỘNG'}</span><strong>{coins(countedPool)}</strong></div>
      <div className="bb-tally-meter"><i style={{ width: (tally.steps.length ? tallyCount / tally.steps.length * 100 : 100) + '%' }} /></div>
    </div>}
    {(isTeam || !['regular', 'sharing'].includes(modeRule.base)) && <BattleScoreSummary room={room} count={completed} finished={finished} states={states} drawProgress={jackpotDrawing ? (reducedMotion ? 0 : progress) : finished ? 1 : null} />}
    <div className={'bb-lanes' + (room.capacity > 4 ? ' bb-many-players' : '')} data-format={room.format ?? 'solo'} style={{ '--players': room.capacity }}>{[...room.players].sort((a,b) => a.seat-b.seat).map(player => {
      const entry = round?.entries.find(item => item.userId === player.userId);
      const state = !isTeam && modeRule.base === 'regular' && phase === 'tally' && activeStep
        ? window.MaySkinsBattlePresentation.standings(activeStep.totals, room.mode)[player.userId] : states[player.userId] ?? 'tied';
      const winner = finished && room.winners?.includes(player.userId);
      const hit = exclusive.hasExclusive && exclusive.hitUserIds.includes(player.userId);
      const laneRevealed = revealed || (exclusiveActive && !hit);
      const placeholder = hit && (stage === 'spinning' || stage === 'exclusive-trigger');
      const reelPool = stage === 'exclusive-spinning' && hit || (hit && (stage === 'revealed' || phase === 'tally' || finished)) ? exclusive.exclusivePool : exclusive.normalPool.length ? exclusive.normalPool : poolByCase[round?.caseId]?.length ? poolByCase[round.caseId] : fallbackPool;
      const reelStage = hit && (stage === 'exclusive-spinning' || stage === 'revealed' || phase === 'tally' || finished) ? 'exclusive' : 'normal';
      const waitingPool = reelPool.filter(item => item.id !== entry?.item?.id && item.name !== entry?.item?.name);
      const waitingItem = stage === 'waiting' ? waitingPool[window.MaySkinsBattlePresentation.indices(waitingPool.length, 1, player.userId + room.id)[0]] ?? room.cases.find(item => item.id === round?.caseId) : entry?.item;
      const reelItem = placeholder ? exclusive.trigger : stage === 'waiting' ? waitingItem : entry?.item;
      const laneProgress = stage === 'spinning' ? sharedProgress : stage === 'exclusive-spinning' ? sharedProgress : 0;
      const laneSpinning = stage === 'spinning' || (stage === 'exclusive-spinning' && hit);
      return <article className={'bb-lane ' + state + (activeStep?.userId === player.userId ? ' is-tally-source' : '') + (exclusiveActive && hit ? ' is-exclusive-active' : '') + (stage === 'revealed' && hit ? ' is-exclusive-revealed' : '')} data-team={teamAt(room, player.seat) ?? undefined} key={player.userId}>
        <header><Avatar player={player} /><div><strong>{player.displayName}</strong><small>{player.isBot ? 'BOT · ' : ''}{seatName(room, player.seat)}</small></div>{winner && <span className="bb-crown" title={room.mode === 'sharing' ? 'Nhận phần chia' : 'Thắng'}>♛</span>}</header>
        <div className="bb-total"><small>{finished && winner ? room.mode === 'sharing' ? 'CHIA ĐỀU' : 'THẮNG' : !isTeam && modeRule.base === 'regular' && state === 'leading' ? 'ĐANG DẪN ĐẦU' : phase === 'tally' ? 'ĐANG CỘNG SKIN' : 'TỔNG SKIN ĐÃ MỞ'}</small><strong>{coins(totals[player.userId])}</strong></div>
        {entry && <VerticalReel key={roundIndex + ':' + reelStage} item={reelItem} pool={reelPool} seed={room.id + ':' + roundIndex + ':' + player.userId + ':' + reelStage} progress={laneProgress} spinning={laneSpinning} exclusive={reelStage === 'exclusive'} />}
        <div className={'bb-drop-value ' + (laneRevealed ? 'is-visible' : '')}>{laneRevealed ? entry?.valueFormatted : stage === 'waiting' ? 'Đang đồng bộ...' : 'Đang quay...'}</div>
        {finished && <div className={'bb-payout ' + (winner ? 'won' : '')}>
          <small>{player.isBot ? 'PHẦN THƯỞNG BOT' : 'PHẦN THƯỞNG NHẬN'}</small>
          <strong>{coins(tally.payouts[player.userId] ?? 0n)}</strong>
          <span>{winner ? player.isBot ? 'Bot không giữ xu hoặc skin' : room.payoutType === 'skins' ? 'Skin đã chuyển vào kho' : 'Xu đã cộng vào ví' : 'Chúc bạn may mắn ở trận tiếp theo'}</span>
        </div>}
        <DropHistory rounds={rounds} completed={completed} player={player} activeStep={activeStep} tallyCount={tallyCount} />
      </article>;
    })}</div>
    {finished && <div className="bb-finish-banner"><div><span>✦ BATTLE HOÀN TẤT</span><strong>Tổng phần thưởng {room.poolFormatted}</strong></div><div className="bb-finish-actions"><button className="ghost-button" onClick={() => { audio?.unlock?.(); setReplay(value => value + 1); }}>↻ Xem lại hoạt ảnh</button>{onRematch && <button className="primary-button" onClick={() => { audio?.unlock?.(); onRematch(); }}>⚔ Chơi lại cấu hình này</button>}</div></div>}
  </section>;
}

function DropHistory({ rounds, completed, player, activeStep, tallyCount }) {
  const [tooltip, setTooltip] = useState(null);
  const history = useRef(null), closeTimer = useRef(null);
  const keepDetails = () => { clearTimeout(closeTimer.current); };
  const hideDetails = () => { clearTimeout(closeTimer.current); setTooltip(null); };
  const scheduleHide = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setTooltip(null), 180); };
  const showDetails = (event, item) => {
    clearTimeout(closeTimer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - 324, rect.left + rect.width / 2 - 156));
    const above = rect.top > 300;
    setTooltip({ item, left, top: above ? rect.top - 10 : rect.bottom + 10, above });
  };
  useEffect(() => {
    const close = event => { if (event.key === 'Escape') hideDetails(); };
    const resize = () => hideDetails();
    const scroll = () => hideDetails();
    window.addEventListener('keydown', close);
    window.addEventListener('resize', resize);
    const element = history.current;
    element?.addEventListener('scroll', scroll, { passive: true });
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('resize', resize); element?.removeEventListener('scroll', scroll); clearTimeout(closeTimer.current); };
  }, []);
  return <>
    <div ref={history} className="bb-drop-history" onClick={event => { if (!event.target.closest('.bb-drop-card')) setTooltip(null); }}>
      {rounds.slice(0, completed).map((round, index) => {
        const drop = round.entries.find(value => value.userId === player.userId);
        if (!drop?.item) return null;
        const active = activeStep?.roundIndex === index && activeStep?.userId === player.userId;
        const details = itemDetails(drop.item);
        const label = [drop.item.name, details, drop.valueFormatted].filter(Boolean).join(' · ');
        const id = 'bb-drop-info-' + player.userId + '-' + index;
        const tooltipItem = { ...drop.item, valueFormatted: drop.valueFormatted, tooltipId: id };
        return <div className={'bb-drop-card ' + tierClass(drop.item) + (active ? ' is-tallying' : '')} key={index}
          aria-label={label} aria-describedby={tooltip?.item.tooltipId === id ? id : undefined} tabIndex={0}
          onMouseEnter={event => showDetails(event, tooltipItem)}
          onMouseLeave={scheduleHide} onFocus={event => showDetails(event, tooltipItem)}
          onBlur={scheduleHide} onClick={event => { if (tooltip?.item.tooltipId === id) hideDetails(); else showDetails(event, tooltipItem); }}>
          <ImageFrame item={drop.item} />
          <span><strong>{drop.item.name}</strong><small className="bb-history-details">{drop.item.wear ?? drop.item.rarity ?? 'CS2'}</small><small className="bb-history-value">{drop.valueFormatted}</small></span>
          {active && <em className="bb-tally-credit" key={tallyCount}>+{coins(activeStep.value)}</em>}
        </div>;
      })}
    </div>
    {tooltip && createPortal(<div id={tooltip.item.tooltipId} role="tooltip" className={'bb-drop-hover-card ' + tierClass(tooltip.item)} style={{ left: tooltip.left, top: tooltip.top, '--rarity': tooltip.item.color ?? '#9b70cc' }} data-above={tooltip.above} onMouseEnter={keepDetails} onMouseLeave={scheduleHide}>
      <div className="bb-drop-hover-art"><ImageFrame item={tooltip.item} eager /></div>
      <div className="bb-drop-hover-main"><small className="bb-drop-hover-rarity">{tooltip.item.rarity ?? 'CS2 SKIN'}{tooltip.item.statTrak ? ' · STATTRAK™' : ''}</small><strong>{tooltip.item.name}</strong>
        <div className="bb-drop-hover-stats"><span>Vũ khí</span><b>{tooltip.item.weapon ?? '—'}</b><span>Độ hiếm</span><b>{tooltip.item.rarity ?? '—'}</b>
          <span>Độ mòn</span><b>{tooltip.item.wear ?? 'Không áp dụng'}</b><span>Float</span><b>{Number.isFinite(tooltip.item.float) ? tooltip.item.float.toFixed(6) : '—'}</b>
          <span>Pattern</span><b>{Number.isInteger(tooltip.item.paintSeed) ? '#' + tooltip.item.paintSeed : '—'}</b></div>
        <div className="bb-drop-hover-price"><small>GIÁ VẬT PHẨM</small><strong>{tooltip.item.valueFormatted ?? 'Chưa có giá'}</strong></div>
      </div>
    </div>, document.body)}
  </>;
}

function Fairness({ room }) { return <details className="bb-fairness"><summary><span>◇ PROVABLY FAIR</span><small>{room.proof ? room.proof.verified ? 'Đã xác minh kết quả' : 'Chưa xác minh' : 'Đã khóa mã cam kết'} ＋</small></summary><p>Mã cam kết được công bố trước khi bắt đầu. Sau trận, server seed được mở để kiểm tra kết quả.</p><dl><dt>Commitment SHA-256</dt><dd>{room.commitment}</dd>{room.proof && <><dt>Server seed</dt><dd>{room.proof.serverSeed}</dd><dt>Client seed</dt><dd>{room.proof.clientSeed}</dd><dt>Thuật toán</dt><dd>{room.proof.algorithm}</dd><dt>Outcomes hash</dt><dd>{room.proof.outcomesHash}</dd></>}</dl></details>; }
