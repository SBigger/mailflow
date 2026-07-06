import React, { useState, useEffect, useMemo, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { Search, Star, CornerDownLeft } from 'lucide-react';
import { ThemeContext } from '@/Layout';
import { useAuth } from '@/lib/AuthContext';
import {
  NAV_GROUPS, visibleItems, allApps, isFavorite, toggleFavorite,
} from '@/components/navigation/appCatalog';
import { useFavorites } from '@/components/navigation/FavoritesDock';
import { openApp } from '@/components/navigation/openApp';
import HubWidgets from '@/components/navigation/HubWidgets';

// ── Start-Hub: Navigation ohne Seitenleiste ────────────────────────
// Suche oben, darunter Favoriten, darunter alle Apps als Kacheln.
// Klick öffnet die App in einem eigenen Fenster (Tauri) bzw. neuen Tab
// (Browser) — der Hub bleibt offen. Alt+Klick öffnet im gleichen Fenster.
// Aktivierbar unter Einstellungen → Darstellung → Navigation.

function hubPalette(theme) {
  if (theme === 'artis') return {
    bg: 'linear-gradient(150deg,#eef4ee 0%,#e9f1f2 55%,#eff0f6 100%)',
    ink: '#1c2420', sub: '#6e7d72', label: '#8a968c',
    grad: 'linear-gradient(100deg,#5f8f6a,#3d9b8f)',
    panelBg: 'rgba(255,255,255,.82)', panelBorder: '#dde5dd',
    panelFocus: '#7a9b7f', focusRing: 'rgba(122,155,127,.18)',
    tileBg: 'rgba(255,255,255,.75)', tileBorder: 'rgba(120,130,120,.16)',
    tileInk: '#26302a', tileSub: '#7d8a80', kbdBorder: 'rgba(28,36,32,.15)',
    accentText: '#5f8f6a', rowHover: 'rgba(122,155,127,.10)',
  };
  if (theme === 'light') return {
    bg: 'linear-gradient(150deg,#f4f4fa 0%,#eef0f6 100%)',
    ink: '#1e2433', sub: '#6b7280', label: '#8a92a3',
    grad: 'linear-gradient(100deg,#7c3aed,#4e79c7)',
    panelBg: 'rgba(255,255,255,.85)', panelBorder: '#dfe2ea',
    panelFocus: '#7c3aed', focusRing: 'rgba(124,58,237,.14)',
    tileBg: 'rgba(255,255,255,.8)', tileBorder: 'rgba(110,120,140,.16)',
    tileInk: '#232a3a', tileSub: '#8a92a3', kbdBorder: 'rgba(30,36,51,.15)',
    accentText: '#7c3aed', rowHover: 'rgba(124,58,237,.08)',
  };
  return { // dark
    bg: '#101413',
    ink: '#eef4ef', sub: '#8a978d', label: '#5f6f64',
    grad: 'linear-gradient(100deg,#8fd3a5,#5fb3d4)',
    panelBg: 'rgba(28,34,31,.92)', panelBorder: 'rgba(223,232,225,.12)',
    panelFocus: 'rgba(143,211,165,.6)', focusRing: 'rgba(143,211,165,.12)',
    tileBg: 'rgba(223,232,225,.04)', tileBorder: 'rgba(223,232,225,.09)',
    tileInk: '#eef4ef', tileSub: '#8a978d', kbdBorder: 'rgba(223,232,225,.2)',
    accentText: '#8fd3a5', rowHover: 'rgba(223,232,225,.06)',
  };
}

function Tile({ app, pal, big = false, onOpen }) {
  const [hover, setHover] = useState(false);
  const Icon = app.icon;
  const c = app.color ?? app.groupColor;
  const fav = isFavorite(app);
  return (
    <button
      onClick={(e) => onOpen(app, e)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${app.label} · Klick: neues Fenster · Alt+Klick: hier öffnen`}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', gap: 9, textAlign: 'left', width: '100%',
        padding: big ? '14px 14px 12px' : '12px 13px 11px',
        borderRadius: 14, cursor: 'pointer',
        background: hover ? `${c}1a` : pal.tileBg,
        border: `1px solid ${hover ? c : pal.tileBorder}`,
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? `0 8px 22px ${c}30` : 'none',
        transition: 'all .13s ease',
      }}
    >
      {(hover || fav) && (
        <span
          role="button"
          title={fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(app); }}
          style={{
            position: 'absolute', top: 7, right: 7, width: 22, height: 22,
            borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: fav ? '#e0a93d' : pal.tileSub, cursor: 'pointer',
          }}
        >
          <Star style={{ width: 13, height: 13, fill: fav ? '#e0a93d' : 'none' }} />
        </span>
      )}
      <span style={{
        width: big ? 38 : 32, height: big ? 38 : 32, borderRadius: big ? 11 : 9,
        background: `linear-gradient(135deg, ${c}, ${c}bb)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', flexShrink: 0, boxShadow: `0 4px 10px ${c}55`,
      }}>
        <Icon style={{ width: big ? 18 : 15, height: big ? 18 : 15 }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: big ? 13.5 : 13, fontWeight: 650, color: pal.tileInk,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
        }}>{app.label}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: pal.tileSub, marginTop: 1 }}>
          {app.groupLabel}
        </span>
      </span>
    </button>
  );
}

export default function Hub() {
  const { theme, hubWidgets } = useContext(ThemeContext);
  const { profile } = useAuth();
  const navigate = useNavigate();
  const pal = hubPalette(theme);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);

  // Widget-Spalte nur auf breiten Fenstern anzeigen
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1080px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1080px)');
    const fn = (e) => setWide(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const showWidgets = hubWidgets && wide;

  const apps = useMemo(() => allApps(profile), [profile]);
  const favApps = useFavorites(profile);

  // Bei Favoriten-Änderung neu rendern (Sterne synchron halten)
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    window.addEventListener('smartis:favorites-changed', bump);
    return () => window.removeEventListener('smartis:favorites-changed', bump);
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

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
    () => (query.trim() ? fuse.search(query.trim()).map(r => r.item).slice(0, 10) : []),
    [fuse, query]
  );

  const handleOpen = (app, e) => {
    openApp(app, { sameWindow: !!e?.altKey, navigate });
  };

  const onKeyDown = (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      openApp(results[Math.min(sel, results.length - 1)], { sameWindow: e.altKey, navigate });
    }
  };

  const heute = new Date().toLocaleDateString('de-CH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const vorname = (profile?.full_name || '').split(' ')[0] || '';

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: pal.bg, color: pal.ink }}>
      <div style={{
        maxWidth: showWidgets ? 1250 : 880, margin: '0 auto', padding: '6vh 24px 60px',
        display: 'flex', gap: 26, alignItems: 'flex-start',
      }}>
      <div style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <h1 style={{ fontSize: 27, fontWeight: 750, letterSpacing: '-.02em', textAlign: 'center' }}>
          Was möchtest du <em style={{
            fontStyle: 'normal', background: pal.grad,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          }}>erledigen</em>{vorname ? `, ${vorname}` : ''}?
        </h1>
        <div style={{ color: pal.sub, fontSize: 13, margin: '7px 0 30px', textAlign: 'center' }}>
          {heute} · Klick öffnet in neuem Fenster · Alt+Klick hier
        </div>

        {/* Suche */}
        <label style={{
          width: 'min(660px,100%)', display: 'flex', alignItems: 'center', gap: 12,
          padding: '15px 20px', borderRadius: 16, cursor: 'text',
          background: pal.panelBg, border: `1px solid ${pal.panelBorder}`,
          transition: 'all .2s',
          boxShadow: query ? `0 0 0 4px ${pal.focusRing}` : 'none',
          borderColor: query ? pal.panelFocus : pal.panelBorder,
        }}>
          <Search style={{ width: 19, height: 19, color: pal.panelFocus, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSel(0); }}
            onKeyDown={onKeyDown}
            placeholder="App suchen… (kredi · abschluss · fristen · le)"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: pal.ink, fontSize: 16.5, fontFamily: 'inherit', minWidth: 0,
            }}
          />
          <kbd style={{
            fontSize: 10, fontWeight: 700, color: pal.sub, fontFamily: 'inherit',
            border: `1px solid ${pal.kbdBorder}`, borderRadius: 5, padding: '2px 7px', flexShrink: 0,
          }}>Ctrl K</kbd>
        </label>

        {/* Suchergebnisse */}
        {query.trim() ? (
          <div style={{
            width: 'min(660px,100%)', marginTop: 10, borderRadius: 14, overflow: 'hidden',
            background: pal.panelBg, border: `1px solid ${pal.panelBorder}`,
          }}>
            {results.length ? results.map((app, i) => {
              const c = app.color ?? app.groupColor;
              const Icon = app.icon;
              return (
                <button
                  key={`${app.groupId}-${app.label}`}
                  onClick={(e) => handleOpen(app, e)}
                  onMouseEnter={() => setSel(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '10px 16px', textAlign: 'left', cursor: 'pointer',
                    background: i === sel ? `${c}1a` : 'transparent',
                  }}
                >
                  <span style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: `linear-gradient(135deg, ${c}, ${c}bb)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  }}>
                    <Icon style={{ width: 15, height: 15 }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: pal.tileInk }}>{app.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: pal.tileSub }}>{app.groupLabel}</span>
                  </span>
                  {i === sel && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>
                      öffnen <CornerDownLeft style={{ width: 13, height: 13 }} />
                    </span>
                  )}
                </button>
              );
            }) : (
              <div style={{ padding: '22px 16px', textAlign: 'center', color: pal.sub, fontSize: 13 }}>
                Keine App gefunden für „{query.trim()}“
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Favoriten */}
            {favApps.length > 0 && (
              <>
                <div style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                  margin: '34px 0 12px', fontSize: 10.5, fontWeight: 800,
                  letterSpacing: '.15em', textTransform: 'uppercase', color: '#c9962e',
                }}>
                  <Star style={{ width: 12, height: 12, fill: '#c9962e' }} /> Favoriten
                </div>
                <div style={{
                  width: '100%', display: 'grid', gap: 10,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                }}>
                  {favApps.map(app => (
                    <Tile key={`fav-${app.groupId}-${app.label}`} app={app} pal={pal} big onOpen={handleOpen} />
                  ))}
                </div>
              </>
            )}

            {/* Alle Apps, gruppiert */}
            {NAV_GROUPS.map(group => {
              const items = visibleItems(group.items, profile);
              if (!items.length) return null;
              return (
                <React.Fragment key={group.id}>
                  <div style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                    margin: '28px 0 12px', fontSize: 10.5, fontWeight: 800,
                    letterSpacing: '.15em', textTransform: 'uppercase', color: group.color,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: group.color, display: 'inline-block' }} />
                    {group.label ?? 'Start'}
                  </div>
                  <div style={{
                    width: '100%', display: 'grid', gap: 10,
                    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  }}>
                    {items.map(item => (
                      <Tile
                        key={`${group.id}-${item.label}`}
                        app={{ ...item, color: item.color ?? group.color, groupColor: group.color, groupLabel: group.label ?? 'Smartis', groupId: group.id }}
                        pal={pal}
                        onOpen={handleOpen}
                      />
                    ))}
                  </div>
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {/* Mini-Dashboard rechts (pro Benutzer aktivierbar) */}
      {showWidgets && <HubWidgets pal={pal} navigate={navigate} profile={profile} />}
      </div>
    </div>
  );
}
