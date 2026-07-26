import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Circle, Clock, Building2, AlertTriangle, CalendarX2, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, isValid, isToday, isTomorrow, startOfDay } from "date-fns";
import { de } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { entities, functions } from "@/api/supabaseClient";
import PersonAvatar from "@/components/ui/PersonAvatar";

// ── Fristenansicht ────────────────────────────────────────────────────────────
// Listview aller offenen Tasks, gruppiert nach Fälligkeits-TAG (aufsteigend).
// Überfällige Gruppen rot markiert, "Heute"/"Morgen" hervorgehoben.
// Tasks ohne due_date separat zuunterst unter "Ohne Frist".

function groupLabel(dayKey) {
  if (dayKey === "none") return "Ohne Frist";
  const d = new Date(dayKey);
  if (!isValid(d)) return dayKey;
  if (isToday(d)) return `Heute · ${format(d, "EEEE, dd.MM.yyyy", { locale: de })}`;
  if (isTomorrow(d)) return `Morgen · ${format(d, "EEEE, dd.MM.yyyy", { locale: de })}`;
  return format(d, "EEEE, dd.MM.yyyy", { locale: de });
}

function DeadlineSection({ dayKey, tasks, columns, priorities, customers, allUsers, theme, onTaskClick, onToggleComplete }) {
  const [collapsed, setCollapsed] = useState(false);
  const isLight = theme === "light";
  const isArtis = theme === "artis";

  const isNone = dayKey === "none";
  const day = isNone ? null : new Date(dayKey);
  const overdue = !isNone && isValid(day) && startOfDay(day) < startOfDay(new Date());
  const today = !isNone && isValid(day) && isToday(day);

  // Akzentfarbe der Gruppe: überfällig rot, heute amber, Zukunft grün/violett, ohne Frist grau
  const accent = overdue ? "#ef4444"
    : today ? "#f59e0b"
    : isNone ? (isArtis ? "#8aa08a" : isLight ? "#9a9ab8" : "#71717a")
    : (isArtis ? "#3d7a3d" : "#6366f1");

  const headerHover = isArtis ? "hover:bg-green-100/30" : isLight ? "hover:bg-slate-100" : "hover:bg-zinc-800/40";
  const headerText  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#f4f4f5";
  const countText   = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#a1a1aa";
  const countBg     = isArtis ? "#edf2ed" : isLight ? "#e4e4f0" : "#3f3f46";
  const rowHover    = isArtis ? "hover:bg-green-100/20" : isLight ? "hover:bg-slate-50" : "hover:bg-zinc-800/30";
  const tableBorder = isArtis ? "#ccd8cc" : isLight ? "#e0e0f0" : "#3f3f46";
  const primaryText = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#f4f4f5";
  const secondaryText = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#a1a1aa";

  const getPriority = (id) => priorities.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);
  const getUser     = (email) => allUsers.find(u => u.email === email);
  const getColumn   = (id) => columns.find(c => c.id === id);

  return (
    <div className="mb-2">
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors rounded-lg ${headerHover}`}
      >
        {isNone
          ? <CalendarX2 className="h-4 w-4 flex-shrink-0" style={{ color: accent }} />
          : <CalendarClock className="h-4 w-4 flex-shrink-0" style={{ color: accent }} />}
        <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: overdue ? accent : headerText }}>
          {groupLabel(dayKey)}
        </span>
        {overdue && (
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>
            überfällig
          </span>
        )}
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: countText, backgroundColor: countBg }}>
          {tasks.length}
        </span>
        <div className="ml-auto" style={{ color: countText }}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      <div className="h-px mx-4 mb-1" style={{ backgroundColor: `${accent}40` }} />

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <tbody>
              {tasks.map(task => {
                const priority = getPriority(task.priority_id);
                const customer = getCustomer(task.customer_id);
                const user = getUser(task.assignee);
                const col = getColumn(task.column_id);
                return (
                  <tr
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    className={`cursor-pointer transition-colors ${rowHover}`}
                    style={{ borderBottomColor: tableBorder, borderBottomWidth: "1px" }}
                  >
                    <td className="px-4 py-2.5 w-8" onClick={e => { e.stopPropagation(); onToggleComplete(task); }}>
                      <button className="text-zinc-500 hover:text-green-400 transition-colors">
                        <Circle className="h-4 w-4" />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 min-w-[240px]">
                      <span className="text-sm font-medium" style={{ color: primaryText }}>{task.title}</span>
                    </td>
                    <td className="px-4 py-2.5 min-w-[110px]">
                      {col ? (
                        <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: `${col.color || "#6366f1"}20`, color: col.color || "#6366f1", border: `1px solid ${col.color || "#6366f1"}40` }}>
                          {col.name}
                        </span>
                      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>}
                    </td>
                    <td className="px-4 py-2.5 min-w-[110px]">
                      {priority ? (
                        <Badge variant="outline" className="text-xs whitespace-nowrap gap-1"
                          style={{ backgroundColor: `${priority.color}20`, borderColor: `${priority.color}50`, color: priority.color }}>
                          {priority.level === 1 && <AlertTriangle className="h-3 w-3" />}
                          {priority.name}
                        </Badge>
                      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>}
                    </td>
                    <td className="px-4 py-2.5 min-w-[130px]">
                      {task.assignee ? (
                        <div className="flex items-center gap-1.5">
                          <PersonAvatar user={user} name={user?.full_name || task.assignee} size={24} />
                          <span className="text-xs truncate max-w-[110px]" style={{ color: primaryText }}>{user?.full_name || task.assignee}</span>
                        </div>
                      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>}
                    </td>
                    <td className="px-4 py-2.5 min-w-[140px]">
                      {customer ? (
                        <div className="flex items-center gap-1 text-xs" style={{ color: primaryText }}>
                          <Building2 className="h-3 w-3 flex-shrink-0" style={{ color: secondaryText }} />
                          {customer.company_name}
                        </div>
                      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>}
                    </td>
                    <td className="px-4 py-2.5 min-w-[100px]">
                      {task.due_date && isValid(new Date(task.due_date)) ? (
                        <div className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: overdue ? "#ef4444" : primaryText }}>
                          <Clock className="h-3 w-3" />
                          {format(new Date(task.due_date), "dd.MM.yyyy", { locale: de })}
                        </div>
                      ) : <span className="text-xs" style={{ color: secondaryText }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TaskDeadlineView({ columns, tasks, onTaskClick, onToggleComplete }) {
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
      const res = await functions.invoke("getAllUsers", {});
      return res.data?.users || [];
    },
  });

  const theme = localStorage.getItem("app_theme") || "dark";
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const bgColor = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "transparent";
  const mutedText = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#a1a1aa";

  // Offene Tasks nach Fälligkeits-TAG gruppieren; ohne Datum → "none" (zuunterst)
  const groups = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      if (t.completed) continue;
      let key = "none";
      if (t.due_date) {
        const d = new Date(t.due_date);
        if (isValid(d)) key = format(d, "yyyy-MM-dd");
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    // Innerhalb der Gruppe: nach Priorität (level), dann Titel
    const prioLevel = (t) => priorities.find(p => p.id === t.priority_id)?.level ?? 99;
    for (const arr of map.values()) {
      arr.sort((a, b) => prioLevel(a) - prioLevel(b) || (a.title || "").localeCompare(b.title || "", "de"));
    }
    const dated = [...map.keys()].filter(k => k !== "none").sort();
    return [...dated, ...(map.has("none") ? ["none"] : [])].map(k => ({ key: k, tasks: map.get(k) }));
  }, [tasks, priorities]);

  return (
    <div className="flex-1 overflow-auto px-4 py-4" style={{ backgroundColor: bgColor }}>
      {groups.length === 0 && (
        <div className="text-center py-16 text-sm" style={{ color: mutedText }}>
          Keine offenen Aufgaben.
        </div>
      )}
      {groups.map(g => (
        <DeadlineSection
          key={g.key}
          dayKey={g.key}
          tasks={g.tasks}
          columns={columns}
          priorities={priorities}
          customers={customers}
          allUsers={allUsers}
          theme={theme}
          onTaskClick={onTaskClick}
          onToggleComplete={onToggleComplete}
        />
      ))}
    </div>
  );
}
