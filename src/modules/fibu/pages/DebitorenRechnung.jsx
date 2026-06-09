/**
 * Rechnung erstellen (Debitoren) — Kopf + Positionen aus Produktstamm,
 * MWST-Berechnung, Entwurf speichern oder stellen & verbuchen.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { kundenApi, artikelApi, kontenApi, mwstCodesApi, debitorenApi } from '../api';

const card = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12 };
const inp  = { width: '100%', padding: '7px 9px', border: '1px solid #d4dcd4', borderRadius: 7, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const cell = { ...inp, padding: '5px 6px', background: 'transparent', border: '1px solid transparent' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };
const CHF  = n => (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2   = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const newRow = () => ({ _id: Math.random().toString(36).slice(2), artikel_id: '', bezeichnung: '', menge: 1, einheit: '', einzelpreis: 0, konto_nr: '', mwst_code: 'V81' });

export default function DebitorenRechnung() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const [kunden, setKunden] = useState([]);
  const [artikel, setArtikel] = useState([]);
  const [konten, setKonten] = useState([]);
  const [mwstMap, setMwstMap] = useState({});
  const [umsatzCodes, setUmsatzCodes] = useState([]);
  const [saving, setSaving] = useState(false);

  const [kundeId, setKundeId] = useState('');
  const [titel, setTitel] = useState('');
  const [belegdatum, setBelegdatum] = useState(todayISO());
  const [zahlungsfrist, setZahlungsfrist] = useState(30);
  const [rows, setRows] = useState([newRow()]);

  useEffect(() => {
    if (!mandant?.id) return;
    kundenApi.list(mandant.id).then(setKunden).catch(console.error);
    artikelApi.list(mandant.id).then(setArtikel).catch(console.error);
    kontenApi.list(mandant.id).then(setKonten).catch(console.error);
    mwstCodesApi.listAktiv(mandant.id).then(codes => {
      const m = {}; codes.forEach(c => { m[c.code] = c.satz; });
      setMwstMap(m);
      setUmsatzCodes(codes.filter(c => /^V/.test(c.code) || c.typ === 'umsatzsteuer' || c.typ === 'steuerbefreit'));
    }).catch(console.error);
  }, [mandant?.id]);

  const faelligkeit = useMemo(() => addDays(belegdatum, parseInt(zahlungsfrist) || 0), [belegdatum, zahlungsfrist]);
  const ertragKonten = konten.filter(k => k.konto_typ === 'ertrag');

  // Beträge pro Zeile
  const calc = (row) => {
    const netto = r2((parseFloat(row.menge) || 0) * (parseFloat(row.einzelpreis) || 0));
    const satz = mwstMap[row.mwst_code] ?? 0;
    const mwst = r2(netto * satz / 100);
    return { netto, mwst, brutto: r2(netto + mwst), satz };
  };
  const totals = rows.reduce((t, r) => { const c = calc(r); t.netto += c.netto; t.mwst += c.mwst; return t; }, { netto: 0, mwst: 0 });
  totals.netto = r2(totals.netto); totals.mwst = r2(totals.mwst); totals.brutto = r2(totals.netto + totals.mwst);

  const setRow = (id, patch) => setRows(rs => rs.map(r => r._id === id ? { ...r, ...patch } : r));
  const pickArtikel = (id, artikelId) => {
    const a = artikel.find(x => x.id === artikelId);
    if (!a) { setRow(id, { artikel_id: '' }); return; }
    setRow(id, { artikel_id: a.id, bezeichnung: a.name, einheit: a.einheit, einzelpreis: a.verkaufspreis, konto_nr: a.ertragskonto || '', mwst_code: a.mwst_code || 'V81' });
  };

  const kundeChange = (id) => {
    setKundeId(id);
    const k = kunden.find(x => x.id === id);
    if (k?.zahlungsbedingung_tage != null) setZahlungsfrist(k.zahlungsbedingung_tage);
  };

  const valid = kundeId && rows.some(r => r.bezeichnung && (parseFloat(r.einzelpreis) || 0) !== 0 && r.konto_nr);

  const save = async (status) => {
    if (!valid) { alert('Bitte Kunde wählen und mind. eine Position mit Bezeichnung, Preis und Konto erfassen.'); return; }
    setSaving(true);
    try {
      const positionen = rows.filter(r => r.bezeichnung && r.konto_nr).map(r => {
        const c = calc(r);
        return { artikel_id: r.artikel_id || null, bezeichnung: r.bezeichnung, menge: parseFloat(r.menge) || 0,
          einheit: r.einheit || null, einzelpreis: parseFloat(r.einzelpreis) || 0, konto_nr: r.konto_nr,
          mwst_code: r.mwst_code, mwst_satz: c.satz, betrag_netto: c.netto, betrag_mwst: c.mwst, betrag_brutto: c.brutto };
      });
      const beleg = { kunde_id: kundeId, titel: titel || null, belegdatum, valutadatum: belegdatum,
        faelligkeit, zahlungsbedingung_tage: parseInt(zahlungsfrist) || null, waehrung: 'CHF',
        betrag_netto: totals.netto, betrag_mwst: totals.mwst, betrag_brutto: totals.brutto, status };
      await debitorenApi.create(mandant.id, beleg, positionen);
      navigate(`/fibu/${mandant.id}/debitoren/uebersicht`);
    } catch (e) { alert('Fehler beim Speichern: ' + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4', gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Neue Rechnung</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · Ausgangsrechnung</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button onClick={() => save('entwurf')} disabled={saving || !valid} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #bfcfbf', background: '#fff', color: '#4a5a4a', fontWeight: 600, cursor: valid ? 'pointer' : 'default' }}>Entwurf speichern</button>
          <button onClick={() => save('offen')} disabled={saving || !valid} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: valid ? '#3d6641' : '#a0b8a0', color: '#fff', fontWeight: 600, cursor: valid ? 'pointer' : 'default' }}>{saving ? 'Speichert…' : 'Rechnung stellen & buchen'}</button>
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1100 }}>
        <div style={{ ...card, padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16, marginBottom: 18 }}>
            <div><label style={lbl}>Kunde *</label>
              <select style={inp} value={kundeId} onChange={e => kundeChange(e.target.value)}>
                <option value="">— wählen —</option>
                {kunden.map(k => <option key={k.id} value={k.id}>{k.name}{k.ort ? `, ${k.ort}` : ''}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Belegdatum</label><input type="date" style={inp} value={belegdatum} onChange={e => setBelegdatum(e.target.value)} /></div>
            <div><label style={lbl}>Fällig in (Tagen) → {faelligkeit}</label><input type="number" style={inp} value={zahlungsfrist} onChange={e => setZahlungsfrist(e.target.value)} /></div>
            <div style={{ gridColumn: '1 / 4' }}><label style={lbl}>Rechnungstitel</label><input style={inp} value={titel} onChange={e => setTitel(e.target.value)} placeholder="z.B. Beratung & Material Q2 2026" /></div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f7faf7', color: '#6b826b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: '30%' }}>Artikel / Position</th>
                <th style={{ textAlign: 'right', padding: '7px 6px', width: 70 }}>Menge</th>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: 70 }}>Einheit</th>
                <th style={{ textAlign: 'right', padding: '7px 6px', width: 90 }}>Einzelpreis</th>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: '16%' }}>Konto</th>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: 90 }}>MWST</th>
                <th style={{ textAlign: 'right', padding: '7px 6px', width: 100 }}>Betrag</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const c = calc(row);
                return (
                  <tr key={row._id} style={{ borderBottom: '1px solid #f0f3f0' }}>
                    <td style={{ padding: '3px 6px' }}>
                      <select style={{ ...cell, marginBottom: 2 }} value={row.artikel_id} onChange={e => pickArtikel(row._id, e.target.value)}>
                        <option value="">— frei / Artikel wählen —</option>
                        {artikel.map(a => <option key={a.id} value={a.id}>{a.nr} · {a.name}</option>)}
                      </select>
                      <input style={cell} value={row.bezeichnung} placeholder="Bezeichnung" onChange={e => setRow(row._id, { bezeichnung: e.target.value })} />
                    </td>
                    <td style={{ padding: '3px 6px' }}><input type="number" step="0.01" style={{ ...cell, textAlign: 'right' }} value={row.menge} onChange={e => setRow(row._id, { menge: e.target.value })} /></td>
                    <td style={{ padding: '3px 6px' }}><input style={cell} value={row.einheit} onChange={e => setRow(row._id, { einheit: e.target.value })} /></td>
                    <td style={{ padding: '3px 6px' }}><input type="number" step="0.05" style={{ ...cell, textAlign: 'right' }} value={row.einzelpreis} onChange={e => setRow(row._id, { einzelpreis: e.target.value })} /></td>
                    <td style={{ padding: '3px 6px' }}>
                      <select style={cell} value={row.konto_nr} onChange={e => setRow(row._id, { konto_nr: e.target.value })}>
                        <option value="">— Konto —</option>
                        {ertragKonten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <select style={cell} value={row.mwst_code} onChange={e => setRow(row._id, { mwst_code: e.target.value })}>
                        {umsatzCodes.map(co => <option key={co.code} value={co.code}>{co.code} · {co.satz}%</option>)}
                        {umsatzCodes.length === 0 && <option value="V81">V81 · 8.1%</option>}
                      </select>
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{CHF(c.brutto)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                      <button onClick={() => setRows(rs => rs.length > 1 ? rs.filter(r => r._id !== row._id) : rs)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4893a' }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={() => setRows(rs => [...rs, newRow()])} style={{ marginTop: 10, background: 'none', border: 'none', color: '#3d6641', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>+ Position hinzufügen</button>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <div style={{ width: 280 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12.5, color: '#4a5a4a' }}><span>Netto</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totals.netto)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12.5, color: '#4a5a4a' }}><span>MWST</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totals.mwst)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #e4e9e4', marginTop: 4, paddingTop: 8, fontSize: 15, fontWeight: 800 }}><span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totals.brutto)}</span></div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: '#94a394', marginTop: 10 }}>
          „Rechnung stellen &amp; buchen" verbucht direkt: Soll 1100 Debitoren / Haben Ertrag + 2200 Umsatzsteuer. QR-Rechnungs-PDF folgt (Phase 2b).
        </div>
      </div>
    </div>
  );
}
