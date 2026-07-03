import React, { useState, useEffect, useRef, createContext, useCallback } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  Mail,
  CheckSquare,
  Settings as SettingsIcon,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarCheck,
  LifeBuoy,
  BookOpen,
  FolderOpen,
  FolderArchive,
  LogOut,
  Wrench,
  Mic,
  CloudUpload,
  BarChart3,
  Clock,
  BookMarked,
  BookText,
  Bot,
  MessageSquare,
  Receipt,
  FileText,
  FileCheck,
  FileSignature,
  Landmark,
  Database,
  Archive,
  Percent,
  Scale,
  PenLine,
  Presentation,
  BookUser,
  Car,
  Sparkles,
  ScrollText,
  PhoneCall,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from "lucide-react";
import { FEATURE_LEISTUNGSERFASSUNG } from "@/lib/featureFlags";
import VoiceAssistant from "@/components/voice/VoiceAssistant";
import TaskReminderPopup from "@/components/tasks/TaskReminderPopup";
import BottomNav from "@/components/mobile/BottomNav";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { useAuth } from '@/lib/AuthContext';
import * as packageJson from "../package.json";

// Theme context for global access if needed elsewhere
export const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });

// ── Navigations-Katalog ────────────────────────────────────────────
// `name`       → MailFlow-Seite (Route /<Name>)
// `fibu`       → Unterseite im FiBu-Modul, geöffnet mit dem zuletzt benutzten Mandanten
// `rail`       → erscheint auch in der schmalen Icon-Leiste (eingeklappter Modus)
// `requiresAi` → nur sichtbar wenn profile.modules.ai aktiv ist
const NAV_GROUPS = [
  {
    id: 'start', label: null, items: [
      { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, rail: true },
    ],
  },
  {
    id: 'arbeit', label: 'Arbeit', items: [
      { name: 'MailKanban', label: 'Mails', icon: Mail, rail: true },
      { name: 'TaskBoard', label: 'Tasks', icon: CheckSquare, rail: true },
      { name: 'Chartis', label: 'Chartis', icon: MessageSquare, rail: true },
      { name: 'TicketBoard', label: 'Tickets', icon: LifeBuoy, rail: true },
      { name: 'Fristen', label: 'Fristen', icon: CalendarClock, rail: true },
      { name: 'Kalender', label: 'Kalender', icon: CalendarDays },
      ...(FEATURE_LEISTUNGSERFASSUNG ? [{ name: 'Leistungserfassung', label: 'Leistungserfassung', icon: Clock, rail: true }] : []),
    ],
  },
  {
    id: 'kunden', label: 'Kunden', items: [
      { name: 'Kunden', label: 'Kunden', icon: Building2, rail: true },
      { name: 'Personen', label: 'Personen', icon: Users },
      { name: 'Dokumente', label: 'Dokumente', icon: FolderOpen, rail: true },
      { name: 'DokumenteV2', label: 'Dokumente V2', icon: FolderOpen },
      { name: 'Posteingang', label: 'Posteingang', icon: CloudUpload, rail: true },
      { name: 'TelefonDashboard', label: 'Telefon', icon: PhoneCall },
    ],
  },
  {
    id: 'fibu', label: 'Buchhaltung', items: [
      { fibu: null, label: 'Mandanten', icon: BookMarked, rail: true },
      { fibu: 'kreditoren/uebersicht', label: 'Kreditoren', icon: Receipt },
      { fibu: 'debitoren/uebersicht', label: 'Debitoren', icon: FileText },
      { fibu: 'bankabstimmung', label: 'E-Banking', icon: Landmark },
      { fibu: 'kreditoren/journal', label: 'Auswertungen FiBu', icon: BookText },
      { fibu: 'jahresabschluss', label: 'Jahresabschluss', icon: FolderArchive },
      { fibu: 'manuelle-buchungen', label: 'Hauptbuch', icon: BookOpen },
      { fibu: 'kontenplan', label: 'Stammdaten', icon: Database },
      { name: 'Anlagebuchhaltung', label: 'Anlagebuchhaltung', icon: Archive },
    ],
  },
  {
    id: 'steuern', label: 'Steuern', items: [
      { name: 'Steuern', label: 'Steuererklärungen', icon: Percent },
      { name: 'Veranlagungen', label: 'Veranlagungen', icon: FileCheck },
      { name: 'Steuerausscheidung', label: 'Steuerausscheidung', icon: Scale },
    ],
  },
  {
    id: 'planung', label: 'Planung & Auswertung', items: [
      { name: 'Auswertungen', label: 'Auswertungen', icon: BarChart3, rail: true },
      { name: 'Jahresplanung', label: 'Jahresplanung', icon: CalendarRange },
      { name: 'Monatsplanung', label: 'Einsatzplanung', icon: CalendarCheck },
      { name: 'Abschlussdokumentation', label: 'Abschlussdokumentation', icon: FolderArchive },
    ],
  },
  {
    id: 'tools', label: 'Tools', items: [
      { name: 'BriefSchreiben', label: 'Briefe schreiben', icon: PenLine },
      { name: 'Whiteboard', label: 'Whiteboard', icon: Presentation },
      { name: 'GVProtokollApp', label: 'GV-Protokoll', icon: ScrollText },
      { name: 'Aktienbuch', label: 'Aktienbuch', icon: BookUser },
      { name: 'Fahrzeugliste', label: 'Fahrzeugliste', icon: Car },
      { name: 'Unterschriften', label: 'Unterschriften', icon: FileSignature },
      { name: 'Promptvorlagen', label: 'Promptvorlagen', icon: Sparkles },
      { name: 'ArtisTools', label: 'Alle Tools', icon: Wrench, rail: true },
    ],
  },
  {
    id: 'system', label: null, items: [
      { name: 'KnowledgeBase', label: 'Wissen', icon: BookOpen, rail: true },
      { name: 'AiAssistant', label: 'AI-Assistant', icon: Bot, rail: true, requiresAi: true },
      { name: 'Settings', label: 'Einstellungen', icon: SettingsIcon, rail: true },
    ],
  },
];

// Gruppen, die beim ersten Start aufgeklappt sind
const DEFAULT_OPEN = { start: true, arbeit: true, kunden: true, fibu: true, steuern: false, planung: false, tools: false, system: true };

// FiBu-Links öffnen den zuletzt benutzten Mandanten direkt;
// ohne bekannten Mandanten landet man auf der Mandanten-Auswahl.
function fibuHref(sub) {
  const id = localStorage.getItem('fibu_last_mandant');
  if (!id || !sub) return '/fibu';
  return `/fibu/${id}/${sub}`;
}

function itemHref(item) {
  if (item.name) return item.href ?? createPageUrl(item.name);
  return fibuHref(item.fibu);
}

// ── Einzelner Navigations-Eintrag ──────────────────────────────────
function NavRow({ item, active, collapsed, pal }) {
  const [hover, setHover] = useState(false);
  const Icon = item.icon;
  return (
    <Link
      to={itemHref(item)}
      title={collapsed ? item.label : undefined}
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
      <Icon style={{ width: collapsed ? 19 : 16, height: collapsed ? 19 : 16, flexShrink: 0 }} />
      {!collapsed && (
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
        </span>
      )}
    </Link>
  );
}

// ── Gruppen-Überschrift mit Auf-/Zuklappen ─────────────────────────
function GroupHeader({ label, open, onToggle, pal }) {
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

  // --- Sidebar-Modus: breit (Labels + Gruppen) oder schmale Icon-Leiste ---
  const [railMode, setRailMode] = useState(() => localStorage.getItem("nav_mode") === "rail");
  const toggleRailMode = () => {
    setRailMode(prev => {
      localStorage.setItem("nav_mode", prev ? "wide" : "rail");
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
      return next;
    });
  };

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

  // --- UI Helpers ---
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- Electron Hotkey: Shift+Ctrl+S → neuer Task ---
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
  };

  // AI-Modul nur anzeigen, wenn freigeschaltet
  const visibleItems = (items) => items.filter(it => !it.requiresAi || profile?.modules?.ai);
  const railItems = NAV_GROUPS.flatMap(g => visibleItems(g.items).filter(i => i.rail));

  // Prevent flash of content if still loading auth
  if (loading) return <div className="h-screen w-screen flex items-center justify-center" style={{ backgroundColor: pageBg }}>...</div>;

  return (
      <ThemeContext.Provider value={{ theme, setTheme }}>
        <div className="flex h-screen overflow-hidden" style={{ backgroundColor: pageBg }}>

          {/* Sidebar - Desktop Only & Not for Task Users */}
          {!isTaskUser && !isMobile && (
              <aside
                  className="flex-shrink-0 flex flex-col border-r transition-all duration-200"
                  style={{ width: railMode ? 56 : 232, backgroundColor: sidebarBg, borderColor: sidebarBorder }}
              >
                {/* Kopf: App-Name + Umschalter breit/schmal */}
                <div
                    className="flex items-center flex-shrink-0"
                    style={{
                      padding: railMode ? '12px 0 8px' : '12px 10px 8px',
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
                          const items = visibleItems(group.items);
                          if (!items.length) return null;
                          return (
                              <div key={group.id}>
                                {group.label && (
                                    <GroupHeader
                                        label={group.label}
                                        open={isGroupOpen(group.id)}
                                        onToggle={() => toggleGroup(group.id)}
                                        pal={pal}
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
          <main className="flex-1 overflow-hidden relative" style={{ paddingBottom: isMobile && !isTaskUser ? 56 : 0 }}>
            <Outlet />
          </main>

          {/* Mobile Navigation */}
          {isMobile && !isTaskUser && <BottomNav />}
        </div>

        {/* Voice Assistant Panel */}
        <VoiceAssistant open={voiceOpen && !isTaskUser && !isMobile} onClose={() => setVoiceOpen(false)} />

        {/* Task Reminder Popup – globale Erinnerungen unten rechts */}
        <TaskReminderPopup currentUser={profile} />
      </ThemeContext.Provider>
  );
}
