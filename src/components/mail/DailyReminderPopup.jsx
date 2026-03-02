import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell, Mail, X } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export default function DailyReminderPopup({ reminders, onMailClick, onDismiss }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (reminders && reminders.length > 0) {
      setOpen(true);
    }
  }, [reminders]);

  const handleClose = () => {
    setOpen(false);
    onDismiss?.();
  };

  if (!reminders || reminders.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Bell className="h-5 w-5 text-amber-400 animate-pulse" />
            Reminder für heute ({reminders.length})
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4 max-h-96 overflow-y-auto">
          {reminders.map((mail) => (
            <button
              key={mail.id}
              onClick={() => {
                onMailClick(mail);
                handleClose();
              }}
              className="w-full p-4 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/30 hover:border-amber-500/50 transition-all text-left"
            >
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-zinc-100 mb-1">
                    {mail.subject}
                  </h3>
                  <p className="text-sm text-zinc-400 mb-2">
                    Von: {mail.sender_name}
                  </p>
                  {mail.body_preview && (
                    <p className="text-xs text-zinc-500 line-clamp-2">
                      {mail.body_preview}
                    </p>
                  )}
                  <div className="mt-2 text-xs text-amber-400">
                    Reminder: {format(new Date(mail.reminder_date), 'HH:mm', { locale: de })} Uhr
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={handleClose} variant="outline" className="border-zinc-700">
            Schliessen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}