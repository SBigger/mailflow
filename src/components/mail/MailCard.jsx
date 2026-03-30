import React, { useState, useContext } from "react";
import { Paperclip, AlertTriangle, Clock, Folder, Bell, Reply, Trash2 } from "lucide-react";
import { isPast, isToday, format } from "date-fns";
import { de } from "date-fns/locale";
import { entities, functions, auth } from "@/api/supabaseClient";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";

export default function MailCard({ mail, isDragging, onClick, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm('Email löschen?')) return;
    
    setDeleting(true);
    try {
      await functions.invoke('deleteOutlookMail', { mail_id: mail.id });
      toast.success('Email erfolgreich gelöscht');
      onDelete?.(mail);
    } catch (error) {
      toast.error('Fehler: ' + (error.response?.data?.error || error.message));
    } finally {
      setDeleting(false);
    }
  };
  const priorityIndicator = {
    high: "border-l-red-400",
    normal: "border-l-transparent",
    low: "border-l-zinc-600",
  };

  const initials = (mail.sender_name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const formattedDate = mail.received_date
    ? format(new Date(mail.received_date), "dd MMM, HH:mm", { locale: de })
    : "";

  return (
    <div
      onClick={onClick}
      className={`group relative backdrop-blur-sm border rounded-xl p-3.5 cursor-pointer transition-all duration-200 border-l-[3px] ${
        priorityIndicator[mail.priority || "normal"]
      } ${
        isDragging
          ? "shadow-2xl shadow-indigo-500/20 ring-1 ring-indigo-500/30 scale-[1.02]"
          : isLight
          ? "hover:shadow-md"
          : "hover:bg-zinc-800/60 hover:border-zinc-700/60 hover:shadow-lg hover:shadow-black/20"
      } ${!mail.is_read ? "" : "opacity-80"} ${mail.is_completed ? "opacity-40" : ""}`}
      style={{
        backgroundColor: isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.8)',
        borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)',
        borderLeftColor: priorityIndicator[mail.priority || "normal"] === 'border-l-transparent' ? 'transparent' : undefined,
      }}
    >
      <div className="flex items-start gap-3">
         {/* Avatar with Delete Button */}
         <div className="flex flex-col items-center gap-1">
          <div
            className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold`}
            style={{
              backgroundColor: !mail.is_read
                ? 'rgba(99,102,241,0.15)'
                : isArtis ? '#e6ede6' : isLight ? '#e8e8f4' : '#27272a',
              color: !mail.is_read
                ? isArtis ? '#4a7a52' : isLight ? '#4f46e5' : '#a5b4fc'
                : isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a',
            }}
          >
            {initials}
          </div>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 text-zinc-600 hover:text-red-400 transition-colors touch-manipulation md:opacity-0 md:group-hover:opacity-100"
            title="Email löschen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
         </div>

        <div className="flex-1 min-w-0">
          {/* Sender & Date */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className={`text-sm truncate ${
                !mail.is_read ? "font-bold" : "font-semibold"
              }`}
              style={{
                color: !mail.is_read
                  ? (isArtis ? '#1e5030' : isLight ? '#1a3a7a' : '#c4d4ff')
                  : (isArtis ? '#4a7a5a' : isLight ? '#4a4a8a' : '#a1a1aa'),
              }}
            >
              {mail.sender_name}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : 'rgba(255,255,255,0.5)' }}>
              <Clock className="h-3 w-3" />
              <span className="text-[10px]">{formattedDate}</span>
            </div>
          </div>

          {/* Subject */}
          <p
            className={`text-sm truncate mb-1 ${!mail.is_read ? 'font-semibold' : 'font-medium'}`}
            style={{ color: !mail.is_read ? (isArtis ? '#1a2e1a' : isLight ? '#1a1a2e' : '#f4f4f5') : (isArtis ? '#4a5e4a' : isLight ? '#5a5a7a' : '#c4c4cc') }}
          >
            {mail.subject}
          </p>

          {/* Preview */}
          {mail.body_preview && (
            <p className="text-xs line-clamp-1 md:line-clamp-2 leading-relaxed" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a' }}>
              {mail.body_preview}
            </p>
          )}

          {/* Tags & Indicators */}
          <div className="hidden md:flex flex-wrap items-center gap-1.5 mt-2">
            {mail.mailbox === 'personal' && (
              <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded-md border border-cyan-500/20 hidden md:inline">
                Persönlich
              </span>
            )}
            {(mail.tags || []).slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-md border border-violet-500/20"
              >
                {tag}
              </span>
            ))}
            {(mail.tags || []).length > 2 && (
              <span className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-md border border-violet-500/20 md:hidden">
                +{mail.tags.length - 2}
              </span>
            )}
            {mail.priority === "high" && (
              <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-md">
                <AlertTriangle className="h-2.5 w-2.5" /> Wichtig
              </span>
            )}
            {mail.has_attachments && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a', backgroundColor: isArtis ? '#e6ede6' : isLight ? '#e8e8f4' : '#27272a' }}>
                <Paperclip className="h-2.5 w-2.5" /> Anhang
              </span>
            )}
            {mail.project && (
              <span className="flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-md">
                <Folder className="h-2.5 w-2.5" /> {mail.project}
              </span>
            )}
            {mail.reminder_date && (() => {
              const reminderDate = new Date(mail.reminder_date);
              const isOverdue = isPast(reminderDate) && !isToday(reminderDate);
              const isReminderToday = isToday(reminderDate);
              return (
                <span 
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ${
                    isOverdue 
                      ? 'text-red-400 bg-red-500/10' 
                      : isReminderToday 
                      ? 'text-amber-400 bg-amber-500/10' 
                      : 'text-blue-400 bg-blue-500/10'
                  }`}
                  title={`Reminder: ${format(reminderDate, "dd.MM.yyyy HH:mm", { locale: de })}`}
                >
                  <Bell className="h-2.5 w-2.5" /> {format(reminderDate, 'dd.MM.', { locale: de })}
                </span>
              );
            })()}
            {mail.is_replied && (
              <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-md">
                <Reply className="h-2.5 w-2.5" /> Beantwortet
              </span>
            )}
          </div>
        </div>
      </div>


    </div>
  );
}