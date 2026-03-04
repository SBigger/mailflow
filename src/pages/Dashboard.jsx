import React, { useState, useMemo } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import {
  Mail,
  CheckSquare,
  User,
  AlertCircle,
  Clock,
  TrendingUp,
  Filter,
  ArrowUpDown,
  LayoutDashboard,
  Menu,
  ChevronDown,
  Settings as SettingsIcon
} from "lucide-react";
import { Card } from "@/components/ui/card";
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
import { format, isToday, isPast } from "date-fns";
import { de } from "date-fns/locale";
import { useTheme } from "@/components/useTheme";

export default function Dashboard() {
  const [selectedUser, setSelectedUser] = useState("all");
  const [taskSortBy, setTaskSortBy] = useState("due_date");
  const [mailSortBy, setMailSortBy] = useState("received_date");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

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
  const avatarBg = isDark ? 'rgba(129,140,248,0.15)' : isArtis ? 'rgba(122,155,127,0.18)' : 'rgba(124,58,237,0.1)';
  const avatarText = isDark ? '#a5b4fc' : isArtis ? '#3a6640' : '#7c3aed';
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

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => entities.User.list(),
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.Task.filter({ created_by: currentUser.id });
    },
    enabled: !!currentUser,
  });

  const { data: mails = [] } = useQuery({
    queryKey: ["mailItems", currentUser?.id],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.MailItem.filter({ created_by: currentUser.id }, "-received_date");
    },
    enabled: !!currentUser,
  });

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = tasks.filter(t => !t.completed);

    if (selectedUser !== "all") {
      result = result.filter(t => t.assignee === selectedUser);
    }

    if (priorityFilter !== "all") {
      result = result.filter(t => t.priority === priorityFilter);
    }

    // Sort
    result.sort((a, b) => {
      if (taskSortBy === "due_date") {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
      } else if (taskSortBy === "priority") {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      } else if (taskSortBy === "created_date") {
        return new Date(b.created_date) - new Date(a.created_date);
      }
      return 0;
    });

    return result;
  }, [tasks, selectedUser, priorityFilter, taskSortBy]);

  // Filter and sort mails
  const filteredMails = useMemo(() => {
    let result = mails.filter(m => !m.is_read && !m.is_completed);

    // Sort
    result.sort((a, b) => {
      if (mailSortBy === "received_date") {
        return new Date(b.received_date) - new Date(a.received_date);
      } else if (mailSortBy === "priority") {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return 0;
    });

    return result;
  }, [mails, mailSortBy]);

  // Statistics
  const stats = {
    totalOpenTasks: tasks.filter(t => !t.completed).length,
    totalUnreadMails: mails.filter(m => !m.is_read && !m.is_completed).length,
    overdueTasks: tasks.filter(t => !t.completed && t.due_date && isPast(new Date(t.due_date))).length,
    todayTasks: tasks.filter(t => !t.completed && t.due_date && isToday(new Date(t.due_date))).length,
    highPriorityTasks: tasks.filter(t => !t.completed && (t.priority === 'high' || t.priority === 'urgent')).length,
    highPriorityMails: mails.filter(m => !m.is_read && !m.is_completed && m.priority === 'high').length,
  };

  // Tasks by user
  const tasksByUser = useMemo(() => {
    const grouped = {};
    tasks.filter(t => !t.completed).forEach(task => {
      const assignee = task.assignee || 'Nicht zugewiesen';
      if (!grouped[assignee]) {
        grouped[assignee] = [];
      }
      grouped[assignee].push(task);
    });
    return grouped;
  }, [tasks]);

  const getPriorityColor = (priority) => {
    if (isDark) {
      switch (priority) {
        case 'urgent': return 'bg-red-500/20 text-red-300 border-red-500/30';
        case 'high': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
        case 'medium': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
        case 'low': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
        default: return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30';
      }
    } else {
      switch (priority) {
        case 'urgent': return 'bg-red-50 text-red-700 border-red-200';
        case 'high': return 'bg-orange-50 text-orange-700 border-orange-200';
        case 'medium': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
        case 'low': return 'bg-blue-50 text-blue-700 border-blue-200';
        default: return 'bg-gray-100 text-gray-600 border-gray-200';
      }
    }
  };

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto">
        {/* Navigation Dropdown */}
        <div className="mb-6">
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
        <div className="flex items-center gap-3 mb-8">
          <LayoutDashboard className="h-8 w-8" style={{ color: accentColor }} />
          <div>
            <h1 className="text-3xl font-bold" style={{ color: headingColor }}>Dashboard</h1>
            <p className="text-sm" style={{ color: textMuted }}>Übersicht über alle Tasks und E-Mails</p>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border p-6" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: textMuted }}>Offene Tasks</p>
                <p className="text-3xl font-bold mt-2" style={{ color: headingColor }}>{stats.totalOpenTasks}</p>
              </div>
              <CheckSquare className="h-12 w-12 opacity-20" style={{ color: accentColor }} />
            </div>
            <div className="mt-4 flex gap-4 text-xs">
              <span className="text-red-500 font-medium">{stats.overdueTasks} überfällig</span>
              <span className="text-amber-500 font-medium">{stats.todayTasks} heute</span>
            </div>
          </div>

          <div className="rounded-xl border p-6" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: textMuted }}>Ungelesene E-Mails</p>
                <p className="text-3xl font-bold mt-2" style={{ color: headingColor }}>{stats.totalUnreadMails}</p>
              </div>
              <Mail className="h-12 w-12 opacity-20" style={{ color: mailColor }} />
            </div>
            <div className="mt-4 flex gap-4 text-xs">
              <span className="text-orange-500 font-medium">{stats.highPriorityMails} hohe Priorität</span>
            </div>
          </div>

          <div className="rounded-xl border p-6" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: textMuted }}>Hohe Priorität</p>
                <p className="text-3xl font-bold mt-2" style={{ color: headingColor }}>{stats.highPriorityTasks}</p>
              </div>
              <AlertCircle className="h-12 w-12 opacity-20 text-orange-500" />
            </div>
            <div className="mt-4 flex gap-4 text-xs">
              <span style={{ color: textMuted }}>Tasks mit hoher/dringender Priorität</span>
            </div>
          </div>
        </div>

        {/* Tasks by User Overview */}
        <div className="rounded-xl border p-6 mb-8" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: headingColor }}>
            <User className="h-5 w-5" style={{ color: accentColor }} />
            Tasks pro Mitarbeiter
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(tasksByUser).map(([assignee, userTasks]) => {
              const user = users.find(u => u.email === assignee);
              const userName = user?.full_name || assignee;

              return (
                <div
                  key={assignee}
                  className="rounded-lg p-4 border"
                  style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm"
                      style={{ backgroundColor: avatarBg, color: avatarText }}
                    >
                      {userName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium" style={{ color: headingColor }}>{userName}</div>
                      <div className="text-xs" style={{ color: textMuted }}>{userTasks.length} offene Tasks</div>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-red-500 font-medium">
                      {userTasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length} dringend
                    </span>
                    <span className="text-amber-500 font-medium">
                      {userTasks.filter(t => t.due_date && isPast(new Date(t.due_date))).length} überfällig
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" style={filterBtnStyle}>
                <User className="h-4 w-4" />
                {selectedUser === "all" ? "Alle Mitarbeiter" : users.find(u => u.email === selectedUser)?.full_name || selectedUser}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
              <DropdownMenuItem onClick={() => setSelectedUser("all")} style={{ color: dropdownText }}>
                Alle Mitarbeiter
              </DropdownMenuItem>
              {users.map((user) => (
                <DropdownMenuItem key={user.id} onClick={() => setSelectedUser(user.email)} style={{ color: dropdownText }}>
                  {user.full_name || user.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" style={filterBtnStyle}>
                <Filter className="h-4 w-4" />
                {priorityFilter === "all" ? "Alle Prioritäten" : priorityFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ backgroundColor: dropdownBg, borderColor: dropdownBorder }}>
              <DropdownMenuItem onClick={() => setPriorityFilter("all")} style={{ color: dropdownText }}>
                Alle Prioritäten
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("urgent")} className="text-red-500">
                Dringend
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("high")} className="text-orange-500">
                Hoch
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("medium")} className="text-yellow-500">
                Mittel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("low")} className="text-blue-500">
                Niedrig
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tasks Section */}
          <div className="rounded-xl border p-6" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: headingColor }}>
                <CheckSquare className="h-5 w-5" style={{ color: accentColor }} />
                Offene Tasks ({filteredTasks.length})
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2" style={{ color: textMuted }}>
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

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredTasks.length === 0 ? (
                <div className="text-center py-8" style={{ color: textMuted }}>
                  Keine offenen Tasks
                </div>
              ) : (
                filteredTasks.map((task) => {
                  const user = users.find(u => u.email === task.assignee);
                  const isOverdue = task.due_date && isPast(new Date(task.due_date));

                  return (
                    <Link
                      key={task.id}
                      to={createPageUrl('TaskBoard')}
                      className={`block p-3 rounded-lg border transition-colors ${itemHoverClass}`}
                      style={{ backgroundColor: itemBg, borderColor: itemBorder }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-semibold mb-1" style={{ color: headingColor }}>
                            {task.title}
                          </div>
                          {task.description && (
                            <div className="text-xs line-clamp-1" style={{ color: textMuted }}>
                              {task.description}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            {task.assignee && (
                              <div className="flex items-center gap-1 text-xs" style={{ color: textMuted }}>
                                <User className="h-3 w-3" />
                                {user?.full_name || task.assignee}
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
                        <Badge variant="outline" className={`text-xs ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </Badge>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Mails Section */}
          <div className="rounded-xl border p-6" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: headingColor }}>
                <Mail className="h-5 w-5" style={{ color: mailColor }} />
                Ungelesene E-Mails ({filteredMails.length})
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2" style={{ color: textMuted }}>
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

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
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
                      <div className="flex-1">
                        <div className="text-sm font-semibold mb-1" style={{ color: headingColor }}>
                          {mail.subject}
                        </div>
                        <div className="text-xs mb-2 font-medium" style={{ color: textMuted }}>
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
                        <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
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
      </div>
    </div>
  );
}
