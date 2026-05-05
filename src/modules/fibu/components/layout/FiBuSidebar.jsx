import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMandant } from '../../contexts/MandantContext';

const NAV = [
  {
    section: 'Kreditoren',
    items: [
      { to: 'kreditoren',            label: 'Dashboard',        icon: 'grid' },
      { to: 'kreditoren/lieferanten', label: 'Lieferanten',     icon: 'users' },
      { to: 'kreditoren/inbox',       label: 'Eingangspostfach',  icon: 'inbox' },
      { to: 'kreditoren/erfassen',   label: 'Rechnung erfassen', icon: 'plus-doc' },
      { to: 'kreditoren/opliste',    label: 'OP-Liste',          icon: 'check-list' },
      { to: 'kreditoren/zahlungslauf', label: 'Zahlungslauf',   icon: 'credit-card' },
      { to: 'kreditoren/journal',    label: 'Belegjournal',      icon: 'list' },
    ],
  },
  {
    section: 'Stammdaten',
    items: [
      { to: 'kontenplan',  label: 'Kontenplan',   icon: 'table' },
      { to: 'mwstcodes',   label: 'MWST-Codes',   icon: 'percent' },
    ],
  },
  {
    section: 'Debitoren',
    items: [
      { to: null, label: 'Rechnungen & Zahlungen', icon: 'mail', disabled: true, note: 'kommt in Phase 2' },
    ],
  },
  {
    section: 'Finanzbuchhaltung',
    items: [
      { to: null, label: 'Journal',          icon: 'lines',     disabled: true },
      { to: null, label: 'Kontoblätter',     icon: 'table',     disabled: true },
      { to: null, label: 'Bilanz & ER',      icon: 'balance',   disabled: true },
      { to: 'mwst/abrechnung', label: 'MWST-Abrechnung', icon: 'doc-text' },
    ],
  },
];

function Icon({ name, className = '' }) {
  const cls = `w-[15px] h-[15px] flex-shrink-0 stroke-2 ${className}`;
  switch (name) {
    case 'grid':       return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>;
    case 'users':      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'plus-doc':   return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
    case 'check-list': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
    case 'credit-card':return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;
    case 'list':       return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16M4 10h16M4 14h8"/><rect x="2" y="2" width="20" height="20" rx="2"/></svg>;
    case 'mail':       return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>;
    case 'lines':      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="7" y2="18"/></svg>;
    case 'table':      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v18M2 9h20M2 15h20"/></svg>;
    case 'balance':    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case 'doc-text':   return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>;
    case 'chevron':    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9 6 6 6-6"/></svg>;
    case 'logout':     return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
    case 'percent':    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
    case 'inbox':      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>;
    default:           return null;
  }
}

export default function FiBuSidebar() {
  const { mandant, mandanten, switchMandant } = useMandant();
  const navigate = useNavigate();
  const [mandantOpen, setMandantOpen] = useState(false);

  const base = `/fibu/${mandant?.id}`;

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={{ width: 220, background: '#e6ede6', borderRight: '1px solid #bfcfbf' }}
    >
      {/* Logo */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: '#bfcfbf' }}>
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
            style={{ background: '#7a9b7f' }}
          >A</div>
          <span className="font-bold text-sm" style={{ color: '#1a1a2e' }}>Artis FiBu</span>
          <button
            className="ml-auto text-xs px-2 py-0.5 rounded"
            style={{ background: '#d4dcd4', color: '#4a5a4a' }}
            onClick={() => navigate('/Dashboard')}
            title="Zurück zu MailFlow"
          >← MailFlow</button>
        </div>

        {/* Mandant-Selector */}
        <div className="relative">
          <button
            className="w-full text-left text-xs font-medium rounded-lg px-2.5 py-1.5 flex items-center gap-1.5"
            style={{ background: '#d4dcd4', borderRadius: 7, color: '#3a4a3a' }}
            onClick={() => setMandantOpen(o => !o)}
          >
            <span className="flex-1 truncate">{mandant?.name ?? '…'}</span>
            <span style={{ color: '#6b826b', fontSize: 10 }}>GJ {new Date().getFullYear()}</span>
            <Icon name="chevron" className="w-3 h-3" style={{ color: '#6b826b' }} />
          </button>
          {mandantOpen && mandanten.length > 1 && (
            <div
              className="absolute left-0 right-0 z-50 mt-1 rounded-lg shadow-lg overflow-hidden"
              style={{ background: '#fff', border: '1px solid #d4dcd4', top: '100%' }}
            >
              {mandanten.map(m => (
                <button
                  key={m.id}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
                  style={{ color: m.id === mandant?.id ? '#3d6641' : '#1a1a2e', fontWeight: m.id === mandant?.id ? 600 : 400 }}
                  onClick={() => { switchMandant(m.id); setMandantOpen(false); }}
                >
                  {m.id === mandant?.id && <span style={{ color: '#7a9b7f' }}>✓</span>}
                  {m.name}
                </button>
              ))}
              <div style={{ borderTop: '1px solid #e4e9e4' }}>
                <button
                  className="w-full text-left px-3 py-2 text-xs"
                  style={{ color: '#7a9b7f', fontWeight: 500 }}
                  onClick={() => { navigate('/fibu'); setMandantOpen(false); }}
                >
                  + Mandant wechseln / neu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-1">
        {NAV.map(({ section, items }) => (
          <div key={section}>
            <div
              className="px-3.5 pt-3 pb-1 text-xs font-bold uppercase tracking-wider"
              style={{ color: '#7a9a7f', letterSpacing: '0.1em' }}
            >{section}</div>
            {items.map(item => {
              if (item.disabled) {
                return (
                  <div
                    key={item.label}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 mx-1.5 rounded-lg opacity-40 cursor-not-allowed"
                    style={{ fontSize: 12.5, color: '#4a5a4a' }}
                    title={item.note ?? 'Noch nicht verfügbar'}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.note && (
                      <span className="ml-auto text-xs" style={{ color: '#94a394', fontSize: 10 }}>bald</span>
                    )}
                  </div>
                );
              }
              return (
                <NavLink
                  key={item.label}
                  to={`${base}/${item.to}`}
                  end={item.to === 'kreditoren'}
                  className={({ isActive }) => [
                    'flex items-center gap-2.5 px-2.5 py-1.5 mx-1.5 rounded-lg transition-colors',
                    isActive
                      ? 'font-medium'
                      : 'hover:bg-[#edf2ed]',
                  ].join(' ')}
                  style={({ isActive }) => ({
                    fontSize: 12.5,
                    color: isActive ? '#fff' : '#4a5a4a',
                    background: isActive ? '#7a9b7f' : undefined,
                    marginBottom: 1,
                  })}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: '#bfcfbf' }}>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: '#7a9b7f' }}
        >SB</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: '#1a1a2e' }}>Artis Treuhand</div>
          <div className="text-xs" style={{ color: '#94a394' }}>Administrator</div>
        </div>
      </div>
    </aside>
  );
}
