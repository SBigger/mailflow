import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { dauerbelegApi, lieferantenApi, kontenApi, mwstCodesApi } from '../api';
import LieferantLink from '../components/LieferantLink';

const CHF  = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const today = () => new Date().toISOString().slice(0, 10);

const INTERVALLE = [
  { v: 'monatlich', l: 'Monatlich' },
  { v: 'quartal',   l: 'Quartalsweise' },
  { v: 'halbjahr',  l: 'Halbjährlich' },
  { v: 'jaehrlich', l: 'Jährlich' },
];
const intLabel = (v) => INTERVALLE.find(i => i.v === v)?.l ?? v;

const emptyForm = () => ({
  lieferant_id: '', bezeichnung: '', konto_nr: '', mwst_code: 'M81',
  betrag_brutto: '', waehrung: 'CHF', intervall: 'monatlich',
  zahlungsbedingung_tage: 30, naechstes_belegdatum: today(), aktiv: true,
});

export default function Dauerbelege() {
  const { mandant, canWrite } = useMandant();
  const [rows, setRows]         = useState([]);
  const [lieferanten, setLief]  = useState([]);
  const [konten, setKonten]     = useState([]);
  const [mwst, setMwst]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(null);   // null | 'new' | row
  const [form, setForm]         = useState(emptyForm());
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try { setRows(await dauerbelegApi.list(mandant.id)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id]);
  useEffect(() => {
    if (!mandant) return;
    lieferantenApi.list(mandant.id).then(setLief).catch(() => {});
    kontenApi.list(mandant.id).then(k => setKonten(k.filter(x => x.aktiv && x.konto_typ === 'aufwand'))).catch(() => {});
    mwstCodesApi.listAktiv(mandant.id).then(setMwst).catch(() => {});
  }, [mandant?.id]);

  const openNew  = () => { setForm(emptyForm()); setEditing('new'); };
  const openEdit = (r) => {
    setForm({
      lieferant_id: r.lieferant_id, bezeichnung: r.bezeichnung, konto_nr: r.konto_nr,
      mwst_code: r.mwst_code ?? '', betrag_brutto: String(r.betrag_brutto),
      waehrung: r.waehrung, intervall: r.intervall,
      zahlungsbedingung_tage: r.zahlungsbedingung_tage,
      naechstes_belegdatum: r.naechstes_belegdatum, aktiv: r.aktiv,
    });
    setEditing(r);
  };
  const close = () => { setEditing(null); };

  const pickLieferant = (id) => {
    const l = lieferanten.find(x => x.id === id);
    setForm(f => ({
      ...f, lieferant_id: id,
      konto_nr: f.konto_nr || l?.standard_konto_nr || '',
      mwst_code: f.mwst_code || l?.mwst_code || 'M81',
      zahlungsbedingung_tage: l?.zahlungsbedingung_tage ?? f.zahlungsbedingung_tage,
    }));
  };

  const canSave = form.lieferant_id && form.bezeichnung.trim() && form.konto_nr
    && parseFloat(form.betrag_brutto) > 0 && form.naechstes_belegdatum && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        lieferant_id: form.lieferant_id, bezeichnung: form.bezeichnung.trim(),
        konto_nr: form.konto_nr, mwst_code: form.mwst_code || null,
        betrag_brutto: parseFloat(form.betrag_brutto), waehrung: form.waehrung || 'CHF',
        intervall: form.intervall, zahlungsbedingung_tage: parseInt(form.zahlungsbedingung_tage) || 30,
        naechstes_belegdatum: form.naechstes_belegdatum, aktiv: form.aktiv,
      };
      if (editing === 'new') await dauerbelegApi.create(mandant.id, payload);
      else                   await dauerbelegApi.update(editing.id, payload);
      close();
      await load();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleErzeugen = async (r) => {
    if (!window.confirm(`Beleg für „${r.bezeichnung}" per ${DATE(r.naechstes_belegdatum)} jetzt erzeugen?`)) return;
    try { await dauerbelegApi.erzeugen(r.id); await load(); setMsg({ type: 'ok', text: `Beleg für „${r.bezeichnung}" erzeugt.` }); }
    catch (e) { alert('Fehler: ' + e.message); }
  };

  const handleFaellige = async () => {
    try {
      const n = await dauerbelegApi.faelligeErzeugen(mandant.id, today());
      await load();
      setMsg({ type: 'ok', text: n > 0 ? `${n} fällige Beleg(e) erzeugt.` : 'Keine fälligen Vorlagen.' });
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Vorlage „${r.bezeichnung}" löschen? Bereits erzeugte Belege bleiben erhalten.`)) return;
    try { await dauerbelegApi.remove(r.id); await load(); }
    catch (e) { alert('Fehler: ' + e.message); }
  };

  const faelligCount = rows.filter(r => r.aktiv && r.naechstes_belegdatum <= today()).length;

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4, display: 'block' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>🔁</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Wiederkehrende Rechnungen</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Vorlagen für periodische Kreditoren-Belege (Miete, Leasing, Abos …)</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleFaellige}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d9b061', background: faelligCount > 0 ? '#fdf6ec' : '#fff', color: '#8a5a00', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          ⏱ Fällige erzeugen{faelligCount > 0 ? ` (${faelligCount})` : ''}
        </button>
        {canWrite && (
          <button onClick={openNew}
            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Neue Vorlage
          </button>
        )}
      </div>

      {msg && (
        <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, background: '#f0f7f0', color: '#166534', borderBottom: '1px solid #e4e9e4' }}>{msg.text}</div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Noch keine Vorlagen – „+ Neue Vorlage" anlegen.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Bezeichnung</th>
              <th style={hdr}>Lieferant</th>
              <th style={hdr}>Intervall</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Betrag</th>
              <th style={hdr}>Nächstes Datum</th>
              <th style={hdr}>Zuletzt erzeugt</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Aktionen</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const faellig = r.aktiv && r.naechstes_belegdatum <= today();
                return (
                  <tr key={r.id} style={{ opacity: r.aktiv ? 1 : 0.55 }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {r.bezeichnung}
                      {!r.aktiv && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#e4e4ea', color: '#4a4a5a' }}>inaktiv</span>}
                    </td>
                    <td style={td}><LieferantLink id={r.lieferant_id} name={r.lieferant?.name} /></td>
                    <td style={td}>{intLabel(r.intervall)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.waehrung} {CHF(r.betrag_brutto)}</td>
                    <td style={{ ...td, color: faellig ? '#8a5a00' : undefined, fontWeight: faellig ? 600 : 400 }}>
                      {DATE(r.naechstes_belegdatum)}{faellig ? ' ⏱' : ''}
                    </td>
                    <td style={{ ...td, color: '#94a394' }}>{DATE(r.letzte_erzeugung)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canWrite && (
                        <>
                          <button onClick={() => handleErzeugen(r)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #b8d4b8', background: '#f0f7f0', color: '#3d6641', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 5 }}>Jetzt erzeugen</button>
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

      {/* Modal */}
      {editing && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
              {editing === 'new' ? 'Neue Vorlage' : 'Vorlage bearbeiten'}
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={lbl}>Lieferant *</label>
                <select style={inp} value={form.lieferant_id} onChange={e => pickLieferant(e.target.value)}>
                  <option value="">— wählen —</option>
                  {lieferanten.map(l => <option key={l.id} value={l.id}>{l.name} ({l.nr})</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Bezeichnung *</label>
                <input style={inp} value={form.bezeichnung} onChange={e => setForm(f => ({ ...f, bezeichnung: e.target.value }))} placeholder="z.B. Büromiete" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Aufwandskonto *</label>
                  <select style={inp} value={form.konto_nr} onChange={e => setForm(f => ({ ...f, konto_nr: e.target.value }))}>
                    <option value="">— Konto —</option>
                    {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </div>
                <div style={{ width: 110 }}>
                  <label style={lbl}>MWST-Code</label>
                  <select style={inp} value={form.mwst_code} onChange={e => setForm(f => ({ ...f, mwst_code: e.target.value }))}>
                    <option value="">—</option>
                    {mwst.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 140 }}>
                  <label style={lbl}>Betrag brutto *</label>
                  <input type="number" step="0.05" style={{ ...inp, textAlign: 'right' }} value={form.betrag_brutto} onChange={e => setForm(f => ({ ...f, betrag_brutto: e.target.value }))} placeholder="0.00" />
                </div>
                <div style={{ width: 80 }}>
                  <label style={lbl}>Währung</label>
                  <input style={inp} value={form.waehrung} onChange={e => setForm(f => ({ ...f, waehrung: e.target.value.toUpperCase().slice(0, 3) }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Intervall *</label>
                  <select style={inp} value={form.intervall} onChange={e => setForm(f => ({ ...f, intervall: e.target.value }))}>
                    {INTERVALLE.map(i => <option key={i.v} value={i.v}>{i.l}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Nächstes Belegdatum *</label>
                  <input type="date" style={inp} value={form.naechstes_belegdatum} onChange={e => setForm(f => ({ ...f, naechstes_belegdatum: e.target.value }))} />
                </div>
                <div style={{ width: 130 }}>
                  <label style={lbl}>Zahlungsfrist (Tage)</label>
                  <input type="number" style={inp} value={form.zahlungsbedingung_tage} onChange={e => setForm(f => ({ ...f, zahlungsbedingung_tage: e.target.value }))} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <input type="checkbox" checked={form.aktiv} onChange={e => setForm(f => ({ ...f, aktiv: e.target.checked }))} />
                Vorlage aktiv
              </label>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={close} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
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
