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

export default function Dashboard() {
  const [selectedUser, setSelectedUser] = useState("all");
  const [taskSortBy, setTaskSortBy] = useState("due_date");
  const [mailSortBy, setMailSortBy] = useState("received_date");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => entities.User.list(),
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return [];
      const allTasks = await entities.Task.list();
      return allTasks.filter(task => task.created_by === currentUser.email);
    },
    enabled: !!currentUser,
  });

  const { data: mails = [] } = useQuery({
    queryKey: ["mailItems", currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return [];
      const allMails = await entities.MailItem.list();
      return allMails.filter(mail => mail.created_by === currentUser.email);
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
    switch (priority) {
      case 'urgent': return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      case 'low': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      default: return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30';
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
                className="border-indigo-600/50 bg-indigo-600/10 hover:bg-indigo-600/20 text-zinc-100 gap-2"
              >
                <Menu className="h-4 w-4" />
                Dashboard
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-zinc-900 border-zinc-800">
              <DropdownMenuItem asChild>
                <Link 
                  to={createPageUrl('MailKanban')} 
                  className="text-zinc-300 cursor-pointer flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  Mailverwaltung
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link 
                  to={createPageUrl('TaskBoard')} 
                  className="text-zinc-300 cursor-pointer flex items-center gap-2"
                >
                  <CheckSquare className="h-4 w-4" />
                  Task-Verwaltung
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link 
                  to={createPageUrl('Settings')} 
                  className="text-zinc-300 cursor-pointer flex items-center gap-2"
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
          <LayoutDashboard className="h-8 w-8 text-indigo-400" />
          <div>
            <h1 className="text-3xl font-bold text-zinc-100">Dashboard</h1>
            <p className="text-sm text-zinc-500">Übersicht über alle Tasks und E-Mails</p>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">Offene Tasks</p>
                <p className="text-3xl font-bold text-zinc-100 mt-2">{stats.totalOpenTasks}</p>
              </div>
              <CheckSquare className="h-12 w-12 text-indigo-400 opacity-20" />
            </div>
            <div className="mt-4 flex gap-4 text-xs text-zinc-500">
              <span className="text-red-400">{stats.overdueTasks} überfällig</span>
              <span className="text-amber-400">{stats.todayTasks} heute</span>
            </div>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">Ungelesene E-Mails</p>
                <p className="text-3xl font-bold text-zinc-100 mt-2">{stats.totalUnreadMails}</p>
              </div>
              <Mail className="h-12 w-12 text-blue-400 opacity-20" />
            </div>
            <div className="mt-4 flex gap-4 text-xs text-zinc-500">
              <span className="text-orange-400">{stats.highPriorityMails} hohe Priorität</span>
            </div>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">Hohe Priorität</p>
                <p className="text-3xl font-bold text-zinc-100 mt-2">{stats.highPriorityTasks}</p>
              </div>
              <AlertCircle className="h-12 w-12 text-orange-400 opacity-20" />
            </div>
            <div className="mt-4 flex gap-4 text-xs text-zinc-500">
              <span>Tasks mit hoher/dringender Priorität</span>
            </div>
          </Card>
        </div>

        {/* Tasks by User Overview */}
        <Card className="bg-zinc-900/50 border-zinc-800 p-6 mb-8">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-indigo-400" />
            Tasks pro Mitarbeiter
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(tasksByUser).map(([assignee, userTasks]) => {
              const user = users.find(u => u.email === assignee);
              const userName = user?.full_name || assignee;
              
              return (
                <div
                  key={assignee}
                  className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 font-semibold text-sm">
                      {userName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-zinc-200">{userName}</div>
                      <div className="text-xs text-zinc-500">{userTasks.length} offene Tasks</div>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-red-400">
                      {userTasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length} dringend
                    </span>
                    <span className="text-amber-400">
                      {userTasks.filter(t => t.due_date && isPast(new Date(t.due_date))).length} überfällig
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="border-zinc-700 text-zinc-300 gap-2">
                <User className="h-4 w-4" />
                {selectedUser === "all" ? "Alle Mitarbeiter" : users.find(u => u.email === selectedUser)?.full_name || selectedUser}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-zinc-900 border-zinc-800">
              <DropdownMenuItem onClick={() => setSelectedUser("all")} className="text-zinc-300">
                Alle Mitarbeiter
              </DropdownMenuItem>
              {users.map((user) => (
                <DropdownMenuItem key={user.id} onClick={() => setSelectedUser(user.email)} className="text-zinc-300">
                  {user.full_name || user.email}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="border-zinc-700 text-zinc-300 gap-2">
                <Filter className="h-4 w-4" />
                {priorityFilter === "all" ? "Alle Prioritäten" : priorityFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-zinc-900 border-zinc-800">
              <DropdownMenuItem onClick={() => setPriorityFilter("all")} className="text-zinc-300">
                Alle Prioritäten
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("urgent")} className="text-red-400">
                Dringend
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("high")} className="text-orange-400">
                Hoch
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("medium")} className="text-yellow-400">
                Mittel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPriorityFilter("low")} className="text-blue-400">
                Niedrig
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tasks Section */}
          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-indigo-400" />
                Offene Tasks ({filteredTasks.length})
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 text-zinc-400">
                    <ArrowUpDown className="h-4 w-4" />
                    {taskSortBy === "due_date" ? "Fälligkeit" : taskSortBy === "priority" ? "Priorität" : "Erstellt"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-zinc-900 border-zinc-800">
                  <DropdownMenuItem onClick={() => setTaskSortBy("due_date")} className="text-zinc-300">
                    Nach Fälligkeit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTaskSortBy("priority")} className="text-zinc-300">
                    Nach Priorität
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTaskSortBy("created_date")} className="text-zinc-300">
                    Nach Erstelldatum
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredTasks.length === 0 ? (
                <div className="text-center py-8 text-zinc-500">
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
                      className="block p-3 bg-zinc-900/60 border border-zinc-800/50 rounded-lg hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-zinc-200 mb-1">
                            {task.title}
                          </div>
                          {task.description && (
                            <div className="text-xs text-zinc-500 line-clamp-1">
                              {task.description}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            {task.assignee && (
                              <div className="flex items-center gap-1 text-xs text-zinc-500">
                                <User className="h-3 w-3" />
                                {user?.full_name || task.assignee}
                              </div>
                            )}
                            {task.due_date && (
                              <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-400' : 'text-zinc-500'}`}>
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
          </Card>

          {/* Mails Section */}
          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-400" />
                Ungelesene E-Mails ({filteredMails.length})
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 text-zinc-400">
                    <ArrowUpDown className="h-4 w-4" />
                    {mailSortBy === "received_date" ? "Datum" : "Priorität"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-zinc-900 border-zinc-800">
                  <DropdownMenuItem onClick={() => setMailSortBy("received_date")} className="text-zinc-300">
                    Nach Datum
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMailSortBy("priority")} className="text-zinc-300">
                    Nach Priorität
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredMails.length === 0 ? (
                <div className="text-center py-8 text-zinc-500">
                  Keine ungelesenen E-Mails
                </div>
              ) : (
                filteredMails.map((mail) => (
                  <Link 
                    key={mail.id} 
                    to={createPageUrl('MailKanban')}
                    className="block p-3 bg-zinc-900/60 border border-zinc-800/50 rounded-lg hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-zinc-200 mb-1">
                          {mail.subject}
                        </div>
                        <div className="text-xs text-zinc-500 mb-2">
                          Von: {mail.sender_name}
                        </div>
                        {mail.body_preview && (
                          <div className="text-xs text-zinc-600 line-clamp-2">
                            {mail.body_preview}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center gap-1 text-xs text-zinc-500">
                            <Clock className="h-3 w-3" />
                            {format(new Date(mail.received_date), 'dd.MM.yyyy HH:mm', { locale: de })}
                          </div>
                        </div>
                      </div>
                      {mail.priority === 'high' && (
                        <Badge variant="outline" className="text-xs bg-orange-500/20 text-orange-300 border-orange-500/30">
                          Hoch
                        </Badge>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}