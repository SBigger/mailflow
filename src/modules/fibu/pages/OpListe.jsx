import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi } from '../api';

const CHF = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const toISO = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : d;

function daysDiff(faelligkeit, stichtag) {
  const f = new Date(faelligkeit + 'T00:00:00');
  const s = new Date(stichtag + 'T00:00:00');
  return Math.round((s - f) / 86400000);
}

export default function OpListe() {
  const { mandant } = useMandant();
  const [stichtag, setStichtag] = useState(toISO(new Date()));
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('alle');

  const load = (date) => {
    if (!mandant) return;
    setLoading(true);
    kreditorenApi.listPerStichtag(mandant.id, date)
      .then(setRaw)
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (mandant) load(stichtag); }, [mandant?.id]);

  const belege = useMemo(() => {
    return raw.filter(b => {
      if (filter === 'fällig')     return daysDiff(b.faelligkeit, stichtag) >= 0;
      if (filter === 'überfällig') return daysDiff(b.faelligkeit, stichtag) > 0;
      return true;
    });
  }, [raw, filter, stichtag]);

  const totalOffen      = belege.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);
  const fällig          = belege.filter(b => { const d = daysDiff(b.faelligkeit, stichtag); return d >= 0 && d <= 7; });
  const überfällig      = belege.filter(b => daysDiff(b.faelligkeit, stichtag) > 0);
  const totalFällig     = fällig.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);
  const totalÜberfällig = überfällig.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);

  const PRESETS = [
    { label: 'Heute', value: toISO(new Date()) },
    { label: '31.12.' + (new Date().getFullYear() - 1), value: `${new Date().getFullYear() - 1}-12-31` },
    { label: '31.12.' + (new Date().getFullYear() - 2), value: `${new Date().getFullYear() - 2}-12-31` },
  ];

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', whiteSpace: 'nowrap', background: '#fff' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };

  const exportCsv = () => {
    const rows = [['Beleg-Nr.','Lieferant','Belegdatum','Fälligkeit','Tage','Brutto CHF','Bezahlt CHF','Offen CHF','Status']];
    belege.forEach(b => {
      const diff = daysDiff(b.faelligkeit, stichtag);
      rows.push([b.beleg_nr, b.lieferant?.name, DATE(b.belegdatum), DATE(b.faelligkeit), diff > 0 ? `+${diff}` : diff < 0 ? diff : '0', CHF(b.betrag_brutto), CHF(b.betrag_bezahlt), CHF(b.betrag_brutto - b.betrag_bezahlt), b.status]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `OP-Liste_${stichtag}.csv`; a.click();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b' }}>Stichtag:</span>
          <input
            type="date" value={stichtag}
            onChange={e => setStichtag(e.target.value)}
            style={{ background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '5px 10px', fontSize: 12.5 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => { setStichtag(p.value); load(p.value); }}
              style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #d4dcd4', background: stichtag === p.value ? '#e6ede6' : '#fff', fontSize: 11.5, cursor: 'pointer', fontWeight: stichtag === p.value ? 600 : 400 }}
            >{p.label}</button>
          ))}
        </div>
        <button
          onClick={() => load(stichtag)}
          style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
        >Anwenden</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[['alle','Alle'],['fällig','Fällig'],['überfällig','Überfällig']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #d4dcd4', background: filter === v ? '#e6ede6' : '#fff', fontSize: 11.5, cursor: 'pointer', fontWeight: filter === v ? 600 : 400 }}>{l}</button>
          ))}
        </div>
        <button onClick={exportCsv} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 11.5, cursor: 'pointer' }}>
          ↓ Export CSV
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 0, padding: '12px 16px', borderBottom: '1px solid #e4e9e4', background: '#fff' }}>
        {[
          { label: 'Gesamtbetrag offen', value: `CHF ${CHF(totalOffen)}`, sub: `${belege.length} Belege per ${DATE(stichtag)}`, color: undefined },
          { label: 'Davon fällig', value: `CHF ${CHF(totalFällig)}`, sub: `${fällig.length} Belege`, color: totalFällig > 0 ? '#8a5a00' : undefined },
          { label: 'Davon überfällig', value: `CHF ${CHF(totalÜberfällig)}`, sub: `${überfällig.length} Belege`, color: totalÜberfällig > 0 ? '#8a2d2d' : undefined },
        ].map((k, i) => (
          <div key={i} style={{ paddingRight: 32, paddingLeft: i > 0 ? 32 : 0, borderLeft: i > 0 ? '1px solid #e4e9e4' : undefined }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#94a394' }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', color: k.color ?? '#1a1a2e', margin: '3px 0 2px' }}>{k.value}</div>
            <div style={{ fontSize: 11.5, color: '#6b826b' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={hdr}>Beleg-Nr.</th><th style={hdr}>Lieferant</th>
              <th style={hdr}>Belegdatum</th><th style={hdr}>Fälligkeit</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Tage</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Brutto CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Bezahlt CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Offen CHF</th>
              <th style={hdr}>Status</th>
            </tr></thead>
            <tbody>
              {belege.map(b => {
                const diff = daysDiff(b.faelligkeit, stichtag);
                const offen = b.betrag_brutto - b.betrag_bezahlt;
                const isOver = diff > 0;
                const isFaellig = diff >= 0 && diff <= 7;
                const rowBg = isOver ? '#fff8f8' : undefined;
                return (
                  <tr key={b.id} style={{ background: rowBg }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                    <td style={td}>{DATE(b.belegdatum)}</td>
                    <td style={{ ...td, color: isOver ? '#8a2d2d' : isFaellig ? '#8a5a00' : undefined, fontWeight: isOver || isFaellig ? 500 : undefined }}>{DATE(b.faelligkeit)}</td>
                    <td style={{ ...td, textAlign: 'right', color: isOver ? '#8a2d2d' : diff < 0 ? '#94a394' : '#8a5a00', fontWeight: isOver ? 600 : undefined }}>
                      {isOver ? `+${diff}` : diff === 0 ? '0' : diff}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{CHF(b.betrag_brutto)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#94a394' }}>{b.betrag_bezahlt > 0 ? CHF(b.betrag_bezahlt) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: isOver ? '#8a2d2d' : isFaellig ? '#8a5a00' : undefined }}>{CHF(offen)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: isOver ? '#fde7e7' : isFaellig ? '#fef0c7' : '#e4e4ea', color: isOver ? '#8a2d2d' : isFaellig ? '#8a5a00' : '#4a4a5a' }}>
                        {isOver ? `überfällig +${diff}` : isFaellig ? 'fällig' : 'offen'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {belege.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine offenen Posten per {DATE(stichtag)}</td></tr>
              )}
            </tbody>
            {belege.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ ...td, fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}>Total CHF</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>{CHF(belege.reduce((s, b) => s + b.betrag_brutto, 0))}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums', color: '#94a394' }}>{CHF(belege.reduce((s, b) => s + b.betrag_bezahlt, 0))}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>{CHF(totalOffen)}</td>
                  <td style={{ ...td, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
