import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, Mail, Edit2, Check, X, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export default function ReminderDialog({ open, onClose, reminders, onMailClick, onUpdateReminder }) {
  const [editingId, setEditingId] = useState(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  if (!reminders || reminders.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Calendar className="h-5 w-5 text-indigo-400" />
              Anstehende Reminder
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-zinc-500">
            Keine Reminder vorhanden
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Calendar className="h-5 w-5 text-indigo-400" />
            Anstehende Reminder ({reminders.length})
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          {reminders.map((mail) => (
            <div
              key={mail.id}
              className="w-full p-4 bg-zinc-900/60 rounded-lg border border-zinc-800/60"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => {
                    onMailClick(mail);
                    onClose();
                  }}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Mail className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                    <h3 className="font-semibold text-zinc-100 truncate">
                      {mail.subject}
                    </h3>
                  </div>
                  <p className="text-sm text-zinc-400 mb-2">
                    Von: {mail.sender_name}
                  </p>
                  {mail.body_preview && (
                    <p className="text-xs text-zinc-500 line-clamp-2">
                      {mail.body_preview}
                    </p>
                  )}
                </button>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {editingId === mail.id ? (
                    <div className="flex flex-col gap-2">
                      <Input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="h-8 w-36 text-xs bg-zinc-800 border-zinc-700"
                      />
                      <Input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="h-8 w-36 text-xs bg-zinc-800 border-zinc-700"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            const [hours, minutes] = editTime.split(":").map(Number);
                            const finalDate = new Date(editDate);
                            finalDate.setHours(hours, minutes, 0);
                            onUpdateReminder?.(mail.id, finalDate.toISOString());
                            setEditingId(null);
                          }}
                          className="h-7 px-2 bg-green-600 hover:bg-green-500"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                          className="h-7 px-2"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                        <Clock className="h-3 w-3" />
                        {format(new Date(mail.reminder_date), 'dd.MM.yyyy', { locale: de })}
                      </div>
                      <div className="text-xs text-zinc-600">
                        {format(new Date(mail.reminder_date), 'HH:mm', { locale: de })} Uhr
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(mail.id);
                            setEditDate(format(new Date(mail.reminder_date), 'yyyy-MM-dd'));
                            setEditTime(format(new Date(mail.reminder_date), 'HH:mm'));
                          }}
                          className="h-6 px-2 text-zinc-500 hover:text-amber-400"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onUpdateReminder?.(mail.id, null);
                          }}
                          className="h-6 px-2 text-zinc-500 hover:text-red-400"
                          title="Reminder entfernen"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}