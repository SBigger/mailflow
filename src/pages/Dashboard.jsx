import React, { useState, useMemo, useEffect } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { GripVertical } from "lucide-react";
import { entities, functions, auth, supabase } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import {
  Mail,
  CheckSquare,
  User,
  Clock,
  Filter,
  ArrowUpDown,
  LayoutDashboard,
  Menu,
  ChevronDown,
  Settings as SettingsIcon,
  Columns3,
  CalendarDays,
  MapPin,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  SlidersHorizontal,
  CalendarClock,
  Inbox,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, isPast } from "date-fns";
import { de } from "date-fns/locale";
import { useTheme } from "@/components/useTheme";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import { leMs365Day } from "@/lib/leApi";

export default function Dashboard() {
  const isMobile = useIsMobile();

  const [selectedUser, setSelectedUser] = useState("all");
  const [taskSortBy, setTaskSortBy] = useState("due_date");
  const [mailSortBy, setMailSortBy] = useState("received_date");
  const [priorityFilter, setPriorityFilter] = useState("all"); // priority_id | "all"

  // Sekundärer Bereich: zwei Slots, je mit eigener Spalte + Priorität
  const [slotAColumnId, setSlotAColumnId] = useState(() => {
    try { return localStorage.getItem('dashboard.slotA.columnId') || ''; } catch { return ''; }
  });
  const [slotAPriorityId, setSlotAPriorityId] = useState(() => {
    try { return localStorage.getItem('dashboard.slotA.priorityId') || 'all'; } catch { return 'all'; }
  });
  const [slotBColumnId, setSlotBColumnId] = useState(() => {
    try { return localStorage.getItem('dashboard.slotB.columnId') || ''; } catch { return ''; }
  });
  const [slotBPriorityId, setSlotBPriorityId] = useState(() => {
    try { return localStorage.getItem('dashboard.slotB.priorityId') || 'all'; } catch { return 'all'; }
  });
  const [slotAUserEmail, setSlotAUserEmail] = useState(() => {
    try { return localStorage.getItem('dashboard.slotA.userEmail') || 'all'; } catch { return 'all'; }
  });
  const [slotBUserEmail, setSlotBUserEmail] = useState(() => {
    try { return localStorage.getItem('dashboard.slotB.userEmail') || 'all'; } catch { return 'all'; }
  });

  // Mobile-Tab (welcher Bereich sichtbar ist), persistiert
  const [mobileTab, setMobileTab] = useState(() => {
    try { return localStorage.getItem('dashboard.mobileTab') || 'tasks'; } catch { return 'tasks'; }
  });

  // Widget-Reihenfolge & Sichtbarkeit (persistiert)
  const DEFAULT_WIDGETS = [
    { id: 'tasks',   visible: true },
    { id: 'mails',   visible: true },
    { id: 'slotA',   visible: true },
    { id: 'slotB',   visible: true },
    { id: 'fristen', visible: true },
    { id: 'uploads', visible: true },
  ];
  const [widgets, setWidgets] = useState(() => {
    try {
      const raw = localStorage.getItem('dashboard.widgets');
      if (!raw) return DEFAULT_WIDGETS;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_WIDGETS;
      // sicherstellen, dass alle bekannten IDs enthalten sind
      const knownIds = DEFAULT_WIDGETS.map(w => w.id);
      const cleaned = parsed.filter(w => knownIds.includes(w.id));
      const missing = knownIds
        .filter(id => !cleaned.some(w => w.id === id))
        .map(id => ({ id, visible: true }));
      return [...cleaned, ...missing];
    } catch { return DEFAULT_WIDGETS; }
  });

  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isArtis = theme === 'artis';

  // Theme-aware color tokens
  const cardBg = isDark ? 'rgba(39,39,42,0.5)' : isArtis ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.85)';
  const cardBorder = isDark ? '#3f3f46' : isArtis ? '#bfcfbf' : '#d0d0dc';
  const headingColor = isDark ? '#e4e4e7' : isArtis ? '#1a3a1a' : '#1e293b';
  const textBody = isDark ? '#d4d4d8' : isArtis ? '#2d4a2d' : '#374151';
  const textMuted = isDark ? '#71717a' : isArtis ? '#5a7a5a' : '#6b7280';
  const accentColor = isDark ? '#818cf8' : isArtis ? '#7a9b7f' : '#7c3aed';
  const mailColor = isDark ? '#60a5fa' : isArtis ? '#5a8a6a' : '#3b82f6';
  const itemBg = isDark ? 'rgba(24,24,27,0.6)' : isArtis ? 'rgba(255,255,255,0.55)' : 'rgba(248,250,252,0.9)';
  const itemBorder = isDark ? 'rgba(63,63,70,0.5)' : isArtis ? 'rgba(191,207,191,0.6)' : 'rgba(203,213,225,0.6)';
  const dropdownBg = isDark ? '#18181b' : isArtis ? '#eaf0ea' : '#ffffff';
  const dropdownBorder = isDark ? '#27272a' : isArtis ? '#bfcfbf' : '#e2e8f0';
  const dropdownText = isDark ? '#d4d4d8' : isArtis ? '#1a3a1a' : '#374151';
  const itemHoverClass = isDark ? 'hover:bg-zinc-800/50' : isArtis ? 'hover:bg-green-50' : 'hover:bg-slate-50';
  const filterBtnStyle = {
    borderColor: cardBorder,
    color: textBody,
    backgroundColor: 'transparent',
  };
  const navBtnStyle = {
    borderColor: isDark ? 'rgba(99,102,241,0.5)' : isArtis ? 'rgba(122,155,127,0.5)' : 'rgba(124,58,237,0.4)',
    backgroundColor: isDark ? 'rgba(99,102,241,0.1)' : isArtis ? 'rgba(122,155,127,0.08)' : 'rgba(124,58,237,0.07)',
    color: headingColor,
  };

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  // Use the same user source as TaskBoard for consistency with assignee email values
  const { data: allUsers = [] } = useQuery({
    queryKey: ["allUsers", currentUser?.email],
    queryFn: async () => {
      try {
        const res = await functions.invoke('getAllUsers');
        const users = res.data?.users || [];
        return users;
      } catch {
        return [];
      }
    },
    enabled: !!currentUser,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.Task.list("order");
    },
    enabled: !!currentUser,
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });

  const { data: taskColumns = [] } = useQuery({
    queryKey: ["taskColumns"],
    queryFn: () => entities.TaskColumn.list("order"),
  });

  const { data: mails = [] } = useQuery({
    queryKey: ["mailItems", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.MailItem.filter({ created_by: currentUser.id }, "-received_date");
    },
    enabled: !!currentUser,
  });

  // Fristen + Customers (für Fristen- und Uploads-Widget)
  const { data: fristen = [] } = useQuery({
    queryKey: ["fristen"],
    queryFn: () => entities.Frist.list("due_date"),
    enabled: !!currentUser,
  });

  const { data: customersList = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
    enabled: !!currentUser,
  });

  // Kunden-Uploads aus Storage-Bucket "posteingang" (Files = noch nicht abgelegt)
  const { data: pendingUploads = [] } = useQuery({
    queryKey: ["dashboard", "pendingUploads"],
    queryFn: async () => {
      const { data: folders, error: folderErr } = await supabase.storage.from('posteingang').list();
      if (folderErr) return [];
      const all = await Promise.all(
        (folders || []).map(async (folder) => {
          const { data: files } = await supabase.storage.from('posteingang').list(folder.name);
          return (files || []).map(f => ({
            id: `${folder.name}/${f.name}`,
            customer_id: folder.name,
            file_name: (f.name.split('@')[1]) || f.name,
            created_at: f.created_at || f.updated_at,
          }));
        })
      );
      return all.flat().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    },
    enabled: !!currentUser,
    staleTime: 60_000,
  });

  // Termine: read-only über bestehende MS365-Sync; nichts einrichten
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const ms365Q = useQuery({
    queryKey: ['dashboard', 'ms365-day', todayIso],
    queryFn: () => leMs365Day(todayIso),
    enabled: !!currentUser,
    staleTime: 60_000,
    retry: false,
  });
  const ms365 = ms365Q.data ?? { calendar: [], notConnected: false };
  const calendarEvents = ms365.calendar || [];
  const showCalendar = !ms365.notConnected && ms365Q.isSuccess;

  const priorityById = useMemo(() => {
    const map = new Map();
    for (const p of priorities) map.set(p.id, p);
    return map;
  }, [priorities]);

  const visibleTasks = useMemo(() => tasks.filter(t => !t.completed), [tasks]);

  // Filter and sort tasks (primary list)
  const filteredTasks = useMemo(() => {
    let result = visibleTasks;

    if (selectedUser !== "all") {
      result = result.filter(t => t.assignee === selectedUser);
    }

    if (priorityFilter !== "all") {
      result = result.filter(t => t.priority_id === priorityFilter);
    }

    result = [...result].sort((a, b) => {
      if (taskSortBy === "due_date") {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
      } else if (taskSortBy === "priority") {
        const la = priorityById.get(a.priority_id)?.level ?? 999;
        const lb = priorityById.get(b.priority_id)?.level ?? 999;
        return la - lb;
      } else if (taskSortBy === "created_date") {
        return new Date(b.created_at || b.created_date || 0) - new Date(a.created_at || a.created_date || 0);
      }
      return 0;
    });

    return result;
  }, [visibleTasks, selectedUser, priorityFilter, taskSortBy, priorityById]);

  // Filter and sort mails
  const filteredMails = useMemo(() => {
    let result = mails.filter(m => !m.is_read && !m.is_completed);

    result = [...result].sort((a, b) => {
      if (mailSortBy === "received_date") {
        return new Date(b.received_date) - new Date(a.received_date);
      } else if (mailSortBy === "priority") {
        const order = { high: 0, normal: 1, low: 2 };
        return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
      }
      return 0;
    });

    return result;
  }, [mails, mailSortBy]);

  // Default-Spalten für Slots A/B (erste zwei Kanban-Spalten)
  const effectiveSlotAColumnId = slotAColumnId || taskColumns[0]?.id || '';
  const effectiveSlotBColumnId = slotBColumnId || taskColumns[1]?.id || taskColumns[0]?.id || '';

  const slotTasks = (columnId, priorityId, userEmail) =>
    visibleTasks.filter(t =>
      t.column_id === columnId &&
      (priorityId === 'all' || t.priority_id === priorityId) &&
      (userEmail === 'all' || t.assignee === userEmail || t.verantwortlich === userEmail)
    );

  useEffect(() => {
    try { localStorage.setItem('dashboard.mobileTab', mobileTab); } catch {}
  }, [mobileTab]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.slotA.columnId', slotAColumnId); } catch {}
  }, [slotAColumnId]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.slotA.priorityId', slotAPriorityId); } catch {}
  }, [slotAPriorityId]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.slotB.columnId', slotBColumnId); } catch {}
  }, [slotBColumnId]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.slotB.priorityId', slotBPriorityId); } catch {}
  }, [slotBPriorityId]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.slotA.userEmail', slotAUserEmail); } catch {}
  }, [slotAUserEmail]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.slotB.userEmail', slotBUserEmail); } catch {}
  }, [slotBUserEmail]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.widgets', JSON.stringify(widgets)); } catch {}
  }, [widgets]);

  const handleWidgetDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination || destination.index === source.index) return;
    setWidgets(prev => {
      // Reorder operiert auf der GESAMTEN Liste, aber Drag basiert auf gefilterten (visible).
      // → Mappen wir source/destination Indices auf die Indizes in `prev`.
      const visibleIds = prev.filter(w => w.visible).map(w => w.id);
      const movedId = visibleIds[source.index];
      const targetId = visibleIds[destination.index];
      const fromIdx = prev.findIndex(w => w.id === movedId);
      const toIdx = prev.findIndex(w => w.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const moveWidget = (id, direction) => {
    setWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const toggleWidget = (id) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  };

  const widgetMeta = {
    tasks:   { label: 'Offene Tasks',     icon: CheckSquare },
    mails:   { label: 'Ungelesene Mails', icon: Mail },
    slotA:   { label: 'Spalte A',         icon: Columns3 },
    slotB:   { label: 'Spalte B',         icon: Columns3 },
    fristen: { label: 'Fristen (20 Tage)',icon: CalendarClock },
    uploads: { label: 'Kunden-Uploads',   icon: Inbox },
  };

  // Fristen die in den nächsten 20 Tagen ablaufen (oder überfällig sind), nur offen
  const upcomingFristen = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = new Date(today); horizon.setDate(horizon.getDate() + 20);
    return fristen
      .filter(f => f.status === 'offen' && f.due_date)
      .map(f => ({ ...f, _due: new Date(f.due_date) }))
      .filter(f => f._due <= horizon)
      .sort((a, b) => a._due - b._due);
  }, [fristen]);

  const customerById = useMemo(() => {
    const m = new Map();
    for (const c of customersList) m.set(c.id, c);
    return m;
  }, [customersList]);

  const userByEmail = useMemo(() => {
    const m = new Map();
    for (const u of allUsers) m.set(u.email, u);
    if (currentUser?.email) m.set(currentUser.email, { ...(m.get(currentUser.email) || {}), email: currentUser.email, full_name: currentUser.full_name || currentUser.email });
    return m;
  }, [allUsers, currentUser]);

  const userDisplayName = (email) => userByEmail.get(email)?.full_name || email || 'Unbekannt';

  const renderTaskCard = (task) => {
    const isOverdue = task.due_date && isPast(new Date(task.due_date));
    const prio = priorityById.get(task.priority_id);
    return (
      <Link
        key={task.id}
        to={createPageUrl('TaskBoard')}
        className={`block p-3 rounded-lg border transition-colors ${itemHoverClass}`}
        style={{ backgroundColor: itemBg, borderColor: itemBorder }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold mb-1 truncate" style={{ color: headingColor }}>
              {task.title}
            </div>
            {task.description && (
              <div className="text-xs line-clamp-1" style={{ color: textMuted }}>
                {task.description}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
              {task.assignee && (
                <div className="flex items-center gap-1 text-xs" style={{ color: textMuted }}>
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{userDisplayName(task.assignee)}</span>
                </div>
              )}
              {task.due_date && (
                <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : ''}`}
                  style={!isOverdue ? { color: textMuted } : {}}>
                  <Clock className="h-3 w-3" />
                  {format(new Date(task.due_date), 'dd.MM.yyyy', { locale: de })}
                </div>
              )}
            </div>
          </div>
          {prio && (
            <Badge
              variant="outline"
              className="text-xs flex-shrink-0"
              style={{
                backgroundColor: `${prio.color}22`,
                color: prio.color,
                borderColor: `${prio.color}66`,
              }}
            >
              {prio.name}
            </Badge>
          )}
        </div>
      </Link>
    );
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    try { return format(new Date(iso), 'HH:mm'); } catch { return ''; }
  };

  const containerPadding = isMobile ? 'p-3' : 'p-6';

  return (
    <div className={`h-screen overflow-y-auto ${containerPadding}`}>
      <div className="max-w-7xl mx-auto">
        {/* Navigation Dropdown */}
        <div className={isMobile ? 'mb-3' : 'mb-6'}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="gap-2"
                style={navBtnStyle}
              >
                <Menu className="h-4 w-4" />
                Dashboard
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
              <DropdownMenuItem asChild>
                <Link
                  to={createPageUrl('MailKanban')}
                  className="cursor-pointer flex items-center gap-2"
                  style={{ color: dropdownText }}
                >
                  <Mail className="h-4 w-4" />
                  Mailverwaltung
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to={createPageUrl('TaskBoard')}
                  className="cursor-pointer flex items-center gap-2"
                  style={{ color: dropdownText }}
                >
                  <CheckSquare className="h-4 w-4" />
                  Task-Verwaltung
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  to={createPageUrl('Settings')}
                  className="cursor-pointer flex items-center gap-2"
                  style={{ color: dropdownText }}
                >
                  <SettingsIcon className="h-4 w-4" />
                  Einstellungen
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Header */}
        <div className={`flex items-center gap-3 ${isMobile ? 'mb-4' : 'mb-8'}`}>
          <LayoutDashboard className={isMobile ? 'h-6 w-6' : 'h-8 w-8'} style={{ color: accentColor }} />
          <div>
            <h1 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold`} style={{ color: headingColor }}>Dashboard</h1>
            {!isMobile && (
              <p className="text-sm" style={{ color: textMuted }}>Übersicht über alle Tasks und E-Mails</p>
            )}
          </div>
        </div>

        {/* Widget-Toolbar: Mobile-Pills + Verwalten-Menü */}
        <div
          className={`flex items-center gap-2 mb-3 ${isMobile ? 'sticky top-0 z-10 -mx-3 px-3 py-2 backdrop-blur' : ''}`}
          style={isMobile ? { backgroundColor: cardBg, borderBottom: `1px solid ${cardBorder}` } : {}}
        >
          {isMobile && (
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 flex-1">
              {(() => {
                const slotCount = (sCol, sPrio, sUser) => {
                  const c = taskColumns.find(x => x.id === sCol);
                  return c ? slotTasks(c.id, sPrio, sUser).length : 0;
                };
                const widgetPill = (id) => {
                  if (id === 'tasks') return { id, label: 'Tasks', count: filteredTasks.length };
                  if (id === 'mails') return { id, label: 'E-Mails', count: filteredMails.length };
                  if (id === 'slotA') {
                    const col = taskColumns.find(c => c.id === effectiveSlotAColumnId);
                    return { id, label: col?.name || 'Spalte A', count: slotCount(effectiveSlotAColumnId, slotAPriorityId, slotAUserEmail) };
                  }
                  if (id === 'slotB') {
                    const col = taskColumns.find(c => c.id === effectiveSlotBColumnId);
                    return { id, label: col?.name || 'Spalte B', count: slotCount(effectiveSlotBColumnId, slotBPriorityId, slotBUserEmail) };
                  }
                  if (id === 'fristen') return { id, label: 'Fristen', count: upcomingFristen.length };
                  if (id === 'uploads') return { id, label: 'Uploads', count: pendingUploads.length };
                  return null;
                };
                const pills = [
                  ...(showCalendar ? [{ id: 'termine', label: 'Termine', count: calendarEvents.length }] : []),
                  ...widgets.filter(w => w.visible).map(w => widgetPill(w.id)).filter(Boolean),
                ];
                return pills.map(({ id, label, count }) => {
                  const active = mobileTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setMobileTab(id)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 touch-manipulation"
                      style={{
                        backgroundColor: active ? accentColor : 'transparent',
                        color: active ? '#ffffff' : textBody,
                        border: `1px solid ${active ? accentColor : cardBorder}`,
                      }}
                    >
                      {label}
                      {count !== null && count !== undefined && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: active ? 'rgba(255,255,255,0.25)' : itemBg,
                            color: active ? '#ffffff' : textMuted,
                          }}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                });
              })()}
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={`gap-2 ${isMobile ? 'flex-shrink-0' : 'ml-auto'}`} style={filterBtnStyle}>
                <SlidersHorizontal className="h-4 w-4" />
                <span className={isMobile ? 'sr-only' : ''}>Widgets</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72" style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: textMuted }}>
                Reihenfolge & Sichtbarkeit
              </div>
              {widgets.map((w, idx) => {
                const meta = widgetMeta[w.id];
                const Icon = meta?.icon || Columns3;
                return (
                  <div key={w.id} className="flex items-center gap-1.5 px-2 py-1.5">
                    <button
                      onClick={() => toggleWidget(w.id)}
                      className="p-1.5 rounded hover:bg-black/5"
                      title={w.visible ? 'Ausblenden' : 'Einblenden'}
                      style={{ color: w.visible ? accentColor : textMuted }}
                    >
                      {w.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <Icon className="h-4 w-4 flex-shrink-0" style={{ color: textMuted }} />
                    <span className="flex-1 text-sm truncate" style={{ color: dropdownText }}>
                      {meta?.label || w.id}
                    </span>
                    <button
                      onClick={() => moveWidget(w.id, 'up')}
                      disabled={idx === 0}
                      className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30"
                      style={{ color: textMuted }}
                      title="Nach oben"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => moveWidget(w.id, 'down')}
                      disabled={idx === widgets.length - 1}
                      className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30"
                      style={{ color: textMuted }}
                      title="Nach unten"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Termine (read-only Outlook) */}
        {showCalendar && (!isMobile || mobileTab === 'termine') && (
          <div className={`rounded-xl border ${isMobile ? 'p-4 mb-4' : 'p-6 mb-8'}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold mb-4 flex items-center gap-2`} style={{ color: headingColor }}>
              <CalendarDays className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: accentColor }} />
              Termine heute ({calendarEvents.length})
            </h2>
            {ms365.calendarError ? (
              <div className="text-xs" style={{ color: textMuted }}>
                Termine konnten nicht geladen werden: {ms365.calendarError}
              </div>
            ) : calendarEvents.length === 0 ? (
              <div className="text-center py-4 text-sm" style={{ color: textMuted }}>
                Keine Termine heute
              </div>
            ) : (
              <div className={`grid grid-cols-1 ${isMobile ? '' : 'md:grid-cols-2 lg:grid-cols-3'} gap-2`}>
                {calendarEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="rounded-lg p-3 border"
                    style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                  >
                    <div className="flex items-center gap-2 text-xs font-medium mb-1" style={{ color: accentColor }}>
                      <Clock className="h-3 w-3" />
                      {evt.isAllDay ? 'Ganztägig' : `${formatTime(evt.start)} – ${formatTime(evt.end)}`}
                    </div>
                    <div className="text-sm font-semibold mb-1 truncate" style={{ color: headingColor }}>
                      {evt.subject || '(Ohne Titel)'}
                    </div>
                    {evt.location && (
                      <div className="flex items-center gap-1 text-xs truncate" style={{ color: textMuted }}>
                        <MapPin className="h-3 w-3" />
                        {evt.location}
                      </div>
                    )}
                    {evt.customer?.company_name && (
                      <div className="text-xs mt-1 truncate" style={{ color: textMuted }}>
                        {evt.customer.company_name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Widgets-Grid (Drag-and-Drop sortierbar auf Desktop) */}
        <DragDropContext onDragEnd={handleWidgetDragEnd}>
          <Droppable droppableId="dashboard-widgets" direction="vertical" isDropDisabled={isMobile}>
            {(droppableProvided) => (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className={`grid grid-cols-1 lg:grid-cols-2 ${isMobile ? 'gap-4' : 'gap-6'}`}
              >
                {widgets.filter(w => w.visible).map((w, dragIndex) => {
                  const hideOnMobile = isMobile && mobileTab !== w.id;

            if (w.id === 'tasks') {
              return (
                <Draggable key={w.id} draggableId={w.id} index={dragIndex} isDragDisabled={isMobile}>
                  {(dp) => (
                <div
                  ref={dp.innerRef}
                  {...dp.draggableProps}
                  className={`${hideOnMobile ? 'hidden' : ''} rounded-xl border ${isMobile ? 'p-4' : 'p-6'} relative`}
                  style={{ backgroundColor: cardBg, borderColor: cardBorder, ...dp.draggableProps.style }}
                >
                  {!isMobile && (
                    <div {...dp.dragHandleProps} className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded opacity-30 hover:opacity-100 transition-opacity z-[1]" title="Verschieben">
                      <GripVertical className="h-4 w-4" style={{ color: textMuted }} />
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2 min-w-0`} style={{ color: headingColor }}>
                      <CheckSquare className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: accentColor }} />
                      <span className="truncate">Offene Tasks ({filteredTasks.length})</span>
                    </h2>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 flex-shrink-0" style={{ color: textMuted }}>
                          <ArrowUpDown className="h-4 w-4" />
                          {taskSortBy === "due_date" ? "Fälligkeit" : taskSortBy === "priority" ? "Priorität" : "Erstellt"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                        <DropdownMenuItem onClick={() => setTaskSortBy("due_date")} style={{ color: dropdownText }}>Nach Fälligkeit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTaskSortBy("priority")} style={{ color: dropdownText }}>Nach Priorität</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTaskSortBy("created_date")} style={{ color: dropdownText }}>Nach Erstelldatum</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                          <User className="h-3.5 w-3.5" />
                          <span className="truncate max-w-[140px]">
                            {selectedUser === "all" ? "Alle Mitarbeiter" : userDisplayName(selectedUser)}
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                        <DropdownMenuItem onClick={() => setSelectedUser("all")} style={{ color: dropdownText }}>
                          Alle Mitarbeiter
                        </DropdownMenuItem>
                        {allUsers.map((user) => (
                          <DropdownMenuItem key={user.id || user.email} onClick={() => setSelectedUser(user.email)} style={{ color: dropdownText }}>
                            {user.full_name || user.email}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                          <Filter className="h-3.5 w-3.5" />
                          {priorityFilter === "all"
                            ? "Alle Prioritäten"
                            : priorityById.get(priorityFilter)?.name || "Priorität"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                        <DropdownMenuItem onClick={() => setPriorityFilter("all")} style={{ color: dropdownText }}>
                          Alle Prioritäten
                        </DropdownMenuItem>
                        {priorities.map((p) => (
                          <DropdownMenuItem key={p.id} onClick={() => setPriorityFilter(p.id)} style={{ color: dropdownText }}>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                              {p.name}
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
                    {filteredTasks.length === 0 ? (
                      <div className="text-center py-8" style={{ color: textMuted }}>Keine offenen Tasks</div>
                    ) : (
                      filteredTasks.map((task) => renderTaskCard(task))
                    )}
                  </div>
                </div>
                  )}
                </Draggable>
              );
            }

            if (w.id === 'mails') {
              return (
                <Draggable key={w.id} draggableId={w.id} index={dragIndex} isDragDisabled={isMobile}>
                  {(dp) => (
                <div
                  ref={dp.innerRef}
                  {...dp.draggableProps}
                  className={`${hideOnMobile ? 'hidden' : ''} rounded-xl border ${isMobile ? 'p-4' : 'p-6'} relative`}
                  style={{ backgroundColor: cardBg, borderColor: cardBorder, ...dp.draggableProps.style }}
                >
                  {!isMobile && (
                    <div {...dp.dragHandleProps} className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded opacity-30 hover:opacity-100 transition-opacity z-[1]" title="Verschieben">
                      <GripVertical className="h-4 w-4" style={{ color: textMuted }} />
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2 min-w-0`} style={{ color: headingColor }}>
                      <Mail className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: mailColor }} />
                      <span className="truncate">Ungelesene E-Mails ({filteredMails.length})</span>
                    </h2>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 flex-shrink-0" style={{ color: textMuted }}>
                          <ArrowUpDown className="h-4 w-4" />
                          {mailSortBy === "received_date" ? "Datum" : "Priorität"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                        <DropdownMenuItem onClick={() => setMailSortBy("received_date")} style={{ color: dropdownText }}>Nach Datum</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMailSortBy("priority")} style={{ color: dropdownText }}>Nach Priorität</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
                    {filteredMails.length === 0 ? (
                      <div className="text-center py-8" style={{ color: textMuted }}>Keine ungelesenen E-Mails</div>
                    ) : (
                      filteredMails.map((mail) => (
                        <Link
                          key={mail.id}
                          to={createPageUrl('MailKanban')}
                          className={`block p-3 rounded-lg border transition-colors ${itemHoverClass}`}
                          style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold mb-1 truncate" style={{ color: headingColor }}>{mail.subject}</div>
                              <div className="text-xs mb-2 font-medium truncate" style={{ color: textMuted }}>Von: {mail.sender_name}</div>
                              {mail.body_preview && (
                                <div className="text-xs line-clamp-2" style={{ color: textMuted }}>{mail.body_preview}</div>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                <div className="flex items-center gap-1 text-xs" style={{ color: textMuted }}>
                                  <Clock className="h-3 w-3" />
                                  {format(new Date(mail.received_date), 'dd.MM.yyyy HH:mm', { locale: de })}
                                </div>
                              </div>
                            </div>
                            {mail.priority === 'high' && (
                              <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 flex-shrink-0">Hoch</Badge>
                            )}
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
                  )}
                </Draggable>
              );
            }

            if (w.id === 'fristen') {
              return (
                <Draggable key={w.id} draggableId={w.id} index={dragIndex} isDragDisabled={isMobile}>
                  {(dp) => (
                <div
                  ref={dp.innerRef}
                  {...dp.draggableProps}
                  className={`${hideOnMobile ? 'hidden' : ''} rounded-xl border ${isMobile ? 'p-4' : 'p-6'} relative`}
                  style={{ backgroundColor: cardBg, borderColor: cardBorder, ...dp.draggableProps.style }}
                >
                  {!isMobile && (
                    <div {...dp.dragHandleProps} className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded opacity-30 hover:opacity-100 transition-opacity z-[1]" title="Verschieben">
                      <GripVertical className="h-4 w-4" style={{ color: textMuted }} />
                    </div>
                  )}
                  <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2 min-w-0 mb-3`} style={{ color: headingColor }}>
                    <CalendarClock className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: accentColor }} />
                    <span className="truncate">Fristen (≤ 20 Tage) ({upcomingFristen.length})</span>
                  </h2>

                  <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
                    {upcomingFristen.length === 0 ? (
                      <div className="text-center py-8 text-sm" style={{ color: textMuted }}>
                        Keine Fristen in den nächsten 20 Tagen
                      </div>
                    ) : (
                      upcomingFristen.map((f) => {
                        const cust = customerById.get(f.customer_id);
                        const isOverdue = f._due < new Date(new Date().setHours(0,0,0,0));
                        const today = new Date(); today.setHours(0,0,0,0);
                        const days = Math.round((f._due - today) / (1000 * 60 * 60 * 24));
                        return (
                          <Link
                            key={f.id}
                            to={createPageUrl('Fristen')}
                            className={`block p-3 rounded-lg border transition-colors ${itemHoverClass}`}
                            style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold mb-1 truncate" style={{ color: headingColor }}>
                                  {f.title}
                                </div>
                                {(cust?.company_name || f.kanton || f.category) && (
                                  <div className="text-xs truncate" style={{ color: textMuted }}>
                                    {[cust?.company_name, f.category, f.kanton].filter(Boolean).join(' · ')}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mt-2">
                                  <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : ''}`}
                                    style={!isOverdue ? { color: textMuted } : {}}>
                                    <Clock className="h-3 w-3" />
                                    {format(f._due, 'dd.MM.yyyy', { locale: de })}
                                  </div>
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className="text-xs flex-shrink-0"
                                style={{
                                  backgroundColor: isOverdue ? 'rgba(239,68,68,0.1)' : days <= 5 ? 'rgba(245,158,11,0.1)' : 'transparent',
                                  color: isOverdue ? '#ef4444' : days <= 5 ? '#f59e0b' : textMuted,
                                  borderColor: isOverdue ? 'rgba(239,68,68,0.3)' : days <= 5 ? 'rgba(245,158,11,0.3)' : itemBorder,
                                }}
                              >
                                {isOverdue ? 'überfällig' : days === 0 ? 'heute' : `${days}T`}
                              </Badge>
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
                  )}
                </Draggable>
              );
            }

            if (w.id === 'uploads') {
              return (
                <Draggable key={w.id} draggableId={w.id} index={dragIndex} isDragDisabled={isMobile}>
                  {(dp) => (
                <div
                  ref={dp.innerRef}
                  {...dp.draggableProps}
                  className={`${hideOnMobile ? 'hidden' : ''} rounded-xl border ${isMobile ? 'p-4' : 'p-6'} relative`}
                  style={{ backgroundColor: cardBg, borderColor: cardBorder, ...dp.draggableProps.style }}
                >
                  {!isMobile && (
                    <div {...dp.dragHandleProps} className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded opacity-30 hover:opacity-100 transition-opacity z-[1]" title="Verschieben">
                      <GripVertical className="h-4 w-4" style={{ color: textMuted }} />
                    </div>
                  )}
                  <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2 min-w-0 mb-3`} style={{ color: headingColor }}>
                    <Inbox className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: accentColor }} />
                    <span className="truncate">Kunden-Uploads (nicht abgelegt) ({pendingUploads.length})</span>
                  </h2>

                  <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
                    {pendingUploads.length === 0 ? (
                      <div className="text-center py-8 text-sm" style={{ color: textMuted }}>
                        Keine offenen Uploads
                      </div>
                    ) : (
                      pendingUploads.map((u) => {
                        const cust = customerById.get(u.customer_id);
                        return (
                          <Link
                            key={u.id}
                            to={createPageUrl('Posteingang')}
                            className={`block p-3 rounded-lg border transition-colors ${itemHoverClass}`}
                            style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-sm font-semibold mb-1 min-w-0" style={{ color: headingColor }}>
                                  <FileText className="h-3.5 w-3.5 flex-shrink-0" style={{ color: textMuted }} />
                                  <span className="truncate">{u.file_name}</span>
                                </div>
                                <div className="text-xs truncate" style={{ color: textMuted }}>
                                  {cust?.company_name || `Kunde: ${u.customer_id}`}
                                </div>
                                {u.created_at && (
                                  <div className="flex items-center gap-1 text-xs mt-2" style={{ color: textMuted }}>
                                    <Clock className="h-3 w-3" />
                                    {format(new Date(u.created_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
                  )}
                </Draggable>
              );
            }

            // Slot-Widgets (slotA / slotB)
            const isA = w.id === 'slotA';
            const slot = {
              columnId: isA ? effectiveSlotAColumnId : effectiveSlotBColumnId,
              priorityId: isA ? slotAPriorityId : slotBPriorityId,
              userEmail: isA ? slotAUserEmail : slotBUserEmail,
              setColumnId: isA ? setSlotAColumnId : setSlotBColumnId,
              setPriorityId: isA ? setSlotAPriorityId : setSlotBPriorityId,
              setUserEmail: isA ? setSlotAUserEmail : setSlotBUserEmail,
            };
            const col = taskColumns.find(c => c.id === slot.columnId);
            const prio = slot.priorityId === 'all' ? null : priorityById.get(slot.priorityId);
            const slotUserName = slot.userEmail === 'all' ? null : userDisplayName(slot.userEmail);
            const colTasks = col ? slotTasks(col.id, slot.priorityId, slot.userEmail) : [];
            return (
              <Draggable key={w.id} draggableId={w.id} index={dragIndex} isDragDisabled={isMobile}>
                {(dp) => (
              <div
                ref={dp.innerRef}
                {...dp.draggableProps}
                className={`${hideOnMobile ? 'hidden' : ''} rounded-xl border ${isMobile ? 'p-4' : 'p-6'} relative`}
                style={{ backgroundColor: cardBg, borderColor: cardBorder, ...dp.draggableProps.style }}
              >
                {!isMobile && (
                  <div {...dp.dragHandleProps} className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded opacity-30 hover:opacity-100 transition-opacity z-[1]" title="Verschieben">
                    <GripVertical className="h-4 w-4" style={{ color: textMuted }} />
                  </div>
                )}
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2 min-w-0`} style={{ color: headingColor }}>
                    <Columns3 className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: accentColor }} />
                    <span className="truncate">{col?.name || (isA ? 'Spalte A' : 'Spalte B')} ({colTasks.length})</span>
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                        <Columns3 className="h-3.5 w-3.5" />
                        {col ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color || accentColor }} />
                            <span className="truncate max-w-[140px]">{col.name}</span>
                          </div>
                        ) : (
                          <span>Spalte wählen</span>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                      {taskColumns.length === 0 && (
                        <DropdownMenuItem disabled style={{ color: textMuted }}>Keine Spalten</DropdownMenuItem>
                      )}
                      {taskColumns.map((c) => (
                        <DropdownMenuItem key={c.id} onClick={() => slot.setColumnId(c.id)} style={{ color: dropdownText }}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color || accentColor }} />
                            {c.name}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                        <Filter className="h-3.5 w-3.5" />
                        {prio ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: prio.color }} />
                            <span className="truncate max-w-[120px]">{prio.name}</span>
                          </div>
                        ) : (
                          <span>Alle Prioritäten</span>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                      <DropdownMenuItem onClick={() => slot.setPriorityId('all')} style={{ color: dropdownText }}>
                        Alle Prioritäten
                      </DropdownMenuItem>
                      {priorities.map((p) => (
                        <DropdownMenuItem key={p.id} onClick={() => slot.setPriorityId(p.id)} style={{ color: dropdownText }}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                            {p.name}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                        <User className="h-3.5 w-3.5" />
                        <span className="truncate max-w-[140px]">{slotUserName || 'Alle Personen'}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                      <DropdownMenuItem onClick={() => slot.setUserEmail('all')} style={{ color: dropdownText }}>
                        Alle Personen
                      </DropdownMenuItem>
                      {currentUser?.email && (
                        <DropdownMenuItem onClick={() => slot.setUserEmail(currentUser.email)} style={{ color: dropdownText }}>
                          {currentUser.full_name || currentUser.email} (ich)
                        </DropdownMenuItem>
                      )}
                      {allUsers
                        .filter(u => u.email && u.email !== currentUser?.email)
                        .map((u) => (
                          <DropdownMenuItem key={u.id || u.email} onClick={() => slot.setUserEmail(u.email)} style={{ color: dropdownText }}>
                            {u.full_name || u.email}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
                  {!col ? (
                    <div className="text-center py-8 text-sm" style={{ color: textMuted }}>Bitte Spalte wählen</div>
                  ) : colTasks.length === 0 ? (
                    <div className="text-center py-8 text-sm" style={{ color: textMuted }}>Keine Tasks</div>
                  ) : (
                    colTasks.map((task) => renderTaskCard(task))
                  )}
                </div>
              </div>
                )}
              </Draggable>
            );
          })}
                {droppableProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  );
}
