import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useMandant } from '../../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { useSetupProgress, SETUP_TOTAL } from '../../hooks/useSetupProgress';

// ── Erkennt Electron / Tauri Desktop-Client ───────────────────────
const isNativeApp = () =>
  typeof window !== 'undefined' &&
  (!!window.__TAURI__ || /electron/i.test(navigator.userAgent));

// ── Navigations-Sektionen ─────────────────────────────────────────
const SECTIONS = [
  {
    id:    'kreditoren',
    short: 'KR',
    label: 'Kreditoren',
    paths: ['kreditoren'],
    items: [
      { to: 'kreditoren/inbox',       label: 'Eingangspostfach', icon: 'inbox',      badge: 'inbox' },
      { to: 'kreditoren/erfassen',    label: 'Rechnung erfassen', icon: 'plus-doc' },
      { to: 'kreditoren/massen-import', label: 'Massen-Import',  icon: 'upload' },
      { to: 'kreditoren/dauerbelege', label: 'Wiederkehrend',   icon: 'calendar' },
      { divider: true },
      { to: 'kreditoren/lieferanten', label: 'Lieferanten',      icon: 'users' },
      { to: 'kreditoren/lieferanten-konto', label: 'Lieferanten-Konto', icon: 'doc-text' },
      { to: 'kreditoren/opliste',     label: 'OP-Liste',          icon: 'check-list' },
      { to: 'kreditoren/zahlungslauf', label: 'Zahlungslauf',    icon: 'credit-card' },
    ],
  },
  {
    id:    'debitoren',
    short: 'DB',
    label: 'Debitoren',
    paths: ['debitoren'],
    items: [
      { label: 'Rechnungen & Zahlungen', icon: 'mail',     disabled: true, note: 'Phase 2' },
      { label: 'Kunden',                 icon: 'users',    disabled: true, note: 'Phase 2' },
      { label: 'OP-Liste',               icon: 'check-list', disabled: true, note: 'Phase 2' },
    ],
  },
  {
    id:    'auswertungen',
    short: '📊',
    label: 'Auswertungen',
    paths: ['journal', 'kontoblaetter', 'bilanz', 'mwst', 'jahresabschluss', 'kursbewertung', 'bankabstimmung', 'kreditoren/journal'],
    items: [
      { to: 'kreditoren/journal',   label: 'Belegjournal',     icon: 'list' },
      { to: 'kontoblaetter',        label: 'Kontoblätter',     icon: 'table' },
      { to: 'bilanz',               label: 'Bilanz & ER',      icon: 'balance' },
      { divider: true },
      { to: 'mwst/abrechnung',      label: 'MWST-Abrechnung',  icon: 'doc-text' },
      { to: 'jahresabschluss',      label: 'Jahresabschluss',  icon: 'calendar' },
      { to: 'kursbewertung',        label: 'FW-Kursbewertung', icon: 'percent' },
      { to: 'bankabstimmung',       label: 'Bankabstimmung',   icon: 'bank', newWindowFallback: true },
    ],
  },
  {
    id:    'hauptbuch',
    short: 'HB',
    label: 'Hauptbuch',
    paths: ['manuelle-buchungen', 'wiederkehrende-buchungen', 'kassenbuch', 'saldovortraege', 'budget'],
    items: [
      { to: 'manuelle-buchungen',      label: 'Manuelle Buchungen', icon: 'plus-doc' },
      { to: 'wiederkehrende-buchungen', label: 'Wiederkehrend',     icon: 'calendar' },
      { to: 'kassenbuch',              label: 'Kassenbuch',         icon: 'credit-card' },
      { to: 'saldovortraege',          label: 'Saldovorträge',      icon: 'balance' },
      { to: 'budget',                  label: 'Budget',             icon: 'doc-text' },
    ],
  },
  {
    id:    'stammdaten',
    short: '⚙',
    label: 'Stammdaten',
    paths: ['kontenplan', 'mwstcodes', 'zahlstellen', 'wechselkurse', 'kontierungsregeln', 'einstellungen', 'setup'],
    items: [
      { to: 'setup',         label: '🚀 Setup-Assistent', icon: 'grid', badge: 'setup' },
      { divider: true },
      { to: 'kontenplan',    label: 'Kontenplan',        icon: 'table' },
      { to: 'mwstcodes',     label: 'MWST-Codes',        icon: 'percent' },
      { to: 'zahlstellen',   label: 'Firmenzahlstellen', icon: 'bank' },
      { to: 'wechselkurse',  label: 'Wechselkurse',      icon: 'percent' },
      { to: 'kontierungsregeln', label: 'Kontierungsregeln', icon: 'list' },
      { to: 'einstellungen', label: 'Einstellungen',     icon: 'grid' },
    ],
  },
];

// ── Icon-Komponente ───────────────────────────────────────────────
function Icon({ name, className = '' }) {
  const cls = `flex-shrink-0 stroke-2 ${className}`;
  const s   = { width: 14, height: 14 };
  switch (name) {
    case 'grid':       return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>;
    case 'users':      return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'plus-doc':   return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
    case 'check-list': return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
    case 'credit-card':return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;
    case 'list':       return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16M4 10h16M4 14h8"/><rect x="2" y="2" width="20" height="20" rx="2"/></svg>;
    case 'mail':       return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>;
    case 'table':      return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v18M2 9h20M2 15h20"/></svg>;
    case 'balance':    return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case 'doc-text':   return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>;
    case 'calendar':   return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case 'bank':       return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/><line x1="3" y1="9" x2="21" y2="9"/></svg>;
    case 'percent':    return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
    case 'inbox':      return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>;
    case 'upload':     return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case 'extern':     return <svg style={{ width: 10, height: 10 }} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
    case 'chevron':    return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9 6 6 6-6"/></svg>;
    case 'logout':     return <svg style={s} className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
    default:           return null;
  }
}

// ── Sektion aus aktuellem Pfad erkennen ──────────────────────────
function detectSection(pathname) {
  for (const sec of SECTIONS) {
    if (sec.paths.some(p => pathname.includes(p))) return sec.id;
  }
  return 'kreditoren';
}

// ── Hauptkomponente ──────────────────────────────────────────────
export default function FiBuSidebar() {
  const { mandant, mandanten, switchMandant } = useMandant();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [mandantOpen, setMandantOpen] = useState(false);
  const [inboxPending, setInboxPending] = useState(0);
  const { doneCount: setupDone } = useSetupProgress(mandant?.id, mandant);

  // Aktive Sektion: aus URL ermitteln, manueller Override möglich
  const urlSection = useMemo(() => detectSection(location.pathname), [location.pathname]);
  const [activeSection, setActiveSection] = useState(urlSection);

  // Bei Navigation: Sektion auto-updaten
  useEffect(() => { setActiveSection(urlSection); }, [urlSection]);

  const section = SECTIONS.find(s => s.id === activeSection) ?? SECTIONS[0];
  const base    = `/fibu/${mandant?.id}`;

  // Pending-Count Eingangspostfach
  useEffect(() => {
    if (!mandant?.id) return;
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from('fibu_rechnung_inbox')
        .select('*', { count: 'exact', head: true })
        .eq('mandant_id', mandant.id)
        .eq('status', 'pending');
      if (!cancelled) setInboxPending(count ?? 0);
    };
    load();
    const ch = supabase
      .channel(`inbox-cnt-${mandant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fibu_rechnung_inbox', filter: `mandant_id=eq.${mandant.id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [mandant?.id]);

  const native = isNativeApp();

  // ── Render ───────────────────────────────────────────────────
  return (
    <aside style={{ display: 'flex', height: '100%', flexShrink: 0 }}>

      {/* ── Icon-Leiste (dunkel) ─────────────────────────────── */}
      <div style={{
        width: 52, background: '#243824', display: 'flex',
        flexDirection: 'column', alignItems: 'center',
        borderRight: '1px solid #1a2a1a',
      }}>
        {/* Logo */}
        <div style={{ paddingTop: 14, paddingBottom: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: '#7a9b7f', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800,
          }}>A</div>
        </div>

        {/* ← MailFlow */}
        <button
          title="Zurück zu MailFlow"
          onClick={() => navigate('/Dashboard')}
          style={{
            width: 40, borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            color: '#a8c8a8', marginBottom: 10, padding: '5px 0',
            transition: 'background .15s',
          }}
          onMouseOver={e => { e.currentTarget.style.background = '#2e4a2e'; e.currentTarget.style.color = '#fff'; }}
          onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a8c8a8'; }}
        >
          <svg style={{ width: 13, height: 13 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.04em', lineHeight: 1 }}>MF</span>
        </button>

        <div style={{ width: 28, height: 1, background: '#2e4a2e', marginBottom: 8 }} />

        {/* Sektion-Icons */}
        {SECTIONS.map(sec => {
          const isActive  = sec.id === activeSection;
          const hasBadge  = sec.id === 'kreditoren' && inboxPending > 0;
          const isDisabled = sec.id === 'debitoren';
          return (
            <button
              key={sec.id}
              title={sec.label}
              disabled={isDisabled}
              onClick={() => setActiveSection(sec.id)}
              style={{
                position: 'relative',
                width: 40, minHeight: 44, borderRadius: 8, border: 'none',
                cursor: isDisabled ? 'default' : 'pointer',
                background: isActive ? '#4a7a4a' : 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 2,
                marginBottom: 4, opacity: isDisabled ? 0.35 : 1,
                transition: 'background .15s',
              }}
              onMouseOver={e => { if (!isActive && !isDisabled) e.currentTarget.style.background = '#2e4a2e'; }}
              onMouseOut={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: sec.short.length === 2 ? 11 : 15, fontWeight: 700, color: isActive ? '#fff' : '#7ab07a', lineHeight: 1 }}>
                {sec.short}
              </span>
              {hasBadge && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  background: '#e85a3a', color: '#fff', borderRadius: 8,
                  fontSize: 8.5, fontWeight: 800, padding: '1px 4px',
                  lineHeight: '12px', minWidth: 14, textAlign: 'center',
                }}>
                  {inboxPending > 9 ? '9+' : inboxPending}
                </span>
              )}
            </button>
          );
        })}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* User Avatar */}
        <div style={{ paddingBottom: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div
            title="Artis Treuhand · Administrator"
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: '#4a6a4a', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#c8e0c8', fontSize: 10.5, fontWeight: 700,
            }}
          >SB</div>
        </div>
      </div>

      {/* ── Kontext-Sidebar (hell) ───────────────────────────── */}
      <div style={{
        width: 185, background: '#e8ede8',
        borderRight: '1px solid #bfcfbf',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Mandant-Selector */}
        <div style={{ padding: '12px 10px 8px', borderBottom: '1px solid #bfcfbf', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <button
              style={{
                width: '100%', textAlign: 'left', fontSize: 11.5, fontWeight: 600,
                borderRadius: 7, padding: '6px 9px',
                background: '#dde5dd', border: 'none', cursor: 'pointer', color: '#2a3a2a',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
              onClick={() => setMandantOpen(o => !o)}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mandant?.name ?? '…'}
              </span>
              <span style={{ color: '#7a9a7f', fontSize: 9.5, fontWeight: 400, whiteSpace: 'nowrap' }}>
                GJ {new Date().getFullYear()}
              </span>
              <Icon name="chevron" />
            </button>
            {mandantOpen && (
              <div style={{
                position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 50, marginTop: 2,
                background: '#fff', border: '1px solid #d4dcd4', borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,.12)', overflow: 'hidden',
              }}>
                {mandanten.map(m => (
                  <button
                    key={m.id}
                    style={{
                      width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 11.5,
                      border: 'none', background: 'none', cursor: 'pointer',
                      color: m.id === mandant?.id ? '#3d6641' : '#1a1a2e',
                      fontWeight: m.id === mandant?.id ? 700 : 400,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                    onClick={() => { switchMandant(m.id); setMandantOpen(false); }}
                  >
                    {m.id === mandant?.id && <span style={{ color: '#7a9b7f' }}>✓</span>}
                    {m.name}
                  </button>
                ))}
                <div style={{ borderTop: '1px solid #e4e9e4' }}>
                  <button
                    style={{ width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12, border: 'none', background: 'none', cursor: 'pointer', color: '#7a9b7f', fontWeight: 600 }}
                    onClick={() => { navigate('/fibu'); setMandantOpen(false); }}
                  >+ Neuer Mandant anlegen</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sektion-Titel */}
        <div style={{
          padding: '10px 12px 6px',
          fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em',
          textTransform: 'uppercase', color: '#5a7a5a', flexShrink: 0,
        }}>
          {section.label}
        </div>

        {/* Nav-Items */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '0 6px 12px' }}>
          {section.items.map((item, i) => {
            // Trennlinie
            if (item.divider) {
              return <div key={i} style={{ height: 1, background: '#cdd8cd', margin: '6px 4px' }} />;
            }

            // Deaktiviert
            if (item.disabled) {
              return (
                <div key={item.label} style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '6px 8px', borderRadius: 7, opacity: 0.4,
                  cursor: 'not-allowed', fontSize: 12, color: '#4a5a4a', marginBottom: 1,
                }}>
                  <Icon name={item.icon} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.note && <span style={{ fontSize: 9, color: '#94a394' }}>{item.note}</span>}
                </div>
              );
            }

            // Badge (Inbox-Pending-Count oder Setup-Progress)
            const badge = item.badge === 'inbox' && inboxPending > 0 ? inboxPending : null;
            const setupBadge = item.badge === 'setup' ? `${setupDone}/${SETUP_TOTAL}` : null;

            // Bankabstimmung: intern in native app, sonst neues Fenster
            if (item.newWindowFallback) {
              if (native) {
                // In Electron/Tauri → normaler NavLink
              } else {
                return (
                  <button
                    key={item.label}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 8px', borderRadius: 7, border: 'none',
                      background: 'transparent', cursor: 'pointer', fontSize: 12,
                      color: '#4a5a4a', marginBottom: 1, textAlign: 'left',
                    }}
                    onClick={() => window.open(`/fibu/bank/${mandant?.id}`, '_blank', 'width=1600,height=900')}
                    onMouseOver={e => e.currentTarget.style.background = '#dde5dd'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Icon name={item.icon} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <Icon name="extern" />
                  </button>
                );
              }
            }

            return (
              <NavLink
                key={item.label}
                to={`${base}/${item.to}`}
                end={item.to === 'kreditoren'}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '6px 8px', borderRadius: 7, fontSize: 12,
                  color: isActive ? '#fff' : '#4a5a4a',
                  background: isActive ? '#5a8a5a' : 'transparent',
                  fontWeight: isActive ? 600 : 400,
                  textDecoration: 'none', marginBottom: 1,
                  transition: 'background .12s',
                })}
                onMouseOver={e => { if (!e.currentTarget.classList.contains('active')) e.currentTarget.style.background = '#dde5dd'; }}
                onMouseOut={e => { if (!e.currentTarget.classList.contains('active')) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name={item.icon} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {badge !== null && (
                  <span style={{
                    background: '#e85a3a', color: '#fff', borderRadius: 10,
                    fontSize: 9, fontWeight: 700, padding: '1px 5px',
                    minWidth: 15, textAlign: 'center', lineHeight: '14px',
                  }}>{badge > 99 ? '99+' : badge}</span>
                )}
                {setupBadge !== null && (
                  <span style={{
                    background: setupDone >= SETUP_TOTAL ? '#7a9b7f' : '#e8a435',
                    color: '#fff', borderRadius: 10,
                    fontSize: 9, fontWeight: 700, padding: '1px 5px',
                    minWidth: 22, textAlign: 'center', lineHeight: '14px',
                  }}>{setupBadge}</span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
