import React, { useState, useEffect, createContext, useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { entities, functions, auth, supabase } from "@/api/supabaseClient";
import { LayoutDashboard, Mail, CheckSquare, Settings as SettingsIcon, Building2, CalendarClock, LifeBuoy, BookOpen, GripVertical } from "lucide-react";
import BottomNav from "@/components/mobile/BottomNav";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

// Theme context
export const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });

export default function Layout({ children, currentPageName, onMailFilterAction, onShowCompletedToggle, onRefresh, isSyncing }) {
  const location = useLocation();
  const [currentUser, setCurrentUser] = React.useState(null);
  const [theme, setThemeState] = React.useState(() => localStorage.getItem("app_theme") || "artis");

  // Nav order state - persisted in localStorage
  const [navOrder, setNavOrder] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nav_order") || "null") || null;
    } catch {
      return null;
    }
  });

  // Apply theme to <html> element
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = React.useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem("app_theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  }, []);

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;
        const { data: user } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
        setCurrentUser(user);
        // Apply profile theme from DB (DB wins unless user explicitly changed it this session)
        if (user?.theme) {
          const localTheme = localStorage.getItem("app_theme");
          // Only override if local theme matches default or is same as DB - DB is the source of truth
          if (!localTheme || localTheme === user.theme) {
            setTheme(user.theme);
          }
        }
        // Task-User automatisch zum TaskBoard weiterleiten
        if (user?.role === 'task_user' && currentPageName !== 'TaskBoard') {
          window.location.href = createPageUrl('TaskBoard');
        }
      } catch (e) {
        console.error('Failed to fetch user:', e);
      }
    };
    fetchUser();
  }, [currentPageName]);

  const getPageTitle = (pageName) => {
    switch (pageName) {
      case 'Dashboard': return 'Dashboard';
      case 'MailKanban': return 'Mailverwaltung';
      case 'TaskBoard': return 'Task-Verwaltung';
      case 'Settings': return 'Einstellungen';
      case 'PrioritySettings': return 'Prioritäten';
      default: return pageName;
    }
  };

  const currentTitle = getPageTitle(currentPageName);
  const isTaskUser = currentUser?.role === 'task_user';

  const navItems = isTaskUser ? [] : [
    { name: 'Dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
    { name: 'MailKanban',     icon: Mail,            label: 'Mails' },
    { name: 'TaskBoard',      icon: CheckSquare,     label: 'Tasks' },
    { name: 'TicketBoard',    icon: LifeBuoy,        label: 'Tickets' },
    { name: 'KnowledgeBase',  icon: BookOpen,        label: 'Wissen' },
    { name: 'Fristen',        icon: CalendarClock,   label: 'Fristen' },
    { name: 'Kunden',         icon: Building2,       label: 'Kunden' },
    { name: 'Settings',       icon: SettingsIcon,    label: 'Einstellungen' },
  ];

  // Sort navItems by saved order (if available)
  const orderedNavItems = React.useMemo(() => {
    if (!navOrder || navOrder.length === 0) return navItems;
    const orderMap = new Map(navOrder.map((name, idx) => [name, idx]));
    return [...navItems].sort((a, b) => {
      const ai = orderMap.has(a.name) ? orderMap.get(a.name) : 9999;
      const bi = orderMap.has(b.name) ? orderMap.get(b.name) : 9999;
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

  const isMobile = useIsMobile();
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

  const sidebarBg = isLight ? '#e8e8ef' : isArtis ? '#e6ede6' : '#2a2a2f';
  const sidebarBorder = isLight ? '#d0d0dc' : isArtis ? '#bfcfbf' : 'rgba(113,113,122,0.3)';
  const pageBg = isLight ? '#f4f4f8' : isArtis ? '#f2f5f2' : '#2a2a2f';

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: pageBg }}>
      {/* Sidebar - hidden on mobile */}
      {!isTaskUser && !isMobile && (
        <div
          className="w-14 flex-shrink-0 flex flex-col items-center py-4 gap-2 border-r"
          style={{ backgroundColor: sidebarBg, borderColor: sidebarBorder }}
        >
          <DragDropContext onDragEnd={handleNavDragEnd}>
            <Droppable droppableId="sidebar-nav" direction="vertical">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="flex flex-col items-center gap-2 w-full"
                >
                  {orderedNavItems.map(({ name, icon: Icon, label }, index) => (
                    <Draggable key={name} draggableId={name} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className="relative group flex items-center justify-center w-full"
                          style={{
                            ...dragProvided.draggableProps.style,
                            opacity: dragSnapshot.isDragging ? 0.85 : 1,
                          }}
                        >
                          {/* Drag handle - visible on hover */}
                          <div
                            {...dragProvided.dragHandleProps}
                            className="absolute left-0.5 opacity-0 group-hover:opacity-40 transition-opacity cursor-grab active:cursor-grabbing"
                            style={{ color: isLight ? '#64748b' : isArtis ? '#6b826b' : '#71717a' }}
                            title="Reihenfolge ändern"
                          >
                            <GripVertical className="h-3 w-3" />
                          </div>

                          <Link
                            to={createPageUrl(name)}
                            title={label}
                            className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                              currentPageName === name
                                ? 'text-white'
                                : isLight
                                ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-200'
                                : isArtis
                                ? 'text-slate-500 hover:text-slate-700 hover:bg-green-100'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
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
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}

      {/* Page Content */}
      <div className="flex-1 overflow-hidden" style={{ paddingBottom: isMobile && !isTaskUser ? 56 : 0 }}>
        {children}
      </div>

      {/* Bottom Nav - mobile only, not for task_user */}
      {isMobile && !isTaskUser && <BottomNav />}
    </div>
    </ThemeContext.Provider>
  );
}

