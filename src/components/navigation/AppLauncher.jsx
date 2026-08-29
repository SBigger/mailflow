import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { Search, Sparkles, CornerDownLeft, Star } from 'lucide-react';
import { allApps, itemHref, recordAppOpen, frecencyTop, NAV_GROUPS, visibleItems, isFavorite, toggleFavorite } from './appCatalog';
import { useAuth } from '@/lib/AuthContext'; //[cite: 6]

// ── Smartis App-Launcher ───────────────────────────────────────────
// Vollbild-Overlay: oben Suchfeld, darunter erscheinen die Apps.
// Leer  → "Für dich" (lernt aus deiner Nutzung) + alle Gruppen als Kacheln.
// Tippen → unscharfe Suche inkl. Kurzformen ("kredi", "debi", "abschluss").
// Bedienung: Ctrl+K öffnen · ↑↓ wählen · Enter öffnen · Esc schliessen.

function FavStar({ app, visible }) {
  const fav = isFavorite(app);
  if (!visible && !fav) return null;
  return (
      <span
          role="button"
          title={fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten (rechte Leiste) hinzufügen'}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(app); }}
          style={{
            position: 'absolute', top: 7, right: 7,
            width: 22, height: 22, borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: fav ? '#e0a93d' : '#a8b2a9',
            background: 'rgba(255,255,255,.7)', cursor: 'pointer',
          }}
      >
      <Star style={{ width: 13, height: 13, fill: fav ? '#e0a93d' : 'none' }} />
    </span>
  );
}

function AppTile({ app, onOpen, big = false, disabled = false }) {
  const [hover, setHover] = useState(false);
  const Icon = app.icon;
  const c = app.color ?? app.groupColor;
  return (
      <button
          onClick={() => !disabled && onOpen(app)} //[cite: 6]
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
            padding: big ? '14px 14px 12px' : '11px 12px 10px',
            borderRadius: 14, border: '1px solid',
            borderColor: disabled ? 'rgba(120,130,120,.2)' : (hover ? c : `${c}44`), //[cite: 6]
            background: disabled ? 'rgba(120,130,120,.05)' : (hover ? `${c}1e` : `${c}0e`), //[cite: 6]
            cursor: disabled ? 'not-allowed' : 'pointer', //[cite: 6]
            textAlign: 'left', width: '100%',
            transform: hover && !disabled ? 'translateY(-1px)' : 'none', //[cite: 6]
            boxShadow: hover && !disabled ? `0 6px 18px ${c}33` : 'none', //[cite: 6]
            transition: 'all .13s ease',
            position: 'relative',
            opacity: disabled ? 0.45 : 1, //[cite: 6]
          }}
      >
        {!disabled && <FavStar app={app} visible={hover} />}
        <span style={{
          width: big ? 40 : 32, height: big ? 40 : 32, borderRadius: big ? 11 : 9,
          background: disabled ? 'gray' : `linear-gradient(135deg, ${c}, ${c}bb)`, //[cite: 6]
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', flexShrink: 0, boxShadow: disabled ? 'none' : `0 3px 8px ${c}55`, //[cite: 6]
        }}>
        <Icon style={{ width: big ? 19 : 15, height: big ? 19 : 15 }} />
      </span>
        <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: big ? 13.5 : 12.5, fontWeight: 650, color: disabled ? '#8a968c' : '#26302a', //[cite: 6]
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
        }}>
          {app.label} {disabled && '(Kein Zugriff)'}
        </span>
        <span style={{ display: 'block', fontSize: 10.5, color: '#7d8a80', marginTop: 1 }}>
          {app.groupLabel}
        </span>
      </span>
      </button>
  );
}

function ResultRow({ app, selected, onOpen, onHover, disabled = false }) {
  const Icon = app.icon;
  const c = app.color ?? app.groupColor;
  return (
      <button
          onClick={() => !disabled && onOpen(app)} //[cite: 6]
          onMouseEnter={onHover}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
            padding: '9px 12px', borderRadius: 12, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', //[cite: 6]
            background: disabled ? 'transparent' : (selected ? `${c}1c` : 'transparent'), //[cite: 6]
            outline: !disabled && selected ? `2px solid ${c}` : 'none', //[cite: 6]
            outlineOffset: -2, textAlign: 'left', transition: 'background .1s',
            opacity: disabled ? 0.45 : 1, //[cite: 6]
          }}
      >
      <span style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: disabled ? 'gray' : `linear-gradient(135deg, ${c}, ${c}bb)`, //[cite: 6]
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        boxShadow: disabled ? 'none' : `0 3px 8px ${c}55`, //[cite: 6]
      }}>
        <Icon style={{ width: 17, height: 17 }} />
      </span>
        <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: disabled ? '#8a968c' : '#26302a' }}>
          {app.label} {disabled && '(Kein Zugriff)'}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: '#7d8a80' }}>{app.groupLabel}</span>
      </span>
        {!disabled && (selected || isFavorite(app)) && (
            <span
                role="button"
                title={isFavorite(app) ? 'Aus Favoriten entfernen' : 'Zu Favoriten (rechte Leiste) hinzufügen'}
                onClick={(e) => { e.stopPropagation(); toggleFavorite(app); }}
                style={{
                  width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isFavorite(app) ? '#e0a93d' : '#a8b2a9', cursor: 'pointer',
                }}
            >
          <Star style={{ width: 14, height: 14, fill: isFavorite(app) ? '#e0a93d' : 'none' }} />
        </span>
        )}
        {!disabled && selected && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700,
              color: c, flexShrink: 0,
            }}>
          öffnen <CornerDownLeft style={{ width: 13, height: 13 }} />
        </span>
        )}
      </button>
  );
}

export default function AppLauncher({ open, onClose, profile, dark = false }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const { canAccessRoute } = useAuth(); //[cite: 6]

  const apps = useMemo(() => allApps(profile), [profile]);

  // Bei Favoriten-Änderung neu rendern (Sterne + Dock bleiben synchron)
  const [, setFavTick] = useState(0);
  useEffect(() => {
    const bump = () => setFavTick(t => t + 1);
    window.addEventListener('smartis:favorites-changed', bump);
    return () => window.removeEventListener('smartis:favorites-changed', bump);
  }, []);

  const fuse = useMemo(() => new Fuse(apps, {
    keys: [
      { name: 'label', weight: 0.7 },
      { name: 'aliases', weight: 0.5 },
      { name: 'groupLabel', weight: 0.15 },
    ],
    threshold: 0.42,
    ignoreLocation: true,
  }), [apps]);

  const results = useMemo(
      () => (query.trim() ? fuse.search(query.trim()).map(r => r.item) : []),
      [fuse, query]
  );

  const topApps = useMemo(() => {
    if (!open) return [];
    const top = frecencyTop(apps, 6);
    if (top.length >= 4) return top;
    // Kaltstart: mit den wichtigsten Rail-Apps auffüllen
    const fill = apps.filter(a => a.rail && !top.includes(a));
    return [...top, ...fill].slice(0, 6);
  }, [apps, open]);

  // Beim Öffnen: zurücksetzen + fokussieren
  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const openApp = useCallback((app) => {
    const href = itemHref(app);
    if (!canAccessRoute(href || app.name)) return; //[cite: 6]
    recordAppOpen(app);
    onClose();
    navigate(href);
  }, [navigate, onClose, canAccessRoute]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const targetApp = results[Math.min(sel, results.length - 1)];
      const href = itemHref(targetApp);
      if (canAccessRoute(href || targetApp.name)) { //[cite: 6]
        openApp(targetApp);
      }
    }
  };

  if (!open) return null;

  const panelBg = 'rgba(250,252,250,.94)';

  return (
      <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
          className="animate-in fade-in duration-150"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: dark ? 'rgba(8,10,9,.6)' : 'rgba(22,30,24,.45)',
            backdropFilter: 'blur(14px) saturate(1.15)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            padding: '9vh 16px 24px',
          }}
      >
        <div
            className="animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200"
            style={{ width: 'min(720px, 100%)', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '82vh' }}
        >
          {/* ── Suchfeld ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: panelBg, borderRadius: 18, padding: '16px 20px',
            boxShadow: '0 18px 50px rgba(10,18,12,.35), 0 0 0 1px rgba(122,155,127,.25)',
            backdropFilter: 'blur(20px)',
          }}>
            <Search style={{ width: 21, height: 21, color: '#7a9b7f', flexShrink: 0 }} />
            <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setSel(0); }}
                onKeyDown={onKeyDown}
                placeholder="App suchen… (z.B. kredi, abschluss, fristen)"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 19, color: '#1d2620', fontWeight: 500, minWidth: 0,
                }}
            />
            <kbd style={{
              fontSize: 10.5, fontWeight: 700, color: '#7d8a80', flexShrink: 0,
              border: '1px solid rgba(120,130,120,.35)', borderBottomWidth: 2,
              borderRadius: 6, padding: '2px 7px', fontFamily: 'inherit',
            }}>esc</kbd>
          </div>

          {/* ── Ergebnisse / Katalog ── */}
          <div style={{
            background: panelBg, borderRadius: 18, padding: 14,
            boxShadow: '0 18px 50px rgba(10,18,12,.30), 0 0 0 1px rgba(122,155,127,.18)',
            overflowY: 'auto', backdropFilter: 'blur(20px)',
          }}>
            {query.trim() ? (
                results.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {results.slice(0, 12).map((app, i) => {
                        const href = itemHref(app);
                        const disabled = !canAccessRoute(href || app.name); //[cite: 6]
                        return (
                            <ResultRow
                                key={`${app.groupId}-${app.label}`}
                                app={app}
                                selected={i === sel}
                                onOpen={openApp}
                                onHover={() => setSel(i)}
                                disabled={disabled} //[cite: 6]
                            />
                        );
                      })}
                    </div>
                ) : (
                    <div style={{ padding: '26px 12px', textAlign: 'center', color: '#7d8a80', fontSize: 13.5 }}>
                      Keine App gefunden für „{query.trim()}“
                    </div>
                )
            ) : (
                <>
                  {/* Für dich — frecency-basiert */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, margin: '4px 6px 8px',
                    fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase', color: '#7a9b7f',
                  }}>
                    <Sparkles style={{ width: 12, height: 12 }} /> Für dich
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
                    {topApps.map(app => {
                      const href = itemHref(app);
                      const disabled = !canAccessRoute(href || app.name); //[cite: 6]
                      return (
                          <AppTile
                              key={`top-${app.groupId}-${app.label}`}
                              app={app}
                              onOpen={openApp}
                              big
                              disabled={disabled} //[cite: 6]
                          />
                      );
                    })}
                  </div>

                  {/* Alle Gruppen */}
                  {NAV_GROUPS.map(group => {
                    const items = visibleItems(group.items, profile);
                    if (!items.length || !group.label) return null;
                    return (
                        <div key={group.id} style={{ marginBottom: 12 }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 7, margin: '2px 6px 7px',
                            fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase', color: group.color,
                          }}>
                            <span style={{ width: 8, height: 8, borderRadius: 3, background: group.color, display: 'inline-block' }} />
                            {group.label}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                            {items.map(item => {
                              const constructedApp = { ...item, color: item.color ?? group.color, groupColor: group.color, groupLabel: group.label ?? 'Smartis', groupId: group.id };
                              const href = itemHref(constructedApp);
                              const disabled = !canAccessRoute(href || constructedApp.name); //[cite: 6]
                              return (
                                  <AppTile
                                      key={`${group.id}-${item.label}`}
                                      app={constructedApp}
                                      onOpen={openApp}
                                      disabled={disabled} //[cite: 6]
                                  />
                              );
                            })}
                          </div>
                        </div>
                    );
                  })}
                </>
            )}

            {/* Fusszeile */}
            <div style={{
              display: 'flex', gap: 16, padding: '10px 6px 2px', marginTop: 4,
              borderTop: '1px solid rgba(120,130,120,.18)', fontSize: 11, color: '#8a968c',
            }}>
              <span><b>↑↓</b> wählen</span>
              <span><b>Enter</b> öffnen</span>
              <span><b>Esc</b> schliessen</span>
              <span style={{ marginLeft: 'auto' }}><b>Ctrl K</b> von überall</span>
            </div>
          </div>
        </div>
      </div>
  );
}