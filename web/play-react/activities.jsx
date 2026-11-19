import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { makeRequestId, ImageFrame, PageTitle } from './shared';
import './activities.css';

const colors = { 'ash-dragon': '#f47855', 'frost-colossus': '#72c6ff', 'iron-hydra': '#c89bff' };
const formatNumber = value => Number(value ?? 0).toLocaleString('vi-VN');
function resetCountdown(timestamp) {
  const remaining = Number(timestamp) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return 'Đang cập nhật';
  const days = Math.floor(remaining / 86400000), hours = Math.floor(remaining % 86400000 / 3600000);
  return days ? `${days} ngày ${hours} giờ` : `${hours} giờ ${Math.floor(remaining % 3600000 / 60000)} phút`;
}

function RewardPayout({ coins, caseReward, className = '' }) {
  const amount = Number(coins) || 0;
  const label = typeof caseReward === 'string' ? caseReward : caseReward?.label;
  if (!amount && !label) return null;
  return <div className={`reward-payout ${className}`.trim()}>
    {amount > 0 && <span className="reward-chip coins">+{formatNumber(amount)} xu</span>}
    {label && <span className="reward-chip case">{label}</span>}
  </div>;
}

export default function ActivitiesPage({ authenticated, onLogin, api, showToast, onNavigate }) {
  const [tab, setTab] = useState('boss');
  return <main className="app-main activity-page">
    <PageTitle eyebrow="SỰ KIỆN CỘNG ĐỒNG · MÙA MỚI MỖI TUẦN" title="SỰ KIỆN & SƯU TẬP" copy="Cùng máy chủ săn Boss, hoàn thành nhiệm vụ và ghi dấu các bộ skin bạn sở hữu." />
    <div className="activity-tabs" role="tablist" aria-label="Sự kiện và sưu tập">
      <button role="tab" aria-selected={tab === 'boss'} className={tab === 'boss' ? 'active' : ''} onClick={() => setTab('boss')}><span>⚔</span><strong>SĂN BOSS</strong><small>Sự kiện máy chủ</small></button>
      <button role="tab" aria-selected={tab === 'book'} className={tab === 'book' ? 'active' : ''} onClick={() => setTab('book')}><span>▤</span><strong>SỔ SƯU TẬP</strong><small>31 bộ · huy hiệu hồ sơ</small></button>
      <button role="tab" aria-selected={tab === 'quests'} className={tab === 'quests' ? 'active' : ''} onClick={() => setTab('quests')}><span>✓</span><strong>NHIỆM VỤ</strong><small>Ngày · tuần · phần thưởng</small></button>
    </div>
    {!authenticated ? <section className="activity-auth"><span>✦</span><h2>Kết nối kho đồ để tham gia</h2><p>Săn Boss dùng chung với người chơi trong máy chủ. Sổ sưu tập chỉ đếm skin đang có trong kho của bạn.</p><button className="primary-button" onClick={onLogin}>Đăng nhập Discord ↗</button></section>
      : tab === 'boss' ? <BossHunt api={api} showToast={showToast} /> : tab === 'book' ? <CollectionBook api={api} showToast={showToast} /> : <QuestBoard api={api} showToast={showToast} onNavigate={onNavigate} />}
  </main>;
}

function QuestBoard({ api, showToast, onNavigate }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setData(await api('/activity-missions')); setError(''); } catch (failure) { setError(failure.message || 'Không tải được nhiệm vụ.'); } }, [api]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(timer); }, [load]);
  const claim = async (type, mission) => {
    if (busy) return;
    setBusy(`${type}:${mission.id}`);
    try { const result = await api('/activity-missions/claim', { requestId: makeRequestId(), type, missionId: mission.id }); setData(result.quests); const reward = result.reward ?? {}; const completionCoins = reward.completionCoins ?? result.completionCoins; const bonusCases = reward.bonusCases ?? result.bonusCases ?? []; const rewardParts = [`+${formatNumber(reward.xp)} XP`]; if (reward.coins) rewardParts.push(`+${formatNumber(reward.coins)} xu`); if (reward.case?.label) rewardParts.push(reward.case.label); if (completionCoins) rewardParts.push(`Thưởng hoàn tất +${formatNumber(completionCoins)} xu`); if (bonusCases.length) rewardParts.push(...bonusCases.map(item => `Thêm ${item.label}`)); if (reward.bonuses?.length && !completionCoins) rewardParts.push(...reward.bonuses); showToast(`Đã nhận ${rewardParts.join(' · ')}.`); }
    catch (failure) { showToast(failure.message || 'Chưa thể nhận nhiệm vụ.', true); }
    finally { setBusy(''); }
  };
  if (error && !data) return <div className="empty-panel activity-error"><p>{error}</p><button className="ghost-button" onClick={load}>Thử tải lại</button></div>;
  if (!data) return <div className="empty-panel" role="status">Đang mở bảng nhiệm vụ...</div>;
  const renderMission = (type, mission) => {
    const action = mission.id.includes('open') || mission.id.includes('finish') ? ['cases', 'Mở hòm'] : mission.id.includes('battle') ? ['battles', 'Vào Battle'] : mission.id.includes('upgrade') ? ['upgrade', 'Mở Upgrade'] : mission.id.includes('boss') ? ['activities', 'Đánh Boss'] : null;
    const reward = mission.reward ?? {};
    const caseReward = reward.case;
    const bonusCases = Array.isArray(reward.bonusCases) ? reward.bonusCases : [];
    return <article className={'quest-card' + (mission.claimed ? ' claimed' : '')} key={`${type}-${mission.id}`}><div className="quest-card-copy"><span className="quest-kind">{type === 'daily' ? 'HÔM NAY' : 'TUẦN NÀY'}</span><strong>{mission.label}</strong><small>{mission.description}</small><i className="quest-rail"><b style={{ width: `${mission.target ? Math.min(100, mission.progress / mission.target * 100) : 0}%` }} /></i><em>{mission.progress} / {mission.target}</em></div><div className="quest-reward"><b>+{formatNumber(reward.xp)}<small> XP</small></b><div className="quest-reward-items">{reward.coins ? <span className="reward-chip coins">+{formatNumber(reward.coins)} xu</span> : null}{caseReward ? <span className="reward-chip case">{caseReward.label || 'Hòm + chìa'}</span> : null}{bonusCases.map(item => <span className="reward-chip case" key={`${item.caseId}-bonus`}>Thêm: {item.label || 'Hòm + chìa'}</span>)}{!reward.coins && !caseReward && !bonusCases.length && reward.cosmetic ? <span className="reward-chip cosmetic">{reward.cosmetic}</span> : null}</div>{mission.claimed ? <mark>ĐÃ NHẬN</mark> : mission.complete ? <button className="primary-button compact-button" disabled={busy === `${type}:${mission.id}`} onClick={() => claim(type, mission)}>{busy === `${type}:${mission.id}` ? '...' : 'Nhận thưởng'}</button> : action && <button className="ghost-button compact-button" onClick={() => onNavigate?.(action[0])}>{action[1]}</button>}</div></article>;
  };
  return <div className="quest-board"><section className="quest-hero"><div><span className="activity-kicker">VÒNG LẶP HÒM · BATTLE · UPGRADE · BOSS</span><h2>Hôm nay chơi gì?</h2><p>Mỗi hành động trong kho đồ đều góp tiến độ. Nhận XP, hòm thật kèm chìa hoặc xu giới hạn, rồi dùng hòm để nạp hỏa lực cho Boss.</p></div><div className="quest-xp"><strong>{formatNumber(data.xp)}</strong><small>XP HỒ SƠ</small></div></section><div className="quest-columns"><section className="quest-section"><div className="quest-section-head"><div><span className="activity-kicker">RESET 00:00 GIỜ VIỆT NAM</span><h3>Nhiệm vụ ngày</h3></div><b>{data.dailyCompleted} / {data.daily.length}</b></div>{data.daily.map(mission => renderMission('daily', mission))}<p className="activity-hint">{data.rewardRules?.dailyAll || 'Hoàn tất đủ nhiệm vụ ngày: nhận thêm Fever Case + chìa.'}</p></section><section className="quest-section"><div className="quest-section-head"><div><span className="activity-kicker">RESET MỖI THỨ HAI</span><h3>Nhiệm vụ tuần</h3></div><b>{data.weeklyCompleted} / {data.weekly.length}</b></div>{data.weekly.map(mission => renderMission('weekly', mission))}<p className="activity-hint">{data.rewardRules?.weeklyAll || 'Hoàn tất đủ nhiệm vụ tuần: nhận thêm Operation Breakout Case + chìa.'}</p></section></div><section className="quest-inventory"><span>✦</span><div><strong>Vật phẩm hồ sơ của bạn</strong><small>Dấu ấn hòm, Mảnh Boss, Chip Upgrade và Bụi di vật chỉ dùng cho nội dung hồ sơ; không bán, không chuyển và không đổi thành xu.</small></div><div className="quest-cosmetics">{Object.entries(data.cosmetics ?? {}).map(([id, count]) => <b key={id}>{count} × {id.replaceAll('-', ' ')}</b>)}</div></section></div>;
}

function BossHunt({ api, showToast }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [claimingMedal, setClaimingMedal] = useState(false);
  const [attempt, setAttempt] = useState(0), [clock, setClock] = useState(Date.now());
  const [tab, setTab] = useState('overview');
  const load = useCallback(async () => {
    try { const next = await api('/boss-hunt'); setData(next); setError(''); }
    catch (failure) { setError(failure.message || 'Không tải được Săn Boss.'); }
  }, [api]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 12000); return () => clearInterval(timer); }, [load, attempt]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const attack = async style => {
    if (busy || !data?.daily.remaining || data.boss.defeated) return;
    setBusy(true);
    try {
      const result = await api('/boss-hunt/attack', { requestId: makeRequestId(), style });
      setData(result); showToast(result.message || 'Đòn đánh đã được ghi nhận.');
    } catch (failure) { showToast(failure.message || 'Đòn đánh chưa được ghi nhận.', true); }
    finally { setBusy(false); }
  };
  const claimMedal = async () => {
    if (claimingMedal) return;
    setClaimingMedal(true);
    try { const result = await api('/boss-hunt/claim', { requestId: makeRequestId() }); setData(result); const rewardParts = [result.medal.bossName]; if (result.victoryReward?.case?.label) rewardParts.push(result.victoryReward.case.label); if (result.victoryReward?.coins) rewardParts.push(`+${formatNumber(result.victoryReward.coins)} xu`); showToast(`Đã nhận phần thưởng Boss · ${rewardParts.join(' · ')}.`); }
    catch (failure) { showToast(failure.message || 'Chưa thể nhận huy hiệu chiến công.', true); }
    finally { setClaimingMedal(false); }
  };
  if (error && !data) return <div className="empty-panel activity-error"><p>{error}</p><button className="ghost-button" onClick={() => setAttempt(value => value + 1)}>Thử tải lại</button></div>;
  if (!data) return <div className="empty-panel" role="status">Đang tải chiến trường...</div>;
  const accent = colors[data.boss.id] ?? '#c381ff';
  const dailyDone = data.dailyMissions.filter(item => item.claimed).length;
  const hasSeasonMedal = data.progress.medals.some(item => item.seasonKey === data.season.key);
  const caseFuel = Math.max(0, Number(data.caseFuel) || 0);
  const victoryReward = data.victoryReward ?? data.bossReward ?? data.reward?.boss ?? null;
  const victoryRewardLabel = victoryReward?.case?.label || victoryReward?.caseLabel || victoryReward?.label || 'Huy hiệu chiến công';
  return <div className="boss-hunt" style={{ '--boss-accent': accent }}>
    <section className="boss-hero">
      <div className="boss-atmosphere" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="boss-hero-top"><span className="activity-kicker">SỰ KIỆN CHUNG CỦA MÁY CHỦ</span><span className="season-pill">{data.season.label}</span></div>
      <div className="boss-intro"><span className={'boss-icon' + (data.lastAttack ? ' was-hit' : '')} aria-hidden="true">{data.boss.icon}{data.lastAttack && <i key={data.lastAttack.at}>−{formatNumber(data.lastAttack.damage)}<small>HP{data.lastAttack.critical ? ' · CHÍ MẠNG' : ''}</small></i>}</span><div><span className="activity-kicker">BOSS · PHA {Math.min(data.boss.phase, data.boss.maxPhases)} / {data.boss.maxPhases}</span><h2>{data.boss.name}</h2><p>{data.boss.defeated ? 'Boss đã bị hạ! Chiến trường mới mở vào mùa kế tiếp.' : data.boss.description}</p></div></div>
      <div className="boss-health-label"><strong>{data.boss.defeated ? 'ĐÃ HẠ GỤC' : `SINH LỰC · PHA ${data.boss.phase}`}</strong><span>{formatNumber(data.boss.health)} / {formatNumber(data.boss.maxHealth)} HP</span></div>
      <div className={'boss-health-rail' + (data.boss.defeated ? ' defeated' : '')} role="progressbar" aria-label="Sinh lực Boss" aria-valuenow={Math.round(data.boss.healthPercent)} aria-valuemin="0" aria-valuemax="100"><i style={{ width: data.boss.healthPercent + '%' }} /></div>
      {data.boss.defeated && <div className="boss-conclusion"><span>✦</span><div><strong>{hasSeasonMedal ? 'Huy hiệu chiến công đã lưu' : 'Máy chủ đã hạ Boss!'}</strong><small>{hasSeasonMedal ? `${data.progress.medals.find(item => item.seasonKey === data.season.key)?.boss.name} · đã thêm vào huy hiệu của bạn` : data.progress.damage >= 100 ? 'Bạn đã góp sát thương và đủ điều kiện nhận huy hiệu mùa này.' : 'Gây ít nhất 100 sát thương tuần này để nhận huy hiệu chiến công.'}</small></div>{!hasSeasonMedal && data.progress.damage >= 100 && <button className="primary-button" disabled={claimingMedal} onClick={claimMedal}>{claimingMedal ? 'Đang nhận...' : 'Nhận huy hiệu'}</button>}</div>}
      <div className="boss-event-stats"><span><strong>{formatNumber(data.boss.totalDamage)}</strong><small>TỔNG SÁT THƯƠNG</small></span><span><strong>{formatNumber(data.boss.participants)}</strong><small>THỢ SĂN THAM GIA</small></span><span><strong>{formatNumber(data.boss.attacks)}</strong><small>ĐÒN ĐÁNH</small></span><span><strong>{resetCountdown(data.season.resetsAt)}</strong><small>CÒN LẠI MÙA NÀY</small></span></div>
      <div className="boss-reward-panel"><div><span>✦</span><strong>Phần thưởng mùa này</strong><small>Mỗi đòn đánh nhận XP thợ săn và góp tiến độ nhiệm vụ. Dùng đủ 3 lượt mỗi ngày để tối đa hóa cấp bậc.</small></div><div><b>XP hồ sơ</b><small>Nhận qua đòn đánh, nhiệm vụ ngày/tuần và cấp Boss.</small></div><div><b>Hỏa lực từ hòm</b><strong className="boss-fuel-value">{caseFuel} lõi</strong><small>Mở 3 hòm bất kỳ nhận 1 lõi. Lõi cộng +75 sát thương cho đòn kế tiếp.</small></div><div><b>Huy hiệu Boss</b><small>{victoryReward ? `Hạ đủ 3 pha: ${victoryRewardLabel}${victoryReward.coins ? ` · +${formatNumber(victoryReward.coins)} xu` : ''}${victoryReward.case?.label ? ` · ${victoryReward.case.label}` : ''}.` : 'Máy chủ hạ Boss và bạn gây đủ 100 sát thương để nhận huy hiệu mùa.'}</small></div></div>
    </section>
    <section className="hunter-dashboard">
      <div className="hunter-panel">
        <div className="hunter-panel-head"><div><span className="activity-kicker">LƯỢT CỦA BẠN · ĐỔI MỚI LÚC 00:00</span><h3>Chọn đòn đánh</h3><p className="boss-fuel-hint">{caseFuel ? `Bạn có ${caseFuel} lõi hỏa lực · đòn kế tiếp được cộng +75 sát thương.` : 'Mở 3 hòm bất kỳ để nạp 1 lõi hỏa lực cho Boss.'}</p></div><b className="attempts-left">{data.daily.remaining}<small> / {data.daily.limit}</small></b></div>
        <div className="daily-progress"><div><span>Nhiệm vụ ngày</span><strong>{dailyDone} / {data.dailyMissions.length} HOÀN THÀNH</strong></div><i><b style={{ width: `${dailyDone / data.dailyMissions.length * 100}%` }} /></i><div className="daily-mission-list">{data.dailyMissions.map(mission => <span className={mission.claimed ? 'complete' : ''} key={mission.id}><i>{mission.claimed ? '✓' : '·'}</i><span>{mission.description}</span><b className="auto-mission-reward">+{formatNumber(mission.rewardXp)} XP{mission.coins > 0 && <small>+{formatNumber(mission.coins)} xu</small>}</b></span>)}</div></div>
        <div className="attack-options">
          <button className="attack-option precision" onClick={() => attack('precision')} disabled={busy || !data.daily.remaining || data.boss.defeated}><span>⌖</span><strong>Ngắm điểm yếu</strong><small>Đòn biến thiên · 18% chí mạng</small><em>CHÍ MẠNG ×1,65</em></button>
          <button className="attack-option steady" onClick={() => attack('steady')} disabled={busy || !data.daily.remaining || data.boss.defeated}><span>⚔</span><strong>Tấn công ổn định</strong><small>Sát thương cân bằng</small><em>ỔN ĐỊNH</em></button>
          <button className="attack-option rally" onClick={() => attack('rally')} disabled={busy || !data.daily.remaining || data.boss.defeated}><span>⇧</span><strong>Tiếp sức đồng đội</strong><small>Để lại +75 cho người đánh kế</small><em>HIỆU LỰC 3 PHÚT</em></button>
        </div>
        {data.daily.remaining === 0 && <p className="activity-hint">Bạn đã hoàn thành lượt hôm nay. Nhiệm vụ mới mở lúc 00:00 giờ Việt Nam.</p>}
        {data.boss.defeated && <p className="activity-hint">Cộng đồng đã hạ Boss tuần này. Điểm và huy hiệu của bạn vẫn được lưu.</p>}
      </div>
      <div className="hunter-panel hunter-rank-panel"><span className="activity-kicker">HỒ SƠ THỢ SĂN</span><div className="rank-display"><span>{data.progress.rank.icon}</span><div><small>CẤP BẬC CỦA BẠN</small><strong>{data.progress.rank.label}</strong></div></div><div className="rank-xp"><span>{formatNumber(data.progress.lifetimeXp)} XP</span><span>{data.progress.rank.nextXp == null ? 'CẤP TỐI ĐA' : `${formatNumber(data.progress.rank.nextXp)} XP · ${data.progress.rank.nextLabel}`}</span></div><i className="rank-rail"><b style={{ width: data.progress.rank.progress + '%' }} /></i><div className="rank-stats"><span><small>ĐÒN TUẦN NÀY</small><strong>{formatNumber(data.progress.attacks)}</strong></span><span><small>SÁT THƯƠNG CỦA BẠN</small><strong>{formatNumber(data.progress.damage)}</strong></span></div><p>Chỉ số dùng để mở cấp bậc và huy hiệu. Không đổi thành xu hoặc vật phẩm có thể bán.</p></div>
    </section>
    <div className="hunter-tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>NHIỆM VỤ TUẦN <span>{data.missions.filter(item => item.claimed).length}/{data.missions.length}</span></button><button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>BẢNG SÁT THƯƠNG <span>{data.leaderboard.length}</span></button><button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>ĐÒN ĐÁNH GẦN ĐÂY</button></div>
    {tab === 'overview' ? <div className="mission-grid">{data.missions.map((mission, index) => <article className={'mission-card' + (mission.claimed ? ' complete' : '')} key={mission.id}><span>{['⚔', '⌖', '⇧', '✦'][index]}</span><div><strong>{mission.label}</strong><small>{mission.description}</small><i><b style={{ width: `${mission.target ? mission.progress / mission.target * 100 : 0}%` }} /></i><em>{mission.claimed ? 'ĐÃ NHẬN XP + XU' : `${formatNumber(mission.progress)} / ${formatNumber(mission.target)}`}</em></div><div className="mission-payout"><b>+{formatNumber(mission.rewardXp)}<small> XP</small></b>{mission.coins > 0 && <span className="reward-chip coins">+{formatNumber(mission.coins)} xu</span>}</div></article>)}</div>
      : tab === 'board' ? <div className="activity-board">{data.leaderboard.map((entry, index) => <article className={entry.isYou ? 'is-you' : ''} key={entry.userId}><b className={'board-place place-' + (index + 1)}>{String(index + 1).padStart(2, '0')}</b><span className="board-avatar">{String(entry.displayName || '?').slice(0, 1).toUpperCase()}</span><strong>{entry.displayName}{entry.isYou && <small> BẠN</small>}</strong><span>{formatNumber(entry.attacks)} đòn</span><em>{formatNumber(entry.damage)} sát thương</em></article>)}{!data.leaderboard.length && <div className="empty-panel">Bảng săn đang chờ đòn đánh đầu tiên.</div>}</div>
      : <div className="activity-log">{data.recent.map((entry, index) => <article className={entry.isYou ? 'is-you' : ''} key={`${entry.at}-${index}`}><span>{entry.critical ? '✦' : entry.style === 'rally' ? '⇧' : '⚔'}</span><strong>{entry.displayName}{entry.isYou && <small> · BẠN</small>}</strong><small>{entry.styleLabel}</small><em>−{formatNumber(entry.damage)} HP</em></article>)}{!data.recent.length && <div className="empty-panel">Mỗi đòn đánh sẽ xuất hiện ở đây.</div>}</div>}
    <p className="activity-footnote">Đồng bộ trên toàn máy chủ · Không tốn xu, không mất skin · {clock ? 'Mọi lượt chơi dùng giờ máy chủ.' : ''}{error && <> · {error}</>}</p>
  </div>;
}

function CollectionBook({ api, showToast }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [claiming, setClaiming] = useState(false);
  const [sort, setSort] = useState('progress');
  const load = useCallback(async () => {
    try { const next = await api('/collection-book'); setData(next); setError(''); }
    catch (failure) { setError(failure.message || 'Không tải được sổ sưu tập.'); }
  }, [api]);
  useEffect(() => { void load(); }, [load, attempt]);
  const selected = data?.sets.find(item => item.id === selectedId);
  const visible = useMemo(() => {
    let sets = [...(data?.sets ?? [])].filter(item => item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
    if (filter === 'incomplete') sets = sets.filter(item => !item.complete);
    if (filter === 'complete') sets = sets.filter(item => item.complete);
    if (filter === 'claimed') sets = sets.filter(item => item.claimed);
    sets.sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name, 'vi')
      : sort === 'missing' ? (left.total - left.owned) - (right.total - right.owned) || left.name.localeCompare(right.name, 'vi')
        : right.percent - left.percent || left.name.localeCompare(right.name, 'vi'));
    return sets;
  }, [data, filter, query, sort]);
  const weaponGroups = useMemo(() => {
    if (!selected) return [];
    const groups = new Map();
    for (const item of selected.items) {
      const weapon = item.weapon || String(item.name || '').split(' | ')[0] || 'Vũ khí khác';
      const group = groups.get(weapon) || { weapon, total: 0, owned: 0 };
      group.total += 1;
      if (item.owned) group.owned += 1;
      groups.set(weapon, group);
    }
    return [...groups.values()].sort((left, right) => right.total - left.total || left.weapon.localeCompare(right.weapon, 'vi'));
  }, [selected]);
  const claim = async item => {
    if (claiming) return;
    setClaiming(true);
    try { const result = await api('/collection-book/claim', { requestId: makeRequestId(), collectionId: item.id }); setData(result.book); const rewardParts = [`huy hiệu ${item.name}`]; if (result.rewardCoins) rewardParts.push(`+${formatNumber(result.rewardCoins)} xu`); if (result.rewardCase?.label) rewardParts.push(result.rewardCase.label); showToast(`Đã nhận ${rewardParts.join(' · ')}.`); }
    catch (failure) { showToast(failure.message || 'Chưa thể nhận huy hiệu.', true); }
    finally { setClaiming(false); }
  };
  const claimMilestone = async milestone => {
    if (claiming) return;
    setClaiming(true);
    try { const result = await api('/collection-book/claim', { requestId: makeRequestId(), milestoneId: milestone.id }); setData(result.book); const rewardParts = [result.reward]; if (result.rewardCoins) rewardParts.push(`+${formatNumber(result.rewardCoins)} xu`); if (result.rewardCase?.label) rewardParts.push(result.rewardCase.label); showToast(`Đã nhận ${rewardParts.join(' · ')}.`); }
    catch (failure) { showToast(failure.message || 'Chưa thể nhận mốc sưu tập.', true); }
    finally { setClaiming(false); }
  };
  if (error && !data) return <div className="empty-panel activity-error"><p>{error}</p><button className="ghost-button" onClick={() => setAttempt(value => value + 1)}>Thử tải lại</button></div>;
  if (!data) return <div className="empty-panel" role="status">Đang mở sổ sưu tập...</div>;
  return <div className="collection-book">
    <section className="book-summary"><div className="book-emblem">▤</div><div className="book-summary-copy"><span className="activity-kicker">CS2 · CÁC BỘ SƯU TẬP HUYỀN THOẠI</span><h2>Sưu tầm theo cách của bạn</h2><p>Mỗi finish chỉ tính một lần. StatTrak, độ mòn và số bản trùng không làm tăng tiến độ. Skin phải đang nằm trong kho để được tính.</p></div><div className="book-total"><strong>{data.totals.percent}%</strong><small>HOÀN THÀNH</small></div><div className="book-progress"><i><b style={{ width: `${data.totals.percent}%` }} /></i><span>{formatNumber(data.totals.collected)} / {formatNumber(data.totals.total)} finish độc nhất</span></div></section>
    <section className="book-achievements"><span>✦</span><div><strong>Huy hiệu bộ sưu tập</strong><small>Hoàn thành toàn bộ một bộ rồi nhận huy hiệu hồ sơ. Huy hiệu được giữ lại nếu bạn bán hoặc trao đổi skin sau đó.</small></div><b>{data.totals.claimedSets} <small>/ {data.totals.sets}</small></b></section>
    <section className="book-milestones"><div className="book-milestones-head"><div><span className="activity-kicker">PHẦN THƯỞNG TIẾN ĐỘ</span><h3>Sổ càng dày, hồ sơ càng nổi bật</h3><p>Thu thập finish để nhận xu, hòm kèm chìa và phần thưởng hồ sơ ở từng mốc.</p></div><span className="book-milestone-total">{data.totals.collected} / {data.totals.total}</span></div><div className="book-milestone-grid">{(data.milestones ?? []).map(milestone => { const rewardClaimed = milestone.rewardClaimed ?? milestone.claimed; return <article className={'book-milestone' + (rewardClaimed ? ' claimed' : '') + (milestone.complete ? ' complete' : '')} key={milestone.id}><div className="book-milestone-percent">{milestone.threshold}%</div><div className="book-milestone-copy"><strong>{milestone.label}</strong><small>{milestone.description}</small><b>{milestone.reward}</b><RewardPayout className="book-inline-payout" coins={milestone.rewardCoins} caseReward={milestone.caseReward}/></div>{rewardClaimed ? <mark>ĐÃ NHẬN</mark> : milestone.complete ? <button className="primary-button compact-button" disabled={claiming} onClick={() => claimMilestone(milestone)}>{claiming ? '...' : 'Nhận thưởng'}</button> : <span className="book-milestone-lock">Đang mở</span>}</article>; })}</div></section>
    <div className="book-toolbar"><div className="book-filters">{[['all', 'Tất cả'], ['incomplete', 'Đang sưu tầm'], ['complete', 'Đã đủ bộ'], ['claimed', 'Đã có huy hiệu']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm bộ sưu tập..." aria-label="Tìm bộ sưu tập"/><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sắp xếp bộ sưu tập"><option value="progress">Tiến độ cao nhất</option><option value="missing">Ít skin còn thiếu</option><option value="name">Tên A–Z</option></select></div>
    <div className="book-set-grid">{visible.map(item => { const rewardClaimed = item.rewardClaimed ?? item.claimed; return <button className={'book-set-card' + (item.complete ? ' complete' : '') + (item.claimed ? ' claimed' : '')} key={item.id} onClick={() => setSelectedId(item.id)}><span className="book-set-image">{item.image ? <img src={item.image} loading="lazy" alt="" /> : '◇'}{item.claimed && <i title="Đã nhận huy hiệu">✦</i>}</span><span className="book-set-info"><strong>{item.name.replace(/^The /, '')}</strong><small>{item.complete ? rewardClaimed ? 'ĐÃ NHẬN THƯỞNG' : 'HOÀN THÀNH · CÓ THƯỞNG' : `${item.total - item.owned} skin còn thiếu`}</small><RewardPayout className="book-set-payout" coins={item.rewardCoins} caseReward={item.rewardCase}/><i><b style={{ width: `${item.percent}%` }} /></i><em>{item.owned} / {item.total} · {item.percent}%</em></span><span className="book-set-arrow">→</span></button>; })}</div>
    {!visible.length && <div className="empty-panel">Không có bộ sưu tập phù hợp.</div>}
    {selected && <section className="book-detail" aria-live="polite"><div className="book-detail-head">{selected.image && <img src={selected.image} alt=""/>}<div><span className="activity-kicker">{selected.kind === 'collection' ? 'BỘ SƯU TẬP CS2' : 'BỘ SKIN'}</span><h3>{selected.name}</h3><small>{selected.owned} / {selected.total} finish · {selected.percent}%</small><RewardPayout className="book-detail-payout" coins={selected.rewardCoins} caseReward={selected.rewardCase}/></div><button className="book-close" onClick={() => setSelectedId('')} aria-label="Đóng bộ sưu tập">×</button>{selected.complete && (selected.rewardClaimed ?? selected.claimed) === false && <button className="primary-button book-claim" disabled={claiming} onClick={() => claim(selected)}>{claiming ? 'Đang nhận...' : selected.claimed ? '✦ Nhận phần thưởng' : '✦ Nhận huy hiệu + thưởng'}</button>}{selected.claimed && <span className="book-badge-earned">✦ HUY HIỆU ĐÃ NHẬN</span>}</div><div className="book-requirements"><div className="book-requirements-head"><div><span className="activity-kicker">DANH SÁCH CẦN SƯU TẦM</span><strong>Bộ này cần {selected.total} finish thuộc {weaponGroups.length} dòng súng</strong><small>Độ mòn và StatTrak không tạo thêm mục mới. Mỗi dòng dưới đây là một finish riêng cần sở hữu.</small></div><b>{selected.total - selected.owned} còn thiếu</b></div><div className="book-weapon-groups">{weaponGroups.map(group => <span key={group.weapon} className={group.owned === group.total ? 'complete' : ''}><strong>{group.weapon}</strong><small>{group.owned}/{group.total} đã có</small></span>)}</div></div><div className="book-skin-grid">{selected.items.map(item => <article className={'book-skin' + (item.owned ? ' owned' : '')} key={item.skinId}><ImageFrame item={item}/><span><strong title={item.name}>{item.weapon || String(item.name || '').split(' | ')[0]}</strong><small>{item.finish || item.name}{item.owned ? ' · ✓ ĐANG CÓ' : ' · CHƯA SƯU TẦM'}</small></span></article>)}</div></section>}
    {error && <p className="activity-footnote">{error} <button className="book-reload" onClick={() => setAttempt(value => value + 1)}>Làm mới</button></p>}
  </div>;
}
