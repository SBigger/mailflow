import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

const N2 = (n) => n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CHF = (n) => `CHF ${N2(n)}`;

// Konto-Klassen-Bezeichnung aus Konto-Nr. (erstes Zeichen)
const KLASSEN = {
  '1': 'Umlauf- und Anlagevermögen',
  '2': 'Fremdkapital / Eigenkapital',
  '3': 'Betriebsertrag',
  '4': 'Material- und Warenaufwand',
  '5': 'Personalaufwand',
  '6': 'Übriger Betriebsaufwand',
  '7': 'Nebenbetrieb / Liegenschaften',
  '8': 'Ausserordentliches / Steuern',
};

function getKlasse(kontoNr) {
  return kontoNr ? KLASSEN[kontoNr[0]] ?? kontoNr[0] : '';
}

// ── Abschnitt-Tabelle (Aktiven / Passiven / Ertrag / Aufwand) ────
function KontoTable({ title, rows, colorScheme, totalLabel, budgetMap }) {
  const [collapsed, setCollapsed] = useState({});
  const withBudget = !!budgetMap && Object.keys(budgetMap).length > 0;
  const kontoTyp   = rows[0]?.konto_typ;

  const ist = (r) => Math.abs(r.saldo ?? 0);
  const bud = (r) => Math.abs(budgetMap?.[r.konto_nr] ?? 0);

  const grouped = useMemo(() => {
    const g = {};
    for (const r of rows) {
      const kl = r.konto_nr?.[0] ?? '?';
      if (!g[kl]) g[kl] = { kl, label: getKlasse(r.konto_nr), rows: [] };
      g[kl].rows.push(r);
    }
    return Object.values(g).sort((a, b) => a.kl.localeCompare(b.kl));
  }, [rows]);

  const total    = rows.reduce((s, r) => s + ist(r), 0);
  const totalBud = rows.reduce((s, r) => s + bud(r), 0);

  // günstige Abweichung: Ertrag über Budget / Aufwand unter Budget
  const abwColor = (abw) => {
    if (Math.abs(abw) < 0.005) return '#94a394';
    const guenstig = kontoTyp === 'ertrag' ? abw > 0 : abw < 0;
    return guenstig ? '#166534' : '#991b1b';
  };
  const NUM = { fontSize: 13, fontVariantNumeric: 'tabular-nums', minWidth: withBudget ? 108 : 130, textAlign: 'right' };
  const NUMs = { ...NUM, fontSize: 12.5 };

  // Zahlen-Zellen (Ist / Budget / Abweichung) einer Zeile
  const Cells = ({ i, b, bold }) => {
    const abw = i - b;
    return (
      <>
        <span style={{ ...NUM, fontWeight: bold ? 700 : 500, color: Math.abs(i) < 0.005 ? '#d1d5db' : '#1a1a2e' }}>{CHF(i)}</span>
        {withBudget && <span style={{ ...NUM, fontWeight: bold ? 700 : 400, color: '#6b826b' }}>{b > 0 ? CHF(b) : '—'}</span>}
        {withBudget && <span style={{ ...NUM, fontWeight: bold ? 700 : 500, color: abwColor(abw) }}>{b > 0 ? (abw >= 0 ? '+' : '−') + N2(Math.abs(abw)) : '—'}</span>}
      </>
    );
  };

  return (
    <div style={{
      background: '#fff', border: `1px solid ${colorScheme.border}`,
      borderRadius: 10, overflow: 'hidden', marginBottom: 20,
    }}>
      {/* Section-Header */}
      <div style={{
        padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: colorScheme.headerBg, borderBottom: `1px solid ${colorScheme.border}`,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: colorScheme.headerColor }}>
          {title}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: colorScheme.headerColor }}>
          {CHF(total)}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '16px 20px', color: '#94a394', fontSize: 12.5, textAlign: 'center' }}>
          Keine Salden
        </div>
      ) : (
        <>
          {/* Spalten-Beschriftung bei Budget-Vergleich */}
          {withBudget && (
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px', background: '#fafcfa', borderBottom: `1px solid ${colorScheme.border}` }}>
              <span style={{ flex: 1 }} />
              {['Ist', 'Budget', 'Abw.'].map(h => (
                <span key={h} style={{ minWidth: 108, textAlign: 'right', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a394' }}>{h}</span>
              ))}
            </div>
          )}

          {grouped.map(grp => {
            const gIst = grp.rows.reduce((s, r) => s + ist(r), 0);
            const gBud = grp.rows.reduce((s, r) => s + bud(r), 0);
            return (
            <React.Fragment key={grp.kl}>
              {/* Klassen-Header */}
              <div
                onClick={() => setCollapsed(c => ({ ...c, [grp.kl]: !c[grp.kl] }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 16px', cursor: 'pointer',
                  background: colorScheme.groupBg, borderBottom: `1px solid ${colorScheme.border}`,
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 11, color: colorScheme.groupColor }}>
                  {collapsed[grp.kl] ? '▸' : '▾'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: colorScheme.groupColor, textTransform: 'uppercase', letterSpacing: '.06em', flex: 1 }}>
                  {grp.label}
                </span>
                <span style={{ ...NUMs, color: colorScheme.groupColor, fontWeight: 600 }}>{CHF(gIst)}</span>
                {withBudget && <span style={{ ...NUMs, color: colorScheme.groupColor, fontWeight: 500 }}>{gBud > 0 ? CHF(gBud) : '—'}</span>}
                {withBudget && <span style={{ ...NUMs, color: abwColor(gIst - gBud), fontWeight: 600 }}>{gBud > 0 ? ((gIst - gBud) >= 0 ? '+' : '−') + N2(Math.abs(gIst - gBud)) : '—'}</span>}
              </div>

              {/* Konto-Zeilen */}
              {!collapsed[grp.kl] && grp.rows.map((r, i) => (
                <div
                  key={r.konto_nr}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 0,
                    padding: '7px 16px 7px 28px',
                    borderBottom: `1px solid ${i < grp.rows.length - 1 ? '#f7faf7' : colorScheme.border}`,
                    background: i % 2 === 0 ? '#fff' : '#fafcfa',
                  }}
                >
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600, color: '#3d6641', minWidth: 44 }}>
                    {r.konto_nr}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, color: '#1a1a2e' }}>{r.bezeichnung}</span>
                  <Cells i={ist(r)} b={bud(r)} />
                </div>
              ))}
            </React.Fragment>
          );})}

          {/* Total-Zeile */}
          <div style={{
            display: 'flex', alignItems: 'center', padding: '10px 16px',
            background: colorScheme.totalBg, borderTop: `2px solid ${colorScheme.border}`,
          }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: colorScheme.totalColor }}>{totalLabel}</span>
            <Cells i={total} b={totalBud} bold />
          </div>
        </>
      )}
    </div>
  );
}

// ── Farb-Schemas ──────────────────────────────────────────────────
const SCHEMES = {
  aktiv: {
    headerBg: '#dbeafe', headerColor: '#1e3a8a', border: '#bfdbfe',
    groupBg:  '#eff6ff', groupColor: '#1e40af',
    totalBg:  '#dbeafe', totalColor: '#1e3a8a',
  },
  passiv: {
    headerBg: '#ffedd5', headerColor: '#7c2d12', border: '#fdba74',
    groupBg:  '#fff7ed', groupColor: '#9a3412',
    totalBg:  '#ffedd5', totalColor: '#7c2d12',
  },
  ertrag: {
    headerBg: '#dcfce7', headerColor: '#14532d', border: '#86efac',
    groupBg:  '#f0fdf4', groupColor: '#166534',
    totalBg:  '#dcfce7', totalColor: '#14532d',
  },
  aufwand: {
    headerBg: '#fee2e2', headerColor: '#7f1d1d', border: '#fca5a5',
    groupBg:  '#fff5f5', groupColor: '#991b1b',
    totalBg:  '#fee2e2', totalColor: '#7f1d1d',
  },
};

// ── Hauptkomponente ───────────────────────────────────────────────
export default function Bilanz() {
  const { mandant } = useMandant();
  const currentYear = new Date().getFullYear();

  const [stichtag, setStichtag] = useState(`${currentYear}-12-31`);
  const [vonER,    setVonER]    = useState(`${currentYear}-01-01`);
  const [bisER,    setBisER]    = useState(`${currentYear}-12-31`);
  const [loading,  setLoading]  = useState(false);

  const [bilanzRows, setBilanzRows] = useState([]);
  const [erRows,     setErRows]     = useState([]);
  const [budgetMap,  setBudgetMap]  = useState({});

  const load = useCallback(async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      const erJahr = new Date(bisER).getFullYear();
      const [b, er, bg] = await Promise.all([
        supabase.rpc('fibu_bilanz', {
          p_mandant_id: mandant.id,
          p_stichtag:   stichtag,
        }),
        supabase.rpc('fibu_erfolgsrechnung', {
          p_mandant_id: mandant.id,
          p_von:        vonER,
          p_bis:        bisER,
        }),
        supabase.from('fibu_budget')
          .select('konto_nr,betrag')
          .eq('mandant_id', mandant.id)
          .eq('jahr', erJahr),
      ]);
      setBilanzRows(b.data ?? []);
      setErRows(er.data ?? []);
      const bm = {};
      (bg.data ?? []).forEach(x => { if (Number(x.betrag) !== 0) bm[x.konto_nr] = Number(x.betrag); });
      setBudgetMap(bm);
    } finally {
      setLoading(false);
    }
  }, [mandant?.id, stichtag, vonER, bisER]);

  useEffect(() => { load(); }, [load]);

  // Aufteilen nach Typ
  const aktiven  = bilanzRows.filter(r => r.konto_typ === 'aktiv');
  const passiven = bilanzRows.filter(r => r.konto_typ === 'passiv');
  const ertrag   = erRows.filter(r => r.konto_typ === 'ertrag');
  const aufwand  = erRows.filter(r => r.konto_typ === 'aufwand');

  const totalAktiven  = aktiven.reduce((s, r) => s + Math.abs(r.saldo ?? 0), 0);
  const totalPassiven = passiven.reduce((s, r) => s + Math.abs(r.saldo ?? 0), 0);
  const totalErtrag   = ertrag.reduce((s, r) => s + Math.abs(r.saldo ?? 0), 0);
  const totalAufwand  = aufwand.reduce((s, r) => s + Math.abs(r.saldo ?? 0), 0);
  const jahresergebnis = totalErtrag - totalAufwand;
  const bilanzDiff     = totalAktiven - totalPassiven;

  // Budget-Vergleich Erfolgsrechnung
  const hasBudget       = Object.keys(budgetMap).length > 0;
  const budgetErtrag    = ertrag.reduce((s, r) => s + Math.abs(budgetMap[r.konto_nr] ?? 0), 0);
  const budgetAufwand   = aufwand.reduce((s, r) => s + Math.abs(budgetMap[r.konto_nr] ?? 0), 0);
  const budgetErgebnis  = budgetErtrag - budgetAufwand;

  const inpSel = {
    background: '#fff', border: '1px solid #d4dcd4', borderRadius: 7,
    padding: '5px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, flexShrink: 0 }}>⚖</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Bilanz & Erfolgsrechnung</span>
          <div style={{ width: 1, height: 18, background: '#d4dcd4' }} />

          {/* Bilanz-Stichtag */}
          <span style={{ fontSize: 12, color: '#6b826b', fontWeight: 600 }}>Bilanz per</span>
          <input type="date" value={stichtag} onChange={e => setStichtag(e.target.value)} style={inpSel} />

          <div style={{ width: 1, height: 18, background: '#d4dcd4' }} />

          {/* ER-Periode */}
          <span style={{ fontSize: 12, color: '#6b826b', fontWeight: 600 }}>ER</span>
          <input type="date" value={vonER} onChange={e => setVonER(e.target.value)} style={inpSel} />
          <span style={{ fontSize: 12, color: '#94a394' }}>–</span>
          <input type="date" value={bisER} onChange={e => setBisER(e.target.value)} style={inpSel} />

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
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : (
          <>
            {/* ════════════════════ BILANZ ════════════════════ */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
              padding: '8px 0', borderBottom: '2px solid #e4e9e4',
            }}>
              <div style={{ width: 4, height: 24, background: '#1e40af', borderRadius: 2 }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Bilanz</span>
              <span style={{ fontSize: 12.5, color: '#94a394' }}>per {new Date(stichtag).toLocaleDateString('de-CH')}</span>
              <div style={{ flex: 1 }} />
              {/* Bilanzkontrolle */}
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
                background: Math.abs(bilanzDiff) < 0.01 ? '#dcfce7' : '#fee2e2',
                color: Math.abs(bilanzDiff) < 0.01 ? '#166534' : '#991b1b',
              }}>
                {Math.abs(bilanzDiff) < 0.01
                  ? '✓ Bilanz ausgeglichen'
                  : `⚠ Differenz CHF ${N2(bilanzDiff)}`}
              </span>
            </div>

            <KontoTable
              title="AKTIVEN"
              rows={aktiven}
              colorScheme={SCHEMES.aktiv}
              totalLabel="Total Aktiven"
            />
            <KontoTable
              title="PASSIVEN"
              rows={passiven}
              colorScheme={SCHEMES.passiv}
              totalLabel="Total Passiven"
            />

            {/* ════════════════════ ERFOLGSRECHNUNG ════════════════ */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, marginBottom: 16,
              padding: '8px 0', borderBottom: '2px solid #e4e9e4',
            }}>
              <div style={{ width: 4, height: 24, background: '#166534', borderRadius: 2 }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Erfolgsrechnung</span>
              <span style={{ fontSize: 12.5, color: '#94a394' }}>
                {new Date(vonER).toLocaleDateString('de-CH')} – {new Date(bisER).toLocaleDateString('de-CH')}
              </span>
            </div>

            <KontoTable
              title="ERTRAG"
              rows={ertrag}
              colorScheme={SCHEMES.ertrag}
              totalLabel="Total Ertrag"
              budgetMap={budgetMap}
            />
            <KontoTable
              title="AUFWAND"
              rows={aufwand}
              colorScheme={SCHEMES.aufwand}
              totalLabel="Total Aufwand"
              budgetMap={budgetMap}
            />

            {/* Jahresergebnis */}
            <div style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
              padding: '14px 20px',
              background: jahresergebnis >= 0 ? '#dcfce7' : '#fee2e2',
              border: `2px solid ${jahresergebnis >= 0 ? '#86efac' : '#fca5a5'}`,
              borderRadius: 10, marginTop: 4,
            }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: jahresergebnis >= 0 ? '#14532d' : '#7f1d1d' }}>
                {jahresergebnis >= 0 ? '✅ Jahresgewinn' : '❌ Jahresverlust'}
              </span>
              {hasBudget && (() => {
                const abw = jahresergebnis - budgetErgebnis;
                return (
                  <span style={{ fontSize: 11.5, color: '#4a5a4a', textAlign: 'right', marginRight: 14 }}>
                    Budget: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{CHF(budgetErgebnis)}</strong>
                    <span style={{ marginLeft: 8, fontWeight: 700, color: abw >= 0 ? '#166534' : '#991b1b' }}>
                      Abw. {abw >= 0 ? '+' : '−'}{N2(Math.abs(abw))}
                    </span>
                  </span>
                );
              })()}
              <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: jahresergebnis >= 0 ? '#166534' : '#991b1b' }}>
                {CHF(Math.abs(jahresergebnis))}
              </span>
            </div>

            {/* Kennzahlen */}
            {(totalAktiven > 0 || totalErtrag > 0) && (
              <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
                {[
                  { label: 'Eigenkapital-Quote', value: totalAktiven > 0 ? `${((totalPassiven > 0 ? 0 : totalAktiven) / totalAktiven * 100).toFixed(1)} %` : '—', hint: 'EK / Bilanzsumme' },
                  { label: 'Umsatzrendite', value: totalErtrag > 0 ? `${(jahresergebnis / totalErtrag * 100).toFixed(1)} %` : '—', hint: 'Jahresergebnis / Ertrag' },
                  { label: 'Bilanzsumme', value: CHF(totalAktiven) },
                  { label: 'Ertrag', value: CHF(totalErtrag) },
                  { label: 'Aufwand', value: CHF(totalAufwand) },
                ].map((k, i) => (
                  <div key={i} style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: '12px 16px', minWidth: 150 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394', marginBottom: 4 }}>{k.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
                    {k.hint && <div style={{ fontSize: 10.5, color: '#94a394', marginTop: 2 }}>{k.hint}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
