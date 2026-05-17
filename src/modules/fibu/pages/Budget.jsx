import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { budgetApi } from '../api';

const CHF = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function Budget() {
  const { mandant, canWrite } = useMandant();
  const aktuellesJahr = new Date().getFullYear();

  const [jahr, setJahr]       = useState(aktuellesJahr);
  const [rows, setRows]       = useState([]);
  const [budget, setBudget]   = useState({});     // konto_nr → string
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState(null);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      const data = await budgetApi.uebersicht(mandant.id, jahr);
      setRows(data);
      const map = {};
      data.forEach(r => { if (Number(r.budget) !== 0) map[r.konto_nr] = String(r.budget); });
      setBudget(map);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id, jahr]);

  const ertrag  = useMemo(() => rows.filter(r => r.konto_typ === 'ertrag'),  [rows]);
  const aufwand = useMemo(() => rows.filter(r => r.konto_typ === 'aufwand'), [rows]);

  const sumCol = (list, field) => list.reduce((s, r) => s + Number(r[field] || 0), 0);
  const sumBudget = (list) => list.reduce((s, r) => s + (parseFloat(budget[r.konto_nr]) || 0), 0);

  const erg = {
    vj2:    sumCol(ertrag, 'ist_vj2')  - sumCol(aufwand, 'ist_vj2'),
    vj1:    sumCol(ertrag, 'ist_vj1')  - sumCol(aufwand, 'ist_vj1'),
    budget: sumBudget(ertrag)          - sumBudget(aufwand),
  };

  const handleSave = async () => {
    if (!canWrite) return;
    setSaving(true); setMsg(null);
    try {
      const list = rows.map(r => ({ konto_nr: r.konto_nr, betrag: parseFloat(budget[r.konto_nr]) || 0 }));
      await budgetApi.speichern(mandant.id, jahr, list);
      setMsg({ type: 'ok', text: `Budget ${jahr} gespeichert.` });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const hdr = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b826b', padding: '7px 10px', borderBottom: '2px solid #e4e9e4', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '5px 10px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#1a1a2e', outline: 'none' };

  const Abschnitt = ({ titel, list, farbe }) => (
    <>
      <tr>
        <td colSpan={5} style={{ padding: '8px 10px 4px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: farbe, background: '#f7faf7' }}>{titel}</td>
      </tr>
      {list.map(r => (
        <tr key={r.konto_nr}>
          <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, width: 70 }}>{r.konto_nr}</td>
          <td style={td}>{r.bezeichnung}</td>
          <td style={{ ...tdR, color: '#94a394', width: 120 }}>{CHF(r.ist_vj2)}</td>
          <td style={{ ...tdR, color: '#6b826b', width: 120 }}>{CHF(r.ist_vj1)}</td>
          <td style={{ ...td, textAlign: 'right', width: 140 }}>
            <input
              type="number" step="100"
              disabled={!canWrite}
              value={budget[r.konto_nr] ?? ''}
              onChange={e => setBudget(b => ({ ...b, [r.konto_nr]: e.target.value }))}
              placeholder="0.00"
              style={{ ...inp, width: 120, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            />
          </td>
        </tr>
      ))}
      <tr style={{ background: '#f0f3f0' }}>
        <td style={{ ...td, fontWeight: 700 }} colSpan={2}>Total {titel}</td>
        <td style={{ ...tdR, fontWeight: 700, color: '#94a394' }}>{CHF(sumCol(list, 'ist_vj2'))}</td>
        <td style={{ ...tdR, fontWeight: 700, color: '#6b826b' }}>{CHF(sumCol(list, 'ist_vj1'))}</td>
        <td style={{ ...tdR, fontWeight: 700 }}>{CHF(sumBudget(list))}</td>
      </tr>
    </>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>🎯</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Budget</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Jahresbudget pro Konto – mit 2 Vorjahres-Ist-Werten als Erfassungshilfe</div>
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: '#6b826b' }}>Budgetjahr</label>
        <input type="number" value={jahr} onChange={e => setJahr(parseInt(e.target.value) || aktuellesJahr)} style={{ ...inp, width: 90 }} />
        {canWrite && (
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Speichert…' : 'Budget speichern'}
          </button>
        )}
      </div>

      {msg && (
        <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, background: msg.type === 'ok' ? '#f0f7f0' : '#fdf0f0', color: msg.type === 'ok' ? '#166534' : '#8a2d2d', borderBottom: '1px solid #e4e9e4' }}>
          {msg.text}
        </div>
      )}

      {/* Tabelle */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Keine Ertrags-/Aufwandskonten im Kontenplan</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ ...hdr, textAlign: 'left' }}>Konto</th>
              <th style={{ ...hdr, textAlign: 'left' }}>Bezeichnung</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Ist {jahr - 2}</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Ist {jahr - 1}</th>
              <th style={{ ...hdr, textAlign: 'right', color: '#3d6641' }}>Budget {jahr}</th>
            </tr></thead>
            <tbody>
              <Abschnitt titel="Ertrag"  list={ertrag}  farbe="#166534" />
              <Abschnitt titel="Aufwand" list={aufwand} farbe="#991b1b" />
              {/* Ergebnis */}
              <tr style={{ background: '#e4ede4', borderTop: '2px solid #c5cfc5' }}>
                <td style={{ ...td, fontWeight: 800, fontSize: 13 }} colSpan={2}>Ergebnis (Ertrag − Aufwand)</td>
                <td style={{ ...tdR, fontWeight: 800, color: erg.vj2 < 0 ? '#991b1b' : '#166534' }}>{CHF(erg.vj2)}</td>
                <td style={{ ...tdR, fontWeight: 800, color: erg.vj1 < 0 ? '#991b1b' : '#166534' }}>{CHF(erg.vj1)}</td>
                <td style={{ ...tdR, fontWeight: 800, color: erg.budget < 0 ? '#991b1b' : '#166534' }}>{CHF(erg.budget)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
