import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ImageFrame, ItemCard, Modal, coins, amount, chance, shortName, itemDetails, tierClass, makeRequestId, safeRead, safeWrite} from './shared';
const GROUPS = {standard:'Hòm thường',casual:'Khởi đầu',theme:'Chủ đề',gold:'Dao & găng',rarity:'Độ hiếm',weapon:'Vũ khí'};
export function CasesPage({catalogue,favorites,setFavorites,onSelectCase,onNavigate,authenticated,onLogin,me}) {
  const [query,setQuery]=useState(''), [group,setGroup]=useState('all'), [sort,setSort]=useState('featured'), [available,setAvailable]=useState(false),[slide,setSlide]=useState(0);
  const visible=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase('vi');
    const items=catalogue.filter(item => (group==='all' || (group==='favorites' ? favorites.has(item.id) : item.group===group)) &&
      (!available || item.available || (item.kind==='standard' && me?.caseStock?.cases?.[item.id]>0 && me?.caseStock?.keys?.[item.keyId]>0)) &&
      (!term || `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('vi').includes(term)));
    if(sort==='name') items.sort((a,b)=>a.name.localeCompare(b.name));
    if(sort==='low'||sort==='high') items.sort((a,b)=>{
      if(!a.available || !b.available) return Number(b.available)-Number(a.available);
      const delta=amount(a.fee)-amount(b.fee);
      return (delta<0n?-1:delta>0n?1:0)*(sort==='low'?1:-1);
    });
    return items;
  },[catalogue,favorites,group,sort,available,query,me?.caseStock]);
  const recent=(me?.history??[]).filter(e=>e.action==='open').flatMap(e=>e.items??[]).slice(0,12);
  const featured=catalogue.filter(c=>c.available).slice(0,9);
  const feed=recent.length?recent:featured;
  const groups=useMemo(()=>new Set(catalogue.map(item=>item.group)),[catalogue]);
  const sections=group==='all'&&sort==='featured'&&!query.trim()?Object.entries(GROUPS).map(([id,title])=>({id,title,items:visible.filter(c=>c.group===id)})).filter(s=>s.items.length):[{id:'results',title:group==='favorites'?'Hòm yêu thích':GROUPS[group]??'Tất cả hòm',items:visible}];
  const favorite=id=>setFavorites(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);safeWrite('favorites',[...n]);return n});
  return <><section className="drop-feed" aria-label={recent.length?'Skin vừa nhận':'Hòm nổi bật'}><div className="feed-label"><i/><b>{recent.length?'YOUR DROPS':'EXPLORE'}</b><small>{recent.length?'MỚI NHẬN':'HÒM NỔI BẬT'}</small></div><div className="feed-items">{feed.map((item,i)=><button className={'feed-item '+tierClass(item)} key={item.id+'-'+i} onClick={()=>recent.length?onNavigate('inventory'):onSelectCase(item.id)}><ImageFrame item={item}/><div><b>{shortName(item.name)}</b><small>{recent.length?coins(item.value):item.feeFormatted}</small></div></button>)}</div></section>
  <section className={'club-banner slide-'+slide}><div className="banner-scenery"/><div className="banner-light"/><div className="banner-sparks" aria-hidden="true"><i/><i/><i/><i/><i/></div><button className="banner-arrow prev" onClick={()=>setSlide((slide+2)%3)} aria-label="Banner trước">‹</button><div className="banner-content"><span className="banner-kicker">HAPPY HOUSE · CS2 COMMUNITY</span><h1>{slide===0?<><em>GRAND</em><br/>HEIST<span>THE SKIN COLLECTION</span></>:slide===1?<><em>CHASE</em><br/>LEGENDS<span>HOWL. DRAGON LORE. BLUE GEM.</span></>:<><em>CASE</em><br/>BATTLE<span>ONE ROOM. EVERYONE PLAYS.</span></>}</h1><p>{slide===2?'Cùng hòm. Cùng cơ hội. Đấu cùng bạn bè.':'Chọn hòm yêu thích. Khám phá món skin tiếp theo.'}</p></div><div className="banner-side"><span>{slide===2?'READY FOR THE NEXT ROUND?':'YOUR NEXT DROP IS WAITING'}</span><div className="banner-stats"><b>{catalogue.length}<small>HÒM CS2</small></b><b>3<small>LUẬT BATTLE</small></b><b>4<small>VỊ TRÍ</small></b></div><button className="primary-button" onClick={()=>slide===2?onNavigate('battles'):document.getElementById('case-catalogue')?.scrollIntoView({behavior:'smooth'})}>{slide===2?'VÀO CASE BATTLE':'KHÁM PHÁ BỘ SƯU TẬP'} ↗</button></div><button className="banner-arrow next" onClick={()=>setSlide((slide+1)%3)} aria-label="Banner tiếp theo">›</button><div className="banner-pagination">{[0,1,2].map(n=><button key={n} onClick={()=>setSlide(n)} className={n===slide?'active':''} aria-label={'Chọn banner '+(n+1)} aria-pressed={n===slide}/>)}</div></section>
  <main className="app-main home-main" id="case-catalogue"><div className="catalogue-nav"><button className={group!=='favorites'?'active':''} onClick={()=>setGroup('all')}>◇ DANH MỤC HÒM</button><button className={group==='favorites'?'active':''} onClick={()=>setGroup('favorites')}>♡ YÊU THÍCH <small>{favorites.size}</small></button><span>{catalogue.length} hòm · Đồng bộ Discord</span></div><div className="catalogue-toolbar"><div className="filter-tabs"><button className={group==='all'?'active':''} aria-pressed={group==='all'} onClick={()=>setGroup('all')}>Tất cả</button>{Object.entries(GROUPS).filter(([id])=>groups.has(id)).map(([id,label])=><button key={id} className={group===id?'active':''} aria-pressed={group===id} onClick={()=>setGroup(id)}>{label}</button>)}</div><div className="catalogue-tools"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm hòm, AWP, Howl..." aria-label="Tìm hòm"/><select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sắp xếp hòm"><option value="featured">Nổi bật</option><option value="low">Giá tăng dần</option><option value="high">Giá giảm dần</option><option value="name">Tên A–Z</option></select><button className="filter-reset" onClick={()=>{setQuery('');setSort('featured');setGroup('all');setAvailable(false)}} aria-label="Đặt lại bộ lọc">↻</button></div></div><div className="catalogue-summary"><span>{visible.length} hòm phù hợp</span><label><input type="checkbox" checked={available} onChange={e=>setAvailable(e.target.checked)}/> Chỉ hòm sẵn sàng</label></div>
  {sections.map(s=><section className="case-section" key={s.id}><div className="section-head"><h2>{s.title.toUpperCase()} <span>✧</span></h2><small>{s.items.length} HÒM</small></div><div className="case-grid">{s.items.map((item,i)=><article className={'case-tile accent-'+(i%5)} key={item.id}><button className={'favorite '+(favorites.has(item.id)?'saved':'')} onClick={()=>favorite(item.id)} aria-label={(favorites.has(item.id)?'Bỏ yêu thích ':'Yêu thích ')+item.name} aria-pressed={favorites.has(item.id)}>{favorites.has(item.id)?'♥':'♡'}</button><button className="case-tile-main" onClick={()=>onSelectCase(item.id)}><div className="case-art"><div className="case-aura"/><ImageFrame item={item}/></div><h3>{item.name}</h3><span className="case-risk">{item.riskLabel??GROUPS[item.group]}</span><strong className={item.available?'':'unavailable'}>{item.feeFormatted}</strong><span className="case-hover">XEM HÒM ↗</span></button></article>)}</div></section>)}{!visible.length&&<div className="empty-panel">Không tìm thấy hòm phù hợp. Hãy thử từ khóa hoặc bộ lọc khác.</div>}
  <section className="community-strip"><div><span className="app-eyebrow">PLAY TOGETHER</span><h2>MỘT CỘNG ĐỒNG. VÔ VÀN KHOẢNH KHẮC.</h2><p>Mở hòm, Upgrade và Case Battle cùng Happy House.</p></div><button className="primary-button" onClick={()=>authenticated?onNavigate('battles'):onLogin()}>{authenticated?'Tạo trận Battle':'Kết nối Discord'} ↗</button></section></main></>;
}
const EASING=[.16,.58,.12,1];
function ReelLane({winner,pool,duration,onDone,index}){
 const track=useRef(null),done=useRef(false),doneCallback=useRef(onDone),[offset,setOffset]=useState(0),[running,setRunning]=useState(false),[resized,setResized]=useState(false); const target=34; doneCallback.current=onDone;
 const cards=useMemo(()=>{const p=pool.length?pool:[winner];const a=Array.from({length:41},(_,i)=>p[(i*7+index*3)%p.length]);a[target]=winner;return a},[pool,winner,index]);
 useEffect(()=>{let raf2,firstResize=true;const measure=()=>{const el=track.current,card=el?.firstElementChild;if(!card)return;const w=card.getBoundingClientRect().width,gap=parseFloat(getComputedStyle(el).gap)||0;return el.parentElement.clientWidth/2-w/2-target*(w+gap)};const raf=requestAnimationFrame(()=>{setOffset(measure()??0);raf2=requestAnimationFrame(()=>setRunning(true))});const observer=new ResizeObserver(()=>{if(firstResize){firstResize=false;return}setResized(true);setOffset(measure()??0);setRunning(true)});if(track.current?.parentElement)observer.observe(track.current.parentElement);const timer=setTimeout(()=>{if(!done.current){done.current=true;doneCallback.current()}},duration+180);return()=>{observer.disconnect();cancelAnimationFrame(raf);cancelAnimationFrame(raf2);clearTimeout(timer)}},[duration]);
 return <div className="reel-lane"><span className="reel-pointer top">▽</span><div className="reel-window"><div className="reel-track" ref={track} style={{transform:'translate3d('+(running?offset:0)+'px,0,0)',transition:running&&!resized?'transform '+duration+'ms cubic-bezier(.16,.58,.12,1)':'none'}}>{cards.map((c,i)=><div className={'reel-card '+tierClass(c)} key={i}><ImageFrame item={c} eager/><strong title={c.name}>{c.name}</strong><small className="case-item-details">{itemDetails(c) || c.rarity}</small></div>)}</div><div className="reel-center"/></div><span className="reel-pointer bottom">△</span></div>
}
const OPENING_PAGE_SIZE = 10;
const MAX_SAFE_COUNT = BigInt(Number.MAX_SAFE_INTEGER);
const minCount = (a, b) => a < b ? a : b;
function standardCost(count, stock, casePrice, keyPrice) {
  const missingCases = count - minCount(count, stock.cases);
  if (missingCases > 0n && casePrice == null) return null;
  return missingCases * (casePrice ?? 0n) + (count - minCount(count, stock.keys)) * keyPrice;
}
function affordableStandardCount(balance, stock, casePrice, keyPrice) {
  let low = 0n, high = casePrice == null ? minCount(MAX_SAFE_COUNT, stock.cases) : MAX_SAFE_COUNT;
  while (low < high) {
    const count = (low + high + 1n) / 2n;
    if (standardCost(count, stock, casePrice, keyPrice) <= balance) low = count;
    else high = count - 1n;
  }
  return low;
}
function trialResult(detail, requestId, index) {
  let seed = 2166136261;
  for (const char of `${requestId}:${index}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  let ticket = seed / 4294967296 * 100;
  const item = detail.entries.find(entry => (ticket -= entry.chance) < 0) ?? detail.entries.at(-1);
  return { ...item, id: `demo-${requestId}-${index}` };
}
export function CasePage({ me, detail, count, setCount, authenticated, onLogin, api, refreshMe, audio, showToast, onBack, onNavigate, onUpgrade, onReload }) {
  const [fast, setFast] = useState(() => safeRead('fast', false));
  const [exclusive, setExclusive] = useState(() => safeRead('exclusive-opening', true));
  const [phase, setPhase] = useState('ready'), [result, setResult] = useState(null);
  const [sale, setSale] = useState(null), [selling, setSelling] = useState(false), [trying, setTrying] = useState(false);
  const [standardQuote, setStandardQuote] = useState(null), [quoting, setQuoting] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [soldIds, setSoldIds] = useState(new Set()), [resultPage, setResultPage] = useState(0);
  const [countText, setCountText] = useState(String(count)), [recovering, setRecovering] = useState(false);
  const pending = useRef(null), lock = useRef(false), mounted = useRef(true), stop = useRef(null), done = useRef(new Set()), upgradeLock = useRef(false);
  const visibleRef = useRef([]), phaseRef = useRef('ready'); phaseRef.current = phase;
  const recoveryKey = 'may-skins:pending-open:' + location.origin + ':' + (me?.user?.guildId ?? 'guest') + ':' + (me?.user?.userId ?? 'guest') + ':' + detail?.case?.id;
  useEffect(() => { setCountText(String(count)); }, [count]);
  useEffect(() => {
    pending.current = null; setRecovering(false);
    try {
      const value = JSON.parse(sessionStorage.getItem(recoveryKey));
      if (value?.caseId === detail?.case?.id && typeof value.requestId === 'string' && Number.isSafeInteger(value.count) && value.count > 0) {
        pending.current = value; setCount(value.count); setCountText(String(value.count));
        if (detail?.case.kind !== 'standard') setExclusive(value.exclusiveDrop !== false);
        setRecovering(true);
      }
    } catch {}
  }, [recoveryKey]);
  const clearPending = () => { pending.current = null; setRecovering(false); try { sessionStorage.removeItem(recoveryKey); } catch {} };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current?.(); audio?.stopAll?.(); }; }, [audio]);
  const duration = fast || matchMedia('(prefers-reduced-motion: reduce)').matches ? 1100 : 6200;
  const fee = amount(detail?.fee), balance = amount(me?.balance);
  const standard = detail?.case.kind === 'standard';
  const stock = { cases: amount(me?.caseStock?.cases?.[detail?.case.id]), keys: amount(me?.caseStock?.keys?.[detail?.case.keyId]) };
  const casePrice = detail?.case.casePrice == null ? null : amount(detail.case.casePrice);
  const keyPrice = amount(detail?.case.keyPrice);
  const parsedCount = /^\d{1,16}$/.test(countText.trim()) ? Number(countText.trim()) : NaN;
  const requestedCount = Number.isSafeInteger(parsedCount) && parsedCount > 0 ? parsedCount : null;
  const maxByBalance = standard ? affordableStandardCount(balance, stock, casePrice, keyPrice) : fee > 0n && balance > 0n ? balance / fee : 0n;
  const maximumCount = Number(minCount(MAX_SAFE_COUNT, maxByBalance));
  const totalCost = standard ? standardCost(BigInt(requestedCount ?? 0), stock, casePrice, keyPrice) : fee * BigInt(requestedCount ?? 0);
  const insufficient = authenticated && requestedCount !== null && totalCost != null && totalCost > balance;
  const countError = requestedCount === null ? 'Nhập số hòm là số nguyên dương hợp lệ.' : insufficient ? 'Ví không đủ xu cho số hòm này.' : '';
  const busy = upgrading || quoting || ['requesting', 'spinning', 'exclusive'].includes(phase);
  const resultCount = result?.demoCount ?? result?.results?.length ?? 0;
  const resultPages = Math.max(1, Math.ceil(resultCount / OPENING_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(resultPage, resultPages - 1));
  const pageStart = currentPage * OPENING_PAGE_SIZE;
  const visibleResults = useMemo(() => {
    if (!result) return [];
    if (result.demoCount) return Array.from({ length: Math.min(OPENING_PAGE_SIZE, result.demoCount - pageStart) }, (_, index) => trialResult(detail, result.requestId, pageStart + index));
    return result.results.slice(pageStart, pageStart + OPENING_PAGE_SIZE);
  }, [result, pageStart, detail]);
  visibleRef.current = visibleResults;
  const exclusiveResults = visibleResults.filter(item => item.exclusive?.triggered);
  const totalValue = useMemo(() => (result?.results ?? []).reduce((sum, item) => sum + amount(item.value), 0n), [result]);
  const pageValue = visibleResults.reduce((sum, item) => sum + amount(item.value), 0n);
  const unsoldPage = visibleResults.filter(item => !soldIds.has(item.id));
  const sellValue = unsoldPage.reduce((sum, item) => sum + amount(item.value), 0n);
  const allSold = !trying && resultCount > 0 && soldIds.size === resultCount;
  const rangeLabel = `${(pageStart + 1).toLocaleString('vi-VN')}–${Math.min(pageStart + OPENING_PAGE_SIZE, resultCount).toLocaleString('vi-VN')} / ${resultCount.toLocaleString('vi-VN')} skin`;
  const normalPool = useMemo(() => exclusive && detail?.exclusive?.available ? [...(detail.entries ?? []).filter(entry => !entry.exclusiveEligible), detail.exclusive.trigger] : detail?.entries ?? [], [detail, exclusive]);
  function changeCount(next) { setStandardQuote(null); setCount(next); setCountText(String(next)); }
  function finish(index) {
    if (done.current.has(index)) return;
    done.current.add(index);
    const current = visibleRef.current, hits = current.filter(item => item.exclusive?.triggered);
    if (done.current.size < (phaseRef.current === 'exclusive' ? hits.length : current.length)) return;
    stop.current?.();
    if (phaseRef.current === 'spinning' && hits.length) {
      audio?.reveal?.({ tier: 4, value: '0' }); done.current = new Set(); setPhase('exclusive');
      stop.current = audio?.spin?.(duration, { steps: 34, easing: EASING }); return;
    }
    audio?.reveal?.(window.MaySkinsAudio?.highestValueItem(current) ?? current[0], { caseFee: standard && !trying ? (amount(result.total) / BigInt(resultCount)).toString() : detail.fee }); setPhase('revealed');
  }
  function replayPage() {
    if (busy || selling || !visibleResults.length) return;
    done.current = new Set(); setPhase('spinning'); void audio?.unlock?.();
    stop.current = audio?.spin?.(duration, { steps: 34, easing: EASING });
  }
  function selectPage(page) {
    if (busy || selling || !Number.isSafeInteger(page) || page < 0 || page >= resultPages) return;
    stop.current?.(); done.current = new Set(); setResultPage(page); setPhase('revealed');
  }
  async function prepareStandardOpen() {
    if (!authenticated) return onLogin();
    if (recovering) return open(false);
    if (lock.current || busy || selling || requestedCount === null) return;
    lock.current = true; setQuoting(true);
    try {
      const { id: caseId } = detail.case, quote = await api('/open/quote', { caseId, count: requestedCount });
      if (mounted.current) setStandardQuote({ ...quote, caseId, count: requestedCount });
    } catch (error) {
      if (mounted.current) { showToast(error.message, true); if (error.status === 409) { void onReload?.(); void refreshMe(); } }
    } finally { lock.current = false; if (mounted.current) setQuoting(false); }
  }
  async function open(demo, confirmed = null) {
    if (!demo && !authenticated) return onLogin();
    if (lock.current || busy || selling || (demo && !detail.entries.length) || (!standard && !detail.case.available && !pending.current)) return;
    if (!pending.current && (requestedCount === null || !demo && !standard && insufficient)) { showToast(countError || 'Số hòm không hợp lệ.', true); return; }
    if (!demo && standard && !pending.current && (!confirmed?.affordable || confirmed.caseId !== detail.case.id || typeof confirmed.quote !== 'string')) return;
    setStandardQuote(null);
    lock.current = true; setPhase('requesting'); setResult(null); setSoldIds(new Set()); setResultPage(0); setTrying(demo); done.current = new Set(); void audio?.unlock?.();
    try {
      if (!mounted.current) return;
      let data;
      if (demo) {
        data = { requestId: makeRequestId(), results: [], demoCount: requestedCount, total: '0' };
      } else {
        const body = pending.current ?? {
          requestId: makeRequestId(), caseId: detail.case.id,
          ...(standard ? { count: confirmed.count, quote: confirmed.quote } : { count: requestedCount, quoteId: detail.quoteId, exclusiveDrop: exclusive })
        };
        pending.current = body; changeCount(body.count);
        try { sessionStorage.setItem(recoveryKey, JSON.stringify(body)); } catch {}
        data = await api('/open', body); clearPending(); void refreshMe();
      }
      if (!mounted.current) return;
      setResult(data); setPhase('spinning'); stop.current = audio?.spin?.(duration, { steps: 34, easing: EASING });
    } catch (error) {
      if (mounted.current) {
        setPhase('ready');
        if (!demo && (!error.status || error.status >= 500)) { setRecovering(true); showToast('Chưa nhận được kết quả. Bấm Khôi phục lượt mở để lấy lại biên nhận; hệ thống dùng lại cùng mã yêu cầu.', true); }
        else { clearPending(); showToast(error.message, true); if (error.status === 409) { void onReload?.(); if (standard) void refreshMe(); } }
      }
    } finally { lock.current = false; }
  }
  async function prepareSell() {
    if (selling || !unsoldPage.length || trying) return;
    setSelling(true);
    try {
      const itemIds = unsoldPage.map(item => item.id), quote = await api('/sell/quote', { itemIds });
      setSale({ ...quote, itemIds, requestId: makeRequestId() });
    } catch (error) { showToast(error.message, true); } finally { setSelling(false); }
  }
  async function confirmSell() {
    if (selling || !sale) return;
    setSelling(true);
    try {
      await api('/sell', { requestId: sale.requestId, itemIds: sale.itemIds, quoteId: sale.quoteId });
      setSoldIds(previous => new Set([...previous, ...sale.itemIds])); setSale(null); await refreshMe(); showToast('Đã bán skin và cộng ' + sale.totalFormatted);
    } catch (error) { setSale(null); showToast(error.message, true); } finally { setSelling(false); }
  }
  async function upgradePage() {
    if (upgradeLock.current || busy || selling || !unsoldPage.length) return;
    upgradeLock.current = true; setUpgrading(true);
    const items = unsoldPage;
    try {
      const current = await refreshMe();
      if (current && mounted.current) onUpgrade(items);
    } catch (error) { if (mounted.current) showToast(error.message, true); }
    finally { upgradeLock.current = false; if (mounted.current) setUpgrading(false); }
  }
  if (!detail) return <main className="app-main"><div className="empty-panel">Đang tải hòm...</div></main>;
  return <main className="app-main case-page"><button className="back-link" onClick={onBack}>← Tất cả hòm</button><div className="case-heading"><span className="app-eyebrow">HAPPY HOUSE · CASE OPENING</span><h1>{detail.case.name.toUpperCase()}</h1><p>{detail.case.description}</p></div>
    <section className={'opening-panel phase-' + phase}><div className="opening-status"><span>{trying ? 'CHẾ ĐỘ MỞ THỬ' : phase === 'exclusive' ? '✦ EXCLUSIVE DROP' : phase === 'revealed' ? 'LƯỢT MỞ HOÀN TẤT' : 'MÓN SKIN TIẾP THEO CỦA BẠN'}</span><button className="text-button" onClick={() => document.getElementById('case-odds')?.scrollIntoView({ behavior: 'smooth' })}>ⓘ Xem tỷ lệ</button></div>
      {phase === 'spinning' || phase === 'exclusive' ? <><div className="case-reel-heading"><span>{phase === 'exclusive' ? 'Hé lộ Exclusive · ' : 'Đang quay · '}{rangeLabel}</span><button className="ghost-button" onClick={() => { stop.current?.(); setPhase('revealed'); }}>Hiện kết quả trang này →</button></div><div className={'reel-stack count-' + (visibleResults.length > 1 ? 10 : 1)}>{(phase === 'exclusive' ? exclusiveResults : visibleResults).map((item, index) => <ReelLane key={result.requestId + '-' + currentPage + '-' + phase + '-' + index} winner={phase === 'spinning' && item.exclusive?.triggered ? detail.exclusive.trigger : item} pool={phase === 'exclusive' ? detail.exclusive.items : normalPool} duration={duration} index={index} onDone={() => finish(index)} />)}</div></>
      : phase === 'revealed' ? <div className="result-stage"><div className="result-heading"><span>{trying ? 'MỞ THỬ · GIÁ TRỊ TRANG NÀY' : allSold ? 'ĐÃ BÁN TOÀN BỘ LƯỢT MỞ' : 'TỔNG GIÁ TRỊ SKIN CỦA LƯỢT MỞ'}</span><strong>{coins(trying ? pageValue : totalValue)}</strong></div>
        <p className="case-batch-note">{rangeLabel}{trying ? ' · Kết quả mô phỏng, không thêm vào kho.' : ' · Toàn bộ skin của lượt mở đã được lưu vào kho.'}</p>
        <div className={'result-cards count-' + visibleResults.length}>{visibleResults.map(item => <div className="case-result-card" key={item.id}><ItemCard item={item} fullName showDetails />{soldIds.has(item.id) && <small className="case-result-sold">✓ Đã bán</small>}</div>)}</div>
        <div className="case-result-pager"><button className="ghost-button" disabled={selling || upgrading || currentPage <= 0} onClick={() => selectPage(currentPage - 1)}>← Trang trước</button><label>Trang <input className="case-page-jump" aria-label="Trang kết quả mở hòm" type="number" min="1" max={resultPages} value={currentPage + 1} disabled={selling || upgrading} onChange={event => selectPage(Number(event.target.value) - 1)} /> / {resultPages.toLocaleString('vi-VN')}</label><button className="ghost-button" disabled={selling || upgrading || currentPage >= resultPages - 1} onClick={() => selectPage(currentPage + 1)}>Trang sau →</button><button className="ghost-button" disabled={selling || upgrading} onClick={replayPage}>↻ Xem hoạt ảnh trang này</button></div>
        {!trying && <div className="result-actions"><button className="ghost-button" disabled={selling || upgrading || !unsoldPage.length} onClick={prepareSell}>Bán {unsoldPage.length} skin trang này · {coins(sellValue)}</button><button className="ghost-button" disabled={selling || upgrading || !unsoldPage.length} onClick={upgradePage}>{upgrading ? 'Đang cập nhật kho…' : '⟐ Upgrade trang này'}</button><button className="ghost-button" disabled={upgrading} onClick={() => onNavigate('inventory')}>Xem toàn bộ trong kho ↗</button></div>}
      </div> : <div className="idle-stage"><span className="reel-pointer top">▽</span><div className="stage-fair"><b>◇</b><span>Xem trước toàn bộ<br />skin và xác suất</span></div><div className="stage-case"><span className="price-chip">{detail.case.feeFormatted}</span><ImageFrame item={detail.case} /></div><div className="stage-side"><b>{detail.entries.length}</b><span>SKIN TRONG HÒM</span></div><span className="reel-pointer bottom">△</span></div>}
      {resultCount > OPENING_PAGE_SIZE && phase !== 'requesting' && <p className="case-batch-note">Lượt này có {resultCount.toLocaleString('vi-VN')} skin. Mỗi trang hiển thị và phát hoạt ảnh tối đa {OPENING_PAGE_SIZE} món để giao diện luôn nhẹ.</p>}
      <div className="opening-controls"><div className="case-count-control"><label className="case-count-label">Số hòm<input className="case-count-input" aria-label="Số hòm muốn mở" inputMode="numeric" value={countText} disabled={busy || recovering} maxLength={16} onChange={event => {setStandardQuote(null);setCountText(event.target.value);}} onBlur={() => { if (requestedCount !== null) changeCount(requestedCount); }} /></label><div className="count-picker"><button aria-label="Giảm một hòm" disabled={busy || recovering || !requestedCount || requestedCount <= 1} onClick={() => changeCount(requestedCount - 1)}>−</button><button aria-label="Tăng một hòm" disabled={busy || recovering || requestedCount === Number.MAX_SAFE_INTEGER} onClick={() => changeCount((requestedCount ?? 0) + 1)}>＋</button></div><button className="ghost-button" disabled={busy || recovering || !authenticated || maximumCount < 1} onClick={() => changeCount(maximumCount)}>MAX theo ví</button>{countError && !recovering && <p className="case-count-error" role="status">{countError}</p>}</div>
        <button className="primary-button open-button" onClick={() => standard && !recovering ? void prepareStandardOpen() : void open(false)} disabled={busy || (!recovering && (requestedCount === null || (standard ? totalCost === null || insufficient : !detail.case.available || insufficient)))}>{busy ? 'ĐANG CHUẨN BỊ…' : recovering ? 'KHÔI PHỤC LƯỢT MỞ' : authenticated ? requestedCount === null ? 'NHẬP SỐ HÒM HỢP LỆ' : standard ? 'XEM CHI PHÍ · ' + requestedCount.toLocaleString('vi-VN') + ' HÒM' : 'MỞ ' + requestedCount.toLocaleString('vi-VN') + ' HÒM · ' + coins(totalCost) : 'ĐĂNG NHẬP ĐỂ MỞ'}</button><button className="ghost-button try-button" disabled={busy || recovering || (!standard && !detail.case.available) || !detail.entries.length || requestedCount === null} onClick={() => open(true)}>Mở thử</button>
      </div><div className="opening-settings"><label><input type="checkbox" disabled={busy || recovering} checked={fast} onChange={event => { setFast(event.target.checked); safeWrite('fast', event.target.checked); }} /> ⚡ Quay nhanh</label>{!standard && <label><input type="checkbox" disabled={busy || recovering || !detail.exclusive?.available} checked={exclusive} onChange={event => { setExclusive(event.target.checked); safeWrite('exclusive-opening', event.target.checked); }} /> ✦ Exclusive Drop {detail.exclusive?.available && <small>{chance(detail.exclusive.chance)}%</small>}</label>}</div>
      <p className="opening-note">{trying ? 'Mở thử không trừ xu; chỉ sinh kết quả cho trang đang xem.' : standard ? `Hòm thường dùng hòm và chìa bạn đã có trước; chỉ phần thiếu mới tính vào ví. ${authenticated ? 'Ví hiện có thể chi trả tối đa ' + maximumCount.toLocaleString('vi-VN') + ' hòm theo giá đang đồng bộ. ' : ''}Xem và xác nhận chi phí trước mỗi lượt mở.` : `Nhập số hòm tùy ý. ${authenticated ? 'Ví hiện có thể mở tối đa ' + maximumCount.toLocaleString('vi-VN') + ' hòm theo giá đang hiển thị. ' : ''}Chi phí và số dư được máy chủ kiểm tra lại trước khi mở.`}</p>
    </section>
    {detail.exclusive?.available && <div className="exclusive-note"><span>✦</span><div><b>EXCLUSIVE DROP</b><p>Nhóm skin đặc biệt có thêm một vòng hé lộ. Bật hoặc tắt hiệu ứng không làm thay đổi xác suất của từng skin.</p></div><strong>{chance(detail.exclusive.chance)}%</strong></div>}
    <section className="odds-section" id="case-odds"><div className="section-head"><h2>SKIN TRONG HÒM <span>✧</span></h2><small>{detail.entries.length} KẾT QUẢ · {standard ? 'TỶ LỆ THEO HÒM DISCORD' : 'TỶ LỆ TỪ THẤP ĐẾN CAO'}</small></div>{standard && <><div className="standard-rarity-legend">{(detail.rarities ?? []).map(rarity => <span key={rarity.tier} style={{'--rarity':rarity.color}}><i/>{rarity.name}<b>{chance(rarity.chance)}%</b></span>)}</div><p className="standard-stock-note">Giá trên thẻ là khoảng gộp các báo giá mới của bản thường và StatTrak™ theo từng độ mòn; giá thực tế tùy kết quả mở.</p>{authenticated && <p className="standard-stock-note">Kho Discord: <b>{stock.cases.toLocaleString('vi-VN')} hòm</b> · <b>{stock.keys.toLocaleString('vi-VN')} chìa</b>. Web dùng số đã có trước khi tính xu.</p>}</>}<div className="item-grid">{[...detail.entries].sort((a,b) => Number(a.chance) - Number(b.chance)).map(item => <ItemCard key={item.id} item={item} chanceValue={item.chance} fullName showDetails />)}</div>{!detail.entries.length && <div className="empty-panel">Hòm đang chờ đồng bộ giá. Vui lòng quay lại sau.</div>}</section>
    <Modal open={!!standardQuote} title="Xác nhận mở hòm thường" eyebrow="DÙNG CÙNG HÒM VÀ CHÌA DISCORD" onClose={() => { if (!quoting) setStandardQuote(null); }} actions={<><button className="ghost-button" disabled={quoting} onClick={() => setStandardQuote(null)}>Quay lại</button><button className="primary-button" disabled={quoting || !standardQuote?.affordable} onClick={() => open(false, standardQuote)}>{quoting ? 'Đang xác nhận…' : standardQuote?.affordable ? `Xác nhận · ${standardQuote.feeFormatted}` : 'Ví chưa đủ xu'}</button></>}><p>Mở <b>{standardQuote?.count?.toLocaleString('vi-VN')}</b> {detail.case.name}. Đã dùng <b>{standardQuote?.ownedCases}</b> hòm và <b>{standardQuote?.ownedKeys}</b> chìa trong kho Discord.</p><p>Phần cần mua: <b>{standardQuote?.missingCases}</b> hòm{standardQuote?.casePriceFormatted ? ` · ${standardQuote.casePriceFormatted}/hòm` : ''} và <b>{standardQuote?.missingKeys}</b> chìa · {standardQuote?.keyPriceFormatted ?? detail.case.keyPriceFormatted}/chìa.</p><p>Tổng trừ ví: <strong>{standardQuote?.feeFormatted}</strong>{standardQuote?.affordable ? ' · Số dư đủ.' : ' · Ví hiện không đủ.'}</p><small>Báo giá có hiệu lực trong thời gian ngắn. Nếu giá hoặc số hòm trong kho đổi trước khi mở, bạn sẽ cần xác nhận lại.</small></Modal>
    <Modal open={!!sale} title="Bán skin của trang đã chọn" eyebrow="XÁC NHẬN GIÁ BÁN" onClose={() => { if (!selling) setSale(null); }} actions={<><button className="ghost-button" disabled={selling} onClick={() => setSale(null)}>Giữ skin</button><button className="primary-button" disabled={selling} onClick={confirmSell}>{selling ? 'Đang bán…' : 'Bán · ' + sale?.totalFormatted}</button></>}><p>Bán {sale?.itemIds.length} skin đã chọn và nhận {sale?.totalFormatted} vào ví xu Discord.</p></Modal>
  </main>;
}
