import React from 'react';
import { ListTodo } from 'lucide-react';

export default function TaskDragOverlay({ task, priority }) {
  if (!task) return null;
  return (
    <div
      className="rounded-lg px-2.5 py-2 border-2 shadow-lg"
      style={{
        width: 240,
        backgroundColor: '#ffffff',
        borderColor: priority?.color || '#6366f1',
        opacity: 0.95,
      }}
    >
      <div className="flex items-center gap-1.5">
        <ListTodo className="h-3.5 w-3.5" style={{ color: priority?.color || '#6366f1' }} />
        <p className="text-xs font-medium truncate" style={{ color: '#1a1a2e' }}>
          {task.title}
        </p>
      </div>
    </div>
  );
}
