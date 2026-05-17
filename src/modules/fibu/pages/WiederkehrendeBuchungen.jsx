import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { buchungSerieApi, kontenApi } from '../api';

const CHF  = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const today = () => new Date().toISOString().slice(0, 10);

const INTERVALLE = [
  { v: 'monatlich', l: 'Monatlich' },
  { v: 'quartal',   l: 'Quartalsweise' },
  { v: 'jaehrlich', l: 'Jährlich' },
];
const intLabel = (v) => INTERVALLE.find(i => i.v === v)?.l ?? v;

const emptyForm = () => ({
  bezeichnung: '', konto_soll: '', konto_haben: '',
  betrag_total: '', anzahl_perioden: 12, intervall: 'monatlich',
  naechstes_datum: today(), aktiv: true,
});

export default function WiederkehrendeBuchungen() {
  const { mandant, canWrite } = useMandant();
  const [rows, setRows]       = useState([]);
  const [konten, setKonten]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState(emptyForm());
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState(null);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try { setRows(await buchungSerieApi.list(mandant.id)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id]);
  useEffect(() => {
    if (!mandant) return;
    kontenApi.list(mandant.id).then(k => setKonten(k.filter(x => x.aktiv))).catch(() => {});
  }, [mandant?.id]);

  const kontoLabel = (nr) => {
    const k = konten.find(x => x.konto_nr === nr);
    return k ? `${k.konto_nr} ${k.bezeichnung}` : nr;
  };
  const proPeriode = (total, anz) => (anz > 0 ? (parseFloat(total) || 0) / anz : 0);

  const openNew  = () => { setForm(emptyForm()); setEditing('new'); };
  const openEdit = (r) => {
    setForm({
      bezeichnung: r.bezeichnung, konto_soll: r.konto_soll, konto_haben: r.konto_haben,
      betrag_total: String(r.betrag_total), anzahl_perioden: r.anzahl_perioden,
      intervall: r.intervall, naechstes_datum: r.naechstes_datum, aktiv: r.aktiv,
    });
    setEditing(r);
  };

  const canSave = form.bezeichnung.trim() && form.konto_soll && form.konto_haben
    && form.konto_soll !== form.konto_haben && parseFloat(form.betrag_total) > 0
    && form.anzahl_perioden > 0 && form.naechstes_datum && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        bezeichnung: form.bezeichnung.trim(), konto_soll: form.konto_soll, konto_haben: form.konto_haben,
        betrag_total: parseFloat(form.betrag_total), anzahl_perioden: parseInt(form.anzahl_perioden) || 12,
        intervall: form.intervall, naechstes_datum: form.naechstes_datum, aktiv: form.aktiv,
      };
      if (editing === 'new') await buchungSerieApi.create(mandant.id, payload);
      else                   await buchungSerieApi.update(editing.id, payload);
      setEditing(null);
      await load();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleErzeugen = async (r) => {
    if (!window.confirm(`Nächste Teilbuchung von „${r.bezeichnung}" (${r.erzeugt_anzahl + 1}/${r.anzahl_perioden}) per ${DATE(r.naechstes_datum)} erzeugen?`)) return;
    try { await buchungSerieApi.erzeugen(r.id); await load(); }
    catch (e) { alert('Fehler: ' + e.message); }
  };
  const handleFaellige = async () => {
    try {
      const n = await buchungSerieApi.faelligeErzeugen(mandant.id, today());
      await load();
      setMsg(n > 0 ? `${n} fällige Teilbuchung(en) erzeugt.` : 'Keine fälligen Buchungen.');
    } catch (e) { alert('Fehler: ' + e.message); }
  };
  const handleDelete = async (r) => {
    if (!window.confirm(`Serie „${r.bezeichnung}" löschen? Bereits erzeugte Buchungen bleiben erhalten.`)) return;
    try { await buchungSerieApi.remove(r.id); await load(); }
    catch (e) { alert('Fehler: ' + e.message); }
  };

  const faelligCount = rows.filter(r => r.aktiv && r.naechstes_datum <= today()).length;

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4, display: 'block' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>🔂</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Wiederkehrende Buchungen</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Gesamtbetrag auf mehrere Perioden verteilt – Abgrenzungen, Abschreibungen …</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleFaellige}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d9b061', background: faelligCount > 0 ? '#fdf6ec' : '#fff', color: '#8a5a00', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          ⏱ Fällige erzeugen{faelligCount > 0 ? ` (${faelligCount})` : ''}
        </button>
        {canWrite && (
          <button onClick={openNew}
            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Neue Serie
          </button>
        )}
      </div>

      {msg && <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, background: '#f0f7f0', color: '#166534', borderBottom: '1px solid #e4e9e4' }}>{msg}</div>}

      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Noch keine Serien – „+ Neue Serie" anlegen.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Bezeichnung</th>
              <th style={hdr}>Soll → Haben</th>
              <th style={hdr}>Intervall</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Gesamt</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Pro Periode</th>
              <th style={hdr}>Fortschritt</th>
              <th style={hdr}>Nächste</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Aktionen</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const fertig = r.erzeugt_anzahl >= r.anzahl_perioden;
                const faellig = r.aktiv && !fertig && r.naechstes_datum <= today();
                return (
                  <tr key={r.id} style={{ opacity: fertig ? 0.6 : 1 }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {r.bezeichnung}
                      {fertig && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>fertig</span>}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{r.konto_soll} → {r.konto_haben}</td>
                    <td style={td}>{intLabel(r.intervall)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{CHF(r.betrag_total)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{CHF(proPeriode(r.betrag_total, r.anzahl_perioden))}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{r.erzeugt_anzahl}/{r.anzahl_perioden}</span>
                        <span style={{ width: 56, height: 6, borderRadius: 3, background: '#eef2ee', display: 'inline-block', overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: '100%', width: `${(r.erzeugt_anzahl / r.anzahl_perioden) * 100}%`, background: fertig ? '#7a9b7f' : '#d9b061' }} />
                        </span>
                      </span>
                    </td>
                    <td style={{ ...td, color: faellig ? '#8a5a00' : undefined, fontWeight: faellig ? 600 : 400 }}>
                      {fertig ? '—' : DATE(r.naechstes_datum)}{faellig ? ' ⏱' : ''}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canWrite && (
                        <>
                          {!fertig && <button onClick={() => handleErzeugen(r)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #b8d4b8', background: '#f0f7f0', color: '#3d6641', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 5 }}>Nächste erzeugen</button>}
                          <button onClick={() => openEdit(r)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #d4dcd4', background: '#fff', fontSize: 11, cursor: 'pointer', marginRight: 5 }}>Bearbeiten</button>
                          <button onClick={() => handleDelete(r)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #e0c0c0', background: '#fff', color: '#8a2d2d', fontSize: 11, cursor: 'pointer' }}>Löschen</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
              {editing === 'new' ? 'Neue Buchungsserie' : 'Serie bearbeiten'}
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={lbl}>Bezeichnung *</label>
                <input style={inp} value={form.bezeichnung} onChange={e => setForm(f => ({ ...f, bezeichnung: e.target.value }))} placeholder="z.B. Versicherung Abgrenzung 2026" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Soll-Konto *</label>
                  <select style={inp} value={form.konto_soll} onChange={e => setForm(f => ({ ...f, konto_soll: e.target.value }))}>
                    <option value="">— wählen —</option>
                    {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Haben-Konto *</label>
                  <select style={inp} value={form.konto_haben} onChange={e => setForm(f => ({ ...f, konto_haben: e.target.value }))}>
                    <option value="">— wählen —</option>
                    {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 150 }}>
                  <label style={lbl}>Gesamtbetrag *</label>
                  <input type="number" step="0.05" style={{ ...inp, textAlign: 'right' }} value={form.betrag_total} onChange={e => setForm(f => ({ ...f, betrag_total: e.target.value }))} placeholder="0.00" />
                </div>
                <div style={{ width: 110 }}>
                  <label style={lbl}>Anzahl Perioden *</label>
                  <input type="number" min="1" max="120" style={{ ...inp, textAlign: 'right' }} value={form.anzahl_perioden} onChange={e => setForm(f => ({ ...f, anzahl_perioden: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Intervall *</label>
                  <select style={inp} value={form.intervall} onChange={e => setForm(f => ({ ...f, intervall: e.target.value }))}>
                    {INTERVALLE.map(i => <option key={i.v} value={i.v}>{i.l}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#3d6641', background: '#f0f7f0', borderRadius: 8, padding: '8px 12px' }}>
                Pro Periode: <strong>CHF {CHF(proPeriode(form.betrag_total, parseInt(form.anzahl_perioden) || 1))}</strong>
                {' '}× {form.anzahl_perioden || 0} = CHF {CHF(form.betrag_total)} (letzte Buchung trägt den Rundungsrest)
              </div>
              <div style={{ width: 200 }}>
                <label style={lbl}>Erstes Buchungsdatum *</label>
                <input type="date" style={inp} value={form.naechstes_datum} onChange={e => setForm(f => ({ ...f, naechstes_datum: e.target.value }))} />
              </div>
              {editing !== 'new' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <input type="checkbox" checked={form.aktiv} onChange={e => setForm(f => ({ ...f, aktiv: e.target.checked }))} />
                  Serie aktiv
                </label>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={handleSave} disabled={!canSave}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: canSave ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}>
                {saving ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
