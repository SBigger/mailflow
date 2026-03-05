import React, { useState, useEffect, useContext } from "react";
import { Draggable } from "@hello-pangea/dnd";
import { Clock, AlertTriangle, User, Mail, CheckCircle2, Circle, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { entities, supabase } from "@/api/supabaseClient";
import { useMutation } from "@tanstack/react-query";
import { ThemeContext } from "@/Layout";

export default function TaskCard({ task, index, onClick, onToggleComplete, currentUser, priorities = [], assigneeUser }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [isRead, setIsRead] = useState(false);
  const [isChecking, setIsChecking] = useState(true); // Start true → kein grüner Flash beim Laden

  // Lesestatus beim Mounten prüfen + Realtime-Abo
  useEffect(() => {
    if (!currentUser || !task.id) return;

    const checkReadStatus = async () => {
      setIsChecking(true);
      try {
        const status = await entities.TaskReadStatus.filter({
          task_id: task.id,
          user_email: currentUser.email
        });
        setIsRead(status.length > 0);
      } catch (e) {
        console.error('Failed to check read status:', e);
      } finally {
        setIsChecking(false);
      }
    };

    checkReadStatus();

    const unsubscribe = entities.TaskReadStatus.subscribe((event) => {
      if (event.data?.task_id === task.id && event.data?.user_email === currentUser.email) {
        if (event.type === 'DELETE' || event.type === 'delete') {
          setIsRead(false);
        } else {
          setIsRead(true);
        }
      }
    });

    return unsubscribe;
  }, [task.id, currentUser?.email]);

  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!currentUser) return;
      // Direkt supabase verwenden – task_read_statuses hat kein created_by
      const { error } = await supabase.from('task_read_statuses').insert({
        task_id: task.id,
        user_email: currentUser.email
      });
      // Duplicate-Fehler ignorieren (Eintrag existiert bereits)
      if (error && !error.message?.includes('duplicate') && !error.code?.includes('23505')) {
        throw new Error(error.message);
      }
    },
    onError: () => {
      // Optimistisches Update zurückrollen falls echter DB-Fehler
      setIsRead(false);
    }
  });

  const taskPriority = priorities.find(p => p.id === task.priority_id);
  const isAssignedToMe = currentUser && task.assignee === currentUser.email;
  const isNewUnread = isAssignedToMe && !isRead && !isChecking;

  const handleClick = React.useCallback(() => {
    onClick(task);
    if (isNewUnread) {
      setIsRead(true); // Optimistisch sofort als gelesen markieren
      if (!markAsReadMutation.isPending) {
        markAsReadMutation.mutate();
      }
    }
  }, [task, isNewUnread, markAsReadMutation]);

  const titleColor = task.completed
    ? (isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#71717a')
    : (isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7');

  const mutedColor = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a';
  const gripColor = isArtis ? '#c8d8c8' : isLight ? '#c8c8dc' : '#3f3f46';

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={handleClick}
          className={`
            rounded-xl mb-2 border cursor-grab active:cursor-grabbing
            ${task.completed ? "opacity-50" : ""}
          `}
          style={{
            backgroundColor: isNewUnread
              ? isArtis ? '#eef5ee' : isLight ? '#ede9fe' : 'rgba(46,16,101,0.6)'
              : '#ffffff',
            borderColor: snapshot.isDragging
              ? 'rgba(99,102,241,0.5)'
              : isNewUnread
                ? isArtis ? 'rgba(122,155,127,0.6)' : isLight ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.6)'
                : isArtis ? '#e8e8e8' : isLight ? '#d4d4e8' : '#52525b',
            boxShadow: snapshot.isDragging
              ? '0 20px 40px rgba(0,0,0,0.18), 0 8px 16px rgba(99,102,241,0.15)'
              : '0 1px 3px rgba(0,0,0,0.06)',
            outline: snapshot.isDragging ? '2px solid rgba(99,102,241,0.35)' : 'none',
            opacity: snapshot.isDragging ? 0.97 : 1,
          }}
        >
          <div className="flex items-stretch">
            {/* Grip-Icon – nur visueller Hinweis, ganze Karte ist ziehbar */}
            <div
              className="flex items-center justify-center w-6 flex-shrink-0 rounded-l-xl"
              style={{ borderRight: `1px solid ${isNewUnread ? (isArtis ? 'rgba(122,155,127,0.2)' : 'rgba(124,58,237,0.15)') : (isArtis ? '#f0f0f0' : isLight ? '#e8e8f4' : '#3a3a40')}` }}
            >
              <GripVertical className="h-3.5 w-3.5" style={{ color: gripColor }} />
            </div>

            {/* Karteninhalt */}
            <div className="flex-1 p-3 min-w-0">
              {/* Titel + Erledigt-Button */}
              <div className="flex items-start justify-between mb-1.5 gap-2">
                <div className="flex items-start gap-1.5 flex-1 min-w-0">
                  {isNewUnread && (
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-violet-400 mt-1.5" />
                  )}
                  <h4
                    className={`text-sm font-medium line-clamp-2 flex-1 ${task.completed ? "line-through" : ""}`}
                    style={{ color: titleColor }}
                  >
                    {task.title}
                  </h4>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleComplete && onToggleComplete(task);
                  }}
                  className="flex-shrink-0 mt-0.5 transition-colors"
                  style={{ color: task.completed ? '#22c55e' : mutedColor }}
                  title={task.completed ? "Als offen markieren" : "Als erledigt markieren"}
                >
                  {task.completed
                    ? <CheckCircle2 className="h-4 w-4" />
                    : <Circle className="h-4 w-4" />
                  }
                </button>
              </div>

              {/* Beschreibung */}
              {task.description && (
                <p className="text-xs line-clamp-2 mb-2" style={{ color: mutedColor }}>
                  {task.description}
                </p>
              )}

              {/* Badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {taskPriority && (
                  <Badge variant="outline" className="text-xs" style={{ backgroundColor: `${taskPriority.color}18`, borderColor: `${taskPriority.color}40`, color: taskPriority.color }}>
                    {taskPriority.level === 1 && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {taskPriority.name}
                  </Badge>
                )}

                {task.assignee && (
                  <Badge variant="outline" className="text-xs gap-1" style={{ backgroundColor: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.25)', color: '#7c3aed' }}>
                    <User className="h-3 w-3" />
                    {assigneeUser?.full_name || task.assignee.split('@')[0]}
                  </Badge>
                )}

                {task.due_date && (
                  <Badge variant="outline" className="text-xs gap-1" style={{ backgroundColor: isArtis ? '#f4f7f4' : isLight ? '#ebebf4' : 'rgba(39,39,42,0.5)', borderColor: isArtis ? '#e0e0e0' : isLight ? '#d4d4e8' : '#3f3f46', color: mutedColor }}>
                    <Clock className="h-3 w-3" />
                    {format(new Date(task.due_date), "dd.MM", { locale: de })}
                  </Badge>
                )}

                {task.linked_mail_id && (
                  <Badge variant="outline" className="text-xs gap-1 bg-cyan-500/10 border-cyan-500/30 text-cyan-500">
                    <Mail className="h-3 w-3" />
                  </Badge>
                )}
              </div>

              {/* Tags */}
              {task.tags && task.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {task.tags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded" style={{ color: '#818cf8', backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
