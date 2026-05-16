import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { useNavigate } from 'react-router-dom';

const N2 = (n) => n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('de-CH') : '—';

const TYP_COLOR = {
  aktiv:    { bg: '#dbeafe', color: '#1e40af' },
  passiv:   { bg: '#ffedd5', color: '#9a3412' },
  ertrag:   { bg: '#dcfce7', color: '#166534' },
  aufwand:  { bg: '#fee2e2', color: '#991b1b' },
  abschluss:{ bg: '#ede9fe', color: '#5b21b6' },
};

const MWST_COLORS = {
  M81:['#dbeafe','#1e40af'], M26:['#fef9c3','#854d0e'], M38:['#fce7f3','#9d174d'],
  I81:['#ede9fe','#5b21b6'], M0: ['#f3f4f6','#374151'],
  V81:['#dcfce7','#166534'], V26:['#fef3c7','#92400e'], V0: ['#f3f4f6','#374151'],
};
const mwstBadge = (code) => {
  if (!code) return null;
  const [bg, color] = MWST_COLORS[code] ?? ['#f3f4f6','#374151'];
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: bg, color }}>{code}</span>;
};

// ── Konto-Suche Combobox ──────────────────────────────────────────
function KontoSelector({ konten, value, onChange }) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState('');
  const ref                   = React.useRef(null);

  const current = konten.find(k => k.konto_nr === value);

  const filtered = useMemo(() => {
    if (!search) return konten;
    const q = search.toLowerCase();
    return konten.filter(k =>
      k.konto_nr.includes(q) ||
      k.bezeichnung.toLowerCase().includes(q)
    );
  }, [konten, search]);

  // Click-Outside schliessen
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 320 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 8,
          border: `1px solid ${open ? '#7a9b7f' : '#d4dcd4'}`,
          background: '#fff', cursor: 'pointer', fontSize: 13,
          userSelect: 'none',
        }}
      >
        {current ? (
          <>
            <span style={{ fontWeight: 700, color: '#3d6641', fontVariantNumeric: 'tabular-nums' }}>{current.konto_nr}</span>
            <span style={{ color: '#1a1a2e', flex: 1 }}>{current.bezeichnung}</span>
            {current.konto_typ && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, ...TYP_COLOR[current.konto_typ] }}>{current.konto_typ}</span>
            )}
          </>
        ) : (
          <span style={{ color: '#94a394' }}>Konto wählen…</span>
        )}
        <span style={{ color: '#94a394', marginLeft: 'auto' }}>▾</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #d4dcd4', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', marginTop: 4, overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0f3f0' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Konto-Nr. oder Bezeichnung…"
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #d4dcd4', fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '12px 14px', color: '#94a394', fontSize: 12.5 }}>Keine Treffer</div>
            )}
            {filtered.map(k => (
              <div
                key={k.konto_nr}
                onClick={() => { onChange(k.konto_nr); setOpen(false); setSearch(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 14px', cursor: 'pointer', fontSize: 12.5,
                  background: k.konto_nr === value ? '#e8f0e8' : 'transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f4f8f4'}
                onMouseLeave={e => e.currentTarget.style.background = k.konto_nr === value ? '#e8f0e8' : 'transparent'}
              >
                <span style={{ fontWeight: 700, color: '#3d6641', minWidth: 40, fontVariantNumeric: 'tabular-nums' }}>{k.konto_nr}</span>
                <span style={{ flex: 1, color: '#1a1a2e' }}>{k.bezeichnung}</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, flexShrink: 0, ...TYP_COLOR[k.konto_typ] }}>{k.konto_typ}</span>
                {k.anzahl != null && <span style={{ fontSize: 10.5, color: '#94a394' }}>{k.anzahl} Buch.</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────
export default function Kontoblaetter() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  const [kontoNr,  setKontoNr]  = useState('');
  const [von,      setVon]      = useState(`${currentYear}-01-01`);
  const [bis,      setBis]      = useState(`${currentYear}-12-31`);
  const [loading,  setLoading]  = useState(false);
  const [konten,   setKonten]   = useState([]);      // alle Konten mit Bewegungen im Jahr
  const [rows,     setRows]     = useState([]);      // Kontoblatt-Zeilen
  const [eroeff,   setEroeff]   = useState(null);    // Eröffnungssaldo

  // Konten mit Bewegungen laden (Dropdown)
  useEffect(() => {
    if (!mandant) return;
    supabase.rpc('fibu_konten_mit_bewegungen', {
      p_mandant_id: mandant.id,
      p_von: `${currentYear}-01-01`,
      p_bis: `${currentYear}-12-31`,
    }).then(({ data }) => setKonten(data ?? []));
  }, [mandant?.id, currentYear]);

  const load = useCallback(async () => {
    if (!mandant || !kontoNr) return;
    setLoading(true);
    try {
      const [bRes, eRes] = await Promise.all([
        supabase.rpc('fibu_kontoblatt', {
          p_mandant_id: mandant.id,
          p_konto_nr:   kontoNr,
          p_von:        von,
          p_bis:        bis,
        }),
        supabase.rpc('fibu_kontoblatt_eroeffnung', {
          p_mandant_id: mandant.id,
          p_konto_nr:   kontoNr,
          p_stichtag:   von,
        }),
      ]);
      setRows(bRes.data ?? []);
      setEroeff(eRes.data ?? 0);
    } finally {
      setLoading(false);
    }
  }, [mandant?.id, kontoNr, von, bis]);

  useEffect(() => { load(); }, [load]);

  // Summen
  const totalSoll  = rows.reduce((s, r) => s + (r.soll  ?? 0), 0);
  const totalHaben = rows.reduce((s, r) => s + (r.haben ?? 0), 0);
  const schluss    = rows.length > 0 ? rows[rows.length - 1].saldo_lfd : (eroeff ?? 0);

  const currentKonto = konten.find(k => k.konto_nr === kontoNr);

  const inpSel = {
    background: '#fff', border: '1px solid #d4dcd4', borderRadius: 7,
    padding: '5px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, flexShrink: 0 }}>📒</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Kontoblätter</span>
          <div style={{ width: 1, height: 18, background: '#d4dcd4' }} />

          {/* Konto-Auswahl */}
          <KontoSelector konten={konten} value={kontoNr} onChange={setKontoNr} />

          {/* Periode */}
          <input type="date" value={von} onChange={e => setVon(e.target.value)} style={inpSel} />
          <span style={{ fontSize: 12, color: '#94a394' }}>–</span>
          <input type="date" value={bis} onChange={e => setBis(e.target.value)} style={inpSel} />

          <button
            onClick={load}
            style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
          >{loading ? '⏳' : '↻'} Laden</button>

          <div style={{ flex: 1 }} />
          <button
            onClick={() => window.print()}
            style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#4a5a4a' }}
          >🖨 Drucken</button>
        </div>

        {/* ── Konto-Info + KPIs ── */}
        {currentKonto && (
          <div style={{ display: 'flex', gap: 0, borderTop: '1px solid #f0f3f0' }}>
            <div style={{ padding: '8px 16px', flex: 2, borderRight: '1px solid #f0f3f0' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394', marginBottom: 2 }}>Konto</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#3d6641', fontVariantNumeric: 'tabular-nums' }}>{currentKonto.konto_nr}</span>
                <span style={{ fontSize: 13, color: '#1a1a2e' }}>{currentKonto.bezeichnung}</span>
                {currentKonto.konto_typ && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, ...TYP_COLOR[currentKonto.konto_typ] }}>{currentKonto.konto_typ}</span>
                )}
              </div>
            </div>
            {[
              { label: 'Eröffnungssaldo', value: eroeff, mono: true },
              { label: 'Total Soll',      value: totalSoll },
              { label: 'Total Haben',     value: totalHaben },
              { label: 'Schlusssaldo',    value: schluss, bold: true },
            ].map((k, i) => (
              <div key={i} style={{ padding: '8px 16px', flex: 1, borderRight: i < 3 ? '1px solid #f0f3f0' : 'none' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394', marginBottom: 2 }}>{k.label}</div>
                <div style={{
                  fontSize: 14, fontWeight: k.bold ? 700 : 500, fontVariantNumeric: 'tabular-nums',
                  color: k.value == null ? '#94a394' : (k.value < 0 ? '#991b1b' : '#1a1a2e'),
                }}>
                  {k.value == null ? '—' : `CHF ${N2(k.value)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Tabelle ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {!kontoNr ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a394', fontSize: 13 }}>
            Konto oben auswählen um das Kontoblatt anzuzeigen
          </div>
        ) : loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#fafcfa' }}>
                <th style={th}>Datum</th>
                <th style={th}>Buchungs-Nr.</th>
                <th style={th}>Gegenkonto</th>
                <th style={{ ...th, flex: 1 }}>Buchungstext / Beleg</th>
                <th style={{ ...th, textAlign: 'right' }}>MWST</th>
                <th style={{ ...th, textAlign: 'right' }}>Soll</th>
                <th style={{ ...th, textAlign: 'right' }}>Haben</th>
                <th style={{ ...th, textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Eröffnungssaldo-Zeile ── */}
              <tr style={{ background: '#e8f0e8' }}>
                <td style={{ ...td, fontWeight: 600, color: '#3d6641', fontSize: 11.5 }} colSpan={3}>
                  Eröffnungssaldo {von}
                </td>
                <td style={td} />
                <td style={tdR} />
                <td style={tdR} />
                <td style={tdR} />
                <td style={{ ...tdR, fontWeight: 700, color: '#1a1a2e' }}>
                  CHF {N2(eroeff)}
                </td>
              </tr>

              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '24px 16px', textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>
                    Keine Buchungen in diesem Zeitraum
                  </td>
                </tr>
              )}

              {rows.map((r, i) => (
                <React.Fragment key={r.buchungs_nr ?? i}>
                  {/* ── Zeile 1: Hauptbuchung ── */}
                  <tr style={{ background: i % 2 === 0 ? '#fff' : '#fafcfa' }}>
                    <td style={{ ...td, color: '#6b826b', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {fmtDate(r.buchungsdatum)}
                    </td>
                    <td style={{ ...tdMono, fontSize: 11.5, color: '#3d6641' }}>
                      {r.buchungs_nr}
                    </td>
                    <td style={{ ...tdMono, fontSize: 11.5 }}>
                      <span style={{ fontWeight: 600 }}>{r.gegenkonto}</span>
                      {r.gegenkonto_bez && (
                        <span style={{ fontSize: 10.5, color: '#94a394', marginLeft: 4 }}>{r.gegenkonto_bez}</span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 12.5, color: '#1a1a2e', maxWidth: 280 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.buch_text || '—'}
                      </span>
                    </td>
                    {/* MWST-Code + Betrag in Hauptzeile */}
                    <td style={{ ...tdR, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {r.mwst_code && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                          {mwstBadge(r.mwst_code)}
                          <span style={{ fontSize: 11, color: '#94a394', fontVariantNumeric: 'tabular-nums' }}>
                            {N2(r.mwst_betrag)}
                          </span>
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdR, color: r.soll > 0 ? '#1a1a2e' : '#d1d5db', fontWeight: r.soll > 0 ? 500 : 400 }}>
                      {r.soll > 0 ? N2(r.soll) : '—'}
                    </td>
                    <td style={{ ...tdR, color: r.haben > 0 ? '#1a1a2e' : '#d1d5db', fontWeight: r.haben > 0 ? 500 : 400 }}>
                      {r.haben > 0 ? N2(r.haben) : '—'}
                    </td>
                    <td style={{ ...tdR, fontWeight: 600, color: r.saldo_lfd < 0 ? '#991b1b' : '#1a1a2e' }}>
                      {N2(r.saldo_lfd)}
                    </td>
                  </tr>

                  {/* ── Zeile 2: Beleg-Referenz (nur wenn vorhanden) ── */}
                  {r.beleg_ref && (
                    <tr style={{ background: i % 2 === 0 ? '#fafcfa' : '#f4f8f4' }}>
                      <td style={{ ...td2, paddingTop: 1, paddingBottom: 5 }} />
                      <td style={{ ...td2, paddingTop: 1, paddingBottom: 5 }} />
                      <td colSpan={2} style={{ ...td2, paddingTop: 1, paddingBottom: 5 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: '#94a394', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Beleg</span>
                          <span style={{ fontSize: 11, color: '#2e4a7d', fontFamily: 'monospace' }}>{r.beleg_ref}</span>
                          {r.quelle_id && (
                            <button
                              onClick={() => navigate(`../kreditoren/erfassen/${r.quelle_id}`)}
                              title="Beleg öffnen"
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a394', fontSize: 11, padding: '0 1px', lineHeight: 1 }}
                            >↗</button>
                          )}
                        </span>
                      </td>
                      <td colSpan={4} style={{ ...td2, paddingTop: 1, paddingBottom: 5 }} />
                    </tr>
                  )}
                </React.Fragment>
              ))}

              {/* ── Schluss-Totalen-Zeile ── */}
              {rows.length > 0 && (
                <tr style={{ background: '#e4ede4', fontWeight: 700 }}>
                  <td colSpan={3} style={{ ...td, fontWeight: 700, fontSize: 12, color: '#3d6641' }}>
                    Total Periode {von} – {bis}
                  </td>
                  <td style={td} />
                  <td style={tdR} />
                  <td style={{ ...tdR, fontWeight: 700 }}>CHF {N2(totalSoll)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>CHF {N2(totalHaben)}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: schluss < 0 ? '#991b1b' : '#166534' }}>CHF {N2(schluss)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Zellen-Styles ─────────────────────────────────────────────────
const th = {
  fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em',
  color: '#6b826b', padding: '7px 10px', borderBottom: '2px solid #e4e9e4',
  textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap',
};
const td = {
  padding: '7px 10px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5,
  verticalAlign: 'middle',
};
const td2 = {
  padding: '0 10px', borderBottom: '1px solid #f0f3f0', fontSize: 11.5,
  verticalAlign: 'top', color: '#94a394',
};
const tdR    = { ...td,  textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const tdMono = { ...td,  fontFamily: 'monospace' };
