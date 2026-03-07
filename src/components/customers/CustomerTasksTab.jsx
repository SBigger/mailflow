import React, { useState, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { CheckCircle2, Circle, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ThemeContext } from "@/Layout";

export default function CustomerTasksTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [showDone, setShowDone] = useState(false);

  // QueryKey ["tasks", ...] damit TaskBoard-Invalidierungen auch hier ankommen
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", "customer", customer.id],
    queryFn: () => entities.Task.filter({ customer_id: customer.id }, "-created_date"),
  });

  const textMuted  = isArtis ? '#6b826b' : isLight ? '#9090b8' : '#52525b';
  const hoverBg    = isArtis ? '#eff3ef' : isLight ? '#ebebf4' : 'rgba(63,63,70,0.4)';
  const hoverBorder= isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)';
  const accentColor= isArtis ? '#7a9b7f' : isLight ? '#7c3aed' : '#6366f1';

  const open = tasks.filter(t => !t.completed);
  const done = tasks.filter(t =>  t.completed);

  if (isLoading) return (
    <div className="text-sm py-4" style={{ color: textMuted }}>Lade Tasks...</div>
  );

  if (tasks.length === 0) return (
    <div className="text-center py-8 text-sm" style={{ color: textMuted }}>
      Keine Tasks zugeordnet.
    </div>
  );

  const TaskRow = ({ task }) => (
    <div
      key={task.id}
      className="flex items-start gap-3 p-3 rounded-lg border border-transparent transition-colors"
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.borderColor = hoverBorder; }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.borderColor = 'transparent'; }}
    >
      {task.completed
        ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
        : <Circle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: textMuted }} />
      }
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium"
          style={{
            color: task.completed ? textMuted : (isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7'),
            textDecoration: task.completed ? 'line-through' : 'none',
          }}
        >
          {task.title}
        </div>
        {task.description && (
          <div className="text-xs truncate" style={{ color: textMuted }}>{task.description}</div>
        )}
      </div>
      {task.due_date && (
        <div className="text-xs flex-shrink-0" style={{ color: textMuted }}>
          {format(new Date(task.due_date), "dd.MM.yy", { locale: de })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-1">
      {/* ── Offene Tasks ── */}
      {open.length === 0 ? (
        <div className="text-sm py-2 px-1" style={{ color: textMuted }}>
          Keine offenen Tasks.
        </div>
      ) : (
        open.map(task => <TaskRow key={task.id} task={task} />)
      )}

      {/* ── Erledigte Tasks (ausklappbar) ── */}
      {done.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowDone(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-1 py-1.5 w-full text-left transition-colors rounded"
            style={{ color: textMuted }}
          >
            {showDone
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />
            }
            Erledigt ({done.length})
          </button>
          {showDone && (
            <div className="space-y-1 mt-1">
              {done.map(task => <TaskRow key={task.id} task={task} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
