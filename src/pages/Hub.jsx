import React, { useState, useEffect, useMemo, useRef, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Search, Star, CornerDownLeft, FileText, Building2, CalendarClock, PhoneCall, Mail } from 'lucide-react';
import { ThemeContext } from '@/Layout';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import {
  NAV_GROUPS, visibleItems, allApps, isFavorite, toggleFavorite, reorderFavorites, appKey,
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

// Kleine Gruppen-Überschrift in der Ergebnisliste (Apps / Dokumente)
function hubGroupLabel(pal) {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '9px 16px 5px', fontSize: 10, fontWeight: 800,
    letterSpacing: '.13em', textTransform: 'uppercase', color: pal.label,
  };
}

// Datei-Kürzel für das Badge (aus Dateiname oder MIME-Typ)
function fileExt(doc) {
  const fn = doc.filename || doc.name || '';
  const m = fn.match(/\.([a-z0-9]{1,5})$/i);
  if (m) return m[1].toUpperCase().slice(0, 4);
  const ft = (doc.file_type || '').toLowerCase();
  if (ft.includes('pdf')) return 'PDF';
  if (ft.includes('word') || ft.includes('doc')) return 'DOC';
  if (ft.includes('sheet') || ft.includes('excel') || ft.includes('xls')) return 'XLS';
  if (ft.includes('image')) return 'IMG';
  return 'DOK';
}

// Highlight-Snippet der Volltextsuche sicher rendern: alles escapen,
// dann nur die <b>-Marker der Suche wieder als farbige Hervorhebung zulassen.
function safeHeadline(h, accent) {
  const esc = String(h || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/&lt;b&gt;/g, `<b style="color:${accent};font-style:normal;font-weight:700">`)
    .replace(/&lt;\/b&gt;/g, '</b>');
}

// Farbiges Icon-Quadrat für einen Suchtreffer
function iconSquare(Icon, color) {
  return (
    <span style={{
      width: 32, height: 32, borderRadius: 9, flexShrink: 0, marginTop: 1,
      background: `linear-gradient(135deg, ${color}, ${color}bb)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
    }}>
      <Icon style={{ width: 15, height: 15 }} />
    </span>
  );
}

// Untertitel-Zeile eines Treffers (einzeilig, gekürzt)
function Sub({ pal, children, color, italic }) {
  if (children == null || children === '') return null;
  return (
    <span style={{
      display: 'block', fontSize: 11, color: color || pal.tileSub, marginTop: 1,
      fontStyle: italic ? 'italic' : 'normal',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>{children}</span>
  );
}

// Generische Trefferzeile: Icon links, Titel + beliebiger Untertitel-Inhalt
function GhostRow({ pal, icon, title, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
        padding: '10px 16px', textAlign: 'left', cursor: 'pointer', background: 'transparent',
      }}
      onMouseEnter={e => e.currentTarget.style.background = pal.rowHover}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: pal.tileInk, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {children}
      </span>
    </button>
  );
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

  // ── Globale Suche: Dokumente (FTS-RPC) + Kunden/Fristen/Telefonate/Mails (ilike) ──
  const [docResults, setDocResults] = useState(null);
  const [custResults, setCustResults] = useState(null);
  const [fristResults, setFristResults] = useState(null);
  const [callResults, setCallResults] = useState(null);
  const [mailResults, setMailResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setDocResults(null); setCustResults(null); setFristResults(null);
      setCallResults(null); setMailResults(null); setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      // Sonderzeichen entfernen, die den .or()-Filter zerlegen würden
      const safe = q.replace(/[,()%*]/g, ' ').trim();
      const orIlike = (cols) => cols.map(c => `${c}.ilike.*${safe}*`).join(',');
      const val = (r) => (r.status === 'fulfilled' && !r.value?.error ? (r.value.data || []) : []);
      const [d, cu, fr, ca, ma] = await Promise.allSettled([
        supabase.rpc('search_dokumente', { p_query: q, p_customer_id: null, p_limit: 8 }),
        supabase.from('customers')
          .select('id, company_name, ort, email')
          .or(orIlike(['company_name', 'ort', 'email']))
          .limit(6),
        supabase.from('fristen')
          .select('id, title, category, kanton, jahr, due_date, status, customer_id')
          .or(orIlike(['title', 'description', 'category', 'kanton']))
          .limit(6),
        supabase.from('call_records')
          .select('id, caller_name, callee_name, caller_number, callee_number, artis_user_name, direction, start_time')
          .or(orIlike(['caller_name', 'callee_name', 'caller_number', 'callee_number', 'artis_user_name', 'notes']))
          .order('start_time', { ascending: false }).limit(6),
        supabase.from('mail_items')
          .select('id, subject, sender_name, sender_email, received_date')
          .or(orIlike(['subject', 'sender_name', 'sender_email', 'body_preview']))
          .order('received_date', { ascending: false }).limit(6),
      ]);
      setDocResults(val(d)); setCustResults(val(cu)); setFristResults(val(fr));
      setCallResults(val(ca)); setMailResults(val(ma));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleOpen = (app, e) => {
    openApp(app, { sameWindow: !!e?.altKey, navigate });
  };

  // Kunden-Namen (id → Firma) für Fristen-Treffer, lazy geladen sobald gesucht wird
  const [custMap, setCustMap] = useState(null);
  useEffect(() => {
    if (custMap || docResults === null) return;
    supabase.from('customers').select('id, company_name')
      .then(({ data }) => setCustMap(new Map((data || []).map(c => [c.id, c.company_name]))))
      .catch(() => setCustMap(new Map()));
  }, [docResults, custMap]);

  // Dokument öffnen: Dokumente-Seite mit ?open=<id> (öffnet + lädt es),
  // in eigenem Fenster; record:false, damit es die App-Statistik nicht verfälscht.
  const openDoc = (doc, e) => {
    openApp(
      { href: `/Dokumente?open=${doc.id}`, label: doc.name || doc.filename || 'Dokument' },
      { sameWindow: !!e?.altKey, navigate, record: false }
    );
  };
  // Modul öffnen (Kunden/Fristen/Telefon/Mails haben noch keinen Datensatz-Deep-Link)
  const openRoute = (route, label, e) => {
    openApp({ href: route, label }, { sameWindow: !!e?.altKey, navigate, record: false });
  };

  // Favoriten per Drag & Drop umsortieren
  const handleFavDragEnd = (result) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const keys = favApps.map(a => appKey(a));
    const [moved] = keys.splice(result.source.index, 1);
    keys.splice(result.destination.index, 0, moved);
    reorderFavorites(keys);
  };

  const onKeyDown = (e) => {
    if (results.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        openApp(results[Math.min(sel, results.length - 1)], { sameWindow: e.altKey, navigate });
      }
    } else if (e.key === 'Enter') {
      // Keine App-Treffer → obersten Inhalts-Treffer öffnen (Dokument zuerst)
      e.preventDefault();
      if (docResults?.length) openDoc(docResults[0], e);
      else if (custResults?.length) openRoute('/Kunden', 'Kunden', e);
      else if (fristResults?.length) openRoute('/Fristen', 'Fristen', e);
      else if (callResults?.length) openRoute('/TelefonDashboard', 'Telefon', e);
      else if (mailResults?.length) openRoute('/MailKanban', 'Mails', e);
    }
  };

  // Datum kurz formatieren (leer bei ungültig)
  const dCH = (x) => { const t = x ? new Date(x) : null; return t && !isNaN(t) ? t.toLocaleDateString('de-CH') : ''; };
  const dirLabel = (d) => d === 'incoming' ? 'eingehend' : d === 'outgoing' ? 'ausgehend' : 'Anruf';

  const heute = new Date().toLocaleDateString('de-CH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const vorname = (profile?.full_name || '').split(' ')[0] || '';

  // ── Treffer-Bereiche in fester Reihenfolge: Datei zuerst ──
  const docBadge = (doc) => (
    <span style={{
      minWidth: 34, height: 32, padding: '0 5px', borderRadius: 8, flexShrink: 0, marginTop: 1,
      background: 'linear-gradient(135deg,#4e79a7,#4e79a7bb)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800,
    }}>{fileExt(doc)}</span>
  );
  const searchSections = [];
  if (query.trim().length >= 2) {
    if (docResults?.length) searchSections.push({
      id: 'docs', icon: FileText, label: 'Dokumente', count: docResults.length,
      rows: docResults.map(doc => {
        const meta = [custMap?.get(doc.customer_id), doc.year].filter(Boolean).join(' · ');
        return (
          <GhostRow key={'doc-' + doc.id} pal={pal} icon={docBadge(doc)} title={doc.name || doc.filename} onClick={(e) => openDoc(doc, e)}>
            {doc.headline && <span style={{ display: 'block', fontSize: 11, color: pal.tileSub, marginTop: 1, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} dangerouslySetInnerHTML={{ __html: safeHeadline(doc.headline, pal.accentText) }} />}
            {meta && <Sub pal={pal} color={pal.accentText}>{meta}</Sub>}
          </GhostRow>
        );
      }),
    });
    if (custResults?.length) searchSections.push({
      id: 'kunden', icon: Building2, label: 'Kunden', count: custResults.length,
      rows: custResults.map(c => (
        <GhostRow key={'cust-' + c.id} pal={pal} icon={iconSquare(Building2, '#d98836')} title={c.company_name || '(ohne Namen)'} onClick={(e) => openRoute('/Kunden', 'Kunden', e)}>
          <Sub pal={pal}>{[c.ort, c.email].filter(Boolean).join(' · ')}</Sub>
        </GhostRow>
      )),
    });
    if (fristResults?.length) searchSections.push({
      id: 'fristen', icon: CalendarClock, label: 'Fristen', count: fristResults.length,
      rows: fristResults.map(f => (
        <GhostRow key={'frist-' + f.id} pal={pal} icon={iconSquare(CalendarClock, '#c94f4f')} title={f.title || f.category || 'Frist'} onClick={(e) => openRoute('/Fristen', 'Fristen', e)}>
          <Sub pal={pal}>{[custMap?.get(f.customer_id), f.jahr, dCH(f.due_date), f.status].filter(Boolean).join(' · ')}</Sub>
        </GhostRow>
      )),
    });
    if (callResults?.length) searchSections.push({
      id: 'calls', icon: PhoneCall, label: 'Telefonate', count: callResults.length,
      rows: callResults.map(c => (
        <GhostRow key={'call-' + c.id} pal={pal} icon={iconSquare(PhoneCall, '#4fae6b')}
          title={c.caller_name || c.callee_name || c.caller_number || c.callee_number || 'Anruf'}
          onClick={(e) => openRoute('/TelefonDashboard', 'Telefon', e)}>
          <Sub pal={pal}>{[dirLabel(c.direction), dCH(c.start_time), c.artis_user_name].filter(Boolean).join(' · ')}</Sub>
        </GhostRow>
      )),
    });
    if (mailResults?.length) searchSections.push({
      id: 'mails', icon: Mail, label: 'Mails', count: mailResults.length,
      rows: mailResults.map(m => (
        <GhostRow key={'mail-' + m.id} pal={pal} icon={iconSquare(Mail, '#4e79a7')} title={m.subject || '(kein Betreff)'} onClick={(e) => openRoute('/MailKanban', 'Mails', e)}>
          <Sub pal={pal}>{[m.sender_name || m.sender_email, dCH(m.received_date)].filter(Boolean).join(' · ')}</Sub>
        </GhostRow>
      )),
    });
  }

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
            placeholder="Alles suchen… App, Dokument, Kunde, Frist, Telefonat, Mail"
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

        {/* Suchergebnisse: Dokumente zuerst, dann Kunden/Fristen/Telefonate/Mails, Apps zuletzt */}
        {query.trim() ? (
          <div style={{
            width: 'min(660px,100%)', marginTop: 10, borderRadius: 14, overflow: 'hidden',
            background: pal.panelBg, border: `1px solid ${pal.panelBorder}`,
            maxHeight: '66vh', overflowY: 'auto',
          }}>
            {searchSections.map((s, i) => (
              <React.Fragment key={s.id}>
                <div style={{ ...hubGroupLabel(pal), borderTop: i > 0 ? `1px solid ${pal.panelBorder}` : 'none' }}>
                  <s.icon style={{ width: 11, height: 11 }} /> {s.label}
                  <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>· {s.count}</span>
                </div>
                {s.rows}
              </React.Fragment>
            ))}

            {/* Apps zuletzt (Datei zuerst) */}
            {results.length > 0 && (
              <>
                <div style={{ ...hubGroupLabel(pal), borderTop: searchSections.length ? `1px solid ${pal.panelBorder}` : 'none' }}>
                  Apps <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>· {results.length}</span>
                </div>
                {results.map((app, i) => {
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
                })}
              </>
            )}

            {/* Suche läuft / nichts gefunden */}
            {searching && searchSections.length === 0 && results.length === 0 && (
              <div style={{ padding: '18px 16px', textAlign: 'center', color: pal.sub, fontSize: 13 }}>Suche läuft…</div>
            )}
            {!searching && searchSections.length === 0 && results.length === 0 && (
              <div style={{ padding: '22px 16px', textAlign: 'center', color: pal.sub, fontSize: 13 }}>
                Nichts gefunden für „{query.trim()}“
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Favoriten — per Drag & Drop umsortierbar */}
            {favApps.length > 0 && (
              <>
                <div style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                  margin: '34px 0 12px', fontSize: 10.5, fontWeight: 800,
                  letterSpacing: '.15em', textTransform: 'uppercase', color: '#c9962e',
                }}>
                  <Star style={{ width: 12, height: 12, fill: '#c9962e' }} /> Favoriten
                  {favApps.length > 1 && (
                    <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: pal.sub, fontSize: 10.5 }}>
                      · ziehen zum Sortieren
                    </span>
                  )}
                </div>
                <DragDropContext onDragEnd={handleFavDragEnd}>
                  <Droppable droppableId="hub-favorites" direction="horizontal">
                    {(dropProvided) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        style={{
                          width: '100%', display: 'grid', gap: 10,
                          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        }}
                      >
                        {favApps.map((app, index) => (
                          <Draggable key={appKey(app)} draggableId={appKey(app)} index={index}>
                            {(drag, snapshot) => (
                              <div
                                ref={drag.innerRef}
                                {...drag.draggableProps}
                                {...drag.dragHandleProps}
                                style={{
                                  ...drag.draggableProps.style,
                                  opacity: snapshot.isDragging ? 0.9 : 1,
                                  cursor: snapshot.isDragging ? 'grabbing' : undefined,
                                }}
                              >
                                <Tile app={app} pal={pal} big onOpen={handleOpen} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {dropProvided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
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
