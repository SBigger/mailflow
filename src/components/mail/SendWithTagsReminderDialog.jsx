import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { addDays, addWeeks, format } from "date-fns";

export default function SendWithTagsReminderDialog({
  open,
  onClose,
  onSend,
  tags = [],
}) {
  const [addTag, setAddTag] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [addReminder, setAddReminder] = useState(false);
  const [reminderType, setReminderType] = useState("today");
  const [customDate, setCustomDate] = useState("");
  const [isSending, setIsSending] = useState(false);

  const getReminderDate = () => {
    const now = new Date();
    now.setHours(9, 0, 0, 0); // 9:00 Uhr als Standard
    
    if (reminderType === "today") return now;
    const future = reminderType === "tomorrow" ? addDays(now, 1) : reminderType === "3days" ? addDays(now, 3) : reminderType === "week" ? addWeeks(now, 1) : null;
    if (future) {
      future.setHours(9, 0, 0, 0);
      return future;
    }
    if (reminderType === "custom" && customDate) {
      const customDateTime = new Date(customDate);
      customDateTime.setHours(9, 0, 0, 0);
      return customDateTime;
    }
    return null;
  };

  const handleSend = async (saveData) => {
    setIsSending(true);
    try {
      const data = {
        tag: addTag ? selectedTag : null,
        reminder: addReminder ? getReminderDate() : null,
      };
      await onSend(data);
    } finally {
      setIsSending(false);
      resetForm();
      onClose();
    }
  };

  const resetForm = () => {
    setAddTag(false);
    setSelectedTag("");
    setAddReminder(false);
    setReminderType("today");
    setCustomDate("");
  };

  const reminderDateDisplay = addReminder ? getReminderDate()?.toLocaleDateString('de-DE') : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Email speichern und nachverfolgen?</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Tag Section */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={addTag}
                onCheckedChange={setAddTag}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-zinc-200">Tag hinzufügen</span>
            </label>

            {addTag && (
              <div className="ml-7 space-y-2">
                <select
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Tag auswählen</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                {selectedTag && (
                  <div className="flex gap-2 flex-wrap">
                    <Badge className="bg-indigo-600/20 text-indigo-300 border-indigo-500/30">
                      {selectedTag}
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reminder Section */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={addReminder}
                onCheckedChange={setAddReminder}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-zinc-200">Reminder setzen</span>
            </label>

            {addReminder && (
              <div className="ml-7 space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-400">Zeitpunkt</Label>
                  <select
                    value={reminderType}
                    onChange={(e) => setReminderType(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md px-3 py-2 text-sm"
                  >
                    <option value="today">Heute</option>
                    <option value="tomorrow">Morgen</option>
                    <option value="3days">In 3 Tagen</option>
                    <option value="week">Nächste Woche</option>
                    <option value="custom">Benutzerdefinierten Datum</option>
                  </select>
                </div>

                {reminderType === "custom" && (
                  <div className="space-y-2">
                    <Label className="text-xs text-zinc-400">Datum</Label>
                    <Input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-zinc-200"
                    />
                  </div>
                )}

                {reminderDateDisplay && (
                  <div className="text-xs text-zinc-400">
                    Reminder am: <span className="text-zinc-200 font-medium">{reminderDateDisplay}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 flex">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            Abbrechen
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSend(false)}
            disabled={isSending}
            className="border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            Nur senden
          </Button>
          <Button
            onClick={() => handleSend(true)}
            disabled={isSending || (addTag && !selectedTag)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            {isSending ? "Wird gesendet..." : "Speichern & Senden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}