import React, { useState } from 'react';

/**
 * Schnellerfassung eines Lieferanten – mit Adressfeldern.
 *
 * Props:
 *   init    – Vorbelegung { name, strasse, plz, ort, land, iban, uid, bank_name }
 *   saving  – bool, true während dem Speichern
 *   onSave  – (form) => void   form: { name, uid, adresse, plz, ort, land, iban, bank_name }
 *   onClose – () => void
 */
export default function NeuerLieferantModal({ init, saving, onSave, onClose }) {
  const [f, setF] = useState({
    name:      init?.name || '',
    uid:       init?.uid || '',
    adresse:   init?.strasse || init?.adresse || '',
    plz:       init?.plz || '',
    ort:       init?.ort || '',
    land:      init?.land || 'CH',
    iban:      init?.iban || '',
    bank_name: init?.bank_name || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const canSave = f.name.trim().length > 0 && !saving;

  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%', boxSizing: 'border-box' };

  return (
    <div onClick={() => !saving && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '96vw', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
          Neuen Lieferant erfassen
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Name *</label>
            <input style={inp} value={f.name} autoFocus onChange={e => set('name', e.target.value)} placeholder="Firmenname" />
          </div>
          <div style={{ background: '#f7faf7', border: '1px solid #e4e9e4', borderRadius: 9, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394', marginBottom: 8 }}>Adresse</div>
            <div style={{ marginBottom: 8 }}>
              <label style={lbl}>Strasse / Nr.</label>
              <input style={inp} value={f.adresse} onChange={e => set('adresse', e.target.value)} placeholder="z.B. Bahnhofstrasse 1" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ width: 90 }}>
                <label style={lbl}>PLZ</label>
                <input style={inp} value={f.plz} onChange={e => set('plz', e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Ort</label>
                <input style={inp} value={f.ort} onChange={e => set('ort', e.target.value)} />
              </div>
              <div style={{ width: 64 }}>
                <label style={lbl}>Land</label>
                <input style={inp} value={f.land} onChange={e => set('land', e.target.value.toUpperCase().slice(0, 2))} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>IBAN</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 11.5 }} value={f.iban} onChange={e => set('iban', e.target.value)} placeholder="CH.." />
            </div>
            <div style={{ width: 130 }}>
              <label style={lbl}>UID</label>
              <input style={inp} value={f.uid} onChange={e => set('uid', e.target.value)} placeholder="CHE-..." />
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
          <button onClick={() => canSave && onSave(f)} disabled={!canSave}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: canSave ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Speichert…' : 'Lieferant anlegen'}
          </button>
        </div>
      </div>
    </div>
  );
}
