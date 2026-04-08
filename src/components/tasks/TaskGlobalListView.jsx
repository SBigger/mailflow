import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Circle, CheckCircle2, Clock, Building2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";

const COLUMNS = [
  { key: "title", label: "Titel", width: "min-w-[220px]" },
  { key: "priority_id", label: "Priorität", width: "min-w-[120px]" },
  { key: "assignee", label: "Zugewiesen", width: "min-w-[140px]" },
  { key: "verantwortlich", label: "Verantwortlich", width: "min-w-[140px]" },
  { key: "due_date", label: "Fällig", width: "min-w-[110px]" },
  { key: "tags", label: "Tags", width: "min-w-[140px]" },
  { key: "customer_id", label: "Kunde", width: "min-w-[140px]" },
  { key: "description", label: "Beschreibung", width: "min-w-[200px]" },
];

function renderCell(key, task, priority, customer, user, theme, verantwortlichUser) {
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const primaryText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#f4f4f5';
  const secondaryText = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#a1a1aa';
  
  switch (key) {
    case "title":
      return <span className="text-sm font-medium" style={{ color: primaryText }}>{task.title}</span>;
    case "priority_id":
      return priority ? (
        <Badge
          variant="outline"
          style={{ backgroundColor: `${priority.color}20`, borderColor: `${priority.color}50`, color: priority.color }}
          className="text-xs whitespace-nowrap gap-1"
        >
          {priority.level === 1 && <AlertTriangle className="h-3 w-3" />}
          {priority.name}
        </Badge>
      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>;
    case "assignee":
      return task.assignee ? (
        <div className="flex items-center gap-1.5">
          <div className="h-6 w-6 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-xs font-medium flex-shrink-0">
            {(user?.full_name || task.assignee).charAt(0).toUpperCase()}
          </div>
          <span className="text-xs truncate max-w-[120px]" style={{ color: primaryText }}>{user?.full_name || task.assignee}</span>
        </div>
      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>;
    case "verantwortlich":
      return task.verantwortlich ? (
        <div className="flex items-center gap-1.5">
          <div className="h-6 w-6 rounded-full bg-emerald-600/30 flex items-center justify-center text-emerald-300 text-xs font-medium flex-shrink-0">
            {(verantwortlichUser?.full_name || task.verantwortlich).charAt(0).toUpperCase()}
          </div>
          <span className="text-xs truncate max-w-[120px]" style={{ color: primaryText }}>{verantwortlichUser?.full_name || task.verantwortlich}</span>
        </div>
      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>;
    case "due_date":
      return task.due_date ? (
        <div className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: primaryText }}>
          <Clock className="h-3 w-3" />
          {format(new Date(task.due_date), "dd.MM.yyyy", { locale: de })}
        </div>
      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>;
    case "tags":
      return task.tags?.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {task.tags.map(tag => (
            <span key={tag} className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>;
    case "customer_id":
      return customer ? (
        <div className="flex items-center gap-1 text-xs" style={{ color: primaryText }}>
          <Building2 className="h-3 w-3 flex-shrink-0" style={{ color: secondaryText }} />
          {customer.company_name}
        </div>
      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>;
    case "description":
      return <span className="text-xs line-clamp-1" style={{ color: secondaryText }}>{task.description || "—"}</span>;
    default:
      return null;
  }
}

function ColumnSection({ column, tasks, onTaskClick, onToggleComplete, priorities, customers, allUsers, theme }) {
  const [collapsed, setCollapsed] = useState(false);

  const [showCompleted, setShowCompleted] = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(1); }
  };

  const activeTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);

  const sortedActiveTasks = useMemo(() => {
    if (!sortKey) return activeTasks;
    return [...activeTasks].sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case 'title':          av = (a.title || '').toLowerCase();                                              bv = (b.title || '').toLowerCase(); break;
        case 'priority_id':    av = priorities.find(p => p.id === a.priority_id)?.level ?? 99;                 bv = priorities.find(p => p.id === b.priority_id)?.level ?? 99; break;
        case 'assignee':       av = (a.assignee || '').toLowerCase();                                          bv = (b.assignee || '').toLowerCase(); break;
        case 'verantwortlich': av = (a.verantwortlich || '').toLowerCase();                                    bv = (b.verantwortlich || '').toLowerCase(); break;
        case 'due_date':       av = a.due_date || '9999';                                                      bv = b.due_date || '9999'; break;
        case 'customer_id':    av = (customers.find(c => c.id === a.customer_id)?.company_name || '').toLowerCase(); bv = (customers.find(c => c.id === b.customer_id)?.company_name || '').toLowerCase(); break;
        case 'tags':           av = (a.tags?.[0] || '').toLowerCase();                                         bv = (b.tags?.[0] || '').toLowerCase(); break;
        case 'description':    av = (a.description || '').toLowerCase();                                       bv = (b.description || '').toLowerCase(); break;
        default: return 0;
      }
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
  }, [activeTasks, sortKey, sortDir, priorities, customers]);
  const accentColor = column.color || "#6366f1";
  
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const headerBg = isArtis ? 'hover:bg-green-100/30' : isLight ? 'hover:bg-slate-100' : 'hover:bg-zinc-800/40';
  const headerText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#f4f4f5';
  const columnNameText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#f4f4f5';
  const countText = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#a1a1aa';
  const countBg = isArtis ? '#edf2ed' : isLight ? '#e4e4f0' : '#3f3f46';
  const tableHeaderText = isArtis ? '#4a5e4a' : isLight ? '#4a4a6a' : '#71717a';
  const tableRowHover = isArtis ? 'hover:bg-green-100/20' : isLight ? 'hover:bg-slate-50' : 'hover:bg-zinc-800/30';
  const tableBorder = isArtis ? '#ccd8cc' : isLight ? '#e0e0f0' : '#3f3f46';
  const cellText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#f4f4f5';

  const getPriority = (id) => priorities.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);
  const getUser = (email) => allUsers.find(u => u.email === email);

  return (
    <div className="mb-2">
      {/* Section Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors rounded-lg group ${headerBg}`}
      >
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: accentColor }} />
        <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: columnNameText }}>{column.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: countText, backgroundColor: countBg }}>{activeTasks.length} offen</span>
        {completedTasks.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: countText, backgroundColor: countBg }}>{completedTasks.length} erledigt</span>
        )}
        <div className="ml-auto" style={{ color: countText }}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Divider with accent color */}
      <div className="h-px mx-4 mb-1" style={{ backgroundColor: `${accentColor}40` }} />

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr style={{ borderBottomColor: tableBorder, borderBottomWidth: '1px' }}>
                <th className="px-4 py-2 w-8" />
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider ${col.width} cursor-pointer select-none`}
                    style={{ color: sortKey === col.key ? (isArtis ? '#3d7a3d' : isLight ? '#4040a0' : '#86efac') : tableHeaderText }}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key
                        ? (sortDir === 1 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
                        : <ChevronUp className="h-3 w-3 opacity-0" />
                      }
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedActiveTasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className={`cursor-pointer transition-colors ${tableRowHover}`}
                  style={{ borderBottomColor: tableBorder, borderBottomWidth: '1px' }}
                >
                  <td className="px-4 py-2.5" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                    <button className="text-zinc-500 hover:text-green-400 transition-colors">
                      <Circle className="h-4 w-4" />
                    </button>
                  </td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-4 py-2.5">
                      {renderCell(col.key, task, getPriority(task.priority_id), getCustomer(task.customer_id), getUser(task.assignee), theme, getUser(task.verantwortlich))}
                    </td>
                  ))}
                </tr>
              ))}

              {completedTasks.length > 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 pt-4 pb-1">
                    <button
                      onClick={() => setShowCompleted(v => !v)}
                      className="flex items-center gap-2 text-xs transition-colors"
                      style={{ color: countText }}
                    >
                      {showCompleted ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <div className="flex-1 h-px w-16" style={{ backgroundColor: `${accentColor}40` }} />
                      <CheckCircle2 className="h-3 w-3" style={{ color: accentColor }} />
                      Erledigt ({completedTasks.length})
                    </button>
                  </td>
                </tr>
              )}

              {showCompleted && completedTasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className={`cursor-pointer transition-colors opacity-60 ${tableRowHover}`}
                  style={{ borderBottomColor: tableBorder, borderBottomWidth: '1px' }}
                >
                  <td className="px-4 py-2.5" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                    <button className="transition-colors" style={{ color: accentColor }}>
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-4 py-2.5">
                      {col.key === "title"
                        ? <span className="text-sm font-medium line-through" style={{ color: countText }}>{task.title}</span>
                        : renderCell(col.key, task, getPriority(task.priority_id), getCustomer(task.customer_id), getUser(task.assignee), theme)
                      }
                    </td>
                  ))}
                </tr>
              ))}

              {activeTasks.length === 0 && completedTasks.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-4 text-center text-xs" style={{ color: countText }}>
                    Keine Tasks
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TaskGlobalListView({ columns, tasks, onTaskClick, onToggleComplete }) {
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await functions.invoke('getAllUsers', {});
      return res.data?.users || [];
    },
  });

  const theme = localStorage.getItem("app_theme") || "dark";
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const bgColor = isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : 'transparent';

  return (
    <div className="flex-1 overflow-auto px-4 py-4" style={{ backgroundColor: bgColor }}>
      {columns.map(column => (
        <ColumnSection
          key={column.id}
          column={column}
          tasks={tasks.filter(t => t.column_id === column.id)}
          onTaskClick={onTaskClick}
          onToggleComplete={onToggleComplete}
          priorities={priorities}
          customers={customers}
          allUsers={allUsers}
          theme={theme}
        />
      ))}
    </div>
  );
}