/**
 * Kundenstamm (Debitoren) — CRUD für fibu_kunden
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kundenApi } from '../api';

const card = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12 };
const inp  = { width: '100%', padding: '8px 10px', border: '1px solid #d4dcd4', borderRadius: 8, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };

const EMPTY = { name: '', uid: '', adresse: '', plz: '', ort: '', land: 'CH', email: '',
  zahlungsbedingung_tage: 30, standard_konto_nr: '', mwst_code: 'V81', notiz: '', aktiv: true };

export default function Kunden() {
  const { mandant } = useMandant();
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);   // { id?, ...fields }
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!mandant?.id) return;
    setLoading(true);
    kundenApi.list(mandant.id).then(setKunden).catch(console.error).finally(() => setLoading(false));
  }, [mandant?.id]);
  useEffect(load, [load]);

  const openNew = async () => {
    const nr = await kundenApi.nextNr(mandant.id).catch(() => '');
    setModal({ ...EMPTY, nr });
  };

  const save = async () => {
    if (!modal.name?.trim()) { alert('Name fehlt'); return; }
    setSaving(true);
    try {
      const payload = { ...modal };
      delete payload.id;
      if (modal.id) await kundenApi.update(modal.id, payload);
      else await kundenApi.create(mandant.id, payload);
      setModal(null);
      load();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setSaving(false); }
  };

  const del = async (k) => {
    if (!confirm(`Kunde «${k.name}» löschen?`)) return;
    try { await kundenApi.remove(k.id); load(); }
    catch (e) { alert('Löschen nicht möglich (evtl. mit Rechnungen verknüpft): ' + e.message); }
  };

  const set = (patch) => setModal(m => ({ ...m, ...patch }));

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Kundenstamm</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · Kunden verwalten</div>
        </div>
        <button onClick={openNew} style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          + Neuer Kunde
        </button>
      </div>

      <div style={{ padding: 24 }}>
        <div style={{ ...card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f7faf7', color: '#6b826b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Nr.</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Ort</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>UID</th>
                <th style={{ textAlign: 'right', padding: '9px 12px' }}>Zahlungsfrist</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ padding: 20, color: '#94a394' }}>Lädt…</td></tr>}
              {!loading && kunden.length === 0 && <tr><td colSpan={6} style={{ padding: 20, color: '#94a394' }}>Noch keine Kunden — lege den ersten an.</td></tr>}
              {kunden.map(k => (
                <tr key={k.id} style={{ borderTop: '1px solid #f0f3f0', opacity: k.aktiv ? 1 : 0.5 }}>
                  <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', color: '#6b826b' }}>{k.nr}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setModal({ ...k })}>{k.name}</td>
                  <td style={{ padding: '9px 12px' }}>{[k.plz, k.ort].filter(Boolean).join(' ')}</td>
                  <td style={{ padding: '9px 12px', color: '#6b826b' }}>{k.uid || '—'}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>{k.zahlungsbedingung_tage} Tage</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    <button onClick={() => setModal({ ...k })} title="Bearbeiten" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a7aaa', marginRight: 8 }}>✎</button>
                    <button onClick={() => del(k)} title="Löschen" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4893a' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{ ...card, width: 520, maxWidth: '96vw' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2ee', fontWeight: 700, fontSize: 14 }}>
              {modal.id ? 'Kunde bearbeiten' : 'Neuer Kunde'} {modal.nr && <span style={{ color: '#94a394', fontWeight: 500 }}>· {modal.nr}</span>}
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Name *</label><input style={inp} value={modal.name} onChange={e => set({ name: e.target.value })} /></div>
              <div><label style={lbl}>UID</label><input style={inp} value={modal.uid || ''} placeholder="CHE-123.456.789" onChange={e => set({ uid: e.target.value })} /></div>
              <div><label style={lbl}>E-Mail (Rechnung)</label><input style={inp} value={modal.email || ''} onChange={e => set({ email: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Adresse</label><input style={inp} value={modal.adresse || ''} onChange={e => set({ adresse: e.target.value })} /></div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 90 }}><label style={lbl}>PLZ</label><input style={inp} value={modal.plz || ''} onChange={e => set({ plz: e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Ort</label><input style={inp} value={modal.ort || ''} onChange={e => set({ ort: e.target.value })} /></div>
              </div>
              <div><label style={lbl}>Land</label><input style={inp} value={modal.land || 'CH'} onChange={e => set({ land: e.target.value.toUpperCase() })} /></div>
              <div><label style={lbl}>Zahlungsfrist (Tage)</label><input type="number" style={inp} value={modal.zahlungsbedingung_tage} onChange={e => set({ zahlungsbedingung_tage: parseInt(e.target.value) || 30 })} /></div>
              <div><label style={lbl}>Standard-Ertragskonto</label><input style={inp} value={modal.standard_konto_nr || ''} placeholder="3400" onChange={e => set({ standard_konto_nr: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Notiz</label><input style={inp} value={modal.notiz || ''} onChange={e => set({ notiz: e.target.value })} /></div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #eef2ee', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setModal(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Speichert…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
