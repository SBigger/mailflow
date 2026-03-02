import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#64748b",
];

export default function AddColumnDialog({ open, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);

  const handleAdd = () => {
    if (name.trim()) {
      onAdd({ name: name.trim(), color });
      setName("");
      setColor(COLORS[0]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-200 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Neue Spalte erstellen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-zinc-400 text-xs">Spaltenname</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. In Bearbeitung"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400 text-xs">Farbe</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-lg transition-all ${
                    color === c ? "ring-2 ring-white/40 scale-110" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            Abbrechen
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim()} className="bg-indigo-600 hover:bg-indigo-500 text-white">
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}