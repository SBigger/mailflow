import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi } from '../api';

const CHF = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';

const toISO = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : d;
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

export default function Belegjournal() {
  const { mandant } = useMandant();
  const [belege, setBelege] = useState([]);
  const [loading, setLoading] = useState(true);
  const [von, setVon] = useState(firstOfYear());
  const [bis, setBis] = useState(toISO(new Date()));
  const [search, setSearch] = useState('');

  const load = () => {
    if (!mandant) return;
    setLoading(true);
    kreditorenApi.listAll(mandant.id, von, bis)
      .then(setBelege)
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (mandant) load(); }, [mandant?.id]);

  const filtered = belege.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return b.beleg_nr?.toLowerCase().includes(q) || b.lieferant?.name?.toLowerCase().includes(q) || b.lieferant_beleg_nr?.toLowerCase().includes(q) || b.notiz?.toLowerCase().includes(q);
  });

  const exportCsv = () => {
    const rows = [['Buchungs-Nr.','Beleg-Nr.','Lieferant','Lieferant-Beleg-Nr.','Belegdatum','Fälligkeit','Brutto CHF','MWST CHF','Status','Notiz']];
    filtered.forEach(b => rows.push([b.id.slice(0,8), b.beleg_nr, b.lieferant?.name, b.lieferant_beleg_nr, DATE(b.belegdatum), DATE(b.faelligkeit), CHF(b.betrag_brutto), CHF(b.betrag_mwst), b.status, b.notiz ?? '']));
    const csv = rows.map(r => r.map(c => `"${c ?? ''}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `Belegjournal_${von}_${bis}.csv`; a.click();
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fff', whiteSpace: 'nowrap' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '5px 10px', fontSize: 12.5, outline: 'none' };

  const STATUS = { offen: ['#e4e4ea','#4a4a5a'], teilbezahlt: ['#efe4f8','#5f3a9c'], bezahlt: ['#e3eaf5','#2e4a7d'], storniert: ['#fde7e7','#8a2d2d'] };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Belegjournal Kreditoren</span>
        <div style={{ width: 1, height: 18, background: '#e4e9e4', margin: '0 4px' }} />
        <input type="date" value={von} onChange={e => setVon(e.target.value)} style={inp} />
        <span style={{ color: '#94a394', fontSize: 12 }}>bis</span>
        <input type="date" value={bis} onChange={e => setBis(e.target.value)} style={inp} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Suche…" style={{ ...inp, width: 180 }} />
        <div style={{ flex: 1 }} />
        <button onClick={exportCsv} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 11.5, cursor: 'pointer' }}>↓ Export CSV</button>
        <button onClick={load} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Anwenden</button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={hdr}>Beleg-Nr.</th>
              <th style={hdr}>Belegdatum</th>
              <th style={hdr}>Lieferant</th>
              <th style={hdr}>Lief.-Beleg-Nr.</th>
              <th style={hdr}>Fälligkeit</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Netto CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>MWST CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Brutto CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Bezahlt CHF</th>
              <th style={hdr}>Status</th>
              <th style={hdr}>Notiz</th>
            </tr></thead>
            <tbody>
              {filtered.map(b => {
                const [bg, color] = STATUS[b.status] ?? STATUS.offen;
                return (
                  <tr key={b.id}
                      onMouseEnter={e => e.currentTarget.querySelectorAll('td').forEach(c => c.style.background = '#f7faf7')}
                      onMouseLeave={e => e.currentTarget.querySelectorAll('td').forEach(c => c.style.background = '')}
                  >
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                    <td style={td}>{DATE(b.belegdatum)}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                    <td style={{ ...td, fontSize: 12, color: '#6b826b' }}>{b.lieferant_beleg_nr ?? '—'}</td>
                    <td style={td}>{DATE(b.faelligkeit)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{CHF(b.betrag_netto)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2e4a7d' }}>{CHF(b.betrag_mwst)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{CHF(b.betrag_brutto)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#94a394' }}>{b.betrag_bezahlt > 0 ? CHF(b.betrag_bezahlt) : '—'}</td>
                    <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: bg, color }}>{b.status}</span></td>
                    <td style={{ ...td, fontSize: 12, color: '#94a394', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.notiz ?? ''}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine Belege für diesen Zeitraum</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot><tr>
                <td colSpan={5} style={{ ...td, fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>{CHF(filtered.reduce((s,b)=>s+b.betrag_netto,0))}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums', color: '#2e4a7d' }}>{CHF(filtered.reduce((s,b)=>s+b.betrag_mwst,0))}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>{CHF(filtered.reduce((s,b)=>s+b.betrag_brutto,0))}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums', color: '#94a394' }}>{CHF(filtered.reduce((s,b)=>s+b.betrag_bezahlt,0))}</td>
                <td colSpan={2} style={{ ...td, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}></td>
              </tr></tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
