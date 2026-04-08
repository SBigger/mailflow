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

function renderCell(key, task, priority, customer, user) {
  switch (key) {
    case "title":
      return <span className="text-sm font-medium text-green-300/80">{task.title}</span>;
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
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "assignee":
      return task.assignee ? (
        <div className="flex items-center gap-1.5">
          <div className="h-6 w-6 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-xs font-medium flex-shrink-0">
            {(user?.full_name || task.assignee).charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-zinc-300 truncate max-w-[120px]">{user?.full_name || task.assignee}</span>
        </div>
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "due_date":
      return task.due_date ? (
        <div className="flex items-center gap-1 text-xs text-zinc-400 whitespace-nowrap">
          <Clock className="h-3 w-3" />
          {format(new Date(task.due_date), "dd.MM.yyyy", { locale: de })}
        </div>
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "tags":
      return task.tags?.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {task.tags.map(tag => (
            <span key={tag} className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "customer_id":
      return customer ? (
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <Building2 className="h-3 w-3 text-zinc-500 flex-shrink-0" />
          {customer.company_name}
        </div>
      ) : <span className="text-zinc-600 text-xs">—</span>;
    case "description":
      return <span className="text-xs text-zinc-500 line-clamp-2">{task.description || "—"}</span>;
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
  const sortActiveColor = isArtis ? '#3d7a3d' : isLight ? '#4040a0' : '#86efac';

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
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 border-b border-zinc-800/60 flex items-center gap-4"
        style={{ borderTopColor: column.color || '#4F46E5', borderTopWidth: '3px' }}
      >
        <Button variant="ghost" size="sm" onClick={onClose} className="text-zinc-400 hover:text-zinc-200 gap-2">
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Kanban-Ansicht
        </Button>
        <div className="h-5 w-px bg-zinc-700" />
        <div>
          <h2 className="text-lg font-bold text-zinc-100">{column.name}</h2>
          <p className="text-xs text-zinc-500">{activeTasks.length} offen · {completedTasks.length} erledigt</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur z-10">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3 w-10" />
              {orderedCols.map(col => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={() => handleColDragStart(col.key)}
                  onDragOver={(e) => handleColDragOver(e, col.key)}
                  onDrop={handleColDrop}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none group"
                  style={{ color: sortField === col.key ? sortActiveColor : undefined }}
                >
                  <div className="flex items-center gap-1">
                    <GripVertical className="h-3 w-3 text-zinc-700 group-hover:text-zinc-500" />
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
                  className="cursor-pointer transition-colors hover:bg-zinc-800/40 border-b border-zinc-800/50"
                >
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                    <button className="text-zinc-500 hover:text-green-400 transition-colors">
                      <Circle className="h-4 w-4" />
                    </button>
                  </td>
                  {orderedCols.map(col => (
                    <td key={col.key} className="px-4 py-3">
                      {renderCell(col.key, task, priority, customer, user)}
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
                    <div className="flex-1 h-px bg-zinc-700/60" />
                    <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      Erledigt ({completedTasks.length})
                    </span>
                    <div className="flex-1 h-px bg-zinc-700/60" />
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
                  className="cursor-pointer transition-colors hover:bg-zinc-800/40 border-b border-zinc-800/30 opacity-50"
                >
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                    <button className="text-green-500 hover:text-zinc-400 transition-colors">
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </td>
                  {orderedCols.map(col => (
                    <td key={col.key} className="px-4 py-3">
                      {col.key === "title"
                        ? <span className="text-sm font-medium line-through text-zinc-500">{task.title}</span>
                        : renderCell(col.key, task, priority, customer, user)
                      }
                    </td>
                  ))}
                </tr>
              );
            })}

            {activeTasks.length === 0 && completedTasks.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-4 py-16 text-center text-zinc-600 text-sm">
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