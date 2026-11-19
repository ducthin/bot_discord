import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './club.css';
import './case-opening.css';
import {Modal,PageTitle,coins,chance,formatDate,safeRead,safeWrite} from './shared';
import {CasesPage,CasePage} from './cases';
import {InventoryPage,MarketPage,UpgradePage} from './collection';
import BattlePage from './battles';
import ActivitiesPage from './activities';
import {createBattleWalletPresentation} from './battle-wallet';
const views=['cases','battles','activities','market','upgrade','inventory','history'];
const caseHash = /^case\/(battle-[a-z0-9-]+|crate-\d+)$/;
function Header({view,navigate,authenticated,me,onLogin,onLogout,audio,onAudioChange,onMenu}) {const muted=audio?.status?.().muted===true;return <><div className="app-utility"><span><i/> HAPPY HOUSE COMMUNITY</span><div><span>◇ CS2 CASES</span><span>⚔ CASE BATTLE</span><span>⟐ UPGRADE</span></div><span>VI / XU DISCORD</span></div><header className="app-header"><button className="app-brand" onClick={()=>navigate('cases')} aria-label="Trang chủ"><span className="brand-mark">H</span><span><b>Happy house</b><small>SCAM CLUB · CS2</small></span></button><nav className="app-nav" aria-label="Điều hướng">{[['cases','◇','MỞ HÒM'],['battles','⚔','BATTLES'],['activities','✦','SỰ KIỆN'],['market','↔','CHỢ'],['upgrade','⟐','UPGRADE'],['inventory','▱','KHO ĐỒ'],['history','◷','LỊCH SỬ']].map(([v,icon,label])=><button key={v} className={view===v||(v==='cases'&&view==='case')?'active':''} onClick={()=>navigate(v)}><span>{icon}</span>{label}</button>)}</nav><div className="app-account"><button id="sound-toggle" className={'sound-button '+(muted?'muted':'')} onClick={onAudioChange} aria-label={muted?'Bật âm thanh':'Tắt âm thanh'} aria-pressed={!muted} title={muted?'Bật âm thanh':'Tắt âm thanh'}>{muted?'♪':'♫'}</button>{authenticated?<><button className="account-balance" onClick={()=>navigate('inventory')}><small>VÍ CỦA BẠN</small>{me?.balanceFormatted??'0 xu'}</button><button className="avatar-button" onClick={onLogout} title="Đăng xuất" aria-label="Đăng xuất">{(me?.user?.displayName??'H').slice(0,1)}</button></>:<button className="sign-button" onClick={onLogin}>ĐĂNG NHẬP ↗</button>}<button className="menu-button" onClick={onMenu} aria-label="Mở menu">☰</button></div></header></>}
function HistoryPage({me,authenticated,onLogin}) {if(!authenticated)return <main className="app-main"><PageTitle eyebrow="YOUR ACTIVITY" title="LỊCH SỬ"/><div className="auth-panel"><h2>Các lượt chơi của bạn</h2><button className="primary-button" onClick={onLogin}>Đăng nhập Discord</button></div></main>;const entries=[...(me?.history??[]),...(me?.upgrade?.history??[]).map(e=>({...e,action:'upgrade'}))].sort((a,b)=>(b.at??b.createdAt??0)-(a.at??a.createdAt??0));const labels={open:'Mở hòm',sell:'Bán skin',upgrade:'Upgrade'};return <main className="app-main"><PageTitle eyebrow="YOUR RECENT ACTIVITY" title="LỊCH SỬ CỦA BẠN" copy="Các lượt mở hòm, giao dịch skin và trận Battle gần đây."/><div className="history-list">{entries.map((entry,i)=><article key={(entry.requestId??entry.id??i)+'-'+i}><span>{entry.action==='upgrade'?'⟐':entry.action==='sell'?'↔':'◇'}</span><div><strong>{labels[entry.action]??entry.message??entry.action}</strong><small>{entry.action==='upgrade'?(entry.won?'Thành công':'Không trúng')+' · '+(entry.target?.name??''):(entry.items??[]).map(e=>e.name).slice(0,3).join(' · ')}</small><small>{formatDate(entry.at??entry.createdAt)}</small></div><em>{entry.action==='upgrade'?chance(entry.chance)+'%':coins(entry.total)}</em></article>)}</div>{!entries.length&&<div className="empty-panel">Chưa có hoạt động gần đây.</div>}</main>}
function App() {
  const csrfRef = useRef('');
  const navigationVersion = useRef(0);
  const audioRef = useRef(null);
  const [catalogue, setCatalogue] = useState([]);
  const battleCatalogue = useMemo(() => catalogue.filter(item => item.id.startsWith('battle-')), [catalogue]);
  const [view, setView] = useState('cases');
  const [caseId, setCaseId] = useState('');
  const [detail, setDetail] = useState(null);
  const [count, setCount] = useState(1);
  const [authenticated, setAuthenticated] = useState(false);
  const [me, setMe] = useState(null);
  const meRef = useRef(null), battleWallet = useRef(null);
  if (!battleWallet.current) battleWallet.current = createBattleWalletPresentation();
  meRef.current = me;
  const [battleBalance, setBattleBalance] = useState(null);
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
  const notify = useCallback((message, error = false) => { setToast({ message, error }); }, []);
  const api = useCallback(async (path, body) => {
    const requestStartedAt = performance.now();
    const response = await fetch(`/play/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfRef.current }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const responseReceivedAt = performance.now();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401 && path !== '/login') { setAuthenticated(false); setMe(null); csrfRef.current = ''; } throw Object.assign(new Error(data.message ?? 'Không thể xử lý yêu cầu.'), { status: response.status }); }
    if (data.csrfToken) csrfRef.current = data.csrfToken;
    if (data.room && typeof data.room === 'object') {
      const serverTime = Number(response.headers.get('x-server-time'));
      const serverElapsed = Number(response.headers.get('x-server-elapsed'));
      const rtt = Math.max(0, responseReceivedAt - requestStartedAt);
      const networkRtt = Number.isFinite(serverElapsed) ? Math.max(0, rtt - serverElapsed) : rtt;
      const fallbackTime = Date.parse(response.headers.get('date') ?? '') || Date.now();
      data.room.playbackClock = { serverNow: (Number.isFinite(serverTime) && serverTime > 0 ? serverTime : fallbackTime) + networkRtt / 2,
        receivedAt: responseReceivedAt };
    }
    return data;
  }, []);
  const refreshMe = useCallback(async () => { if (!authenticated) return null; try { const data = await api('/me'); setMe(data); return data; } catch (error) { notify(error.message, true); return null; } }, [api, authenticated, notify]);
  const trackBattleBalance = useCallback(room => {
    const current = meRef.current;
    const clock = room?.playbackClock;
    const now = Number.isFinite(clock?.serverNow) && Number.isFinite(clock?.receivedAt) ? clock.serverNow + performance.now() - clock.receivedAt : Date.now();
    const epoch = room?.playbackStartedAt ?? (Number.isFinite(room?.finishedAt) ? room.finishedAt + 6000 : null);
    const pending = room?.status === 'finished' && epoch != null && window.MaySkinsBattlePresentation
      ? now < epoch + window.MaySkinsBattlePresentation.playbackPlan(room).duration : false;
    setBattleBalance(battleWallet.current.watch(room, current?.user?.userId, current?.balance, { pending }));
    if (pending) void api('/me').then(data => {
      setMe(data);
      const held = battleWallet.current.confirmSettledBalance(room.id, data.balance);
      if (held !== undefined) setBattleBalance(held);
    }).catch(() => {});
  }, [api]);
  const finishBattleBalance = useCallback(roomId => {
    if (battleWallet.current.finish(roomId)) {
      setBattleBalance(null);
      void refreshMe();
    }
  }, [refreshMe]);
  const navigate = useCallback(next => {
    navigationVersion.current++;
    setMenuOpen(false);
    if (!views.includes(next)) next = 'cases';
    setView(next); setDetail(null); setCaseId(''); setUpgradeInputs([]);
    history.pushState(null, '', `#${next}`);
  document.title = `${({ cases: 'Mở hòm', battles: 'Case Battle', activities: 'Sự kiện & sưu tập', market: 'Chợ người chơi', upgrade: 'Upgrade', inventory: 'Kho đồ', history: 'Lịch sử' })[next]} · Happy house Scam Club`;
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (next !== 'cases' && authenticated) void refreshMe();
  }, [authenticated, refreshMe]);
  const selectCase = useCallback(async id => {
    const version = ++navigationVersion.current;
    try { const data = await api(`/cases/${encodeURIComponent(id)}`); if (version !== navigationVersion.current) return; setDetail(data); setCaseId(id); setView('case'); if(location.hash !== `#case/${encodeURIComponent(id)}`) history.pushState(null, '', `#case/${encodeURIComponent(id)}`); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (error) { if (version === navigationVersion.current) notify(error.message, true); }
  }, [api, notify]);
  useEffect(() => {
    audioRef.current = window.MaySkinsAudio?.create({ safeRead, safeWrite, button: null });
    const initialHash = location.hash.slice(1);
    const match = caseHash.exec(initialHash);
    if (match) { void selectCase(match[1]); }
    else if (views.includes(initialHash)) setView(initialHash);
    Promise.all([api('/catalogue'), api('/session')]).then(async ([cases, session]) => {
      setCatalogue(cases.cases ?? []); setAuthenticated(session.authenticated === true); csrfRef.current = session.csrfToken ?? '';
      if (session.authenticated) setMe(await api('/me'));
    }).catch(error => notify(error.message, true)).finally(() => setLoading(false));
    const onHash = () => { const hash = location.hash.slice(1); const target = caseHash.exec(hash); if (target) void selectCase(target[1]); else { navigationVersion.current++; setView(views.includes(hash) ? hash : 'cases'); setDetail(null); setCaseId(''); setUpgradeInputs([]); } };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); audioRef.current?.destroy?.(); };
  }, []);
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(null), toast.error ? 6500 : 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (!authenticated) return undefined; const timer = window.setInterval(() => { if (!document.hidden) void refreshMe(); }, 25000); return () => clearInterval(timer); }, [authenticated, refreshMe]);
  const openLogin = () => { setLoginError(''); const fragment = location.hash.startsWith('#login=') ? new URLSearchParams(location.hash.slice(1)).get('login') : ''; if (fragment && /^[A-HJ-NP-Z2-9-]{16,19}$/i.test(fragment)) setLoginCode(fragment.toUpperCase()); setLoginOpen(true); };
  const submitLogin = async event => { event.preventDefault(); if (!/^[A-HJ-NP-Z2-9]{16}$/i.test(loginCode.replace(/[-\s]/g,''))) { setLoginError('Nhập mã 16 ký tự lấy từ lệnh /web trong Discord.'); return; } setLoginBusy(true); setLoginError(''); try { const session = await api('/login', { code: loginCode.replace(/[-\s]/g,'').toUpperCase().match(/.{4}/g).join('-') }); csrfRef.current = session.csrfToken ?? ''; setAuthenticated(true); setMe(await api('/me')); setLoginOpen(false); setLoginCode(''); notify('Đã kết nối tài khoản Discord.'); } catch (error) { setLoginError(error.message); } finally { setLoginBusy(false); } };
  const logout = async () => { if (!window.confirm('Đăng xuất khỏi tài khoản Discord?')) return; try { await api('/logout', {}); setAuthenticated(false); setMe(null); csrfRef.current = ''; notify('Đã đăng xuất.'); } catch (error) { notify(error.message, true); } };
  const audio = audioRef.current;
  const refreshAudio = () => { audioRef.current?.toggle?.(); forceAudioRefresh(value => value + 1); };
  const startUpgradeWith = items => { navigate('upgrade'); setUpgradeInputs(items.filter(item => !item.locked)); };
  const displayedMe = view === 'battles' && me && battleBalance !== null ? { ...me, balance: battleBalance, balanceFormatted: coins(battleBalance) } : me;
  if (loading) return <div className="app-loading"><span className="brand-symbol">H</span><strong>HAPPY HOUSE SCAM CLUB</strong><span>Đang tải sảnh CS2...</span></div>;
  return <div className="app-shell"><Header view={view} navigate={navigate} authenticated={authenticated} me={displayedMe} onLogin={openLogin} onLogout={logout} audio={audio} onAudioChange={refreshAudio} onMenu={() => setMenuOpen(true)} />
    {view === 'cases' && <CasesPage me={me} catalogue={catalogue} favorites={favorites} setFavorites={setFavorites} onSelectCase={selectCase} onNavigate={navigate} authenticated={authenticated} onLogin={openLogin} />}
    {view === 'case' && <CasePage key={caseId} me={me} detail={detail} count={count} setCount={setCount} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} audio={audio} showToast={notify} onBack={() => navigate('cases')} onNavigate={navigate} onUpgrade={startUpgradeWith} onReload={() => selectCase(caseId)} />}
    {view === 'inventory' && <InventoryPage me={me} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} showToast={notify} onUpgrade={startUpgradeWith} />}
    {view === 'market' && <MarketPage me={me} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} showToast={notify} />}
    {view === 'upgrade' && <UpgradePage key={upgradeInputs.map(item => item.id).join(':')} me={me} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} showToast={notify} initialInputs={upgradeInputs} audio={audio} />}
    {view === 'battles' && <BattlePage catalogue={battleCatalogue} authenticated={authenticated} onLogin={openLogin} api={api} refreshMe={refreshMe} audio={audio} showToast={notify} onBattleRoomChange={trackBattleBalance} onBattlePlaybackComplete={finishBattleBalance} />}
    {view === 'activities' && <ActivitiesPage authenticated={authenticated} onLogin={openLogin} api={api} showToast={notify} onNavigate={navigate} />}
    {view === 'history' && <HistoryPage me={me} authenticated={authenticated} onLogin={openLogin} />}
    <footer className="app-footer"><div><b>HAPPY HOUSE<span>SCAM CLUB</span></b><p>DRIVE. LOVE. CS2.</p></div><nav aria-label="Liên kết cuối trang">{[["cases","Mở hòm"],["battles","Case Battle"],["activities","Sự kiện & sưu tập"],["market","Chợ người chơi"],["upgrade","Upgrade"],["inventory","Kho đồ"],["history","Lịch sử"]].map(([target,label])=><button key={target} onClick={()=>navigate(target)}>{label}</button>)}</nav><small>Skin mô phỏng · Xu ảo trong Discord<br/>Không nạp/rút tiền hoặc giao dịch Steam.</small></footer>
    <nav className="mobile-nav">{[['cases', '⌂', 'MAIN'], ['battles', '♞', 'BATTLE'], ['activities', '✦', 'SỰ KIỆN'], ['upgrade', '⟐', 'UPGRADE'], ['inventory', '▱', 'KHO'], ['menu', '☰', 'MENU']].map(([name, icon, label]) => <button key={name} className={(view === name || name === 'cases' && view === 'case') ? 'active' : ''} onClick={() => name === 'menu' ? setMenuOpen(true) : navigate(name)}><span>{icon}</span><small>{label}</small></button>)}</nav>
    {toast && <div className={`app-toast ${toast.error ? 'error' : ''}`} role="status">{toast.message}</div>}
    <Modal open={loginOpen} title="Kết nối với Discord" eyebrow="MỘT TÀI KHOẢN · MỘT KHO ĐỒ" onClose={() => setLoginOpen(false)}><form className="login-form" onSubmit={submitLogin}><p>Dùng lệnh <strong>/web</strong> trong Discord để lấy mã một lần. Không nhập mật khẩu hoặc Discord token.</p><label>Mã đăng nhập<input autoFocus value={loginCode} onChange={event => setLoginCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH-JKLM-NPQR" maxLength={19} autoComplete="one-time-code" /></label>{loginError && <p className="form-error">{loginError}</p>}<button className="primary-button" disabled={loginBusy}>{loginBusy ? 'Đang kết nối...' : 'Vào kho của tôi ↗'}</button></form></Modal>
    <Modal open={menuOpen} title="MENU" eyebrow="HAPPY HOUSE SCAM CLUB" onClose={() => setMenuOpen(false)} className="menu-modal"><div className="menu-links">{[['cases', '⌂', 'Main'], ['battles', '♞', 'Battles'], ['activities', '✦', 'Sự kiện & sưu tập'], ['market', '↔', 'Chợ người chơi'], ['upgrade', '⟐', 'Upgrade'], ['inventory', '▱', 'Kho đồ'], ['history', '◷', 'Lịch sử']].map(([target, icon, label]) => <button key={target} onClick={() => navigate(target)}><span>{icon}</span>{label} →</button>)}</div><div className="menu-balance"><span>● Hệ thống hoạt động</span><strong>{authenticated ? displayedMe?.balanceFormatted : 'Chơi bằng xu ảo'}</strong></div></Modal>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);


