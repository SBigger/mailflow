import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Check, X } from "lucide-react";
import { format, addDays } from "date-fns";
import { de } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ReminderDatePicker({ open, onClose, onSave, currentReminder }) {
  const [selectedDate, setSelectedDate] = useState(currentReminder ? new Date(currentReminder) : null);
  const [selectedTime, setSelectedTime] = useState(currentReminder ? format(new Date(currentReminder), "HH:mm") : "09:00");

  const quickOptions = [
    { label: "Heute", getValue: () => new Date() },
    { label: "Morgen", getValue: () => addDays(new Date(), 1) },
    { label: "In 3 Tagen", getValue: () => addDays(new Date(), 3) },
    { label: "Nächste Woche", getValue: () => addDays(new Date(), 7) },
  ];

  const handleSave = () => {
    if (!selectedDate) return;

    const [hours, minutes] = selectedTime.split(":").map(Number);
    const finalDate = new Date(selectedDate);
    finalDate.setHours(hours, minutes, 0);

    onSave(finalDate.toISOString());
    setSelectedDate(null);
    setSelectedTime("09:00");
  };

  const handleQuickOption = (getValue) => {
    setSelectedDate(getValue());
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Reminder setzen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Quick Options */}
          <div className="grid grid-cols-2 gap-2">
            {quickOptions.map((option) => (
              <button
                key={option.label}
                onClick={() => handleQuickOption(option.getValue)}
                className="px-3 py-2 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg text-sm text-zinc-300 hover:text-zinc-100 transition-colors border border-zinc-700/50 hover:border-zinc-600/50"
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Date Picker */}
          <div className="space-y-2">
            <label className="text-sm text-zinc-400 flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Datum
            </label>
            <input
              type="date"
              value={selectedDate ? format(selectedDate, "yyyy-MM-dd") : ""}
              onChange={(e) => setSelectedDate(e.target.value ? new Date(e.target.value) : null)}
              className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>

          {/* Time Picker */}
          <div className="space-y-2">
            <label className="text-sm text-zinc-400 flex items-center gap-2">
              <Clock className="h-4 w-4" /> Uhrzeit
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>

          {/* Selected Reminder Display */}
          {selectedDate && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm text-amber-300">
                Reminder: {format(
                  new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 
                    parseInt(selectedTime.split(":")[0]), parseInt(selectedTime.split(":")[1])),
                  "EEEE, dd. MMMM 'um' HH:mm 'Uhr'",
                  { locale: de }
                )}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800/50"
            >
              <X className="h-4 w-4 mr-2" /> Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={!selectedDate}
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white"
            >
              <Check className="h-4 w-4 mr-2" /> Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}