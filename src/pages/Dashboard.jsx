import React, { useState, useMemo, useEffect } from "react";
import { entities, functions, auth, supabase } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import {
  Mail,
  CheckSquare,
  User,
  AlertCircle,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, isToday, isPast } from "date-fns";
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

  // Second task area state
  const [secondaryColumnIds, setSecondaryColumnIds] = useState(null); // null = use defaults
  const [secondaryPriorityFilter, setSecondaryPriorityFilter] = useState("all");

  // Configurable stat card (column + priority); persisted in localStorage
  const [statCardColumnId, setStatCardColumnId] = useState(() => {
    try { return localStorage.getItem('dashboard.statCard.columnId') || 'all'; } catch { return 'all'; }
  });
  const [statCardPriorityId, setStatCardPriorityId] = useState(() => {
    try { return localStorage.getItem('dashboard.statCard.priorityId') || 'all'; } catch { return 'all'; }
  });

  // Mobile-Tab (welcher Bereich sichtbar ist), persistiert
  const [mobileTab, setMobileTab] = useState(() => {
    try { return localStorage.getItem('dashboard.mobileTab') || 'tasks'; } catch { return 'tasks'; }
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

  // Default selection for secondary area: first 3 columns by order
  const effectiveSecondaryColumnIds = useMemo(() => {
    if (secondaryColumnIds !== null) return secondaryColumnIds;
    return taskColumns.slice(0, 3).map(c => c.id);
  }, [secondaryColumnIds, taskColumns]);

  const secondaryFiltered = useMemo(() => {
    let result = visibleTasks;
    if (secondaryPriorityFilter !== "all") {
      result = result.filter(t => t.priority_id === secondaryPriorityFilter);
    }
    return result;
  }, [visibleTasks, secondaryPriorityFilter]);

  // Statistics
  const stats = {
    totalOpenTasks: visibleTasks.length,
    totalUnreadMails: mails.filter(m => !m.is_read && !m.is_completed).length,
    overdueTasks: visibleTasks.filter(t => t.due_date && isPast(new Date(t.due_date))).length,
    todayTasks: visibleTasks.filter(t => t.due_date && isToday(new Date(t.due_date))).length,
    highPriorityMails: mails.filter(m => !m.is_read && !m.is_completed && m.priority === 'high').length,
  };

  // Configurable stat card derived values
  useEffect(() => {
    try { localStorage.setItem('dashboard.statCard.columnId', statCardColumnId); } catch {}
  }, [statCardColumnId]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.statCard.priorityId', statCardPriorityId); } catch {}
  }, [statCardPriorityId]);
  useEffect(() => {
    try { localStorage.setItem('dashboard.mobileTab', mobileTab); } catch {}
  }, [mobileTab]);

  const statCardColumn = statCardColumnId === 'all' ? null : taskColumns.find(c => c.id === statCardColumnId);
  const statCardPriority = statCardPriorityId === 'all' ? null : priorityById.get(statCardPriorityId);
  const statCardColumnLabel = statCardColumn?.name || 'Alle Spalten';
  const statCardPriorityLabel = statCardPriority?.name || 'Alle Prioritäten';
  const statCardPriorityColor = statCardPriority?.color || '#f97316';
  const statCardCount = visibleTasks.filter(t =>
    (statCardColumnId === 'all' || t.column_id === statCardColumnId) &&
    (statCardPriorityId === 'all' || t.priority_id === statCardPriorityId)
  ).length;

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

  const toggleSecondaryColumn = (colId) => {
    const current = effectiveSecondaryColumnIds;
    const next = current.includes(colId)
      ? current.filter(id => id !== colId)
      : [...current, colId];
    setSecondaryColumnIds(next);
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

        {/* Statistics Cards (mobile: horizontal snap-scroll) */}
        <div
          className={
            isMobile
              ? 'flex gap-3 overflow-x-auto snap-x snap-mandatory mb-4 -mx-3 px-3 pb-1 [&>*]:snap-start [&>*]:shrink-0 [&>*]:w-[82%]'
              : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8'
          }
        >
          <div className={`rounded-xl border ${isMobile ? 'p-4' : 'p-6'}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: textMuted }}>Offene Tasks</p>
                <p className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold mt-2`} style={{ color: headingColor }}>{stats.totalOpenTasks}</p>
              </div>
              <CheckSquare className={`${isMobile ? 'h-9 w-9' : 'h-12 w-12'} opacity-20`} style={{ color: accentColor }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <span className="text-red-500 font-medium">{stats.overdueTasks} überfällig</span>
              <span className="text-amber-500 font-medium">{stats.todayTasks} heute</span>
            </div>
          </div>

          <div className={`rounded-xl border ${isMobile ? 'p-4' : 'p-6'}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: textMuted }}>Ungelesene E-Mails</p>
                <p className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold mt-2`} style={{ color: headingColor }}>{stats.totalUnreadMails}</p>
              </div>
              <Mail className={`${isMobile ? 'h-9 w-9' : 'h-12 w-12'} opacity-20`} style={{ color: mailColor }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <span className="text-orange-500 font-medium">{stats.highPriorityMails} hohe Priorität</span>
            </div>
          </div>

          <div className={`rounded-xl border ${isMobile ? 'p-4' : 'p-6'}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm" style={{ color: textMuted }}>
                  {statCardColumnLabel} · {statCardPriorityLabel}
                </p>
                <p className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold mt-2`} style={{ color: headingColor }}>
                  {statCardCount}
                </p>
              </div>
              <AlertCircle className={`${isMobile ? 'h-9 w-9' : 'h-12 w-12'} opacity-20 flex-shrink-0`} style={{ color: statCardPriorityColor }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                    <Columns3 className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[120px]">{statCardColumnLabel}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                  <DropdownMenuItem onClick={() => setStatCardColumnId('all')} style={{ color: dropdownText }}>
                    Alle Spalten
                  </DropdownMenuItem>
                  {taskColumns.map((col) => (
                    <DropdownMenuItem key={col.id} onClick={() => setStatCardColumnId(col.id)} style={{ color: dropdownText }}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color || accentColor }} />
                        {col.name}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" style={filterBtnStyle}>
                    <Filter className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[120px]">{statCardPriorityLabel}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                  <DropdownMenuItem onClick={() => setStatCardPriorityId('all')} style={{ color: dropdownText }}>
                    Alle Prioritäten
                  </DropdownMenuItem>
                  {priorities.map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => setStatCardPriorityId(p.id)} style={{ color: dropdownText }}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Mobile Pill-Tabs */}
        {isMobile && (
          <div className="sticky top-0 z-10 -mx-3 px-3 py-2 mb-3 backdrop-blur" style={{ backgroundColor: cardBg, borderBottom: `1px solid ${cardBorder}` }}>
            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
              {[
                { id: 'tasks', label: 'Tasks', count: filteredTasks.length },
                { id: 'mails', label: 'E-Mails', count: filteredMails.length },
                ...(showCalendar ? [{ id: 'termine', label: 'Termine', count: calendarEvents.length }] : []),
                { id: 'spalten', label: 'Spalten', count: null },
              ].map(({ id, label, count }) => {
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
              })}
            </div>
          </div>
        )}

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

        {/* Filters (primary task list) */}
        <div className={`flex flex-wrap items-center ${isMobile ? 'gap-2 mb-4' : 'gap-3 mb-6'} ${isMobile && mobileTab !== 'tasks' ? 'hidden' : ''}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size={isMobile ? 'sm' : 'default'} className="gap-2" style={filterBtnStyle}>
                <User className="h-4 w-4" />
                <span className="truncate max-w-[160px]">
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
              <Button variant="outline" size={isMobile ? 'sm' : 'default'} className="gap-2" style={filterBtnStyle}>
                <Filter className="h-4 w-4" />
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
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setPriorityFilter(p.id)}
                  style={{ color: dropdownText }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className={`grid grid-cols-1 lg:grid-cols-2 ${isMobile ? 'gap-4' : 'gap-6'} ${isMobile && mobileTab !== 'tasks' && mobileTab !== 'mails' ? 'hidden' : ''}`}>
          {/* Tasks Section */}
          <div className={`rounded-xl border ${isMobile ? 'p-4' : 'p-6'} ${isMobile && mobileTab !== 'tasks' ? 'hidden' : ''}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between mb-4 gap-2">
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
                  <DropdownMenuItem onClick={() => setTaskSortBy("due_date")} style={{ color: dropdownText }}>
                    Nach Fälligkeit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTaskSortBy("priority")} style={{ color: dropdownText }}>
                    Nach Priorität
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTaskSortBy("created_date")} style={{ color: dropdownText }}>
                    Nach Erstelldatum
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
              {filteredTasks.length === 0 ? (
                <div className="text-center py-8" style={{ color: textMuted }}>
                  Keine offenen Tasks
                </div>
              ) : (
                filteredTasks.map((task) => renderTaskCard(task))
              )}
            </div>
          </div>

          {/* Mails Section */}
          <div className={`rounded-xl border ${isMobile ? 'p-4' : 'p-6'} ${isMobile && mobileTab !== 'mails' ? 'hidden' : ''}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
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
                  <DropdownMenuItem onClick={() => setMailSortBy("received_date")} style={{ color: dropdownText }}>
                    Nach Datum
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMailSortBy("priority")} style={{ color: dropdownText }}>
                    Nach Priorität
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className={`space-y-2 ${isMobile ? 'max-h-[420px]' : 'max-h-[600px]'} overflow-y-auto`}>
              {filteredMails.length === 0 ? (
                <div className="text-center py-8" style={{ color: textMuted }}>
                  Keine ungelesenen E-Mails
                </div>
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
                        <div className="text-sm font-semibold mb-1 truncate" style={{ color: headingColor }}>
                          {mail.subject}
                        </div>
                        <div className="text-xs mb-2 font-medium truncate" style={{ color: textMuted }}>
                          Von: {mail.sender_name}
                        </div>
                        {mail.body_preview && (
                          <div className="text-xs line-clamp-2" style={{ color: textMuted }}>
                            {mail.body_preview}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center gap-1 text-xs" style={{ color: textMuted }}>
                            <Clock className="h-3 w-3" />
                            {format(new Date(mail.received_date), 'dd.MM.yyyy HH:mm', { locale: de })}
                          </div>
                        </div>
                      </div>
                      {mail.priority === 'high' && (
                        <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 flex-shrink-0">
                          Hoch
                        </Badge>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sekundärer Task-Bereich: Spalten-Auswahl + Priorität */}
        <div className={`rounded-xl border ${isMobile ? 'p-4 mt-4' : 'p-6 mt-8'} ${isMobile && mobileTab !== 'spalten' ? 'hidden' : ''}`} style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold flex items-center gap-2 min-w-0`} style={{ color: headingColor }}>
              <Columns3 className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} style={{ color: accentColor }} />
              <span className="truncate">Tasks nach Spalte</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" style={filterBtnStyle}>
                    <Columns3 className="h-4 w-4" />
                    Spalten
                    <span className="bg-indigo-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {effectiveSecondaryColumnIds.length}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                  {taskColumns.length === 0 && (
                    <DropdownMenuItem disabled style={{ color: textMuted }}>Keine Spalten</DropdownMenuItem>
                  )}
                  {taskColumns.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={effectiveSecondaryColumnIds.includes(col.id)}
                      onCheckedChange={() => toggleSecondaryColumn(col.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color || accentColor }} />
                        {col.name}
                      </div>
                    </DropdownMenuCheckboxItem>
                  ))}
                  {taskColumns.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setSecondaryColumnIds(taskColumns.map(c => c.id))}
                        style={{ color: dropdownText }}
                      >
                        Alle anzeigen
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSecondaryColumnIds(null)}
                        style={{ color: dropdownText }}
                      >
                        Standard (erste 3)
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" style={filterBtnStyle}>
                    <Filter className="h-4 w-4" />
                    {secondaryPriorityFilter === "all"
                      ? "Alle Prioritäten"
                      : priorityById.get(secondaryPriorityFilter)?.name || "Priorität"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
                  <DropdownMenuItem onClick={() => setSecondaryPriorityFilter("all")} style={{ color: dropdownText }}>
                    Alle Prioritäten
                  </DropdownMenuItem>
                  {priorities.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => setSecondaryPriorityFilter(p.id)}
                      style={{ color: dropdownText }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {effectiveSecondaryColumnIds.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: textMuted }}>
              Keine Spalten ausgewählt
            </div>
          ) : (
            <div
              className={`grid gap-3 ${
                isMobile
                  ? 'grid-cols-1'
                  : effectiveSecondaryColumnIds.length === 1
                  ? 'grid-cols-1'
                  : effectiveSecondaryColumnIds.length === 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {taskColumns
                .filter(c => effectiveSecondaryColumnIds.includes(c.id))
                .map((col) => {
                  const colTasks = secondaryFiltered.filter(t => t.column_id === col.id);
                  return (
                    <div
                      key={col.id}
                      className="rounded-lg border p-3"
                      style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: col.color || accentColor }} />
                          <div className="text-sm font-semibold truncate" style={{ color: headingColor }}>{col.name}</div>
                        </div>
                        <span className="text-xs" style={{ color: textMuted }}>{colTasks.length}</span>
                      </div>
                      <div className={`space-y-2 ${isMobile ? 'max-h-[260px]' : 'max-h-[420px]'} overflow-y-auto`}>
                        {colTasks.length === 0 ? (
                          <div className="text-center py-6 text-xs" style={{ color: textMuted }}>
                            Keine Tasks
                          </div>
                        ) : (
                          colTasks.map((task) => renderTaskCard(task))
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
