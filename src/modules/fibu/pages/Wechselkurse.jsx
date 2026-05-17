import React, { useEffect, useState, useRef } from 'react';
import { wechselkurseApi } from '../api';
import { useMandant } from '../contexts/MandantContext';

const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const MONAT = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH', { month: 'long', year: 'numeric' }) : '—';
const K6 = (n) => Number(n).toLocaleString('de-CH', { minimumFractionDigits: 4, maximumFractionDigits: 6 });

export default function Wechselkurse() {
  const { mandant } = useMandant();
  const buchungsTyp = mandant?.fw_buchungskurs ?? 'monat';
  const [typ, setTyp]         = useState('monat');     // 'monat' | 'tag'
  const [datum, setDatum]     = useState(null);
  const [kurse, setKurse]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg]         = useState(null);
  const autoTried = useRef(false);

  const load = async (t) => {
    setLoading(true);
    try {
      const { datum, kurse } = await wechselkurseApi.list(t);
      setDatum(datum);
      setKurse(kurse);
      return kurse.length;
    } finally { setLoading(false); }
  };

  useEffect(() => { load(typ); }, [typ]);

  // Beim ersten Laden automatisch importieren, falls noch keine Kurse da sind
  useEffect(() => {
    (async () => {
      if (autoTried.current) return;
      autoTried.current = true;
      const n = await load(typ);
      if (n === 0) await handleImport(true);
    })();
  }, []);

  const handleImport = async (silent = false) => {
    setImporting(true);
    if (!silent) setMsg(null);
    try {
      const res = await wechselkurseApi.importNow('beide');
      await load(typ);
      const teile = (res?.ergebnis ?? []).map(e =>
        e.fehler ? `${e.typ}: Fehler (${e.fehler})` : `${e.typ}: ${e.anzahl} Kurse (${e.datum})`,
      );
      setMsg({ type: res?.ok ? 'ok' : 'err', text: 'Import ESTV/BAZG · ' + (teile.join(' · ') || 'keine Daten') });
    } catch (e) {
      setMsg({ type: 'err', text: 'Import fehlgeschlagen: ' + e.message });
    } finally { setImporting(false); }
  };

  const inp  = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 7, padding: '5px 10px', fontSize: 12.5, outline: 'none' };
  const hdr  = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa' };
  const td   = { padding: '7px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const tab  = (active) => ({ padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: active ? '#fff' : 'transparent', color: active ? '#3d6641' : '#6b826b', boxShadow: active ? '0 1px 3px rgba(0,0,0,.1)' : 'none' });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>💱</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Wechselkurse</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Offizielle Fremdwährungskurse der ESTV / BAZG</div>
        </div>
        <div style={{ display: 'flex', gap: 3, background: '#f0f3f0', borderRadius: 8, padding: 3, marginLeft: 8 }}>
          <button onClick={() => setTyp('monat')} style={tab(typ === 'monat')}>Monatsmittelkurs{buchungsTyp === 'monat' ? ' ★' : ''}</button>
          <button onClick={() => setTyp('tag')}   style={tab(typ === 'tag')}>Tageskurs{buchungsTyp === 'tag' ? ' ★' : ''}</button>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#6b826b' }}>
          {typ === 'monat' ? 'Monat: ' : 'Tag: '}
          <strong>{typ === 'monat' ? MONAT(datum) : DATE(datum)}</strong>
        </span>
        <button onClick={() => handleImport(false)} disabled={importing}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          {importing ? 'Importiert…' : '↓ Von ESTV aktualisieren'}
        </button>
      </div>

      {msg && (
        <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, background: msg.type === 'ok' ? '#f0f7f0' : '#fdf0f0', color: msg.type === 'ok' ? '#166534' : '#8a2d2d', borderBottom: '1px solid #e4e9e4' }}>
          {msg.text}
        </div>
      )}

      {/* Tabelle */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : kurse.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>
            Noch keine Kurse vorhanden – „Von ESTV aktualisieren" klicken.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Währung</th>
              <th style={hdr}>Land</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Einheit</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Kurs (CHF / 1 Einheit)</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Originalkurs</th>
            </tr></thead>
            <tbody>
              {kurse.map(k => (
                <tr key={k.id}>
                  <td style={{ ...td, fontWeight: 700, color: '#3d6641' }}>{k.waehrung}</td>
                  <td style={{ ...td, color: '#6b826b' }}>{k.land || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{k.einheit}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{K6(k.kurs)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#94a394' }}>
                    {K6(k.kurs_raw)} <span style={{ fontSize: 10.5 }}>/ {k.einheit} {k.waehrung}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ padding: '10px 16px', fontSize: 11, color: '#94a394' }}>
          Quelle: Eidg. Steuerverwaltung / Bundesamt für Zoll und Grenzsicherheit (backend-rates.bazg.admin.ch).
          Monatsmittelkurs = Mittel der Tageskurse 25. – 24., publiziert am 25. des Folgemonats.
          {' '}★ = aktueller Buchungskurs des Mandanten (umstellbar unter Stammdaten › Einstellungen).
        </div>
      </div>
    </div>
  );
}
