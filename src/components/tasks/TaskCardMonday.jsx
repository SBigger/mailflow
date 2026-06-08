import React, { useState, useEffect, useContext } from "react";
import { Draggable } from "@hello-pangea/dnd";
import { Clock, AlertTriangle, Mail, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, isValid } from "date-fns";
import { de } from "date-fns/locale";
import { entities, supabase } from "@/api/supabaseClient";
import { useMutation } from "@tanstack/react-query";
import { ThemeContext } from "@/Layout";

// Monday-Style Kachel-Variante: zeigt bei "zugewiesen an" das Foto (Kopf) der Person.
// Drop-in-kompatibel zu TaskCard (gleiche Props & Verhalten).
export default function TaskCardMonday({ task, index, onClick, onToggleComplete, currentUser, priorities = [], assigneeUser }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [isRead, setIsRead] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  // Lesestatus beim Mounten prüfen + Realtime-Abo (identisch zu TaskCard)
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
      const { error } = await supabase.from('task_read_statuses').insert({
        task_id: task.id,
        user_email: currentUser.email
      });
      if (error && !error.message?.includes('duplicate') && !error.code?.includes('23505')) {
        throw new Error(error.message);
      }
    },
    onError: () => setIsRead(false)
  });

  const taskPriority = priorities.find(p => p.id === task.priority_id);
  const isAssignedToMe = currentUser && task.assignee === currentUser.email;
  const isNewUnread = isAssignedToMe && !isRead && !isChecking;

  const handleClick = React.useCallback(() => {
    onClick(task);
    if (isNewUnread) {
      setIsRead(true);
      if (!markAsReadMutation.isPending) markAsReadMutation.mutate();
    }
  }, [task, isNewUnread, markAsReadMutation]);

  const titleColor = task.completed
    ? (isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#71717a')
    : (isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7');
  const mutedColor = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#a1a1aa';

  // Akzentfarbe der Kachel = Prioritätsfarbe, sonst Spalten-/Theme-Akzent
  const accent = taskPriority?.color || (isArtis ? '#3d7a3d' : '#7c3aed');

  function formatDate(date) {
    try { return format(new Date(date), "dd.MM.yyyy", { locale: de }); }
    catch (e) { console.error(e); return ''; }
  }

  // Anzeigename + Initialen für den "Kopf"
  const assigneeName = assigneeUser?.full_name || (task.assignee ? task.assignee.split('@')[0] : null);
  const assigneeInitials = (assigneeUser?.full_name || task.assignee || '?')
    .split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
  const avatarBg = isArtis ? '#3d7a3d' : '#7c3aed';

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`rounded-2xl mb-2.5 border cursor-grab active:cursor-grabbing overflow-hidden ${task.completed ? "opacity-50" : ""}`}
          style={{
            backgroundColor: isNewUnread
              ? isArtis ? '#eef5ee' : isLight ? '#f3f0fe' : 'rgba(46,16,101,0.55)'
              : isLight || isArtis ? '#ffffff' : '#20202a',
            borderColor: snapshot.isDragging
              ? 'rgba(124,58,237,0.5)'
              : isHovered
                ? (isArtis ? '#b0c8b0' : isLight ? '#c4b5fd' : '#6b6b7e')
                : (isArtis ? '#e3ece3' : isLight ? '#e6e2f4' : '#313140'),
            boxShadow: snapshot.isDragging
              ? '0 20px 40px rgba(0,0,0,0.20), 0 8px 16px rgba(124,58,237,0.18)'
              : isHovered
                ? '0 10px 26px rgba(40,30,90,0.14), 0 3px 8px rgba(40,30,90,0.08)'
                : '0 1px 3px rgba(0,0,0,0.06)',
            transition: 'box-shadow 0.16s ease, border-color 0.16s ease',
            ...provided.draggableProps.style,
          }}
        >
          <div className="flex">
            {/* Farb-Akzent links (Monday-Signatur) */}
            <div className="w-1.5 flex-shrink-0" style={{ backgroundColor: accent }} />

            <div className="flex-1 p-3.5 min-w-0">
              {/* Titel + Erledigt-Toggle */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-start gap-1.5 flex-1 min-w-0">
                  {isNewUnread && <div className="flex-shrink-0 w-2 h-2 rounded-full bg-violet-400 mt-1.5" />}
                  <h4
                    className={`text-[15px] font-semibold leading-snug ${task.completed ? "line-through" : ""}`}
                    style={{ color: titleColor }}
                  >
                    {task.title}
                  </h4>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleComplete && onToggleComplete(task); }}
                  className="flex-shrink-0 mt-0.5 transition-colors"
                  style={{ color: task.completed ? '#22c55e' : mutedColor }}
                  title={task.completed ? "Als offen markieren" : "Als erledigt markieren"}
                >
                  {task.completed ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <Circle className="h-[18px] w-[18px]" />}
                </button>
              </div>

              {/* Beschreibung */}
              {task.description && (
                <p className="text-[12.5px] line-clamp-2 mb-2.5" style={{ color: mutedColor }}>
                  {task.description}
                </p>
              )}

              {/* Badges: Priorität, Frist, Mail */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {taskPriority && (
                  <Badge variant="outline" className="text-xs" style={{ backgroundColor: `${taskPriority.color}18`, borderColor: `${taskPriority.color}45`, color: taskPriority.color }}>
                    {taskPriority.level === 1 && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {taskPriority.name}
                  </Badge>
                )}
                {task.due_date && isValid(new Date(task.due_date)) && (
                  <Badge variant="outline" className="text-xs gap-1" style={{ backgroundColor: isArtis ? '#f4f7f4' : isLight ? '#ebebf4' : 'rgba(39,39,42,0.6)', borderColor: isArtis ? '#e0e0e0' : isLight ? '#d4d4e8' : '#3f3f46', color: mutedColor }}>
                    <Clock className="h-3 w-3" />
                    {formatDate(task.due_date)}
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
                    <span key={tag} className="text-xs px-2 py-0.5 rounded" style={{ color: '#818cf8', backgroundColor: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Footer: ZUGEWIESEN AN — der Kopf/Foto der Person */}
              {task.assignee && (
                <div
                  className="flex items-center gap-2.5 mt-3 pt-3"
                  style={{ borderTop: `1px solid ${isArtis ? '#eef3ee' : isLight ? '#efecf9' : '#2c2c39'}` }}
                >
                  <div
                    className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: avatarBg, boxShadow: '0 0 0 2px rgba(255,255,255,0.9), 0 1px 3px rgba(0,0,0,0.18)' }}
                  >
                    {assigneeUser?.avatar_url
                      ? <img src={assigneeUser.avatar_url} alt={assigneeName || ''} className="w-full h-full object-cover" />
                      : <span>{assigneeInitials}</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: mutedColor }}>Zugewiesen an</div>
                    <div className="text-[13px] font-semibold truncate" style={{ color: titleColor }}>{assigneeName}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
