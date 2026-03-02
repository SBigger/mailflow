import React, { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import { CheckCircle2, Circle } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ThemeContext } from "@/Layout";

export default function CustomerTasksTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks-customer", customer.id],
    queryFn: () => entities.Task.filter({ customer_id: customer.id }, "-created_date"),
  });

  if (isLoading) return <div className="text-sm py-4" style={{ color: isLight ? '#9090b8' : '#52525b' }}>Lade Tasks...</div>;
  if (tasks.length === 0) return <div className="text-center py-8 text-sm" style={{ color: isLight ? '#9090b8' : '#52525b' }}>Keine Tasks zugeordnet.</div>;

  return (
    <div className="space-y-1">
      {tasks.map(task => (
        <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border border-transparent transition-colors"
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = isLight ? '#ebebf4' : 'rgba(63,63,70,0.4)'; e.currentTarget.style.borderColor = isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.borderColor = 'transparent'; }}
        >
          {task.completed
            ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
            : <Circle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: isLight ? '#9090b8' : '#71717a' }} />
          }
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium" style={{ color: task.completed ? (isLight ? '#9090b8' : '#71717a') : (isLight ? '#1a1a2e' : '#e4e4e7'), textDecoration: task.completed ? 'line-through' : 'none' }}>
              {task.title}
            </div>
            {task.description && (
              <div className="text-xs truncate" style={{ color: isLight ? '#8080a0' : '#71717a' }}>{task.description}</div>
            )}
          </div>
          {task.due_date && (
            <div className="text-xs flex-shrink-0" style={{ color: isLight ? '#9090b8' : '#52525b' }}>
              {format(new Date(task.due_date), "dd.MM.yy", { locale: de })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}