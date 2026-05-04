import React, { useState, useEffect, useRef, createContext, useContext, useMemo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  Mail,
  CheckSquare,
  Settings as SettingsIcon,
  Building2,
  CalendarClock,
  LifeBuoy,
  BookOpen,
  GripVertical,
  FolderOpen,
  LogOut,
  Wrench,
  Mic,
  CloudUpload,
  BarChart3,
  Clock,
  BookMarked,
  CalendarDays,
  CalendarRange
} from "lucide-react";
import { FEATURE_LEISTUNGSERFASSUNG } from "@/lib/featureFlags";
import VoiceAssistant from "@/components/voice/VoiceAssistant";
import TaskReminderPopup from "@/components/tasks/TaskReminderPopup";
import BottomNav from "@/components/mobile/BottomNav";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useAuth } from '@/lib/AuthContext';
import * as packageJson from "../package.json";

// Theme context for global access if needed elsewhere
export const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });

export default function Layout({ children, currentPageName }) {
  const { signOut, profile, loading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const menuRef = useRef(null);

  // --- Theme State ---
  const [theme, setThemeState] = useState(() => localStorage.getItem("app_theme") || "artis");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem("app_theme", newTheme);
  }, []);

  // --- Navigation Order Persistence ---
  const [navOrder, setNavOrder] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nav_order")) || null;
    } catch {
      return null;
    }
  });

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

  // --- Navigation Config ---
  const isTaskUser = profile?.role === 'task_user';

  const navItems = useMemo(() => isTaskUser ? [] : [
    { name: 'Dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
    { name: 'MailKanban',     icon: Mail,            label: 'Mails' },
    { name: 'TaskBoard',      icon: CheckSquare,     label: 'Tasks' },
    { name: 'TicketBoard',    icon: LifeBuoy,        label: 'Tickets' },
    { name: 'KnowledgeBase',  icon: BookOpen,        label: 'Wissen' },
    { name: 'Fristen',        icon: CalendarClock,   label: 'Fristen' },
    { name: 'Kunden',         icon: Building2,       label: 'Kunden' },
    { name: 'Dokumente',      icon: FolderOpen,      label: 'Dokumente' },
    { name: 'Posteingang',    icon: CloudUpload,     label: 'Posteingang' },
    { name: 'Auswertungen',   icon: BarChart3,       label: 'Auswertungen' },
    ...(FEATURE_LEISTUNGSERFASSUNG ? [{ name: 'Leistungserfassung', icon: Clock, label: 'Leistungserfassung' }] : []),
    { name: 'FiBu',           icon: BookMarked,      label: 'Buchhaltung', href: '/fibu' },
    { name: 'ArtisTools',     icon: Wrench,          label: 'Artis Tools' },
    { name: 'Settings',       icon: SettingsIcon,    label: 'Einstellungen' },
  ], [isTaskUser]);

  const orderedNavItems = useMemo(() => {
    if (!navOrder || navOrder.length === 0) return navItems;
    const orderMap = new Map(navOrder.map((name, idx) => [name, idx]));
    return [...navItems].sort((a, b) => {
      const ai = orderMap.has(a.name) ? orderMap.get(a.name) : 999;
      const bi = orderMap.has(b.name) ? orderMap.get(b.name) : 999;
      return ai - bi;
    });
  }, [navItems, navOrder]);

  const handleNavDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(orderedNavItems);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    const newOrder = items.map(item => item.name);
    setNavOrder(newOrder);
    localStorage.setItem("nav_order", JSON.stringify(newOrder));
  };

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

  // Prevent flash of content if still loading auth
  if (loading) return <div className="h-screen w-screen flex items-center justify-center" style={{ backgroundColor: pageBg }}>...</div>;

  return (
      <ThemeContext.Provider value={{ theme, setTheme }}>
        <div className="flex h-screen overflow-hidden" style={{ backgroundColor: pageBg }}>

          {/* Sidebar - Desktop Only & Not for Task Users */}
          {!isTaskUser && !isMobile && (
              <aside
                  className="w-14 flex-shrink-0 flex flex-col items-center justify-between py-4 border-r transition-colors duration-300"
                  style={{ backgroundColor: sidebarBg, borderColor: sidebarBorder }}
              >
                <DragDropContext onDragEnd={handleNavDragEnd}>
                  <Droppable droppableId="sidebar-nav">
                    {(provided) => (
                        <nav
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex flex-col items-center gap-2 w-full"
                        >
                          {orderedNavItems.map(({ name, icon: Icon, label, href }, index) => (
                              <Draggable key={name} draggableId={name} index={index}>
                                {(dragProvided, dragSnapshot) => (
                                    <div
                                        ref={dragProvided.innerRef}
                                        {...dragProvided.draggableProps}
                                        className="relative group flex items-center justify-center w-full px-1"
                                        style={dragProvided.draggableProps.style}
                                    >
                                      <div
                                          {...dragProvided.dragHandleProps}
                                          className="absolute left-0 opacity-0 group-hover:opacity-40 transition-opacity cursor-grab"
                                          style={{ color: isLight ? '#64748b' : isArtis ? '#6b826b' : '#71717a' }}
                                      >
                                        <GripVertical className="h-3 w-3" />
                                      </div>

                                      <Link
                                          to={href ?? createPageUrl(name)}
                                          title={label}
                                          className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 ${
                                              currentPageName === name
                                                  ? 'text-white shadow-md'
                                                  : isLight
                                                      ? 'text-slate-500 hover:bg-slate-200'
                                                      : isArtis
                                                          ? 'text-slate-500 hover:bg-green-100'
                                                          : 'text-zinc-500 hover:bg-zinc-800/60'
                                          }`}
                                          style={currentPageName === name ? { backgroundColor: isArtis ? '#7a9b7f' : '#7c3aed' } : {}}
                                      >
                                        <Icon className="h-5 w-5" />
                                      </Link>
                                    </div>
                                )}
                              </Draggable>
                          ))}
                          {provided.placeholder}
                        </nav>
                    )}
                  </Droppable>
                </DragDropContext>

                {/* Voice Assistant Button */}
                <button
                    onClick={() => setVoiceOpen(v => !v)}
                    title="Smartis KI-Assistent (Ctrl+Shift+Space)"
                    className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 ${
                        voiceOpen ? 'text-white shadow-md' : isLight ? 'text-slate-500 hover:bg-slate-200' : isArtis ? 'text-slate-500 hover:bg-green-100' : 'text-zinc-500 hover:bg-zinc-800/60'
                    }`}
                    style={voiceOpen ? { backgroundColor: isArtis ? '#7a9b7f' : '#7c3aed' } : {}}
                >
                    <Mic className="h-5 w-5" />
                </button>

                {/* Profile Menu */}
                <div className="relative" ref={menuRef}>
                  <button
                      onClick={() => setMenuOpen(!menuOpen)}
                      className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-sm font-semibold border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
                  >
                    {profile?.full_name?.charAt(0) || profile?.email?.charAt(0)}
                  </button>

                  {menuOpen && (
                      <div className="absolute bottom-0 left-14 mb-2 w-52 rounded-md shadow-xl bg-zinc-900 border border-zinc-800 py-2 z-50 animate-in fade-in slide-in-from-left-2">
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
              </aside>
          )}

          {/* Main Content Area */}
          <main className="flex-1 overflow-hidden relative" style={{ paddingBottom: isMobile && !isTaskUser ? 56 : 0 }}>
            {children}
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