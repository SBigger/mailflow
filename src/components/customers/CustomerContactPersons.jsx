import React, { useState, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, User, Phone, Pencil, Check, X } from "lucide-react";
import { ThemeContext } from "@/Layout";
import CallNotePopup from "./CallNotePopup";

const EMPTY_FORM = { anrede: "", vorname: "", name: "", email: "", phone: "", phone2: "", role: "" };

export default function CustomerContactPersons({ customer, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const contacts = customer.contact_persons || [];
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [callPopup, setCallPopup] = useState(null); // { phone, contactLabel } | null

  // phone2 nur behalten wenn nicht identisch mit phone
  const cleanCp = (cp) => {
    const out = { ...cp };
    if (out.phone2 && out.phone && out.phone2.trim() === out.phone.trim()) {
      out.phone2 = "";
    }
    return out;
  };

  const save = (updated) => onUpdate({ contact_persons: updated.map(cleanCp) });

  const add = () => {
    if (!form.name.trim()) return;
    save([...contacts, form]);
    setForm(EMPTY_FORM);
    setAdding(false);
  };

  const remove = (idx) => save(contacts.filter((_, i) => i !== idx));

  const startEdit = (idx) => {
    const cp = contacts[idx] || {};
    setEditForm({
      anrede:  cp.anrede  || "",
      vorname: cp.vorname || "",
      name:    cp.name    || "",
      email:   cp.email   || "",
      phone:   cp.phone   || "",
      phone2:  cp.phone2  || "",
      role:    cp.role    || "",
    });
    setEditIdx(idx);
    setAdding(false);
  };

  const cancelEdit = () => { setEditIdx(null); setEditForm(EMPTY_FORM); };

  const saveEdit = () => {
    if (!editForm.name.trim()) return;
    const updated = contacts.map((cp, i) => i === editIdx ? editForm : cp);
    save(updated);
    cancelEdit();
  };

  const PhoneRow = ({ number, label, contactLabel }) => number ? (
    <div className="flex items-center gap-1.5 mt-0.5">
      <button
        type="button"
        onClick={() => setCallPopup({ phone: number, contactLabel })}
        title={label || "Anrufen mit Notiz"}
        className="flex items-center justify-center w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors flex-shrink-0"
      >
        <Phone className="h-3 w-3 text-white" />
      </button>
      <span className="text-xs" style={{ color: isArtis ? '#8aaa8a' : isLight ? '#9090b0' : '#a1a1aa' }}>{number}</span>
    </div>
  ) : null;

  return (
    <div className="space-y-3">
      {contacts.map((cp, idx) => {
        if (editIdx === idx) {
          return (
            <div key={idx} className="p-3 rounded-lg border border-violet-300 space-y-2" style={{ backgroundColor: isArtis ? '#fafcfa' : isLight ? '#fafaff' : '#f9fafb' }}>
              <div className="grid gap-2" style={{ gridTemplateColumns: '100px 1fr 1fr' }}>
                <select
                  value={editForm.anrede}
                  onChange={e => setEditForm({ ...editForm, anrede: e.target.value })}
                  className="text-xs h-8 rounded-md border px-2"
                  style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: editForm.anrede ? (isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937') : '#9ca3af' }}
                >
                  <option value="">Anrede</option>
                  <option value="Herr">Herr</option>
                  <option value="Frau">Frau</option>
                </select>
                <Input value={editForm.vorname} onChange={e => setEditForm({ ...editForm, vorname: e.target.value })} placeholder="Vorname" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
                <Input value={editForm.name}    onChange={e => setEditForm({ ...editForm, name: e.target.value })}    placeholder="Nachname *" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input value={editForm.role}  onChange={e => setEditForm({...editForm, role: e.target.value})}  placeholder="Funktion (z.B. CEO)" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
                <Input value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} placeholder="E-Mail" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input value={editForm.phone}  onChange={e => setEditForm({...editForm, phone: e.target.value})}  placeholder="Telefon 1" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
                <Input value={editForm.phone2} onChange={e => setEditForm({...editForm, phone2: e.target.value})} placeholder="Telefon 2" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={cancelEdit} className="h-7 text-xs" style={{ color: isLight ? '#7070a0' : '#71717a' }}>
                  <X className="h-3 w-3" /> Abbrechen
                </Button>
                <Button size="sm" onClick={saveEdit} className="bg-violet-600 hover:bg-violet-500 h-7 text-xs">
                  <Check className="h-3 w-3" /> Speichern
                </Button>
              </div>
            </div>
          );
        }
        const showPhone2 = cp.phone2 && (!cp.phone || cp.phone2.trim() !== cp.phone.trim());
        const labelStr = [cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ") + (cp.role ? ` · ${cp.role}` : "");
        return (
          <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border group" style={{ backgroundColor: isArtis ? '#fafcfa' : isLight ? '#fafaff' : '#f9fafb', borderColor: isArtis ? '#dde8dd' : isLight ? '#e0e0f0' : '#e5e7eb' }}>
            <User className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: isArtis ? '#a0bca0' : isLight ? '#9090b0' : '#71717a' }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: isArtis ? '#4a5f4a' : isLight ? '#3a3a5e' : '#e4e4e7' }}>
                {[cp.anrede, cp.vorname, cp.name].filter(Boolean).join(" ")}
                {cp.role && <span className="font-normal" style={{ color: isArtis ? '#8aaa8a' : isLight ? '#9090b0' : '#71717a' }}> · {cp.role}</span>}
              </div>
              {cp.email && <div className="text-xs" style={{ color: isArtis ? '#7a9a7a' : isLight ? '#8080a0' : '#a1a1aa' }}>{cp.email}</div>}
              <PhoneRow number={cp.phone}  label="Anrufen mit Notiz (Tel. 1)" contactLabel={labelStr} />
              {showPhone2 && <PhoneRow number={cp.phone2} label="Anrufen mit Notiz (Tel. 2)" contactLabel={labelStr} />}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(idx)} title="Bearbeiten" className="text-gray-400 hover:text-violet-600 p-1">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => remove(idx)} title="Loeschen" className="text-gray-400 hover:text-red-400 p-1">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}

      {adding ? (
        <div className="p-3 rounded-lg border border-violet-300 space-y-2" style={{ backgroundColor: isArtis ? '#fafcfa' : isLight ? '#fafaff' : '#f9fafb' }}>
          {/* Zeile 1: Anrede | Vorname | Nachname */}
          <div className="grid gap-2" style={{ gridTemplateColumns: '100px 1fr 1fr' }}>
            <select
              value={form.anrede}
              onChange={e => setForm({ ...form, anrede: e.target.value })}
              className="text-xs h-8 rounded-md border px-2"
              style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: form.anrede ? (isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937') : '#9ca3af' }}
            >
              <option value="">Anrede</option>
              <option value="Herr">Herr</option>
              <option value="Frau">Frau</option>
            </select>
            <Input value={form.vorname} onChange={e => setForm({ ...form, vorname: e.target.value })} placeholder="Vorname" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
            <Input value={form.name}    onChange={e => setForm({ ...form, name: e.target.value })}    placeholder="Nachname *" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
          </div>
          {/* Zeile 2: Funktion | E-Mail */}
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.role}  onChange={e => setForm({...form, role: e.target.value})}  placeholder="Funktion (z.B. CEO)" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
            <Input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="E-Mail" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
          </div>
          {/* Zeile 3: Telefon 1 | Telefon 2 */}
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.phone}  onChange={e => setForm({...form, phone: e.target.value})}  placeholder="Telefon 1" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
            <Input value={form.phone2} onChange={e => setForm({...form, phone2: e.target.value})} placeholder="Telefon 2" className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)} className="h-7 text-xs" style={{ color: isLight ? '#7070a0' : '#71717a' }}>Abbrechen</Button>
            <Button size="sm" onClick={add} className="bg-violet-600 hover:bg-violet-500 h-7 text-xs">Hinzufuegen</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)} className="text-xs" style={{ color: isLight ? '#7070a0' : '#71717a' }}>
          <Plus className="h-3 w-3" /> Kontaktperson hinzufuegen
        </Button>
      )}

      <CallNotePopup
        open={!!callPopup}
        onClose={() => setCallPopup(null)}
        phone={callPopup?.phone}
        customerId={customer.id}
        customerName={customer.company_name}
        contactLabel={callPopup?.contactLabel}
      />
    </div>
  );
}
