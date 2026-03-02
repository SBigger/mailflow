import React, { useState } from "react";
import { Bell, Check, Clock, Edit2, Trash2 } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReminderDatePicker from "./ReminderDatePicker";

export default function ReminderItem({ mail, onComplete, onReschedule, onDelete, onClick }) {
  const [reschedulerOpen, setReschedulerOpen] = useState(false);

  const reminderDate = new Date(mail.reminder_date);
  const isOverdue = isPast(reminderDate) && !isToday(reminderDate);
  const isTonight = isToday(reminderDate);

  const timeDisplay = format(reminderDate, "dd. MMMM yyyy HH:mm", { locale: de });
  const relativeTime = isOverdue 
    ? `Überfällig seit ${format(reminderDate, "d. MMMM", { locale: de })}`
    : isTonight
    ? format(reminderDate, "HH:mm 'Uhr'")
    : format(reminderDate, "dd. MMMM HH:mm", { locale: de });

  return (
    <>
      <div
        onClick={onClick}
        className={`group bg-zinc-900/60 border rounded-xl p-4 cursor-pointer transition-all hover:bg-zinc-800/60 ${
          isOverdue
            ? "border-red-500/30 hover:border-red-500/50"
            : isTonight
            ? "border-amber-500/30 hover:border-amber-500/50"
            : "border-zinc-700/60 hover:border-zinc-600/60"
        }`}
      >
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
            <Bell className={`h-5 w-5 ${isOverdue ? "text-red-400" : isTonight ? "text-amber-400" : "text-zinc-500"}`} />
          </div>

          <div className="flex-1 min-w-0">
            {/* Email Subject */}
            <h3 className="text-sm font-semibold text-zinc-100 truncate hover:text-indigo-300">
              {mail.subject}
            </h3>

            {/* Sender / Recipient */}
            <p className="text-xs text-zinc-500 mt-0.5">
              {mail.to ? (
                <>
                  <span>An: {mail.recipient_name || mail.to}</span>
                </>
              ) : (
                `Von: ${mail.sender_name}`
              )}
            </p>

            {/* Reminder Date */}
            <div className="flex items-center gap-2 mt-2">
              <Clock className="h-3.5 w-3.5 text-zinc-600" />
              <span className={`text-xs font-medium ${isOverdue ? "text-red-400" : isTonight ? "text-amber-400" : "text-zinc-400"}`}>
                {relativeTime}
              </span>
            </div>

            {/* Tags */}
            {mail.tags && mail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {mail.tags.map((tag) => (
                  <Badge key={tag} className="text-xs bg-violet-500/10 text-violet-300 border-violet-500/20">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
           <Button
             variant="ghost"
             size="sm"
             onClick={(e) => {
               e.stopPropagation();
               setReschedulerOpen(true);
             }}
             className="text-zinc-500 hover:text-zinc-300 hover:bg-white/5 h-8 px-2"
             title="Reminder verschieben"
           >
             <Edit2 className="h-3.5 w-3.5" />
           </Button>
           <Button
             variant="ghost"
             size="sm"
             onClick={(e) => {
               e.stopPropagation();
               onDelete?.(mail);
             }}
             className="text-red-500 hover:text-red-400 hover:bg-red-500/10 h-8 px-2"
             title="Reminder löschen"
           >
             <Trash2 className="h-3.5 w-3.5" />
           </Button>
           <Button
             variant="ghost"
             size="sm"
             onClick={(e) => {
               e.stopPropagation();
               onComplete?.(mail);
             }}
             className="text-green-500 hover:text-green-400 hover:bg-green-500/10 h-8 px-2"
             title="Erledigt"
           >
             <Check className="h-3.5 w-3.5" />
           </Button>
          </div>
        </div>
      </div>

      <ReminderDatePicker
        open={reschedulerOpen}
        onClose={() => setReschedulerOpen(false)}
        onSave={(newDate) => {
          onReschedule?.(mail, newDate);
          setReschedulerOpen(false);
        }}
        currentReminder={mail.reminder_date}
      />
    </>
  );
}