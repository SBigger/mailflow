import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { lieferantenApi } from '../api';

const CHF  = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';

export default function LieferantenKonto() {
  const { mandant } = useMandant();
  const jahr = new Date().getFullYear();

  const [searchParams, setSearchParams] = useSearchParams();
  const [lieferanten, setLieferanten] = useState([]);
  const [lieferantId, setLieferantId] = useState(searchParams.get('l') || '');
  const [von, setVon]   = useState(`${jahr}-01-01`);
  const [bis, setBis]   = useState(`${jahr}-12-31`);
  const [belege, setBelege]   = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mandant) return;
    lieferantenApi.list(mandant.id).then(setLieferanten).catch(() => {});
  }, [mandant?.id]);

  // URL-Param ?l=<id> → Lieferant vorselektieren (Verlinkung von anderen Seiten)
  useEffect(() => {
    const l = searchParams.get('l');
    if (l && l !== lieferantId) setLieferantId(l);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mandant || !lieferantId) { setBelege([]); return; }
    setLoading(true);
    supabase
      .from('fibu_kreditoren_belege')
      .select('id, beleg_nr, lieferant_beleg_nr, belegtyp, belegdatum, faelligkeit, betrag_brutto, betrag_bezahlt, waehrung, status')
      .eq('mandant_id', mandant.id)
      .eq('lieferant_id', lieferantId)
      .gte('belegdatum', von)
      .lte('belegdatum', bis)
      .order('belegdatum')
      .order('beleg_nr')
      .then(({ data }) => setBelege(data ?? []))
      .then(() => setLoading(false));
  }, [mandant?.id, lieferantId, von, bis]);

  const lieferant = lieferanten.find(l => l.id === lieferantId);

  // Laufender Saldo (offen kumuliert)
  const rows = useMemo(() => {
    let kum = 0;
    return belege.map(b => {
      const offen = (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0);
      kum += offen;
      return { ...b, offen, kum };
    });
  }, [belege]);

  const totalBrutto  = belege.reduce((s, b) => s + (b.betrag_brutto ?? 0), 0);
  const totalBezahlt = belege.reduce((s, b) => s + (b.betrag_bezahlt ?? 0), 0);
  const totalOffen   = totalBrutto - totalBezahlt;
  const anzRechnung  = belege.filter(b => b.belegtyp !== 'gutschrift').length;
  const anzGutschrift= belege.filter(b => b.belegtyp === 'gutschrift').length;

  const inp = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 7, padding: '5px 10px', fontSize: 12.5, outline: 'none' };
  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '7px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>📇</div>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Lieferanten-Kontoauszug</span>
        <select value={lieferantId} onChange={e => { setLieferantId(e.target.value); setSearchParams(e.target.value ? { l: e.target.value } : {}); }} style={{ ...inp, minWidth: 240 }}>
          <option value="">— Lieferant wählen —</option>
          {lieferanten.map(l => <option key={l.id} value={l.id}>{l.name} ({l.nr})</option>)}
        </select>
        <input type="date" value={von} onChange={e => setVon(e.target.value)} style={inp} />
        <span style={{ color: '#94a394' }}>–</span>
        <input type="date" value={bis} onChange={e => setBis(e.target.value)} style={inp} />
        <div style={{ flex: 1 }} />
        {lieferantId && (
          <button onClick={() => window.print()} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#4a5a4a' }}>🖨 Drucken</button>
        )}
      </div>

      {/* Lieferant-Info + KPIs */}
      {lieferant && (
        <div style={{ flexShrink: 0, display: 'flex', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
          <div style={{ padding: '8px 16px', flex: 2, borderRight: '1px solid #f0f3f0' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394' }}>Lieferant</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{lieferant.name}</div>
            <div style={{ fontSize: 11, color: '#6b826b' }}>
              {[lieferant.adresse, [lieferant.plz, lieferant.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}
              {lieferant.iban ? ` · ${lieferant.iban}` : ''}
            </div>
          </div>
          {[
            { label: `Rechnungen / Gutschriften`, value: `${anzRechnung} / ${anzGutschrift}`, raw: true },
            { label: 'Total fakturiert', value: CHF(totalBrutto) },
            { label: 'Total bezahlt', value: CHF(totalBezahlt) },
            { label: 'Offener Saldo', value: CHF(totalOffen), bold: true },
          ].map((k, i) => (
            <div key={i} style={{ padding: '8px 16px', flex: 1, borderRight: i < 3 ? '1px solid #f0f3f0' : 'none' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394' }}>{k.label}</div>
              <div style={{ fontSize: 14, fontWeight: k.bold ? 800 : 600, fontVariantNumeric: 'tabular-nums', color: k.bold && totalOffen > 0 ? '#8a2d2d' : '#1a1a2e' }}>
                {k.raw ? k.value : `CHF ${k.value}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabelle */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {!lieferantId ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lieferant oben wählen</div>
        ) : loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Keine Belege in diesem Zeitraum</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Datum</th>
              <th style={hdr}>Beleg-Nr.</th>
              <th style={hdr}>Lief.-Beleg</th>
              <th style={hdr}>Typ</th>
              <th style={hdr}>Fälligkeit</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Brutto</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Bezahlt</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Offen</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Saldo kum.</th>
            </tr></thead>
            <tbody>
              {rows.map(b => {
                const gs = b.belegtyp === 'gutschrift';
                return (
                  <tr key={b.id} style={{ background: gs ? '#fdf4f8' : '#fff' }}>
                    <td style={td}>{DATE(b.belegdatum)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{b.beleg_nr}</td>
                    <td style={{ ...td, color: '#6b826b' }}>{b.lieferant_beleg_nr || '—'}</td>
                    <td style={td}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: gs ? '#fce7f3' : '#e8f0e8', color: gs ? '#9d174d' : '#3d6641' }}>
                        {gs ? 'Gutschrift' : 'Rechnung'}
                      </span>
                    </td>
                    <td style={td}>{DATE(b.faelligkeit)}</td>
                    <td style={tdR}>{CHF(b.betrag_brutto)}</td>
                    <td style={{ ...tdR, color: '#94a394' }}>{b.betrag_bezahlt ? CHF(b.betrag_bezahlt) : '—'}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: b.offen > 0 ? '#8a2d2d' : '#94a394' }}>{CHF(b.offen)}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{CHF(b.kum)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: '#e4ede4', borderTop: '2px solid #c5cfc5' }}>
                <td style={{ ...td, fontWeight: 700 }} colSpan={5}>Total</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{CHF(totalBrutto)}</td>
                <td style={{ ...tdR, fontWeight: 700, color: '#6b826b' }}>{CHF(totalBezahlt)}</td>
                <td style={{ ...tdR, fontWeight: 800, color: totalOffen > 0 ? '#8a2d2d' : '#166534' }}>{CHF(totalOffen)}</td>
                <td style={tdR} />
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
