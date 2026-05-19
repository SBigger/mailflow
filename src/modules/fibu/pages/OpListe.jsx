import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi, wechselkurseApi } from '../api';

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
  const [verrechnenGs, setVerrechnenGs] = useState(null);
  const [verrProcessing, setVerrProcessing] = useState(false);
  const [stornoBeleg, setStornoBeleg] = useState(null);
  const [stornoDatum, setStornoDatum] = useState(toISO(new Date()));
  const [stornoProcessing, setStornoProcessing] = useState(false);
  const [kursMap, setKursMap] = useState({});

  useEffect(() => {
    wechselkurseApi.list('monat')
      .then(({ kurse }) => {
        const m = {};
        (kurse || []).forEach(k => { m[k.waehrung] = Number(k.kurs); });
        setKursMap(m);
      })
      .catch(() => {});
  }, []);

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

  // ── Fremdwährung → CHF ──────────────────────────────────────────
  const isFW   = (b) => b.waehrung && b.waehrung !== 'CHF';
  const kursOf = (w) => (!w || w === 'CHF') ? 1 : (kursMap[w] ?? null);
  const offenFW  = (b) => (b.betrag_brutto - b.betrag_bezahlt);
  const offenCHF = (b) => {
    const k = kursOf(b.waehrung);
    return k == null ? null : offenFW(b) * k;
  };
  // Anzeige Betrag + Währungscode (CHF ohne Suffix)
  const AMT = (b, v) => isFW(b) ? `${CHF(v)} ${b.waehrung}` : CHF(v);

  const totalOffen      = belege.reduce((s, b) => s + (offenCHF(b) ?? offenFW(b)), 0);
  const fällig          = belege.filter(b => { const d = daysDiff(b.faelligkeit, stichtag); return d >= 0 && d <= 7; });
  const überfällig      = belege.filter(b => daysDiff(b.faelligkeit, stichtag) > 0);
  const totalFällig     = fällig.reduce((s, b) => s + (offenCHF(b) ?? offenFW(b)), 0);
  const totalÜberfällig = überfällig.reduce((s, b) => s + (offenCHF(b) ?? offenFW(b)), 0);

  // FIFO-Vorschau für die Verrechnung der gewählten Gutschrift
  const verrechnungPreview = useMemo(() => {
    if (!verrechnenGs) return null;
    const gsOffen = Math.abs(verrechnenGs.betrag_brutto) - Math.abs(verrechnenGs.betrag_bezahlt || 0);
    const rechnungen = raw
      .filter(b => b.belegtyp !== 'gutschrift'
        && b.lieferant_id === verrechnenGs.lieferant_id
        && ['offen', 'teilbezahlt'].includes(b.status))
      .sort((a, b) => (a.belegdatum < b.belegdatum ? -1 : a.belegdatum > b.belegdatum ? 1
        : (a.beleg_nr || '').localeCompare(b.beleg_nr || '')));
    let rest = gsOffen;
    const alloc = [];
    for (const r of rechnungen) {
      if (rest <= 0.005) break;
      const rRest = r.betrag_brutto - (r.betrag_bezahlt || 0);
      if (rRest <= 0.005) continue;
      const x = Math.min(rRest, rest);
      alloc.push({ beleg: r, rRest, x });
      rest -= x;
    }
    return { gsOffen, alloc, applied: gsOffen - rest, restGs: rest };
  }, [verrechnenGs, raw]);

  const handleVerrechnen = async () => {
    if (!verrechnenGs) return;
    setVerrProcessing(true);
    try {
      await kreditorenApi.gutschriftVerrechnen(mandant.id, verrechnenGs.id);
      setVerrechnenGs(null);
      load(stichtag);
    } catch (e) {
      alert('Verrechnung fehlgeschlagen: ' + e.message);
    } finally { setVerrProcessing(false); }
  };

  const handleFreigeben = async (belegId) => {
    try {
      await kreditorenApi.freigeben(belegId);
      load(stichtag);
    } catch (e) {
      alert('Freigabe fehlgeschlagen: ' + e.message);
    }
  };

  const openStorno = (b) => { setStornoBeleg(b); setStornoDatum(toISO(new Date())); };
  const handleStorno = async () => {
    if (!stornoBeleg || !stornoDatum) return;
    setStornoProcessing(true);
    try {
      await kreditorenApi.storno(stornoBeleg.id, stornoDatum);
      setStornoBeleg(null);
      load(stichtag);
    } catch (e) {
      alert('Storno fehlgeschlagen: ' + e.message);
    } finally { setStornoProcessing(false); }
  };

  const PRESETS = [
    { label: 'Heute', value: toISO(new Date()) },
    { label: '31.12.' + (new Date().getFullYear() - 1), value: `${new Date().getFullYear() - 1}-12-31` },
    { label: '31.12.' + (new Date().getFullYear() - 2), value: `${new Date().getFullYear() - 2}-12-31` },
  ];

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', whiteSpace: 'nowrap', background: '#fff' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };

  const exportCsv = () => {
    const rows = [['Beleg-Nr.','Lieferant','Belegdatum','Fälligkeit','Tage','Währung','Brutto','Bezahlt','Offen','Offen CHF','Status']];
    belege.forEach(b => {
      const diff = daysDiff(b.faelligkeit, stichtag);
      const oCHF = offenCHF(b);
      rows.push([b.beleg_nr, b.lieferant?.name, DATE(b.belegdatum), DATE(b.faelligkeit), diff > 0 ? `+${diff}` : diff < 0 ? diff : '0', b.waehrung || 'CHF', CHF(b.betrag_brutto), CHF(b.betrag_bezahlt), CHF(offenFW(b)), oCHF == null ? '' : CHF(oCHF), b.status]);
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
              <th style={{ ...hdr, textAlign: 'right' }}>Brutto</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Bezahlt</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Offen</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Offen CHF</th>
              <th style={hdr}>Status</th>
            </tr></thead>
            <tbody>
              {belege.map(b => {
                const diff = daysDiff(b.faelligkeit, stichtag);
                const offen = b.betrag_brutto - b.betrag_bezahlt;
                const istGS = b.belegtyp === 'gutschrift';
                const isOver = diff > 0 && !istGS;
                const isFaellig = diff >= 0 && diff <= 7 && !istGS;
                const rowBg = istGS ? '#fdf4f8' : (isOver ? '#fff8f8' : undefined);
                return (
                  <tr key={b.id} style={{ background: rowBg }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                      {b.beleg_nr}
                      {istGS && <span style={{ marginLeft: 6, fontFamily: "'Inter',system-ui", fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#fce7f3', color: '#9d174d' }}>Gutschrift</span>}
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                    <td style={td}>{DATE(b.belegdatum)}</td>
                    <td style={{ ...td, color: isOver ? '#8a2d2d' : isFaellig ? '#8a5a00' : undefined, fontWeight: isOver || isFaellig ? 500 : undefined }}>{DATE(b.faelligkeit)}</td>
                    <td style={{ ...td, textAlign: 'right', color: isOver ? '#8a2d2d' : diff < 0 ? '#94a394' : '#8a5a00', fontWeight: isOver ? 600 : undefined }}>
                      {isOver ? `+${diff}` : diff === 0 ? '0' : diff}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{AMT(b, b.betrag_brutto)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#94a394' }}>{b.betrag_bezahlt > 0 || b.betrag_bezahlt < 0 ? AMT(b, b.betrag_bezahlt) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: isOver ? '#8a2d2d' : isFaellig ? '#8a5a00' : undefined }}>{AMT(b, offen)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {offenCHF(b) == null
                        ? <span style={{ color: '#c08a8a', fontSize: 11 }}>Kurs fehlt</span>
                        : <>
                            {CHF(offenCHF(b))}
                            {isFW(b) && <div style={{ fontSize: 9.5, color: '#94a394', fontWeight: 400 }}>Kurs {kursOf(b.waehrung).toFixed(4)}</div>}
                          </>}
                    </td>
                    <td style={td}>
                      {istGS ? (
                        Math.abs(offen) > 0.005 ? (
                          <button
                            onClick={() => setVerrechnenGs(b)}
                            style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #f0c8dc', background: '#fdf4f8', color: '#9d174d', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                          >↹ Verrechnen</button>
                        ) : (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: '#e4e4ea', color: '#4a4a5a' }}>verrechnet</span>
                        )
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {b.status === 'ebanking' ? (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>
                              🏦 E-Banking
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: isOver ? '#fde7e7' : isFaellig ? '#fef0c7' : '#e4e4ea', color: isOver ? '#8a2d2d' : isFaellig ? '#8a5a00' : '#4a4a5a' }}>
                              {isOver ? `überfällig +${diff}` : isFaellig ? 'fällig' : 'offen'}
                            </span>
                          )}
                          {b.freigabe_status === 'ausstehend' && (
                            <>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>⏳ Freigabe offen</span>
                              <button
                                onClick={() => handleFreigeben(b.id)}
                                title="Beleg freigeben"
                                style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #b8d4b8', background: '#f0f7f0', color: '#3d6641', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                              >✓ Freigeben</button>
                            </>
                          )}
                          {b.status !== 'ebanking' && (b.betrag_bezahlt || 0) === 0 && (
                            <button
                              onClick={() => openStorno(b)}
                              title="Rechnung stornieren"
                              style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #e0c0c0', background: '#fff', color: '#8a2d2d', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                            >⊗ Storno</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {belege.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine offenen Posten per {DATE(stichtag)}</td></tr>
              )}
            </tbody>
            {belege.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={8} style={{ ...td, fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}>Total offen in CHF</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>{CHF(totalOffen)}</td>
                  <td style={{ ...td, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* ── Verrechnungs-Dialog ── */}
      {verrechnenGs && verrechnungPreview && (
        <div onClick={() => !verrProcessing && setVerrechnenGs(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '96vw', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
              Gutschrift verrechnen
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12.5, color: '#4a5a4a' }}>
                Gutschrift <strong>{verrechnenGs.beleg_nr}</strong> · {verrechnenGs.lieferant?.name}
                <span style={{ marginLeft: 8, color: '#9d174d', fontWeight: 700 }}>
                  CHF {CHF(verrechnungPreview.gsOffen)} offen
                </span>
              </div>

              {verrechnungPreview.alloc.length === 0 ? (
                <div style={{ fontSize: 12.5, color: '#8a2d2d', background: '#fdf0f0', border: '1px solid #e0b8b8', borderRadius: 8, padding: '10px 12px' }}>
                  Keine offenen Rechnungen dieses Lieferanten – Verrechnung nicht möglich.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a394' }}>
                    Verrechnung gegen offene Rechnungen (FIFO)
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: '#6b826b', fontSize: 10.5, fontWeight: 700, borderBottom: '1px solid #e4e9e4' }}>Rechnung</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', color: '#6b826b', fontSize: 10.5, fontWeight: 700, borderBottom: '1px solid #e4e9e4' }}>Offen</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', color: '#6b826b', fontSize: 10.5, fontWeight: 700, borderBottom: '1px solid #e4e9e4' }}>Verrechnet</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', color: '#6b826b', fontSize: 10.5, fontWeight: 700, borderBottom: '1px solid #e4e9e4' }}>Neu offen</th>
                    </tr></thead>
                    <tbody>
                      {verrechnungPreview.alloc.map(a => (
                        <tr key={a.beleg.id}>
                          <td style={{ padding: '5px 6px', fontFamily: 'monospace', borderBottom: '1px solid #f0f3f0' }}>{a.beleg.beleg_nr}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid #f0f3f0' }}>{CHF(a.rRest)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#9d174d', fontWeight: 600, borderBottom: '1px solid #f0f3f0' }}>−{CHF(a.x)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid #f0f3f0' }}>{CHF(a.rRest - a.x)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 12, color: '#4a5a4a', background: '#f0f7f0', borderRadius: 8, padding: '8px 12px' }}>
                    Total verrechnet: <strong>CHF {CHF(verrechnungPreview.applied)}</strong>
                    {verrechnungPreview.restGs > 0.005 && (
                      <span style={{ color: '#8a5a00' }}> · Gutschrift-Rest CHF {CHF(verrechnungPreview.restGs)} bleibt offen</span>
                    )}
                    <div style={{ fontSize: 11, color: '#6b826b', marginTop: 4 }}>
                      Buchhalterisch neutral – gleicht nur die Offenen Posten aus. Der Zahlungslauf zahlt danach automatisch nur die Differenz.
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setVerrechnenGs(null)} disabled={verrProcessing}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={handleVerrechnen}
                disabled={verrProcessing || verrechnungPreview.alloc.length === 0}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: verrechnungPreview.alloc.length === 0 ? '#c5cdc5' : '#9d174d',
                  color: '#fff', fontSize: 12.5, fontWeight: 600,
                  cursor: verrechnungPreview.alloc.length === 0 ? 'not-allowed' : 'pointer' }}>
                {verrProcessing ? 'Verrechnet…' : 'Verrechnen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Storno-Dialog ── */}
      {stornoBeleg && (
        <div onClick={() => !stornoProcessing && setStornoBeleg(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '96vw', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
              Rechnung stornieren
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12.5, color: '#4a5a4a' }}>
                Rechnung <strong>{stornoBeleg.beleg_nr}</strong> · {stornoBeleg.lieferant?.name}
                <span style={{ marginLeft: 8, fontWeight: 700 }}>CHF {CHF(stornoBeleg.betrag_brutto)}</span>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4, display: 'block' }}>Storno-Datum</label>
                <input type="date" value={stornoDatum} onChange={e => setStornoDatum(e.target.value)}
                  style={{ background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, outline: 'none' }} />
              </div>
              <div style={{ fontSize: 11.5, color: '#6b826b', background: '#fdf4f4', border: '1px solid #f0d8d8', borderRadius: 8, padding: '8px 12px' }}>
                Es wird eine Storno-Gutschrift mit Gegenbuchung per Storno-Datum erstellt – die Originalrechnung
                bleibt erhalten und wird als „storniert" markiert. Buchhalterisch wird die Rechnung damit ausgebucht.
              </div>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setStornoBeleg(null)} disabled={stornoProcessing}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={handleStorno} disabled={stornoProcessing || !stornoDatum}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#8a2d2d', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                {stornoProcessing ? 'Storniert…' : 'Rechnung stornieren'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
