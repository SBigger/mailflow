import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kontierungsregelnApi, kontenApi, mwstCodesApi } from '../api';

export default function Kontierungsregeln() {
  const { mandant, canWrite } = useMandant();
  const [regeln, setRegeln] = useState([]);
  const [konten, setKonten] = useState([]);
  const [mwst, setMwst]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [neu, setNeu] = useState({ stichwort: '', konto_nr: '', mwst_code: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try { setRegeln(await kontierungsregelnApi.list(mandant.id)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id]);
  useEffect(() => {
    if (!mandant) return;
    kontenApi.list(mandant.id).then(k => setKonten(k.filter(x => x.aktiv && x.konto_typ === 'aufwand'))).catch(() => {});
    mwstCodesApi.listAktiv(mandant.id).then(setMwst).catch(() => {});
  }, [mandant?.id]);

  const kontoLabel = (nr) => {
    const k = konten.find(x => x.konto_nr === nr);
    return k ? `${k.konto_nr} ${k.bezeichnung}` : nr;
  };

  const handleAdd = async () => {
    if (!neu.stichwort.trim() || !neu.konto_nr) return;
    setSaving(true);
    try {
      await kontierungsregelnApi.create(mandant.id, {
        stichwort: neu.stichwort.trim(), konto_nr: neu.konto_nr,
        mwst_code: neu.mwst_code || null, sortierung: regeln.length,
      });
      setNeu({ stichwort: '', konto_nr: '', mwst_code: '' });
      await load();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setSaving(false); }
  };

  const patch = async (r, field, value) => {
    setRegeln(rs => rs.map(x => x.id === r.id ? { ...x, [field]: value } : x));
    try { await kontierungsregelnApi.update(r.id, { [field]: value || null }); }
    catch (e) { alert('Fehler: ' + e.message); load(); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Regel „${r.stichwort}" löschen?`)) return;
    try { await kontierungsregelnApi.remove(r.id); await load(); }
    catch (e) { alert('Fehler: ' + e.message); }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa' };
  const td  = { padding: '6px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>🏷</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Kontierungsregeln</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Stichwort → Aufwandskonto · Vorschlag beim Erfassen von Lieferantenrechnungen</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7', padding: 16 }}>
        <div style={{ fontSize: 11.5, color: '#6b826b', marginBottom: 12, background: '#eef4ee', borderRadius: 8, padding: '8px 12px' }}>
          Beim Erfassen einer Lieferantenrechnung wird der Belegtext / Dateiname gegen die Stichworte
          geprüft. Das erste passende Konto wird vorgeschlagen – z.B. „EDV", „Leasing", „Benzin", „Diesel".
          Hat ein Lieferant bereits ein gelerntes Standardkonto, geht dieses vor.
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
          <thead><tr>
            <th style={{ ...hdr, width: 220 }}>Stichwort</th>
            <th style={hdr}>Aufwandskonto</th>
            <th style={{ ...hdr, width: 120 }}>MWST-Code</th>
            <th style={{ ...hdr, width: 60 }}></th>
          </tr></thead>
          <tbody>
            {/* Neue Regel */}
            {canWrite && (
              <tr style={{ background: '#f7faf7' }}>
                <td style={td}>
                  <input style={inp} value={neu.stichwort} placeholder="z.B. EDV"
                    onChange={e => setNeu(n => ({ ...n, stichwort: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()} />
                </td>
                <td style={td}>
                  <select style={inp} value={neu.konto_nr} onChange={e => setNeu(n => ({ ...n, konto_nr: e.target.value }))}>
                    <option value="">— Konto —</option>
                    {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <select style={inp} value={neu.mwst_code} onChange={e => setNeu(n => ({ ...n, mwst_code: e.target.value }))}>
                    <option value="">—</option>
                    {mwst.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button onClick={handleAdd} disabled={saving || !neu.stichwort.trim() || !neu.konto_nr}
                    style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: (neu.stichwort.trim() && neu.konto_nr) ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>+</button>
                </td>
              </tr>
            )}
            {loading ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#94a394' }}>Lädt…</td></tr>
            ) : regeln.length === 0 ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#94a394' }}>Noch keine Regeln</td></tr>
            ) : regeln.map(r => (
              <tr key={r.id}>
                <td style={td}>
                  <input style={inp} defaultValue={r.stichwort} disabled={!canWrite}
                    onBlur={e => e.target.value.trim() && e.target.value !== r.stichwort && patch(r, 'stichwort', e.target.value.trim())} />
                </td>
                <td style={td}>
                  <select style={inp} value={r.konto_nr} disabled={!canWrite} onChange={e => patch(r, 'konto_nr', e.target.value)}>
                    {!konten.some(k => k.konto_nr === r.konto_nr) && <option value={r.konto_nr}>{kontoLabel(r.konto_nr)}</option>}
                    {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <select style={inp} value={r.mwst_code ?? ''} disabled={!canWrite} onChange={e => patch(r, 'mwst_code', e.target.value)}>
                    <option value="">—</option>
                    {mwst.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                  </select>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {canWrite && (
                    <button onClick={() => handleDelete(r)} style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
