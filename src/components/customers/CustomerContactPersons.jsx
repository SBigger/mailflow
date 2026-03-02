import React, { useState, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, User, Phone } from "lucide-react";
import { ThemeContext } from "@/Layout";

export default function CustomerContactPersons({ customer, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const contacts = customer.contact_persons || [];
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "" });

  const save = (updated) => onUpdate({ contact_persons: updated });

  const add = () => {
    if (!form.name.trim()) return;
    save([...contacts, form]);
    setForm({ name: "", email: "", phone: "", role: "" });
    setAdding(false);
  };

  const remove = (idx) => save(contacts.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {contacts.map((cp, idx) => (
        <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border group" style={{ backgroundColor: isArtis ? '#f5f8f5' : isLight ? '#f7f7fc' : '#f9fafb', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : '#e5e7eb' }}>
          <User className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: isLight ? '#7070a0' : '#71717a' }} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium" style={{ color: isLight ? '#1a1a2e' : '#e4e4e7' }}>{cp.name} {cp.role && <span className="font-normal" style={{ color: isLight ? '#7070a0' : '#71717a' }}>· {cp.role}</span>}</div>
            {cp.email && <div className="text-xs" style={{ color: isLight ? '#5a5a7a' : '#a1a1aa' }}>{cp.email}</div>}
            {cp.phone && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <a
                  href={`tel:${cp.phone}`}
                  onClick={e => { e.preventDefault(); window.location.href = `tel:${cp.phone}`; }}
                  title="Anrufen"
                  className="flex items-center justify-center w-5 h-5 rounded bg-emerald-600 hover:bg-emerald-500 transition-colors flex-shrink-0"
                >
                  <Phone className="h-3 w-3 text-white" />
                </a>
                <span className="text-xs" style={{ color: isLight ? '#7070a0' : '#71717a' }}>{cp.phone}</span>
              </div>
            )}
          </div>
          <button onClick={() => remove(idx)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="p-3 rounded-lg border border-violet-300 space-y-2" style={{ backgroundColor: isArtis ? '#f5f8f5' : isLight ? '#f7f7fc' : '#f9fafb' }}>
          <div className="grid grid-cols-2 gap-2">
            {[['name','Name*'],['role','Funktion (z.B. CEO)'],['email','E-Mail'],['phone','Telefon']].map(([key, ph]) => (
              <Input key={key} value={form[key]} onChange={e => setForm({...form, [key]: e.target.value})} placeholder={ph} className="text-xs h-8" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }} />
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)} className="h-7 text-xs" style={{ color: isLight ? '#7070a0' : '#71717a' }}>Abbrechen</Button>
            <Button size="sm" onClick={add} className="bg-violet-600 hover:bg-violet-500 h-7 text-xs">Hinzufügen</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)} className="text-xs" style={{ color: isLight ? '#7070a0' : '#71717a' }}>
          <Plus className="h-3 w-3" /> Kontaktperson hinzufügen
        </Button>
      )}
    </div>
  );
}