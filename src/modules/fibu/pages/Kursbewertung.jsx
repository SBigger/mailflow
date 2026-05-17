import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { kontenApi, kursbewertungApi } from '../api';

const CHF = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const K4  = (n) => n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';

export default function Kursbewertung() {
  const { mandant, canWrite } = useMandant();
  const jahr = new Date().getFullYear();

  const [stichtag, setStichtag] = useState(`${jahr}-12-31`);
  const [belege, setBelege]     = useState([]);
  const [kurse, setKurse]       = useState({});       // waehrung → Stichtagskurs
  const [konten, setKonten]     = useState([]);
  const [kontoDiff, setKontoDiff] = useState('');
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);

  useEffect(() => {
    if (!mandant) return;
    kontenApi.list(mandant.id).then(k => {
      const akt = k.filter(x => x.aktiv);
      setKonten(akt);
      const kd = akt.find(x => /kursdiff/i.test(x.bezeichnung || ''));
      if (kd) setKontoDiff(kd.konto_nr);
    }).catch(() => {});
  }, [mandant?.id]);

  const load = async () => {
    if (!mandant) return;
    setLoading(true); setMsg(null);
    try {
      const [bRes, kRes] = await Promise.all([
        supabase.from('fibu_kreditoren_belege')
          .select('id, beleg_nr, belegtyp, belegdatum, waehrung, kurs, betrag_brutto, betrag_bezahlt, lieferant:fibu_lieferanten(name)')
          .eq('mandant_id', mandant.id)
          .neq('waehrung', 'CHF')
          .in('status', ['offen', 'teilbezahlt'])
          .lte('belegdatum', stichtag),
        supabase.from('fibu_wechselkurse')
          .select('waehrung, kurs, datum')
          .eq('typ', 'monat')
          .lte('datum', stichtag)
          .order('datum', { ascending: false }),
      ]);
      setBelege(bRes.data ?? []);
      const map = {};
      (kRes.data ?? []).forEach(r => { if (!(r.waehrung in map)) map[r.waehrung] = Number(r.kurs); });
      setKurse(map);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id, stichtag]);

  const rows = useMemo(() => belege.map(b => {
    const fwOffen   = (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0);
    const stKurs    = kurse[b.waehrung] ?? null;
    const buchKurs  = b.kurs ?? stKurs;          // Fallback: kein Buchkurs → Differenz 0
    const buchwert  = buchKurs != null ? fwOffen * buchKurs : null;
    const stWert    = stKurs   != null ? fwOffen * stKurs   : null;
    const diff      = (buchwert != null && stWert != null) ? Math.round((stWert - buchwert) * 100) / 100 : null;
    return { ...b, fwOffen, stKurs, buchKurs, buchwert, stWert, diff, kursFehlt: stKurs == null };
  }), [belege, kurse]);

  const totalDiff = rows.reduce((s, r) => s + (r.diff ?? 0), 0);
  const fehlend   = rows.filter(r => r.kursFehlt).length;
  const istVerlust = totalDiff > 0;

  const handleBuchen = async () => {
    if (!canWrite || !kontoDiff || Math.abs(totalDiff) < 0.01) return;
    setSaving(true); setMsg(null);
    try {
      await kursbewertungApi.buchen(mandant.id, stichtag, kontoDiff, totalDiff);
      setMsg({ type: 'ok', text: `Kursbewertung gebucht: CHF ${CHF(Math.abs(totalDiff))} ${istVerlust ? 'Kursverlust' : 'Kursgewinn'} per ${DATE(stichtag)} (Storno automatisch per Folgetag).` });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const inp = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 7, padding: '5px 10px', fontSize: 12.5, outline: 'none' };
  const hdr = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b826b', padding: '7px 10px', borderBottom: '2px solid #e4e9e4', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '6px 10px', borderBottom: '1px solid #f0f3f0', fontSize: 12 };
  const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>💱</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>FW-Kursbewertung</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Offene Fremdwährungs-Kreditoren zum Stichtagskurs bewerten</div>
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: '#6b826b' }}>Stichtag</label>
        <input type="date" value={stichtag} onChange={e => setStichtag(e.target.value)} style={inp} />
      </div>

      {msg && (
        <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, background: msg.type === 'ok' ? '#f0f7f0' : '#fdf0f0', color: msg.type === 'ok' ? '#166534' : '#8a2d2d', borderBottom: '1px solid #e4e9e4' }}>
          {msg.text}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Keine offenen Fremdwährungs-Kreditoren per {DATE(stichtag)}.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={{ ...hdr, textAlign: 'left' }}>Beleg / Lieferant</th>
              <th style={{ ...hdr, textAlign: 'left' }}>Datum</th>
              <th style={{ ...hdr, textAlign: 'left' }}>Whg.</th>
              <th style={{ ...hdr, textAlign: 'right' }}>FW offen</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Buchkurs</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Buchwert CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Stichtagskurs</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Stichtagswert CHF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Differenz</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ background: r.kursFehlt ? '#fdf6ec' : '#fff' }}>
                  <td style={td}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.beleg_nr}</span>
                    <span style={{ color: '#6b826b', marginLeft: 6 }}>{r.lieferant?.name}</span>
                  </td>
                  <td style={td}>{DATE(r.belegdatum)}</td>
                  <td style={{ ...td, fontWeight: 700, color: '#9a3412' }}>{r.waehrung}</td>
                  <td style={tdR}>{CHF(r.fwOffen)}</td>
                  <td style={tdR}>{K4(r.buchKurs)}</td>
                  <td style={tdR}>{r.buchwert != null ? CHF(r.buchwert) : '—'}</td>
                  <td style={tdR}>{r.kursFehlt ? <span style={{ color: '#b9802e' }}>Kurs fehlt</span> : K4(r.stKurs)}</td>
                  <td style={tdR}>{r.stWert != null ? CHF(r.stWert) : '—'}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: r.diff == null ? '#c5cdc5' : r.diff > 0 ? '#991b1b' : r.diff < 0 ? '#166534' : '#94a394' }}>
                    {r.diff == null ? '—' : (r.diff >= 0 ? '+' : '−') + CHF(Math.abs(r.diff))}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#e4ede4', borderTop: '2px solid #c5cfc5' }}>
                <td style={{ ...td, fontWeight: 800 }} colSpan={8}>Total Kursdifferenz</td>
                <td style={{ ...tdR, fontWeight: 800, fontSize: 13, color: totalDiff > 0 ? '#991b1b' : totalDiff < 0 ? '#166534' : '#1a1a2e' }}>
                  {(totalDiff >= 0 ? '+' : '−') + CHF(Math.abs(totalDiff))}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Buchungs-Panel */}
        {rows.length > 0 && (
          <div style={{ margin: 16, background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16, maxWidth: 640 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', marginBottom: 10 }}>Kursbewertung verbuchen</div>
            <div style={{ fontSize: 12.5, color: '#4a5a4a', marginBottom: 12, lineHeight: 1.5 }}>
              Es wird per <strong>{DATE(stichtag)}</strong> eine Bewertungsbuchung über
              {' '}<strong>CHF {CHF(Math.abs(totalDiff))}</strong> {istVerlust ? '(Kursverlust)' : '(Kursgewinn)'}
              {' '}erstellt – Gegenkonto 2000 Kreditoren – und am Folgetag automatisch storniert
              (reine Stichtagsbewertung).
              {fehlend > 0 && <span style={{ color: '#b9802e' }}> {fehlend} Beleg(e) ohne Stichtagskurs sind nicht berücksichtigt – Wechselkurse importieren.</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>Kursdifferenz-Konto</label>
                <select value={kontoDiff} onChange={e => setKontoDiff(e.target.value)} style={{ ...inp, minWidth: 280 }}>
                  <option value="">— Konto wählen —</option>
                  {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                </select>
              </div>
              <button
                onClick={handleBuchen}
                disabled={!canWrite || saving || !kontoDiff || Math.abs(totalDiff) < 0.01}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none',
                  background: (!kontoDiff || Math.abs(totalDiff) < 0.01) ? '#c5cdc5' : '#7a9b7f',
                  color: '#fff', fontSize: 12.5, fontWeight: 600,
                  cursor: (!kontoDiff || Math.abs(totalDiff) < 0.01) ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Bucht…' : 'Kursbewertung buchen'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
