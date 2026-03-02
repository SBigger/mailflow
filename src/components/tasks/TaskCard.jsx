import React, { useState, useEffect, useContext } from "react";
import { Draggable } from "@hello-pangea/dnd";
import { Clock, AlertTriangle, User, Mail, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ThemeContext } from "@/Layout";

export default function TaskCard({ task, index, onClick, onToggleComplete, currentUser, priorities = [], assigneeUser }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [isRead, setIsRead] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  // Check read status on mount and subscribe to changes
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

    // Subscribe to real-time changes
    const unsubscribe = entities.TaskReadStatus.subscribe((event) => {
      if (event.data?.task_id === task.id && event.data?.user_email === currentUser.email) {
        setIsRead(event.type === 'create' || event.type === 'update');
      }
    });

    return unsubscribe;
  }, [task.id, currentUser?.email]);

  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!currentUser) return;
      await entities.TaskReadStatus.create({
        task_id: task.id,
        user_email: currentUser.email
      });
      setIsRead(true);
    },
    onError: () => {
      console.error('Failed to mark as read');
    }
  });

  const taskPriority = priorities.find(p => p.id === task.priority_id);
  const isAssignedToMe = currentUser && task.assignee === currentUser.email;
  const isNewUnread = isAssignedToMe && !isRead && !isChecking;

  const handleClick = React.useCallback((e) => {
    onClick(task);
    if (isNewUnread && !markAsReadMutation.isPending) {
      markAsReadMutation.mutate();
    }
  }, [task, isNewUnread, markAsReadMutation]);

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
           ref={provided.innerRef}
           {...provided.draggableProps}
           {...provided.dragHandleProps}
           onClick={handleClick}
          className={`
            rounded-xl p-4 mb-3 border cursor-pointer transition-all duration-200 backdrop-blur-sm
            ${snapshot.isDragging ? "shadow-2xl shadow-indigo-500/20 ring-2 ring-indigo-500/40" : ""}
            ${task.completed ? "opacity-50" : ""}
          `}
          style={{
            backgroundColor: isNewUnread
              ? isArtis ? '#e6ede6' : isLight ? '#ede9fe' : 'rgba(46,16,101,0.6)'
              : isArtis ? '#ffffff' : isLight ? '#ffffff' : '#000000',
            borderColor: isNewUnread
              ? isArtis ? 'rgba(122,155,127,0.5)' : isLight ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.6)'
              : isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : '#52525b',
          }}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <div className="flex items-start gap-2 flex-1">
              {isNewUnread && (
                <div className="flex-shrink-0 w-2 h-2 rounded-full bg-violet-400 mt-1.5" />
              )}
              <h4 className={`text-sm font-medium line-clamp-2 flex-1 ${task.completed ? "line-through" : ""}`} style={{ color: task.completed ? (isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#71717a') : (isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7') }}>
                {task.title}
              </h4>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleComplete && onToggleComplete(task);
              }}
              className="flex-shrink-0 mt-0.5 text-zinc-500 hover:text-green-400 transition-colors"
              title={task.completed ? "Als offen markieren" : "Als erledigt markieren"}
            >
              {task.completed
                ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                : <Circle className="h-4 w-4" />
              }
            </button>
          </div>

          {task.description && (
            <p className="text-xs line-clamp-2 mb-3" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a' }}>
              {task.description}
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {taskPriority && (
              <Badge variant="outline" style={{ backgroundColor: `${taskPriority.color}20`, borderColor: `${taskPriority.color}50`, color: taskPriority.color }}>
                {taskPriority.level === 1 && <AlertTriangle className="h-3 w-3 mr-1" />}
                {taskPriority.name}
              </Badge>
            )}

            {task.assignee && (
               <Badge variant="outline" className="bg-violet-500/10 border-violet-500/30 text-violet-400 text-xs gap-1">
                 <User className="h-3 w-3" />
                 {assigneeUser?.full_name || task.assignee}
               </Badge>
             )}

            {task.due_date && (
              <Badge variant="outline" className="text-xs gap-1" style={{ backgroundColor: isArtis ? '#edf2ed' : isLight ? '#ebebf4' : 'rgba(39,39,42,0.5)', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : '#3f3f46', color: isArtis ? '#5a7a5f' : isLight ? '#5a5a7a' : '#a1a1aa' }}>
                <Clock className="h-3 w-3" />
                {format(new Date(task.due_date), "dd.MM", { locale: de })}
              </Badge>
            )}

            {task.linked_mail_id && (
              <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-400 text-xs gap-1">
                <Mail className="h-3 w-3" />
              </Badge>
            )}
          </div>

          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {task.tags.map((tag) => (
                <span key={tag} className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}