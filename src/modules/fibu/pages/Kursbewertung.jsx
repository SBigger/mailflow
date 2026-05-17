import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { kontenApi, kursbewertungApi } from '../api';

const CHF  = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
const K4   = (n) => n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const SIGN = (n) => n == null ? '—' : n === 0 ? 'CHF 0.00' : (n > 0 ? '+' : '−') + CHF(Math.abs(n));
const nextDay = (s) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

export default function Kursbewertung() {
  const { mandant, canWrite } = useMandant();
  const bewKursTyp  = mandant?.fw_bewertungskurs ?? 'tag';
  const bewKursLabel = bewKursTyp === 'tag' ? 'ESTV Tageskurs' : 'ESTV Monatsmittelkurs';

  const [stichtag, setStichtag]     = useState(`${new Date().getFullYear()}-12-31`);
  const [belege, setBelege]         = useState([]);
  const [kurse, setKurse]           = useState({});        // waehrung → stichtagskurs
  const [fibuSaldi, setFibuSaldi]   = useState({});        // waehrung → {fw, chf}
  const [konten, setKonten]         = useState([]);
  const [kontoDiff, setKontoDiff]   = useState('');
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState(null);
  const [showDetail, setShowDetail] = useState(false);

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
      const [bRes, kRes, fibuRes] = await Promise.all([
        // Offene FW-Kreditoren per Stichtag
        supabase.from('fibu_kreditoren_belege')
          .select('id, beleg_nr, belegdatum, waehrung, kurs, betrag_brutto, betrag_bezahlt, lieferant:fibu_lieferanten(name)')
          .eq('mandant_id', mandant.id)
          .neq('waehrung', 'CHF')
          .in('status', ['offen', 'teilbezahlt'])
          .lte('belegdatum', stichtag),
        // ESTV Stichtagskurse (neuester Kurs pro Währung ≤ Stichtag)
        supabase.from('fibu_wechselkurse')
          .select('waehrung, kurs, datum')
          .eq('typ', bewKursTyp)
          .lte('datum', stichtag)
          .order('datum', { ascending: false }),
        // Fibu Konto 2000 – nur FW-Buchungen (fw_waehrung IS NOT NULL)
        // Kursbewertungs-Buchungen haben kein fw_betrag → automatisch ausgeschlossen
        supabase.from('fibu_buchungen')
          .select('fw_waehrung, fw_betrag, betrag, konto_soll, konto_haben')
          .eq('mandant_id', mandant.id)
          .not('fw_waehrung', 'is', null)
          .lte('buchungsdatum', stichtag)
          .or('konto_soll.eq.2000,konto_haben.eq.2000'),
      ]);

      setBelege(bRes.data ?? []);

      // Stichtagskurs-Map: neuester Kurs pro Währung
      const kMap = {};
      (kRes.data ?? []).forEach(r => { if (!(r.waehrung in kMap)) kMap[r.waehrung] = Number(r.kurs); });
      setKurse(kMap);

      // Netto-Saldi auf Konto 2000 pro Währung
      // Haben = Verbindlichkeit (positiv), Soll = Zahlung / Gutschrift (negativ)
      const fMap = {};
      (fibuRes.data ?? []).forEach(b => {
        const w = b.fw_waehrung;
        if (!fMap[w]) fMap[w] = { fw: 0, chf: 0 };
        const s = b.konto_haben === '2000' ? 1 : -1;
        fMap[w].fw  += s * Number(b.fw_betrag ?? 0);
        fMap[w].chf += s * Number(b.betrag    ?? 0);
      });
      setFibuSaldi(fMap);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id, stichtag, bewKursTyp]);

  // ── Zusammenfassung pro Währung (Hauptansicht) ─────────────────────────
  const summaryRows = useMemo(() => {
    const currencies = new Set([
      ...belege.map(b => b.waehrung),
      ...Object.keys(fibuSaldi),
    ]);
    return Array.from(currencies).map(w => {
      // Kreditoren-Nebenbuch: Summe offener FW-Beträge
      const krediSaldo = belege
        .filter(b => b.waehrung === w)
        .reduce((s, b) => s + (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0), 0);
      // Fibu Konto 2000: authentischer Netto-Saldo
      const fibu    = fibuSaldi[w] ?? { fw: 0, chf: 0 };
      const stKurs  = kurse[w] ?? null;
      const stWert  = stKurs != null ? Math.round(fibu.fw * stKurs * 100) / 100 : null;
      const diff    = stWert != null ? Math.round((stWert - fibu.chf) * 100) / 100 : null;
      // Abstimmungs-Check: Nebenbuch-FW-Saldo muss Fibu-FW-Saldo entsprechen
      const krediOK = Math.abs(krediSaldo - fibu.fw) < 0.01;
      return { waehrung: w, krediSaldo, fibuFw: fibu.fw, fibuChf: fibu.chf, stKurs, stWert, diff, kursFehlt: stKurs == null, krediOK };
    })
      .filter(r => r.krediSaldo > 0.005 || Math.abs(r.fibuFw) > 0.005)
      .sort((a, b) => a.waehrung.localeCompare(b.waehrung));
  }, [belege, fibuSaldi, kurse]);

  // ── Detail pro Einzelbeleg (aufklappbar) ──────────────────────────────
  const detailRows = useMemo(() => belege.map(b => {
    const fwOffen  = (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0);
    const stKurs   = kurse[b.waehrung] ?? null;
    const buchKurs = b.kurs ?? stKurs;
    const buchwert = buchKurs != null ? fwOffen * buchKurs : null;
    const stWert   = stKurs   != null ? fwOffen * stKurs   : null;
    const diff     = (buchwert != null && stWert != null) ? Math.round((stWert - buchwert) * 100) / 100 : null;
    return { ...b, fwOffen, stKurs, buchKurs, buchwert, stWert, diff, kursFehlt: stKurs == null };
  }), [belege, kurse]);

  const totalDiff   = summaryRows.reduce((s, r) => s + (r.diff ?? 0), 0);
  const istVerlust  = totalDiff > 0;
  const fehlend     = summaryRows.filter(r => r.kursFehlt).length;
  const hasMismatch = summaryRows.some(r => !r.krediOK);

  const handleBuchen = async () => {
    if (!canWrite || !kontoDiff || Math.abs(totalDiff) < 0.01) return;
    setSaving(true); setMsg(null);
    try {
      await kursbewertungApi.buchen(mandant.id, stichtag, kontoDiff, totalDiff);
      setMsg({
        type: 'ok',
        text: `Kursbewertung gebucht: CHF ${CHF(Math.abs(totalDiff))} ${istVerlust ? 'Kursverlust' : 'Kursgewinn'} per ${DATE(stichtag)} · Storno automatisch per ${DATE(nextDay(stichtag))}.`,
      });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const inp  = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 7, padding: '5px 10px', fontSize: 12.5, outline: 'none' };
  const hdr  = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b826b', padding: '7px 10px', borderBottom: '2px solid #e4e9e4', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td   = { padding: '7px 10px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const tdR  = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const dhdr = { ...hdr, fontSize: 9.5, padding: '6px 8px' };
  const dtd  = { padding: '5px 8px', borderBottom: '1px solid #f0f3f0', fontSize: 11.5 };
  const dtdR = { ...dtd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>⚖️</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>FW-Kursbewertung</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>
            Stichtagsbewertung offener FW-Kreditoren · Bewertungskurs: {bewKursLabel}
          </div>
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
        ) : summaryRows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>
            Keine offenen Fremdwährungs-Kreditoren per {DATE(stichtag)}.
          </div>
        ) : (
          <>
            {/* Abstimmungswarnung */}
            {hasMismatch && (
              <div style={{ margin: '12px 16px 0', padding: '9px 13px', borderRadius: 8, background: '#fef3c7', border: '1px solid #d97706', fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                ⚠️ <strong>Abstimmungsdifferenz:</strong> FW-Saldo im Kreditoren-Nebenbuch stimmt nicht mit dem Netto-FW-Saldo auf Konto 2000 überein. Bitte Buchungen und Zahlungen prüfen (z. B. manuell verbuchte Zahlungen ohne FW-Betrag).
              </div>
            )}

            {/* ── Saldo-Abstimmung & Kursbewertung pro Währung ── */}
            <div style={{ margin: '12px 16px', background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #e4e9e4', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', background: '#fafcfa' }}>
                Saldo-Abstimmung &amp; Kursbewertung per {DATE(stichtag)}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={hdr}>Währung</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>FW-Saldo Nebenbuch</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>FW-Saldo Kto. 2000</th>
                  <th style={{ ...hdr, textAlign: 'center' }}>≡</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>Buchwert CHF</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>Stichtagskurs</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>Stichtagswert CHF</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>Kursdifferenz</th>
                </tr></thead>
                <tbody>
                  {summaryRows.map(r => (
                    <tr key={r.waehrung}>
                      <td style={{ ...td, fontWeight: 700, color: '#3d6641' }}>{r.waehrung}</td>
                      <td style={tdR}>{CHF(r.krediSaldo)}</td>
                      <td style={tdR}>{CHF(r.fibuFw)}</td>
                      <td style={{ ...td, textAlign: 'center', fontSize: 15 }}>
                        {r.krediOK
                          ? <span style={{ color: '#166534' }}>✓</span>
                          : <span style={{ color: '#b91c1c' }}>✗</span>}
                      </td>
                      <td style={tdR}>{CHF(r.fibuChf)}</td>
                      <td style={tdR}>
                        {r.kursFehlt
                          ? <span style={{ color: '#b9802e', fontSize: 11 }}>Kurs fehlt</span>
                          : K4(r.stKurs)}
                      </td>
                      <td style={tdR}>{r.stWert != null ? CHF(r.stWert) : '—'}</td>
                      <td style={{
                        ...tdR, fontWeight: 700,
                        color: r.diff == null ? '#c5cdc5' : r.diff > 0 ? '#991b1b' : r.diff < 0 ? '#166534' : '#94a394',
                      }}>
                        {SIGN(r.diff)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: '#e4ede4', borderTop: '2px solid #c5cfc5' }}>
                    <td colSpan={7} style={{ ...td, fontWeight: 800 }}>Total Kursdifferenz per {DATE(stichtag)}</td>
                    <td style={{ ...tdR, fontWeight: 800, fontSize: 13, color: totalDiff > 0 ? '#991b1b' : totalDiff < 0 ? '#166534' : '#1a1a2e' }}>
                      {SIGN(totalDiff)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: '8px 12px', fontSize: 11, color: '#94a394', borderTop: '1px solid #f0f3f0', lineHeight: 1.6 }}>
                <strong>Nebenbuch</strong> = Summe offener FW-Beträge aller Kreditoren-Belege ·{' '}
                <strong>Kto. 2000</strong> = Netto-FW-Saldo aus verbuchten Belegen und Zahlungen (ohne CHF-Bewertungsbuchungen) ·{' '}
                <strong>Buchwert</strong> = CHF-Gegenwert zu Buchkursen ·{' '}
                Kursdifferenz: positiv = Kursverlust (Währung aufgewertet), negativ = Kursgewinn.
              </div>
            </div>

            {/* ── Buchungs-Panel ── */}
            <div style={{ margin: '0 16px 16px', background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16, maxWidth: 660 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', marginBottom: 10 }}>
                Kursbewertung verbuchen
              </div>
              <div style={{ fontSize: 12.5, color: '#4a5a4a', marginBottom: 12, lineHeight: 1.6 }}>
                Per <strong>{DATE(stichtag)}</strong> wird eine Bewertungsbuchung über{' '}
                <strong>CHF {CHF(Math.abs(totalDiff))}</strong>{' '}
                {istVerlust
                  ? <span style={{ color: '#991b1b', fontWeight: 600 }}>Kursverlust</span>
                  : <span style={{ color: '#166534', fontWeight: 600 }}>Kursgewinn</span>}
                {' '}erstellt (Kreditoren Kto. 2000 ↔ Kursdifferenz-Konto).
                Automatische Stornierung per <strong>{DATE(nextDay(stichtag))}</strong> (reine Stichtagsbewertung nach OR 960a).
                {fehlend > 0 && (
                  <span style={{ color: '#b9802e' }}>
                    {' '}{fehlend} Währung(en) ohne Stichtagskurs nicht berücksichtigt – bitte Wechselkurse importieren.
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>Kursdifferenz-Konto</label>
                  <select value={kontoDiff} onChange={e => setKontoDiff(e.target.value)} style={{ ...inp, minWidth: 300 }}>
                    <option value="">— Konto wählen —</option>
                    {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </div>
                <button
                  onClick={handleBuchen}
                  disabled={!canWrite || saving || !kontoDiff || Math.abs(totalDiff) < 0.01}
                  style={{
                    padding: '8px 18px', borderRadius: 8, border: 'none',
                    background: (!kontoDiff || Math.abs(totalDiff) < 0.01) ? '#c5cdc5' : '#7a9b7f',
                    color: '#fff', fontSize: 12.5, fontWeight: 600,
                    cursor: (!kontoDiff || Math.abs(totalDiff) < 0.01) ? 'not-allowed' : 'pointer',
                  }}>
                  {saving ? 'Bucht…' : 'Kursbewertung buchen'}
                </button>
              </div>
            </div>

            {/* ── Einzelbelege (aufklappbar) ── */}
            <div style={{ margin: '0 16px 16px', background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
              <button
                onClick={() => setShowDetail(v => !v)}
                style={{
                  width: '100%', padding: '10px 14px', background: '#fafcfa', border: 'none',
                  borderBottom: showDetail ? '1px solid #e4e9e4' : 'none',
                  textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b',
                }}>
                <span style={{ fontSize: 9 }}>{showDetail ? '▼' : '▶'}</span>
                Einzelbelege ({detailRows.length})
              </button>
              {showDetail && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...dhdr, textAlign: 'left' }}>Beleg / Lieferant</th>
                    <th style={{ ...dhdr, textAlign: 'left' }}>Datum</th>
                    <th style={{ ...dhdr, textAlign: 'left' }}>Whg.</th>
                    <th style={{ ...dhdr, textAlign: 'right' }}>FW offen</th>
                    <th style={{ ...dhdr, textAlign: 'right' }}>Buchkurs</th>
                    <th style={{ ...dhdr, textAlign: 'right' }}>Buchwert CHF</th>
                    <th style={{ ...dhdr, textAlign: 'right' }}>Stichtagskurs</th>
                    <th style={{ ...dhdr, textAlign: 'right' }}>Stichtagswert CHF</th>
                    <th style={{ ...dhdr, textAlign: 'right' }}>Differenz</th>
                  </tr></thead>
                  <tbody>
                    {detailRows.map(r => (
                      <tr key={r.id} style={{ background: r.kursFehlt ? '#fdf6ec' : '#fff' }}>
                        <td style={dtd}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.beleg_nr}</span>
                          <span style={{ color: '#6b826b', marginLeft: 6 }}>{r.lieferant?.name}</span>
                        </td>
                        <td style={dtd}>{DATE(r.belegdatum)}</td>
                        <td style={{ ...dtd, fontWeight: 700, color: '#9a3412' }}>{r.waehrung}</td>
                        <td style={dtdR}>{CHF(r.fwOffen)}</td>
                        <td style={dtdR}>{K4(r.buchKurs)}</td>
                        <td style={dtdR}>{r.buchwert != null ? CHF(r.buchwert) : '—'}</td>
                        <td style={dtdR}>
                          {r.kursFehlt ? <span style={{ color: '#b9802e' }}>Kurs fehlt</span> : K4(r.stKurs)}
                        </td>
                        <td style={dtdR}>{r.stWert != null ? CHF(r.stWert) : '—'}</td>
                        <td style={{
                          ...dtdR, fontWeight: 600,
                          color: r.diff == null ? '#c5cdc5' : r.diff > 0 ? '#991b1b' : r.diff < 0 ? '#166534' : '#94a394',
                        }}>
                          {SIGN(r.diff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
