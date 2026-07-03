import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, X } from 'lucide-react';
import { favoriteApps, appKey, itemHref, recordAppOpen, toggleFavorite } from './appCatalog';

// ── Favoriten-Dock (rechte Bildschirmkante) ────────────────────────
// Apps landen hier über den Stern im App-Launcher (Ctrl+K).
// Klick = öffnen · Mittelklick/Ctrl+Klick = neuer Tab · Shift+Klick = neues Fenster
// (native Browser-Links) · × beim Hover = Favorit entfernen.

export function useFavorites(profile) {
  const [favs, setFavs] = useState(() => favoriteApps(profile));
  useEffect(() => {
    const update = () => setFavs(favoriteApps(profile));
    update();
    window.addEventListener('smartis:favorites-changed', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('smartis:favorites-changed', update);
      window.removeEventListener('storage', update);
    };
  }, [profile]);
  return favs;
}

function DockTile({ app }) {
  const [hover, setHover] = useState(false);
  const Icon = app.icon;
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Link
        to={itemHref(app)}
        title={`${app.label} · Mittelklick: neuer Tab · Shift+Klick: neues Fenster`}
        onClick={() => recordAppOpen(app)}
        onAuxClick={() => recordAppOpen(app)}
        style={{
          width: 38, height: 38, borderRadius: 11,
          background: `linear-gradient(135deg, ${app.groupColor}, ${app.groupColor}bb)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', textDecoration: 'none',
          boxShadow: hover ? `0 4px 12px ${app.groupColor}66` : `0 2px 6px ${app.groupColor}33`,
          transform: hover ? 'scale(1.08)' : 'scale(1)',
          transition: 'transform .12s ease, box-shadow .12s ease',
        }}
      >
        <Icon style={{ width: 17, height: 17 }} />
      </Link>
      {hover && (
        <button
          title="Favorit entfernen"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(app); }}
          style={{
            position: 'absolute', top: -5, right: -5,
            width: 16, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#4a4f4a', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,.3)',
          }}
        >
          <X style={{ width: 10, height: 10 }} />
        </button>
      )}
    </div>
  );
}

export default function FavoritesDock({ profile, sidebarBg, sidebarBorder, faintColor }) {
  const favs = useFavorites(profile);
  if (!favs.length) return null;
  return (
    <aside
      title="Favoriten"
      style={{
        width: 52, flexShrink: 0,
        background: sidebarBg, borderLeft: `1px solid ${sidebarBorder}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 12, paddingBottom: 12, gap: 9,
        overflowY: 'auto', overflowX: 'hidden',
      }}
    >
      <Star style={{ width: 13, height: 13, color: faintColor, flexShrink: 0, marginBottom: 2 }} />
      {favs.map(app => <DockTile key={appKey(app)} app={app} />)}
    </aside>
  );
}
