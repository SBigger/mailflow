import React, { useState, useEffect, useRef, createContext, useCallback, Suspense } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useIsWidescreen, useViewportClass } from "@/components/layout/useIsWidescreen";
const WorkspaceShell = React.lazy(() => import("@/components/layout/WorkspaceShell"));
import { createPageUrl } from "@/utils";
import ChartisNotifier from "@/components/chartis/ChartisNotifier";
import {
  LogOut,
  Mic,
  Search,
  Star,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from "lucide-react";
import VoiceAssistant from "@/components/voice/VoiceAssistant";
import TaskReminderPopup from "@/components/tasks/TaskReminderPopup";
import BottomNav from "@/components/mobile/BottomNav";
import AppLauncher from "@/components/navigation/AppLauncher";
import FavoritesDock, { useFavorites } from "@/components/navigation/FavoritesDock";
import { NAV_GROUPS, DEFAULT_OPEN, itemHref, visibleItems, recordAppOpen, appKey, isFavorite, toggleFavorite } from "@/components/navigation/appCatalog";
import { hydrateNavPrefs, scheduleNavPrefsSave } from "@/components/navigation/navPrefsSync";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { useAuth } from '@/lib/AuthContext';
import * as packageJson from "../package.json";

// Theme context for global access if needed elsewhere
// navLayout: 'sidebar' | 'hub' | 'widescreen'
// layoutMode: 'mobile' | 'desktop' | 'widescreen' — effektiv gerendert
// viewportClass: '2col' | '3col' | '4col' | null — nur wenn widescreen aktiv
export const ThemeContext = createContext({
  theme: 'dark', setTheme: () => {},
  navLayout: 'sidebar', setNavLayout: () => {},
  hubWidgets: false, setHubWidgets: () => {},
  hubOpenMode: 'same', setHubOpenMode: () => {},
  layoutMode: 'desktop', viewportClass: null,
});

// ── Einzelner Navigations-Eintrag ──────────────────────────────────
function NavRow({ item, active, collapsed, pal }) {
  const [hover, setHover] = useState(false);
  const Icon = item.icon;
  return (
    <Link
      to={itemHref(item)}
      title={collapsed ? item.label : undefined}
      onClick={() => recordAppOpen(item)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: collapsed ? 40 : 'auto',
        height: collapsed ? 40 : 'auto',
        padding: collapsed ? 0 : '6px 10px',
        margin: collapsed ? '0 auto 4px' : '0 8px 1px',
        borderRadius: 8, fontSize: 13, textDecoration: 'none',
        color: active ? '#fff' : pal.text,
        background: active ? pal.active : hover ? pal.hover : 'transparent',
        fontWeight: active ? 600 : 400,
        boxShadow: active ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
        transition: 'background .12s',
      }}
    >
      <Icon style={{
        width: collapsed ? 19 : 16, height: collapsed ? 19 : 16, flexShrink: 0,
        color: active ? '#fff' : (item.color ?? pal.text),
      }} />
      {!collapsed && (
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
        </span>
      )}
      {!collapsed && (hover || isFavorite(item)) && (
        <span
          role="button"
          title={isFavorite(item) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
            color: isFavorite(item) ? '#e0a93d' : active ? 'rgba(255,255,255,.85)' : pal.faint,
          }}
        >
          <Star style={{ width: 12.5, height: 12.5, fill: isFavorite(item) ? '#e0a93d' : 'none' }} />
        </span>
      )}
    </Link>
  );
}

// ── Schwebender Hub-Knopf: klickbar UND frei verschiebbar ──────────
// Position wird pro Gerät gespeichert (hub_chip_pos), damit er nichts verdeckt.
function HubChip({ pal, sidebarBorder, lightBg }) {
  const navigate = useNavigate();
  const [pos, setPos] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem('hub_chip_pos'));
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    } catch { /* Default */ }
    return { x: 12, y: 12 };
  });
  const posRef = useRef(pos);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  useEffect(() => { posRef.current = pos; }, [pos]);

  const clamp = (x, y) => ({
    x: Math.min(Math.max(4, x), window.innerWidth - 90),
    y: Math.min(Math.max(4, y), window.innerHeight - 44),
  });

  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) movedRef.current = true;
      setPos(clamp(d.origX + (e.clientX - d.startX), d.origY + (e.clientY - d.startY)));
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('hub_chip_pos', JSON.stringify(posRef.current));
      } catch { /* egal */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  return (
    <button
      title="Zurück zum Start-Hub · Ziehen zum Verschieben"
      onMouseDown={(e) => {
        movedRef.current = false;
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y };
        document.body.style.userSelect = 'none';
      }}
      onClick={() => {
        if (movedRef.current) { movedRef.current = false; return; }
        navigate('/Hub');
      }}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 45,
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 12px 6px 7px', borderRadius: 12, border: `1px solid ${sidebarBorder}`,
        background: lightBg ? 'rgba(255,255,255,.85)' : 'rgba(30,36,32,.85)',
        boxShadow: '0 6px 20px rgba(20,30,24,.18)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        color: pal.text, fontSize: 12.5, fontWeight: 700,
        cursor: dragRef.current ? 'grabbing' : 'pointer',
      }}
    >
      <span style={{
        width: 22, height: 22, borderRadius: 7, background: pal.active, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800,
      }}>S</span>
      Hub
    </button>
  );
}

// ── Gruppen-Überschrift mit Auf-/Zuklappen ─────────────────────────
function GroupHeader({ label, open, onToggle, pal, count }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, width: 'calc(100% - 16px)',
        margin: '10px 8px 3px', padding: '3px 6px', borderRadius: 6,
        border: 'none', cursor: 'pointer', textAlign: 'left',
        background: hover ? pal.hover : 'transparent',
        fontSize: 10, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase',
        color: pal.faint,
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {!open && count > 0 && (
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: 0,
          background: pal.hover, borderRadius: 8, padding: '1px 6px',
        }}>{count}</span>
      )}
      <ChevronDown style={{
        width: 12, height: 12, flexShrink: 0,
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform .15s',
      }} />
    </button>
  );
}

export default function Layout({ currentPageName: currentPageNameProp }) {
  const { signOut, profile, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const menuRef = useRef(null);

  // Aktive Seite: Prop hat Vorrang, sonst aus der URL abgeleitet (/Dashboard → "Dashboard")
  const currentPageName = currentPageNameProp ?? location.pathname.split('/')[1] ?? '';

  // --- Theme State ---
  const [theme, setThemeState] = useState(() => localStorage.getItem("app_theme") || "artis");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem("app_theme", newTheme);
  }, []);

  // --- Navigations-Art: 'sidebar' | 'hub' | 'widescreen' ---
  const [navLayout, setNavLayoutState] = useState(() => {
    const v = localStorage.getItem("nav_layout");
    return v === "hub" || v === "widescreen" ? v : "sidebar";
  });
  const setNavLayout = useCallback((layout) => {
    setNavLayoutState(layout);
    localStorage.setItem("nav_layout", layout);
    scheduleNavPrefsSave();
  }, []);

  // --- Hub-Widgets (Mini-Dashboard rechts im Hub) — pro Benutzer aktivierbar ---
  const [hubWidgets, setHubWidgetsState] = useState(() => localStorage.getItem("hub_widgets") === "1");
  const setHubWidgets = useCallback((on) => {
    setHubWidgetsState(!!on);
    localStorage.setItem("hub_widgets", on ? "1" : "0");
    scheduleNavPrefsSave();
  }, []);

  // --- Hub: App-Klick öffnet im gleichen Fenster (schnell) oder neuem Fenster ---
  const [hubOpenMode, setHubOpenModeState] = useState(() =>
    localStorage.getItem("hub_open_mode") === "new" ? "new" : "same"
  );
  const setHubOpenMode = useCallback((mode) => {
    const m = mode === "new" ? "new" : "same";
    setHubOpenModeState(m);
    localStorage.setItem("hub_open_mode", m);
    scheduleNavPrefsSave();
  }, []);

  // --- Sidebar-Modus: breit (Labels + Gruppen) oder schmale Icon-Leiste ---
  const [railMode, setRailMode] = useState(() => localStorage.getItem("nav_mode") === "rail");
  const toggleRailMode = () => {
    setRailMode(prev => {
      localStorage.setItem("nav_mode", prev ? "wide" : "rail");
      scheduleNavPrefsSave();
      return !prev;
    });
  };

  // --- Auf-/zugeklappte Gruppen (persistiert) ---
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nav_groups_open")) || {};
    } catch {
      return {};
    }
  });
  const isGroupOpen = (id) => openGroups[id] ?? DEFAULT_OPEN[id] ?? true;
  const toggleGroup = (id) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !isGroupOpen(id) };
      localStorage.setItem("nav_groups_open", JSON.stringify(next));
      scheduleNavPrefsSave();
      return next;
    });
  };

  // Beim Start: Einstellungen aus dem Profil übernehmen (falls dort neuer)
  useEffect(() => {
    if (!profile) return;
    if (hydrateNavPrefs(profile)) {
      try {
        setOpenGroups(JSON.parse(localStorage.getItem("nav_groups_open")) || {});
      } catch {
        setOpenGroups({});
      }
      setRailMode(localStorage.getItem("nav_mode") === "rail");
      {
        const v = localStorage.getItem("nav_layout");
        setNavLayoutState(v === "hub" || v === "widescreen" ? v : "sidebar");
      }
      setHubWidgetsState(localStorage.getItem("hub_widgets") === "1");
      setHubOpenModeState(localStorage.getItem("hub_open_mode") === "new" ? "new" : "same");
    }
  }, [profile]);

  // --- Role-Based Access Control & Redirection ---
  useEffect(() => {
    if (!loading && profile?.role === 'task_user' && currentPageName !== 'TaskBoard') {
      navigate(createPageUrl('TaskBoard'));
    }

    // Sync theme from profile if it exists and hasn't been set locally this session
    if (profile?.theme && !localStorage.getItem("app_theme")) {
      setTheme(profile.theme);
    }
  }, [profile, loading, currentPageName, navigate, setTheme]);

  const isTaskUser = profile?.role === 'task_user';

  // Start-Hub aktiv? (nur Desktop, nicht für Task-User)
  const hubMode = navLayout === 'hub' && !isTaskUser && !isMobile;

  // --- Widescreen: additiver dritter Layout-Modus (nur Desktop, ab 1600px) ---
  const isWidescreen = useIsWidescreen();
  const viewportClass = useViewportClass();
  const layoutMode = isMobile
    ? 'mobile'
    : (navLayout === 'widescreen' && isWidescreen && !isTaskUser)
      ? 'widescreen'
      : 'desktop';

  // Hub-Modus: beim App-Start auf dem Hub landen statt auf dem Dashboard
  const hubStartDone = useRef(false);
  useEffect(() => {
    if (hubStartDone.current || loading) return;
    hubStartDone.current = true;
    if (hubMode && (location.pathname === '/' || location.pathname === '/Dashboard')) {
      navigate('/Hub', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // --- Launcher-Hotkey: Ctrl/Cmd+K von überall ---
  useEffect(() => {
    if (isTaskUser || isMobile) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setLauncherOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isTaskUser, isMobile]);

  // --- UI Helpers ---
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- Tauri Hotkey: Shift+Ctrl+S → neuer Task ---
  useEffect(() => {
    if (!window.smartis?.onNewTask) return;
    const unsubscribe = window.smartis.onNewTask(() => {
      navigate('/TaskBoard');
      // kurze Verzögerung damit TaskBoard mountet bevor der Dialog geöffnet wird
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('smartis:open-new-task'));
      }, 150);
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [navigate]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/Login');
  };

  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const sidebarBg = isLight ? '#e8e8ef' : isArtis ? '#e6ede6' : '#2a2a2f';
  const sidebarBorder = isLight ? '#d0d0dc' : isArtis ? '#bfcfbf' : 'rgba(113,113,122,0.3)';
  const pageBg = isLight ? '#f4f4f8' : isArtis ? '#f2f5f2' : '#2a2a2f';

  // Farbwerte für Nav-Einträge, abhängig vom Theme
  const pal = {
    text: isLight ? '#526071' : isArtis ? '#48584a' : '#a1a1aa',
    faint: isLight ? '#8a97a8' : isArtis ? '#7e917f' : '#71717a',
    hover: isLight ? '#dcdde8' : isArtis ? '#d8e4d8' : 'rgba(63,63,70,.55)',
    active: isArtis ? '#7a9b7f' : '#7c3aed',
    searchBg: isLight ? '#ffffff' : isArtis ? '#f4f8f4' : 'rgba(63,63,70,.4)',
  };

  const railItems = NAV_GROUPS.flatMap(g => visibleItems(g.items, profile).filter(i => i.rail));

  // Favoriten (Sterne) — erscheinen als eigener Block zwischen Dashboard und Arbeit
  const favApps = useFavorites(profile);

  // Prevent flash of content if still loading auth
  if (loading) return <div className="h-screen w-screen flex items-center justify-center" style={{ backgroundColor: pageBg }}>...</div>;

  return (
      <ThemeContext.Provider value={{ theme, setTheme, navLayout, setNavLayout, hubWidgets, setHubWidgets, hubOpenMode, setHubOpenMode, layoutMode, viewportClass }}>
        <ChartisNotifier />
        <div className="flex h-screen overflow-hidden" style={{ backgroundColor: pageBg }}>

          {/* Start-Hub-Modus: schwebender, verschiebbarer Zurück-zum-Hub-Knopf */}
          {hubMode && location.pathname !== '/Hub' && (
              <HubChip pal={pal} sidebarBorder={sidebarBorder} lightBg={isLight || isArtis} />
          )}

          {/* Sidebar - Desktop Only & Not for Task Users */}
          {!isTaskUser && !isMobile && !hubMode && (
              <aside
                  className="flex-shrink-0 flex flex-col border-r transition-all duration-200"
                  style={{ width: railMode ? 56 : 232, backgroundColor: sidebarBg, borderColor: sidebarBorder }}
              >
                {/* Kopf: App-Name + Umschalter breit/schmal */}
                <div
                    className="flex items-center flex-shrink-0"
                    style={{
                      padding: railMode ? '12px 0 6px' : '12px 10px 6px',
                      justifyContent: railMode ? 'center' : 'space-between',
                    }}
                >
                  {!railMode && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                          background: pal.active, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 800,
                        }}>S</div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: pal.text, whiteSpace: 'nowrap' }}>
                          Smartis
                        </span>
                      </div>
                  )}
                  <button
                      onClick={toggleRailMode}
                      title={railMode ? 'Navigation ausklappen' : 'Navigation einklappen'}
                      style={{
                        width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: 'transparent', color: pal.faint,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onMouseOver={e => { e.currentTarget.style.background = pal.hover; }}
                      onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {railMode
                        ? <PanelLeftOpen style={{ width: 16, height: 16 }} />
                        : <PanelLeftClose style={{ width: 16, height: 16 }} />}
                  </button>
                </div>

                {/* Suche → öffnet den App-Launcher */}
                {railMode ? (
                    <button
                        onClick={() => setLauncherOpen(true)}
                        title="App suchen (Ctrl+K)"
                        style={{
                          width: 40, height: 40, margin: '0 auto 6px', borderRadius: 8,
                          border: 'none', cursor: 'pointer', background: 'transparent', color: pal.text,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        onMouseOver={e => { e.currentTarget.style.background = pal.hover; }}
                        onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Search style={{ width: 19, height: 19 }} />
                    </button>
                ) : (
                    <button
                        onClick={() => setLauncherOpen(true)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          margin: '2px 8px 6px', padding: '7px 10px', borderRadius: 9,
                          border: `1px solid ${sidebarBorder}`, cursor: 'pointer',
                          background: pal.searchBg, color: pal.faint, fontSize: 12.5, textAlign: 'left',
                        }}
                        onMouseOver={e => { e.currentTarget.style.borderColor = pal.active; }}
                        onMouseOut={e => { e.currentTarget.style.borderColor = sidebarBorder; }}
                    >
                      <Search style={{ width: 14, height: 14, flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>App suchen…</span>
                      <kbd style={{
                        fontSize: 9.5, fontWeight: 700, fontFamily: 'inherit',
                        border: `1px solid ${sidebarBorder}`, borderBottomWidth: 2,
                        borderRadius: 5, padding: '1px 5px',
                      }}>Ctrl K</kbd>
                    </button>
                )}

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: 10 }}>
                  {railMode
                      ? railItems.map(item => (
                          <NavRow
                              key={item.label}
                              item={item}
                              active={item.name ? currentPageName === item.name : false}
                              collapsed
                              pal={pal}
                          />
                      ))
                      : NAV_GROUPS.map(group => {
                          const items = visibleItems(group.items, profile);
                          if (!items.length) return null;
                          return (
                              <React.Fragment key={group.id}>
                                <div>
                                  {group.label && (
                                      <GroupHeader
                                          label={group.label}
                                          open={isGroupOpen(group.id)}
                                          onToggle={() => toggleGroup(group.id)}
                                          pal={pal}
                                          count={items.length}
                                      />
                                  )}
                                  {(!group.label || isGroupOpen(group.id)) && items.map(item => (
                                      <NavRow
                                          key={item.label}
                                          item={item}
                                          active={item.name ? currentPageName === item.name : false}
                                          collapsed={false}
                                          pal={pal}
                                      />
                                  ))}
                                </div>
                                {/* Favoriten-Block direkt nach Dashboard */}
                                {group.id === 'start' && favApps.length > 0 && (
                                    <div>
                                      <GroupHeader
                                          label="★ Favoriten"
                                          open={isGroupOpen('favoriten')}
                                          onToggle={() => toggleGroup('favoriten')}
                                          pal={{ ...pal, faint: '#c9962e' }}
                                          count={favApps.length}
                                      />
                                      {isGroupOpen('favoriten') && favApps.map(app => (
                                          <NavRow
                                              key={`fav-${appKey(app)}`}
                                              item={app}
                                              active={app.name ? currentPageName === app.name : false}
                                              collapsed={false}
                                              pal={pal}
                                          />
                                      ))}
                                    </div>
                                )}
                              </React.Fragment>
                          );
                      })}
                </nav>

                {/* Fussbereich: KI-Assistent + Profil */}
                <div
                    className="flex-shrink-0"
                    style={{ borderTop: `1px solid ${sidebarBorder}`, padding: railMode ? '8px 0' : 8 }}
                >
                  <button
                      onClick={() => setVoiceOpen(v => !v)}
                      title="Smartis KI-Assistent (Ctrl+Shift+Space)"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9,
                        justifyContent: railMode ? 'center' : 'flex-start',
                        width: railMode ? 40 : '100%',
                        height: railMode ? 40 : 'auto',
                        padding: railMode ? 0 : '6px 10px',
                        margin: railMode ? '0 auto 4px' : '0 0 4px',
                        borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                        color: voiceOpen ? '#fff' : pal.text,
                        background: voiceOpen ? pal.active : 'transparent',
                        transition: 'background .12s',
                      }}
                      onMouseOver={e => { if (!voiceOpen) e.currentTarget.style.background = pal.hover; }}
                      onMouseOut={e => { if (!voiceOpen) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Mic style={{ width: railMode ? 19 : 16, height: railMode ? 19 : 16, flexShrink: 0 }} />
                    {!railMode && <span>KI-Assistent</span>}
                  </button>

                  {/* Profile Menu */}
                  <div className="relative" ref={menuRef} style={{ display: 'flex', justifyContent: railMode ? 'center' : 'flex-start' }}>
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9,
                          width: railMode ? 'auto' : '100%',
                          padding: railMode ? 0 : '5px 8px',
                          borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: 'transparent', textAlign: 'left',
                        }}
                        onMouseOver={e => { e.currentTarget.style.background = pal.hover; }}
                        onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div
                          className="rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-semibold border border-indigo-500/30"
                          style={{ width: 30, height: 30, fontSize: 12, flexShrink: 0 }}
                      >
                        {profile?.full_name?.charAt(0) || profile?.email?.charAt(0)}
                      </div>
                      {!railMode && (
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: pal.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {profile?.full_name || profile?.email}
                            </div>
                            <div style={{ fontSize: 10.5, color: pal.faint }}>{profile?.role}</div>
                          </div>
                      )}
                    </button>

                    {menuOpen && (
                        <div
                            className="absolute w-52 rounded-md shadow-xl bg-zinc-900 border border-zinc-800 py-2 z-50 animate-in fade-in slide-in-from-left-2"
                            style={railMode ? { bottom: 0, left: 48 } : { bottom: '100%', left: 0, marginBottom: 6 }}
                        >
                          <div className="px-4 py-2 border-b border-zinc-800 mb-1">
                            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Benutzer</p>
                            <p className="text-sm font-medium text-zinc-200 truncate">{profile?.full_name || profile?.email}</p>
                            <p className="text-[10px] text-zinc-500 mt-1 italic">Role: {profile?.role}</p>
                            <p className="text-[10px] text-zinc-500 mt-1 italic">Version: {packageJson.version}</p>
                          </div>

                          <button
                              onClick={handleLogout}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <LogOut size={14} />
                            Abmelden
                          </button>
                        </div>
                    )}
                  </div>
                </div>
              </aside>
          )}

          {/* Main Content Area */}
          <main className="flex-1 overflow-hidden relative" style={{ paddingBottom: isMobile && !isTaskUser ? 'calc(56px + env(safe-area-inset-bottom))' : 0 }}>
            {layoutMode === 'widescreen' ? (
              <Suspense fallback={<Outlet />}>
                <WorkspaceShell viewportClass={viewportClass} currentPageName={currentPageName}>
                  <Outlet />
                </WorkspaceShell>
              </Suspense>
            ) : (
              <Outlet />
            )}
          </main>

          {/* Favoriten-Dock rechts (Apps anpinnen via Stern im Launcher) */}
          {!isTaskUser && !isMobile && !hubMode && (
              <FavoritesDock
                  profile={profile}
                  sidebarBg={sidebarBg}
                  sidebarBorder={sidebarBorder}
                  faintColor={pal.faint}
              />
          )}

          {/* Mobile Navigation */}
          {isMobile && !isTaskUser && <BottomNav />}
        </div>

        {/* App-Launcher: Ctrl+K oder Klick aufs Suchfeld */}
        {!isTaskUser && !isMobile && (
            <AppLauncher
                open={launcherOpen}
                onClose={() => setLauncherOpen(false)}
                profile={profile}
                dark={!isLight && !isArtis}
            />
        )}

        {/* Voice Assistant Panel */}
        <VoiceAssistant open={voiceOpen && !isTaskUser && !isMobile} onClose={() => setVoiceOpen(false)} />

        {/* Task Reminder Popup – globale Erinnerungen unten rechts */}
        <TaskReminderPopup currentUser={profile} />
      </ThemeContext.Provider>
  );
}
