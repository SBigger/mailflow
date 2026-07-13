import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ListTodo, ChevronLeft, ChevronRight, Clock, CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

function TaskChip({ task, priority, theme }) {
  const isScheduled = !!task.scheduled_start;
  // Bereits geplante Aufgaben werden zusätzlich als Block im Wochenraster gerendert (gleiche
  // draggable-id "task-<id>") — nur EIN Drag-Handle pro Task darf aktiv sein, sonst kollidieren
  // die dnd-kit-Registrierungen. Umplanen erfolgt daher über den Grid-Block, nicht den Chip.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    disabled: isScheduled,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-lg px-2.5 py-2 border select-none transition-opacity ${isScheduled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
      style={{
        backgroundColor: theme.rowBg,
        borderColor: theme.rowBorder,
        opacity: isDragging ? 0.3 : isScheduled ? 0.55 : 1,
      }}
      title={task.title}
    >
      <div className="flex items-start gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: priority?.color || theme.textMuted }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: theme.headingColor }}>
            {task.title}
          </p>
          {isScheduled ? (
            <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: theme.accentColor }}>
              <CheckCircle2 className="h-3 w-3" />
              geplant {format(parseISO(task.scheduled_start), 'dd.MM. HH:mm', { locale: de })}
            </p>
          ) : task.due_date ? (
            <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: theme.textMuted }}>
              <Clock className="h-3 w-3" />
              {format(parseISO(task.due_date), 'dd.MM.yyyy', { locale: de })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function TaskSidebar({ tasks, priorities, collapsed, onToggleCollapse, theme }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'task-sidebar' });
  const priorityMap = React.useMemo(() => {
    const m = new Map();
    for (const p of priorities) m.set(p.id, p);
    return m;
  }, [priorities]);

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center py-3 border-r flex-shrink-0"
        style={{ width: 40, backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
      >
        <button onClick={onToggleCollapse} title="Aufgaben anzeigen" style={{ color: theme.textMuted }}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col border-r flex-shrink-0 overflow-hidden"
      style={{
        width: 260,
        backgroundColor: isOver ? theme.todayBg : theme.cardBg,
        borderColor: theme.cardBorder,
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: theme.cardBorder }}
      >
        <div className="flex items-center gap-1.5">
          <ListTodo className="h-4 w-4" style={{ color: theme.accentColor }} />
          <h3 className="text-xs font-semibold" style={{ color: theme.headingColor }}>
            Meine Aufgaben
          </h3>
          {tasks.length > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: theme.accentColor, color: '#fff' }}
            >
              {tasks.length}
            </span>
          )}
        </div>
        <button onClick={onToggleCollapse} title="Einklappen" style={{ color: theme.textMuted }}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-2">
            <ListTodo className="h-6 w-6 opacity-30" style={{ color: theme.textMuted }} />
            <p className="text-xs" style={{ color: theme.textMuted }}>Keine offenen Aufgaben</p>
          </div>
        ) : (
          tasks.map(task => (
            <TaskChip
              key={task.id}
              task={task}
              priority={priorityMap.get(task.priority_id)}
              theme={theme}
            />
          ))
        )}
      </div>
    </div>
  );
}
