import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

// ── Helpers ──────────────────────────────────────────────────────
const N2  = (n) => (n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const N2s = (n, currency = 'CHF') => `${currency} ${N2(n)}`;

function getPeriodRange(year, quarter, methode) {
  if (methode === 'saldosteuersatz') {
    // Semester
    if (quarter === 1) return { von: `${year}-01-01`, bis: `${year}-06-30`, label: `S1 ${year}` };
    return { von: `${year}-07-01`, bis: `${year}-12-31`, label: `S2 ${year}` };
  }
  // Quartal
  const starts = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
  const ends   = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
  return {
    von:   `${year}-${starts[quarter]}`,
    bis:   `${year}-${ends[quarter]}`,
    label: `Q${quarter} ${year}`,
  };
}

// ── Farben & Styles ───────────────────────────────────────────────
const styles = {
  table:  { width: '100%', borderCollapse: 'collapse' },
  th:     { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' },
  thR:    { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'right', background: '#fafcfa', whiteSpace: 'nowrap' },
  td:     { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' },
  tdR:    { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tdMono: { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12, verticalAlign: 'middle', fontFamily: 'monospace' },
};

const codeBadge = (code) => {
  const colors = {
    M81: ['#dbeafe','#1e40af'], M26: ['#fef9c3','#854d0e'], M38: ['#fce7f3','#9d174d'],
    I81: ['#ede9fe','#5b21b6'], M0: ['#f3f4f6','#374151'],
    V81: ['#dcfce7','#166534'], V26: ['#fef3c7','#92400e'], V38: ['#fce7f3','#9d174d'],
    V0:  ['#f3f4f6','#374151'],
  };
  const [bg, color] = colors[code] ?? ['#f3f4f6','#374151'];
  return <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: bg, color }}>{code}</span>;
};

// ── Ziffer-Box (Swiss MWST Form) ─────────────────────────────────
function Ziffer({ nr, label, value, highlight, currency = 'CHF', indent = false, bold = false, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: highlight ? '10px 12px' : '7px 12px',
      background: highlight ? (color === 'red' ? '#fee2e2' : color === 'green' ? '#dcfce7' : '#f0f7ff') : 'transparent',
      borderRadius: highlight ? 8 : 0,
      borderBottom: highlight ? 'none' : '1px solid #f0f3f0',
      marginLeft: indent ? 20 : 0,
    }}>
      <span style={{ flexShrink: 0, width: 44, fontSize: 10.5, fontWeight: 700, color: '#7a9b7f', fontFamily: 'monospace' }}>Ziff. {nr}</span>
      <span style={{ flex: 1, fontSize: bold ? 13 : 12.5, fontWeight: bold ? 700 : 400, color: bold ? '#1a1a2e' : '#4a5a4a' }}>{label}</span>
      <span style={{
        flexShrink: 0, fontVariantNumeric: 'tabular-nums',
        fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 500,
        color: color === 'red' ? '#991b1b' : color === 'green' ? '#166534' : '#1a1a2e',
        minWidth: 120, textAlign: 'right',
      }}>
        {value == null ? <span style={{ color: '#94a394' }}>—</span> : `${currency} ${N2(value)}`}
      </span>
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ padding: '10px 12px 6px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394', borderBottom: '2px solid #e4e9e4', background: '#fff' }}>
      {children}
    </div>
  );
}

// ── Tab: Offizielle Abrechnung ────────────────────────────────────
function TabAbrechnung({ summary, mandant, period }) {
  const byCode = Object.fromEntries(summary.map(s => [s.mwst_code, s]));
  const waehrung = mandant?.waehrung ?? 'CHF';

  // Vorsteuer-Summen
  const vs_normal    = byCode['M81']?.sum_mwst ?? 0;
  const vs_reduced   = byCode['M26']?.sum_mwst ?? 0;
  const vs_hotel     = byCode['M38']?.sum_mwst ?? 0;
  const vs_invest    = byCode['I81']?.sum_mwst ?? 0;
  const vorsteuer_total = vs_normal + vs_reduced + vs_hotel + vs_invest;

  // Umsatzsteuer-Summen (aus Debitoren, Phase 2)
  const us_normal = byCode['V81']?.sum_mwst ?? 0;
  const us_reduced = byCode['V26']?.sum_mwst ?? 0;
  const us_hotel  = byCode['V38']?.sum_mwst ?? 0;
  const umsatz_total = us_normal + us_reduced + us_hotel;

  // Netto-Umsätze
  const umsatz_netto_81 = byCode['V81']?.sum_netto ?? 0;
  const umsatz_netto_26 = byCode['V26']?.sum_netto ?? 0;
  const umsatz_netto_38 = byCode['V38']?.sum_netto ?? 0;
  const gesamtumsatz = umsatz_netto_81 + umsatz_netto_26 + umsatz_netto_38 + (byCode['V0']?.sum_netto ?? 0);

  const zahllast = umsatz_total - vorsteuer_total;

  if (mandant?.mwst_methode === 'saldosteuersatz') {
    const sss = mandant.saldosteuersatz_prozent ?? 0;
    const steuer = gesamtumsatz * sss / 100;
    return (
      <div style={{ padding: 20, maxWidth: 600 }}>
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
          ⚡ Saldosteuersatz-Methode — Abrechnung {period.label}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
          <SectionHeader>Saldosteuersatz-Abrechnung (Formular 533a)</SectionHeader>
          <Ziffer nr="200" label="Gesamtumsatz (inkl. MWST)" value={gesamtumsatz} currency={waehrung} />
          <Ziffer nr="900" label={`Saldosteuersatz: ${sss}%`} value={steuer} currency={waehrung} />
          <div style={{ height: 8 }} />
          <Ziffer nr="500" label="Zu zahlende Steuer" value={steuer} currency={waehrung} highlight bold color={steuer > 0 ? 'red' : 'green'} />
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: '#94a394', lineHeight: 1.6 }}>
          Hinweis: Bei der Saldosteuersatz-Methode entfällt der Vorsteuerabzug. Die Steuer berechnet sich auf dem Gesamtumsatz.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 640 }}>
      <div style={{ marginBottom: 12, fontSize: 12, color: '#6b826b' }}>
        MWST-Abrechnung Effektive Methode — {period.label} — Formular 533
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Abschnitt I: Umsatz */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
          <SectionHeader>I — Umsatz und geschuldete Steuer</SectionHeader>
          <Ziffer nr="200" label="Vereinbarte/vereinnahmte Entgelte (Gesamtumsatz inkl. MWST)" value={gesamtumsatz || null} currency={waehrung} />
          <Ziffer nr="205" label="Von der Steuer ausgenommene Leistungen" value={byCode['V0']?.sum_netto ?? 0} currency={waehrung} indent />
          <Ziffer nr="220" label="Steuerbarer Umsatz (Ziff. 200 minus 205)" value={gesamtumsatz - (byCode['V0']?.sum_netto ?? 0) || null} currency={waehrung} bold />
          <div style={{ padding: '6px 12px', fontSize: 11, color: '#94a394', background: '#fafcfa', fontStyle: 'italic' }}>Steuer auf dem steuerbaren Umsatz:</div>
          <Ziffer nr="302" label={`Zum Satz von 8.1% auf CHF ${N2(umsatz_netto_81)}`} value={us_normal || null} currency={waehrung} indent />
          <Ziffer nr="312" label={`Zum Satz von 3.8% auf CHF ${N2(umsatz_netto_38)}`} value={us_hotel || null} currency={waehrung} indent />
          <Ziffer nr="342" label={`Zum Satz von 2.6% auf CHF ${N2(umsatz_netto_26)}`} value={us_reduced || null} currency={waehrung} indent />
          <Ziffer nr="399" label="Geschuldete Steuer (302 + 312 + 342)" value={umsatz_total || null} currency={waehrung} bold />
        </div>

        {/* Abschnitt II: Vorsteuern */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
          <SectionHeader>II — Abziehbare Vorsteuern</SectionHeader>
          <Ziffer nr="400" label={`Vorsteuern auf Material-/Dienstleistungsaufwand (M81: ${N2(vs_normal)}, M26: ${N2(vs_reduced)}, M38: ${N2(vs_hotel)})`} value={vs_normal + vs_reduced + vs_hotel} currency={waehrung} />
          <Ziffer nr="405" label={`Vorsteuern auf Investitionen und übrigem Betriebsaufwand (I81)`} value={vs_invest || null} currency={waehrung} />
          <Ziffer nr="410" label="Vorsteuerkorrekturen und -kürzungen (Eigenverbrauch, etc.)" value={0} currency={waehrung} />
          <Ziffer nr="479" label="Abziehbare Vorsteuern gesamt" value={vorsteuer_total} currency={waehrung} bold />
        </div>

        {/* Abschnitt III: Abrechnung */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
          <SectionHeader>III — Abrechnung</SectionHeader>
          <Ziffer nr="500" label={zahllast >= 0 ? '🔴 Zu zahlende Steuer (399 minus 479)' : '🟢 Steuerguthaben (479 minus 399)'} value={Math.abs(zahllast)} currency={waehrung} highlight bold color={zahllast > 0 ? 'red' : 'green'} />
        </div>

        {/* Hinweis wenn keine Daten */}
        {gesamtumsatz === 0 && vorsteuer_total === 0 && (
          <div style={{ padding: '12px 16px', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
            ⚠️ Keine Buchungen mit MWST in diesem Zeitraum. Debitoren-Umsätze werden in Phase 2 integriert.
          </div>
        )}
        {vorsteuer_total > 0 && gesamtumsatz === 0 && (
          <div style={{ padding: '12px 16px', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 8, fontSize: 12, color: '#1e40af' }}>
            ℹ️ Vorsteuer aus Kreditoren CHF {N2(vorsteuer_total)} erfasst. Umsatzsteuer aus Debitoren-Modul folgt in Phase 2 (Leistungserfassung-Integration).
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Nach MWST-Code ──────────────────────────────────────────
function TabNachCode({ summary }) {
  const vorsteuer = summary.filter(s => s.typ === 'vorsteuer');
  const umsatz    = summary.filter(s => s.typ === 'umsatzsteuer');
  const befreit   = summary.filter(s => s.typ === 'steuerbefreit');

  const SummaryTable = ({ rows, title, icon }) => (
    <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '10px 14px', background: '#fafcfa', borderBottom: '1px solid #e4e9e4', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b' }}>{title}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '20px 14px', color: '#94a394', fontSize: 12, textAlign: 'center' }}>Keine Buchungen in dieser Periode</div>
      ) : (
        <table style={styles.table}>
          <thead><tr>
            <th style={styles.th}>Code</th>
            <th style={styles.th}>Bezeichnung</th>
            <th style={{ ...styles.thR }}>Satz</th>
            <th style={{ ...styles.thR }}>Buchungen</th>
            <th style={{ ...styles.thR }}>Nettobetrag</th>
            <th style={{ ...styles.thR, color: '#2e4a7d' }}>MWST-Betrag</th>
            <th style={{ ...styles.thR }}>Bruttobetrag</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.mwst_code}>
                <td style={styles.td}>{codeBadge(r.mwst_code)}</td>
                <td style={styles.td}>{r.bezeichnung ?? r.mwst_code}</td>
                <td style={styles.tdR}>{r.mwst_satz != null ? `${r.mwst_satz}%` : '—'}</td>
                <td style={styles.tdR}>{r.anzahl_buchungen}</td>
                <td style={styles.tdR}>{N2(r.sum_netto)}</td>
                <td style={{ ...styles.tdR, fontWeight: 600, color: '#2e4a7d' }}>{N2(r.sum_mwst)}</td>
                <td style={styles.tdR}>{N2(r.sum_brutto)}</td>
              </tr>
            ))}
            <tr style={{ background: '#fafcfa', fontWeight: 700 }}>
              <td colSpan={4} style={{ ...styles.td, fontSize: 11.5, color: '#6b826b' }}>Total</td>
              <td style={styles.tdR}>{N2(rows.reduce((s, r) => s + (r.sum_netto ?? 0), 0))}</td>
              <td style={{ ...styles.tdR, color: '#2e4a7d' }}>{N2(rows.reduce((s, r) => s + (r.sum_mwst ?? 0), 0))}</td>
              <td style={styles.tdR}>{N2(rows.reduce((s, r) => s + (r.sum_brutto ?? 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <SummaryTable rows={vorsteuer} title="Vorsteuer (Kreditoren / Einkauf)" icon="🟢" />
      <SummaryTable rows={umsatz} title="Umsatzsteuer (Debitoren / Verkauf)" icon="🔴" />
      <SummaryTable rows={befreit} title="Steuerbefreite Umsätze / Ausnahmen" icon="⚪" />
    </div>
  );
}

// ── Tab: Nach Konto ───────────────────────────────────────────────
function TabNachKonto({ byKonto }) {
  const grouped = useMemo(() => {
    const g = {};
    for (const r of byKonto) {
      if (!g[r.konto_nr]) g[r.konto_nr] = { konto_nr: r.konto_nr, bez: r.konto_bez, codes: [] };
      g[r.konto_nr].codes.push(r);
    }
    return Object.values(g).sort((a, b) => a.konto_nr.localeCompare(b.konto_nr));
  }, [byKonto]);

  if (!byKonto.length) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine Buchungen in diesem Zeitraum</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
        <table style={styles.table}>
          <thead><tr>
            <th style={styles.th}>Konto</th>
            <th style={styles.th}>Bezeichnung</th>
            <th style={styles.th}>MWST-Code</th>
            <th style={{ ...styles.thR }}>Satz</th>
            <th style={{ ...styles.thR }}>Buchungen</th>
            <th style={{ ...styles.thR }}>Nettobetrag</th>
            <th style={{ ...styles.thR, color: '#2e4a7d' }}>MWST-Betrag</th>
          </tr></thead>
          <tbody>
            {grouped.map(grp => (
              <React.Fragment key={grp.konto_nr}>
                {grp.codes.map((r, i) => (
                  <tr key={`${r.konto_nr}-${r.mwst_code}`} style={{ background: i % 2 === 0 ? '#fff' : '#fafcfa' }}>
                    <td style={{ ...styles.tdMono, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? '#1a1a2e' : '#4a5a4a' }}>
                      {i === 0 ? r.konto_nr : ''}
                    </td>
                    <td style={{ ...styles.td, color: i === 0 ? '#1a1a2e' : '#6b826b', fontSize: i === 0 ? 12.5 : 12 }}>
                      {i === 0 ? (r.konto_bez || r.konto_nr) : ''}
                    </td>
                    <td style={styles.td}>{codeBadge(r.mwst_code)}</td>
                    <td style={styles.tdR}>{r.mwst_satz != null ? `${r.mwst_satz}%` : '—'}</td>
                    <td style={styles.tdR}>{r.anzahl}</td>
                    <td style={styles.tdR}>{N2(r.sum_netto)}</td>
                    <td style={{ ...styles.tdR, fontWeight: 600, color: '#2e4a7d' }}>{N2(r.sum_mwst)}</td>
                  </tr>
                ))}
                {/* Konto-Summe */}
                <tr style={{ background: '#f0f7f0' }}>
                  <td colSpan={4} style={{ ...styles.td, fontSize: 11, color: '#6b826b' }}>
                    Konto {grp.konto_nr} Total
                  </td>
                  <td style={{ ...styles.tdR, fontWeight: 600 }}>{grp.codes.reduce((s, r) => s + (r.anzahl ?? 0), 0)}</td>
                  <td style={{ ...styles.tdR, fontWeight: 600 }}>{N2(grp.codes.reduce((s, r) => s + (r.sum_netto ?? 0), 0))}</td>
                  <td style={{ ...styles.tdR, fontWeight: 700, color: '#2e4a7d' }}>{N2(grp.codes.reduce((s, r) => s + (r.sum_mwst ?? 0), 0))}</td>
                </tr>
              </React.Fragment>
            ))}
            {/* Gesamttotal */}
            <tr style={{ background: '#e4ede4', fontWeight: 700 }}>
              <td colSpan={4} style={{ ...styles.td, fontWeight: 700 }}>Gesamttotal</td>
              <td style={{ ...styles.tdR, fontWeight: 700 }}>{byKonto.reduce((s, r) => s + (r.anzahl ?? 0), 0)}</td>
              <td style={{ ...styles.tdR, fontWeight: 700 }}>{N2(byKonto.reduce((s, r) => s + (r.sum_netto ?? 0), 0))}</td>
              <td style={{ ...styles.tdR, fontWeight: 700, color: '#166534' }}>{N2(byKonto.reduce((s, r) => s + (r.sum_mwst ?? 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Detailliert pro Buchung ──────────────────────────────────
function TabDetail({ detail }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return detail;
    const q = search.toLowerCase();
    return detail.filter(d =>
      d.buchungs_nr?.toLowerCase().includes(q) ||
      d.beleg_ref?.toLowerCase().includes(q) ||
      d.konto_soll?.includes(q) ||
      d.mwst_code?.toLowerCase().includes(q) ||
      d.text?.toLowerCase().includes(q)
    );
  }, [detail, search]);

  if (!detail.length) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine Buchungen in diesem Zeitraum</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div style={{ flexShrink: 0, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buchung, Beleg-Nr., Konto suchen…"
          style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #d4dcd4', fontSize: 12.5, outline: 'none', background: '#f7faf7', color: '#1a1a2e', width: 260 }}
        />
        <span style={{ fontSize: 12, color: '#94a394' }}>{filtered.length} Buchungen</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={styles.table}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr>
            <th style={styles.th}>Datum</th>
            <th style={styles.th}>Buchungs-Nr.</th>
            <th style={styles.th}>Beleg</th>
            <th style={styles.th}>Konto Soll</th>
            <th style={styles.th}>Code</th>
            <th style={{ ...styles.thR }}>Satz</th>
            <th style={{ ...styles.thR }}>Netto</th>
            <th style={{ ...styles.thR, color: '#2e4a7d' }}>MWST dekl.</th>
            <th style={{ ...styles.thR, color: '#6b826b' }}>MWST erwartet</th>
            <th style={{ ...styles.thR }}>Differenz</th>
            <th style={styles.th}>Text</th>
          </tr></thead>
          <tbody>
            {filtered.map((d, i) => {
              const diffOk = Math.abs(d.differenz ?? 0) <= 0.05;
              return (
                <tr key={d.buchungs_nr ?? i} style={{ background: i % 2 === 0 ? '#fff' : '#fafcfa' }}>
                  <td style={{ ...styles.td, fontSize: 12, color: '#6b826b', whiteSpace: 'nowrap' }}>
                    {d.buchungsdatum ? new Date(d.buchungsdatum).toLocaleDateString('de-CH') : '—'}
                  </td>
                  <td style={styles.tdMono}>{d.buchungs_nr}</td>
                  <td style={{ ...styles.tdMono, color: '#2e4a7d' }}>{d.beleg_ref}</td>
                  <td style={styles.tdMono}>{d.konto_soll} <span style={{ fontSize: 11, color: '#94a394' }}>{d.konto_soll_bez}</span></td>
                  <td style={styles.td}>{codeBadge(d.mwst_code)}</td>
                  <td style={styles.tdR}>{d.mwst_satz != null ? `${d.mwst_satz}%` : '—'}</td>
                  <td style={styles.tdR}>{N2(d.betrag_netto)}</td>
                  <td style={{ ...styles.tdR, fontWeight: 600, color: '#2e4a7d' }}>{N2(d.mwst_betrag)}</td>
                  <td style={{ ...styles.tdR, color: '#6b826b' }}>{N2(d.mwst_erwartet)}</td>
                  <td style={{ ...styles.tdR, color: diffOk ? '#94a394' : '#991b1b', fontWeight: diffOk ? 400 : 700 }}>
                    {diffOk ? <span style={{ fontSize: 11 }}>✓</span> : N2(d.differenz)}
                  </td>
                  <td style={{ ...styles.td, fontSize: 11.5, color: '#4a5a4a', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Verprobung ───────────────────────────────────────────────
function TabVerprobung({ detail, summary }) {
  const fehler = detail.filter(d => Math.abs(d.differenz ?? 0) > 0.05);
  const totalNetto  = detail.reduce((s, d) => s + (d.betrag_netto ?? 0), 0);
  const totalDeklariert = detail.reduce((s, d) => s + (d.mwst_betrag ?? 0), 0);
  const totalErwartet   = detail.reduce((s, d) => s + (d.mwst_erwartet ?? 0), 0);
  const totalDiff = totalDeklariert - totalErwartet;

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status-Karte */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px',
        borderRadius: 10, border: `1px solid ${fehler.length === 0 ? '#86efac' : '#fca5a5'}`,
        background: fehler.length === 0 ? '#f0fdf4' : '#fff5f5',
      }}>
        <span style={{ fontSize: 32 }}>{fehler.length === 0 ? '✅' : '⚠️'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: fehler.length === 0 ? '#166534' : '#991b1b' }}>
            {fehler.length === 0 ? 'Verprobung OK — alle Beträge stimmen überein' : `${fehler.length} Differenz${fehler.length !== 1 ? 'en' : ''} gefunden`}
          </div>
          <div style={{ fontSize: 12, color: '#6b826b', marginTop: 2 }}>
            {detail.length} Buchungen geprüft · Toleranz ±0.05 CHF (Rundungsdifferenz)
          </div>
        </div>
      </div>

      {/* Verprobungs-Tabelle */}
      <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: '#fafcfa', borderBottom: '1px solid #e4e9e4', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b' }}>
          MWST-Verprobung nach Code
        </div>
        <table style={styles.table}>
          <thead><tr>
            <th style={styles.th}>MWST-Code</th>
            <th style={styles.th}>Bezeichnung</th>
            <th style={{ ...styles.thR }}>Satz</th>
            <th style={{ ...styles.thR }}>Nettobetrag</th>
            <th style={{ ...styles.thR, color: '#2e4a7d' }}>MWST deklariert</th>
            <th style={{ ...styles.thR, color: '#6b826b' }}>MWST erwartet</th>
            <th style={{ ...styles.thR }}>Differenz</th>
            <th style={styles.th}>Status</th>
          </tr></thead>
          <tbody>
            {summary.map(s => {
              const expectedMwst = (s.sum_netto ?? 0) * (s.mwst_satz ?? 0) / 100;
              const diff = (s.sum_mwst ?? 0) - expectedMwst;
              const ok = Math.abs(diff) <= 0.10;
              return (
                <tr key={s.mwst_code}>
                  <td style={styles.td}>{codeBadge(s.mwst_code)}</td>
                  <td style={styles.td}>{s.bezeichnung ?? s.mwst_code}</td>
                  <td style={styles.tdR}>{s.mwst_satz != null ? `${s.mwst_satz}%` : '—'}</td>
                  <td style={styles.tdR}>{N2(s.sum_netto)}</td>
                  <td style={{ ...styles.tdR, fontWeight: 600, color: '#2e4a7d' }}>{N2(s.sum_mwst)}</td>
                  <td style={{ ...styles.tdR, color: '#6b826b' }}>{N2(expectedMwst)}</td>
                  <td style={{ ...styles.tdR, color: ok ? '#94a394' : '#991b1b', fontWeight: ok ? 400 : 700 }}>
                    {N2(diff)}
                  </td>
                  <td style={styles.td}>
                    {ok
                      ? <span style={{ fontSize: 11.5, color: '#166534' }}>✓ OK</span>
                      : <span style={{ fontSize: 11.5, color: '#991b1b', fontWeight: 600 }}>⚠ Prüfen</span>
                    }
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: '#f0f7f0', fontWeight: 700 }}>
              <td colSpan={3} style={{ ...styles.td, fontWeight: 700 }}>Total</td>
              <td style={{ ...styles.tdR, fontWeight: 700 }}>{N2(totalNetto)}</td>
              <td style={{ ...styles.tdR, fontWeight: 700, color: '#2e4a7d' }}>{N2(totalDeklariert)}</td>
              <td style={{ ...styles.tdR, fontWeight: 700, color: '#6b826b' }}>{N2(totalErwartet)}</td>
              <td style={{ ...styles.tdR, fontWeight: 700, color: Math.abs(totalDiff) > 0.10 ? '#991b1b' : '#166534' }}>{N2(totalDiff)}</td>
              <td style={styles.td}>{Math.abs(totalDiff) <= 0.10 ? <span style={{ color: '#166534', fontSize: 12 }}>✓ OK</span> : <span style={{ color: '#991b1b', fontSize: 12, fontWeight: 700 }}>⚠ Prüfen</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Fehler-Detail */}
      {fehler.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #fca5a5', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: '#fee2e2', borderBottom: '1px solid #fca5a5', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#991b1b' }}>
            Buchungen mit Differenzen (&gt;±0.05 CHF)
          </div>
          <table style={styles.table}>
            <thead><tr>
              <th style={styles.th}>Datum</th><th style={styles.th}>Buchungs-Nr.</th><th style={styles.th}>Beleg</th>
              <th style={styles.th}>Code</th><th style={styles.thR}>Netto</th>
              <th style={styles.thR}>MWST dekl.</th><th style={styles.thR}>MWST erwartet</th><th style={styles.thR}>Diff.</th>
            </tr></thead>
            <tbody>
              {fehler.map((d, i) => (
                <tr key={i} style={{ background: '#fff5f5' }}>
                  <td style={{ ...styles.td, fontSize: 12 }}>{d.buchungsdatum ? new Date(d.buchungsdatum).toLocaleDateString('de-CH') : '—'}</td>
                  <td style={styles.tdMono}>{d.buchungs_nr}</td>
                  <td style={{ ...styles.tdMono, color: '#2e4a7d' }}>{d.beleg_ref}</td>
                  <td style={styles.td}>{codeBadge(d.mwst_code)}</td>
                  <td style={styles.tdR}>{N2(d.betrag_netto)}</td>
                  <td style={styles.tdR}>{N2(d.mwst_betrag)}</td>
                  <td style={styles.tdR}>{N2(d.mwst_erwartet)}</td>
                  <td style={{ ...styles.tdR, fontWeight: 700, color: '#991b1b' }}>{N2(d.differenz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Haupt-Komponente ──────────────────────────────────────────────
const TABS = [
  { id: 'abrechnung', label: '📋 Abrechnung',   title: 'Offizielle MWST-Abrechnung (Formular 533)' },
  { id: 'code',       label: '🏷 Nach Code',     title: 'Zusammenfassung nach MWST-Code' },
  { id: 'konto',      label: '📊 Nach Konto',    title: 'Zusammenfassung nach Konto und Code' },
  { id: 'detail',     label: '🔎 Detailliert',   title: 'Alle Buchungen mit MWST-Angaben' },
  { id: 'verprobung', label: '✅ Verprobung',    title: 'Abstimmung deklarierte vs. berechnete MWST' },
];

export default function MwstAbrechnung() {
  const { mandant } = useMandant();
  const currentYear = new Date().getFullYear();
  const currentQ    = Math.ceil((new Date().getMonth() + 1) / 3);

  const [year,    setYear]    = useState(currentYear);
  const [quarter, setQuarter] = useState(currentQ);
  const [tab,     setTab]     = useState('abrechnung');
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState([]);
  const [byKonto, setByKonto] = useState([]);
  const [detail,  setDetail]  = useState([]);

  // Methode aus Mandant lesen (default: effektiv, Quartal)
  const methode    = mandant?.mwst_methode ?? 'effektiv';
  const isSaldo    = methode === 'saldosteuersatz';
  const period     = getPeriodRange(year, quarter, methode);

  const quarters = isSaldo
    ? [{ v: 1, l: 'S1 (Jan–Jun)' }, { v: 2, l: 'S2 (Jul–Dez)' }]
    : [{ v: 1, l: 'Q1 (Jan–Mär)' }, { v: 2, l: 'Q2 (Apr–Jun)' }, { v: 3, l: 'Q3 (Jul–Sep)' }, { v: 4, l: 'Q4 (Okt–Dez)' }];

  const loadData = useCallback(async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      const [s, k, d] = await Promise.all([
        supabase.rpc('fibu_mwst_summary',  { p_mandant_id: mandant.id, p_von: period.von, p_bis: period.bis }),
        supabase.rpc('fibu_mwst_by_konto', { p_mandant_id: mandant.id, p_von: period.von, p_bis: period.bis }),
        supabase.rpc('fibu_mwst_detail',   { p_mandant_id: mandant.id, p_von: period.von, p_bis: period.bis }),
      ]);
      setSummary(s.data ?? []);
      setByKonto(k.data ?? []);
      setDetail(d.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [mandant?.id, period.von, period.bis]);

  useEffect(() => { loadData(); }, [loadData]);

  // KPIs für Header
  const vorsteuerTotal = summary.filter(s => s.typ === 'vorsteuer').reduce((s, r) => s + (r.sum_mwst ?? 0), 0);
  const umsatzTotal    = summary.filter(s => s.typ === 'umsatzsteuer').reduce((s, r) => s + (r.sum_mwst ?? 0), 0);
  const zahllast       = umsatzTotal - vorsteuerTotal;

  const inpSel = {
    background: '#f0f3f0', border: '1px solid #c5cfc5', borderRadius: 7,
    padding: '5px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0, background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        {/* Periode-Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f0f3f0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a2e' }}>MWST-Abrechnung</span>
          <div style={{ width: 1, height: 16, background: '#d4dcd4', margin: '0 4px' }} />

          <select style={inpSel} value={year} onChange={e => setYear(+e.target.value)}>
            {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select style={inpSel} value={quarter} onChange={e => setQuarter(+e.target.value)}>
            {quarters.map(q => <option key={q.v} value={q.v}>{q.l}</option>)}
          </select>

          <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: isSaldo ? '#fef3c7' : '#dbeafe', color: isSaldo ? '#92400e' : '#1e40af' }}>
            {isSaldo ? '⚡ Saldosteuersatz' : '📊 Effektive Methode'}
          </div>
          <span style={{ fontSize: 12, color: '#6b826b' }}>{period.von} – {period.bis}</span>

          <div style={{ flex: 1 }} />
          <button
            onClick={loadData}
            style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#4a5a4a' }}
          >{loading ? '⏳' : '↻'} Laden</button>
          <button
            onClick={() => window.print()}
            style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >🖨 Drucken</button>
        </div>

        {/* KPI-Leiste */}
        {!loading && (
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e4e9e4', overflow: 'hidden' }}>
            {[
              { label: 'Vorsteuer (abziehbar)', value: vorsteuerTotal, sub: `aus ${summary.filter(s=>s.typ==='vorsteuer').reduce((s,r)=>s+(r.anzahl_buchungen??0),0)} Buchungen`, color: '#166534', bg: '#f0fdf4' },
              { label: 'Umsatzsteuer (geschuldet)', value: umsatzTotal, sub: 'aus Debitoren (Phase 2)', color: umsatzTotal > 0 ? '#991b1b' : '#94a394', bg: umsatzTotal > 0 ? '#fff5f5' : '#fafcfa' },
              { label: zahllast >= 0 ? '🔴 Zahllast' : '🟢 Steuerguthaben', value: Math.abs(zahllast), sub: zahllast >= 0 ? 'zu zahlen an ESTV' : 'Rückerstattung ESTV', color: zahllast > 0 ? '#991b1b' : '#166534', bg: zahllast > 0 ? '#fff5f5' : '#f0fdf4' },
              { label: 'Buchungen total', value: null, raw: detail.length, sub: `${period.label}`, color: '#2e4a7d', bg: '#f0f7ff' },
            ].map((kpi, i) => (
              <div key={i} style={{ flex: 1, padding: '10px 16px', background: kpi.bg, borderRight: i < 3 ? '1px solid #e4e9e4' : 'none' }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#94a394', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>{kpi.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color, fontVariantNumeric: 'tabular-nums' }}>
                  {kpi.raw != null ? kpi.raw : `CHF ${N2(kpi.value)}`}
                </div>
                <div style={{ fontSize: 11, color: '#94a394', marginTop: 2 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab-Navigation */}
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px', border: 'none', borderBottom: tab === t.id ? '2px solid #7a9b7f' : '2px solid transparent',
                background: 'transparent', fontSize: 12.5, fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? '#1a1a2e' : '#6b826b', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
        ) : (
          <>
            {tab === 'abrechnung' && <TabAbrechnung summary={summary} mandant={mandant} period={period} />}
            {tab === 'code'       && <TabNachCode summary={summary} />}
            {tab === 'konto'      && <TabNachKonto byKonto={byKonto} />}
            {tab === 'detail'     && <TabDetail detail={detail} />}
            {tab === 'verprobung' && <TabVerprobung detail={detail} summary={summary} />}
          </>
        )}
      </div>
    </div>
  );
}
