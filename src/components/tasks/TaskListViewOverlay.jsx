import React, { useState, useRef, useMemo } from "react";
import { X, ArrowLeft, CheckCircle2, Circle, Clock, Building2, AlertTriangle, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";

const DEFAULT_COLUMNS = [
  { key: "title", label: "Titel" },
  { key: "priority_id", label: "Priorität" },
  { key: "assignee", label: "Zugewiesen" },
  { key: "due_date", label: "Fällig" },
  { key: "tags", label: "Tags" },
  { key: "customer_id", label: "Kunde" },
  { key: "description", label: "Beschreibung" },
];

const STORAGE_KEY = "tasklistview-col-order";

function loadColOrder(userEmail) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${userEmail}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_COLUMNS.map(c => c.key);
}

function saveColOrder(userEmail, order) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${userEmail}`, JSON.stringify(order));
  } catch {}
}

function renderCell(key, task, priority, customer, user, theme) {
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';
  const primaryText   = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#d4d4d8';
  const secondaryText = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a';
  const emptyText     = isArtis ? '#9aad9a' : isLight ? '#9898b8' : '#52525b';

  switch (key) {
    case "title":
      return <span className="text-sm font-medium" style={{ color: isArtis ? '#2d5a2d' : isLight ? '#1a1a2e' : '#86efac' }}>{task.title}</span>;
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
      ) : <span className="text-xs" style={{ color: emptyText }}>—</span>;
    case "assignee":
      return task.assignee ? (
        <div className="flex items-center gap-1.5">
          <div className="h-6 w-6 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-xs font-medium flex-shrink-0">
            {(user?.full_name || task.assignee).charAt(0).toUpperCase()}
          </div>
          <span className="text-xs truncate max-w-[120px]" style={{ color: primaryText }}>{user?.full_name || task.assignee}</span>
        </div>
      ) : <span className="text-xs" style={{ color: emptyText }}>—</span>;
    case "due_date":
      return task.due_date ? (
        <div className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: secondaryText }}>
          <Clock className="h-3 w-3" />
          {format(new Date(task.due_date), "dd.MM.yyyy", { locale: de })}
        </div>
      ) : <span className="text-xs" style={{ color: emptyText }}>—</span>;
    case "tags":
      return task.tags?.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {task.tags.map(tag => (
            <span key={tag} className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      ) : <span className="text-xs" style={{ color: emptyText }}>—</span>;
    case "customer_id":
      return customer ? (
        <div className="flex items-center gap-1 text-xs" style={{ color: primaryText }}>
          <Building2 className="h-3 w-3 flex-shrink-0" style={{ color: secondaryText }} />
          {customer.company_name}
        </div>
      ) : <span className="text-xs" style={{ color: emptyText }}>—</span>;
    case "description":
      return <span className="text-xs line-clamp-2" style={{ color: secondaryText }}>{task.description || "—"}</span>;
    default:
      return null;
  }
}

export default function TaskListViewOverlay({ column, tasks, onClose, onTaskClick, onToggleComplete }) {
  const [sortField, setSortField] = useState("order");
  const [sortDir, setSortDir] = useState(1);

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["allUsers"],
    queryFn: () => entities.User.list(),
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const [colOrder, setColOrder] = useState(() => loadColOrder(currentUser?.email || "default"));
  const dragColRef = useRef(null);
  const dragOverColRef = useRef(null);

  const handleColDragStart = (key) => { dragColRef.current = key; };
  const handleColDragOver = (e, key) => { e.preventDefault(); dragOverColRef.current = key; };
  const handleColDrop = () => {
    if (!dragColRef.current || dragColRef.current === dragOverColRef.current) return;
    const newOrder = [...colOrder];
    const fromIdx = newOrder.indexOf(dragColRef.current);
    const toIdx = newOrder.indexOf(dragOverColRef.current);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragColRef.current);
    setColOrder(newOrder);
    saveColOrder(currentUser?.email || "default", newOrder);
    dragColRef.current = null;
    dragOverColRef.current = null;
  };

  const orderedCols = colOrder
    .map(key => DEFAULT_COLUMNS.find(c => c.key === key))
    .filter(Boolean);

  const activeTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);

  const getPriority = (id) => priorities.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);
  const getUser = (email) => allUsers.find(u => u.email === email);

  const theme = localStorage.getItem("app_theme") || "dark";
  const isArtis = theme === 'artis';
  const isLight = theme === 'light';

  // Theme-Farben
  const bgColor        = isArtis ? '#f2f5f2'         : isLight ? '#f0f0f6'         : '#09090b';
  const headerBg       = isArtis ? '#e8ede8'         : isLight ? '#e4e4f0'         : '#18181b';
  const headerBorder   = isArtis ? '#ccd8cc'         : isLight ? '#d0d0e8'         : 'rgba(39,39,42,0.6)';
  const theadBg        = isArtis ? '#e8ede8'         : isLight ? '#e4e4f0'         : 'rgba(24,24,27,0.95)';
  const theadBorder    = isArtis ? '#ccd8cc'         : isLight ? '#d0d0e8'         : '#27272a';
  const rowHoverBg     = isArtis ? 'rgba(0,100,0,0.06)' : isLight ? 'rgba(0,0,100,0.04)' : 'rgba(39,39,42,0.4)';
  const rowBorder      = isArtis ? '#dde6dd'         : isLight ? '#e0e0f0'         : 'rgba(39,39,42,0.5)';
  const primaryText    = isArtis ? '#2d3a2d'         : isLight ? '#1a1a2e'         : '#f4f4f5';
  const secondaryText  = isArtis ? '#6b826b'         : isLight ? '#7a7a9a'         : '#71717a';
  const headerText     = isArtis ? '#4a5e4a'         : isLight ? '#4a4a6a'         : '#a1a1aa';
  const sortActiveColor= isArtis ? '#3d7a3d'         : isLight ? '#4040a0'         : '#86efac';
  const dividerColor   = isArtis ? '#ccd8cc'         : isLight ? '#d0d0e8'         : 'rgba(63,63,70,0.6)';
  const gripColor      = isArtis ? '#b0c4b0'         : isLight ? '#c0c0d8'         : '#3f3f46';
  const gripHoverColor = isArtis ? '#6b826b'         : isLight ? '#7a7a9a'         : '#71717a';

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d * -1);
    else { setSortField(field); setSortDir(1); }
  };

  const sortedActiveTasks = useMemo(() => {
    if (sortField === "order") return activeTasks;
    return [...activeTasks].sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case 'title':       av = (a.title || '').toLowerCase();                                              bv = (b.title || '').toLowerCase(); break;
        case 'priority_id': av = getPriority(a.priority_id)?.level ?? 99;                                  bv = getPriority(b.priority_id)?.level ?? 99; break;
        case 'assignee':    av = (a.assignee || '').toLowerCase();                                          bv = (b.assignee || '').toLowerCase(); break;
        case 'due_date':    av = a.due_date || '9999';                                                      bv = b.due_date || '9999'; break;
        case 'customer_id': av = (getCustomer(a.customer_id)?.company_name || '').toLowerCase();            bv = (getCustomer(b.customer_id)?.company_name || '').toLowerCase(); break;
        case 'tags':        av = (a.tags?.[0] || '').toLowerCase();                                         bv = (b.tags?.[0] || '').toLowerCase(); break;
        case 'description': av = (a.description || '').toLowerCase();                                       bv = (b.description || '').toLowerCase(); break;
        default: return 0;
      }
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
  }, [activeTasks, sortField, sortDir, priorities]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden" style={{ backgroundColor: bgColor }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 flex items-center gap-4"
        style={{ backgroundColor: headerBg, borderBottom: `1px solid ${headerBorder}`, borderTop: `3px solid ${column.color || '#4F46E5'}` }}
      >
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-2" style={{ color: secondaryText }}>
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Kanban-Ansicht
        </Button>
        <div className="h-5 w-px" style={{ backgroundColor: headerBorder }} />
        <div>
          <h2 className="text-lg font-bold" style={{ color: primaryText }}>{column.name}</h2>
          <p className="text-xs" style={{ color: secondaryText }}>{activeTasks.length} offen · {completedTasks.length} erledigt</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="ml-auto" style={{ color: secondaryText }}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 backdrop-blur z-10" style={{ backgroundColor: theadBg }}>
            <tr style={{ borderBottom: `1px solid ${theadBorder}` }}>
              <th className="px-4 py-3 w-10" />
              {orderedCols.map(col => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={() => handleColDragStart(col.key)}
                  onDragOver={(e) => handleColDragOver(e, col.key)}
                  onDrop={handleColDrop}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none"
                  style={{ color: sortField === col.key ? sortActiveColor : headerText }}
                >
                  <div className="flex items-center gap-1">
                    <GripVertical className="h-3 w-3" style={{ color: gripColor }} />
                    {col.label}
                    {sortField === col.key
                      ? (sortDir === 1 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
                      : <ChevronUp className="h-3 w-3 opacity-0" />
                    }
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedActiveTasks.map((task) => {
              const priority = getPriority(task.priority_id);
              const customer = getCustomer(task.customer_id);
              const user = getUser(task.assignee);
              return (
                <tr
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className="cursor-pointer transition-colors"
                  style={{ borderBottom: `1px solid ${rowBorder}` }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHoverBg}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
                >
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                    <button className="transition-colors" style={{ color: secondaryText }}>
                      <Circle className="h-4 w-4" />
                    </button>
                  </td>
                  {orderedCols.map(col => (
                    <td key={col.key} className="px-4 py-3">
                      {renderCell(col.key, task, priority, customer, user, theme)}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Separator */}
            {completedTasks.length > 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-4 pt-6 pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px" style={{ backgroundColor: dividerColor }} />
                    <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: secondaryText }}>
                      <CheckCircle2 className="h-3.5 w-3.5" style={{ color: sortActiveColor }} />
                      Erledigt ({completedTasks.length})
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: dividerColor }} />
                  </div>
                </td>
              </tr>
            )}

            {completedTasks.map((task) => {
              const priority = getPriority(task.priority_id);
              const customer = getCustomer(task.customer_id);
              const user = getUser(task.assignee);
              return (
                <tr
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className="cursor-pointer transition-colors opacity-50"
                  style={{ borderBottom: `1px solid ${rowBorder}` }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHoverBg}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
                >
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                    <button className="transition-colors" style={{ color: sortActiveColor }}>
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </td>
                  {orderedCols.map(col => (
                    <td key={col.key} className="px-4 py-3">
                      {col.key === "title"
                        ? <span className="text-sm font-medium line-through" style={{ color: secondaryText }}>{task.title}</span>
                        : renderCell(col.key, task, priority, customer, user, theme)
                      }
                    </td>
                  ))}
                </tr>
              );
            })}

            {activeTasks.length === 0 && completedTasks.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-4 py-16 text-center text-sm" style={{ color: secondaryText }}>
                  Keine Tasks in dieser Spalte
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
