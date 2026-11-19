import React, {useEffect, useRef, useState} from 'react';
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
function itemDetails(item) {
  if (!item) return '';
  const details = [];
  const actualDrop = Number.isSafeInteger(item.acquiredAt);
  if (item.rarity) details.push(item.rarity);
  if (item.phase && !String(item.name ?? '').includes(item.phase)) details.push(item.phase);
  if (actualDrop) {
    if (item.statTrak === true && !/^StatTrak™\s*/u.test(item.name ?? '')) details.push('StatTrak™');
    else if (item.statTrak === false) details.push('Bản thường');
    if (item.wear) details.push(item.wear);
    if (Number.isFinite(item.float)) details.push(`Float ${item.float.toFixed(6)}`);
    if (Number.isInteger(item.paintSeed)) details.push(`Pattern #${item.paintSeed}`);
  } else if (item.possibleStatTrak || item.statTrak === true) {
    details.push('Có thể rơi StatTrak™');
  }
  return details.join(' · ');
}
function formatDate(value) { return Number.isFinite(Number(value)) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(value))) : ''; }
function chance(value) { const numeric = Number(value); return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) : '—'; }
function tierClass(item) { return `tier-${Math.max(0, Math.min(4, Number(item?.tier) || 0))}`; }
function imageSource(value) {
  if (typeof value !== 'string') return '';
  if (/^\/play\/(?:art\/(?:skins\/skin-(?:[a-f0-9]{12}|vanilla-weapon_[a-z0-9_]+)\/(?:base|wear-[0-4]|seed-\d{1,4})\.png|battle-[a-z0-9-]+\.png)|bot-avatars\/[a-z0-9-]+\.svg)$/.test(value)) return value;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; }
}

function ImageFrame({ item, className = '', eager = false }) {
  const [failed, setFailed] = useState(false);
  const source = imageSource(item?.image);
  useEffect(() => setFailed(false), [source]);
  return <span className={`app-image ${failed || !source ? 'is-failed' : ''} ${className}`}>
    {source && !failed ? <img src={source} alt={item?.name ?? 'CS2 skin'} loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)} /> : <span className="image-fallback"><b>◇</b><small>{shortName(item?.name ?? 'CS2')}</small></span>}
  </span>;
}

function ItemCard({ item, selected = false, onClick, compact = false, chanceValue, fullName = false, showDetails = false }) {
  const content = <>
    {item?.locked && <span className="item-lock" title="Skin đã khóa">▣</span>}
    <ImageFrame item={item} />
    <strong title={item?.name ?? undefined}>{fullName ? item?.name : shortName(item?.name)}</strong>
    <small>{showDetails ? itemDetails(item) || 'CS2' : item?.wear ?? item?.rarity ?? 'CS2'}</small>
    {chanceValue != null && <em className="item-chance">{chance(chanceValue)}%</em>}
    <span className="item-price" title={item?.priceNote ?? undefined}>{item?.valueFormatted ?? coins(item?.value)}</span>
    {item?.marketRangeFormatted && <small className="item-market-range" title={item.marketRangeNote ?? undefined}>Mọi độ mòn / ST: {item.marketRangeFormatted}</small>}
  </>;
  return onClick ? <button className={`item-card ${tierClass(item)} ${compact ? 'is-compact' : ''} ${selected ? 'is-selected' : ''}`} onClick={onClick} aria-pressed={selected}>{content}</button>
    : <article className={`item-card ${tierClass(item)} ${compact ? 'is-compact' : ''}`}>{content}</article>;
}

function Modal({ open, title, eyebrow, onClose, children, actions, className = '' }) {
  const panel = useRef(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(panel.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter(e => e.offsetParent !== null);
    focusable()[0]?.focus();
    const keys = event => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); } if (event.key === 'Tab') { const nodes = focusable(); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keys); previous?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}><section ref={panel} className={'app-modal ' + className} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Đóng">×</button>{eyebrow && <span className="app-eyebrow">{eyebrow}</span>}{title && <h2>{title}</h2>}<div className="modal-body">{children}</div>{actions && <div className="modal-actions">{actions}</div>}</section></div>;
}

function PageTitle({ eyebrow, title, copy, action }) { return <div className="page-title"><div><span className="app-eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{action}</div>; }
export { makeRequestId, safeRead, safeWrite, amount, coins, shortName, itemDetails, formatDate, chance, tierClass, imageSource, ImageFrame, ItemCard, Modal, PageTitle };
