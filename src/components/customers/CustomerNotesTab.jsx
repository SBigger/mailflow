import React, { useState, useEffect, useContext } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { ThemeContext } from "@/Layout";

export default function CustomerNotesTab({ customer, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [notes, setNotes] = useState(
    Array.isArray(customer.notes)
      ? customer.notes
      : customer.notes
      ? [{ text: customer.notes, date: customer.updated_date || new Date().toISOString() }]
      : []
  );
  const [newText, setNewText] = useState("");
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    setNotes(
      Array.isArray(customer.notes)
        ? customer.notes
        : customer.notes
        ? [{ text: customer.notes, date: customer.updated_date || new Date().toISOString() }]
        : []
    );
  }, [customer.id]);

  const handleAdd = () => {
    if (!newText.trim()) return;
    const updated = [{ text: newText.trim(), date: new Date().toISOString() }, ...notes];
    setNotes(updated);
    onUpdate({ notes: updated });
    setNewText("");
  };

  const handleDelete = (idx) => {
    const updated = notes.filter((_, i) => i !== idx);
    setNotes(updated);
    onUpdate({ notes: updated });
  };

  const handleEditStart = (idx) => {
    setEditingIdx(idx);
    setEditText(notes[idx].text);
  };

  const handleEditSave = (idx) => {
    if (!editText.trim()) return;
    const updated = notes.map((n, i) => i === idx ? { ...n, text: editText.trim() } : n);
    setNotes(updated);
    onUpdate({ notes: updated });
    setEditingIdx(null);
  };

  const handleEditCancel = () => {
    setEditingIdx(null);
    setEditText("");
  };

  return (
    <div className="space-y-3 flex flex-col">
      {/* New note input */}
      <div className="flex flex-col gap-2">
        <Textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Neue Notiz eingeben..."
          className="resize-none min-h-[80px]"
          style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }}
          onKeyDown={e => {
            if (e.key === "Enter" && e.ctrlKey) handleAdd();
          }}
        />
        <Button
          onClick={handleAdd}
          disabled={!newText.trim()}
          size="sm"
          className="self-end bg-violet-600 hover:bg-violet-500 text-white gap-1"
        >
          <Plus className="h-4 w-4" /> Notiz hinzufügen
        </Button>
      </div>

      {/* Notes list */}
      <div className="space-y-2">
        {notes.map((note, idx) => (
          <div key={idx} className="rounded-lg p-3 group relative border" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : '#e5e7eb' }}>
            <div className="text-xs mb-1" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#6b7280' }}>
              {format(new Date(note.date), "dd.MM.yyyy HH:mm", { locale: de })}
            </div>
            {editingIdx === idx ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  className="resize-none min-h-[60px]"
                  style={{ backgroundColor: '#f9fafb', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter" && e.ctrlKey) handleEditSave(idx);
                    if (e.key === "Escape") handleEditCancel();
                  }}
                />
                <div className="flex gap-2 self-end">
                  <Button size="sm" variant="ghost" onClick={handleEditCancel} className="text-gray-400 h-7 px-2">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" onClick={() => handleEditSave(idx)} className="bg-violet-600 hover:bg-violet-500 h-7 px-2">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap pr-16" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }}>{note.text}</p>
            )}
            {editingIdx !== idx && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEditStart(idx)} className="text-gray-400 hover:text-violet-500">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(idx)} className="text-gray-400 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ))}
        {notes.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-4">Noch keine Notizen vorhanden.</p>
        )}
      </div>
    </div>
  );
}