import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { useNavigate } from 'react-router-dom';

const N2 = (n) => n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('de-CH') : '—';

// Beleg-Nr. kurz: "RE-2024-000420" → "420"
const shortBeleg = (ref) => {
  if (!ref) return null;
  const m = ref.match(/(\d+)$/);
  return m ? String(parseInt(m[1], 10)) : ref;
};

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

// ── PDF Export ────────────────────────────────────────────────────
async function exportKontoblattPDF({ rows, eroeff, kontoNr, currentKonto, von, bis, mandantName }) {
  const { jsPDF }            = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const DARK = [26, 26, 46];
  const GRAY = [120, 130, 120];
  const GRN  = [61, 102, 65];
  const LGRN = [232, 240, 232];
  const LGRN2= [212, 228, 212];
  const BLUE = [74, 90, 138];

  const N2l  = (v) => v == null ? '—' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dFmt = (d) => d ? new Date(d).toLocaleDateString('de-CH') : '—';
  const sBel = (ref) => { if (!ref) return ''; const m = ref.match(/(\d+)$/); return m ? String(parseInt(m[1], 10)) : ref; };

  const totalSoll  = rows.reduce((s, r) => s + (r.soll  ?? 0), 0);
  const totalHaben = rows.reduce((s, r) => s + (r.haben ?? 0), 0);
  const schluss    = rows.length > 0 ? rows[rows.length - 1].saldo_lfd : (eroeff ?? 0);

  // ── Seitenheader ──
  const addPageHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...DARK);
    doc.text('Kontoblatt', 14, 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRN);
    doc.text(`${kontoNr}  ${currentKonto?.bezeichnung ?? ''}`, 14, 20.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    doc.text(`Periode ${dFmt(von)} – ${dFmt(bis)}`, 14, 26);
    if (mandantName) doc.text(mandantName, 14, 30.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    doc.text(new Date().toLocaleDateString('de-CH'), 196, 14, { align: 'right' });
    doc.setDrawColor(...GRAY); doc.setLineWidth(0.2); doc.line(14, 33, 196, 33);
  };

  addPageHeader();

  // ── KPI-Zeile ──
  const kpis = [
    ['Eröffnungssaldo', N2l(eroeff)],
    ['Total Soll',      N2l(totalSoll)],
    ['Total Haben',     N2l(totalHaben)],
    ['Schlusssaldo',    N2l(schluss)],
  ];
  const kW = (196 - 14) / 4;
  kpis.forEach(([lbl, val], i) => {
    const x = 14 + i * kW;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
    doc.text(lbl, x, 38);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...DARK);
    doc.text(`CHF ${val}`, x, 43);
  });
  doc.setDrawColor(...GRAY); doc.setLineWidth(0.2); doc.line(14, 46, 196, 46);

  // ── Tabellenzeilen bauen ──
  const body = [];

  // Saldovortrag
  body.push([
    { content: 'Saldovortrag', colSpan: 6, styles: { fontStyle: 'italic', textColor: GRAY, fillColor: [232, 240, 232] } },
    { content: N2l(eroeff), styles: { halign: 'right', fontStyle: 'bold', fillColor: [232, 240, 232] } },
  ]);

  rows.forEach(r => {
    const bel     = sBel(r.beleg_ref);
    const hasAtt  = !!r.quelle_id;
    const hasMwst = r.mwst_betrag && Math.abs(r.mwst_betrag) > 0.005 && r.konto_vorsteuer;

    // Hauptzeile
    body.push([
      { content: dFmt(r.buchungsdatum), styles: { textColor: GRAY } },
      r.buch_text || '—',
      { content: r.gegenkonto || '', styles: { fontStyle: 'bold' } },
      // _att-Flag für didDrawCell
      { content: bel || '', _att: hasAtt, styles: { cellPadding: hasAtt ? { top: 2, bottom: 2, left: 7, right: 2 } : { top: 2, bottom: 2, left: 3, right: 2 } } },
      { content: r.soll > 0 ? N2l(r.soll) : '', styles: { halign: 'right' } },
      { content: r.haben > 0 ? N2l(r.haben) : '', styles: { halign: 'right' } },
      { content: N2l(r.saldo_lfd), styles: { halign: 'right', fontStyle: 'bold', textColor: r.saldo_lfd < 0 ? [153, 27, 27] : DARK } },
    ]);

    // MWST-Sub-Zeile
    if (hasMwst) {
      body.push([
        { content: '', _isMwst: true, styles: { fillColor: [244, 248, 244] } },
        { content: '', styles: { fillColor: [244, 248, 244] } },
        { content: r.konto_vorsteuer, styles: { fontStyle: 'bold', textColor: BLUE, fillColor: [244, 248, 244] } },
        { content: bel || '', _att: true, _isMwst: true, styles: { textColor: BLUE, fillColor: [244, 248, 244], cellPadding: { top: 1, bottom: 1, left: 7, right: 2 } } },
        { content: N2l(r.mwst_betrag), styles: { halign: 'right', textColor: BLUE, fillColor: [244, 248, 244] } },
        { content: '', styles: { fillColor: [244, 248, 244] } },
        { content: N2l(r.saldo_lfd), styles: { halign: 'right', textColor: GRAY, fillColor: [244, 248, 244] } },
      ]);
    }
  });

  // Footer
  if (rows.length > 0) {
    body.push([
      { content: `Saldo  ${dFmt(von)} – ${dFmt(bis)}`, colSpan: 4,
        styles: { fontStyle: 'bold', fillColor: LGRN, fontSize: 8 } },
      { content: N2l(totalSoll),  styles: { halign: 'right', fontStyle: 'bold', fillColor: LGRN } },
      { content: N2l(totalHaben), styles: { halign: 'right', fontStyle: 'bold', fillColor: LGRN } },
      { content: N2l(schluss),    styles: { halign: 'right', fontStyle: 'bold', fillColor: LGRN,
        textColor: schluss < 0 ? [153, 27, 27] : DARK } },
    ]);
    body.push([
      { content: 'Saldovortrag', colSpan: 6, styles: { fontStyle: 'italic', textColor: GRAY } },
      { content: N2l(eroeff), styles: { halign: 'right', textColor: GRAY } },
    ]);
    body.push([
      { content: 'Saldo Buchungsjahr', colSpan: 6,
        styles: { fontStyle: 'bold', fillColor: LGRN2 } },
      { content: N2l(schluss), styles: { halign: 'right', fontStyle: 'bold', fillColor: LGRN2,
        textColor: schluss < 0 ? [153, 27, 27] : [22, 101, 52] } },
    ]);
  }

  autoTable(doc, {
    startY: 49,
    head: [['BelDatum', 'Text', 'Gegenkonto', 'Beleg', 'Soll', 'Haben', 'Saldo']],
    body,
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 20 },
      3: { cellWidth: 20 },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
    },
    headStyles: { fillColor: GRN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 2 } },
    bodyStyles: { fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 3, right: 2 } },
    alternateRowStyles: { fillColor: [248, 251, 248] },
    // Keine alternierenden Farben für MWST-Sub-Zeilen (die setzen ihr eigenes fillColor)
    didParseCell: (data) => {
      if (data.row.raw[0]?._isMwst) {
        data.cell.styles.fontSize = 7.5;
      }
    },
    // 📎 Anhang-Punkt: kleines grünes Rechteck links im Beleg-Cell
    didDrawCell: (data) => {
      if (data.column.index === 3 && data.section === 'body') {
        const cell = data.row.raw[3];
        if (cell?._att) {
          const cx = data.cell.x + 1.8;
          const cy = data.cell.y + data.cell.height / 2 - 1.2;
          doc.setFillColor(...GRN);
          doc.roundedRect(cx, cy, 3.2, 2.4, 0.6, 0.6, 'F');
        }
      }
    },
    didDrawPage: (d) => {
      // Seiten-Fusszeile
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
      doc.text(`${kontoNr} ${currentKonto?.bezeichnung ?? ''}  ·  Seite ${d.pageNumber}`,
        14, doc.internal.pageSize.height - 8);
      doc.text(new Date().toLocaleDateString('de-CH'),
        196, doc.internal.pageSize.height - 8, { align: 'right' });
      // Horizontale Linie oben auf Folgeseiten
      if (d.pageNumber > 1) {
        doc.setDrawColor(...GRAY); doc.setLineWidth(0.2); doc.line(14, 10, 196, 10);
      }
    },
  });

  // Legende unter der Tabelle
  const finalY = doc.lastAutoTable.finalY + 4;
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
  doc.setFillColor(...GRN);
  doc.roundedRect(14, finalY - 1.2, 3.2, 2.4, 0.6, 0.6, 'F');
  doc.text('= Originalbeleg vorhanden', 19, finalY + 0.5);

  const fname = `Kontoblatt_${kontoNr}_${von}_${bis}.pdf`;
  doc.save(fname);
}

// ── Hauptkomponente ───────────────────────────────────────────────
export default function Kontoblaetter() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  const [kontoNr,  setKontoNr]  = useState('');
  const [von,      setVon]      = useState(`${currentYear}-01-01`);
  const [bis,      setBis]      = useState(`${currentYear}-12-31`);
  const [loading,    setLoading]    = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
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
            disabled={!kontoNr || rows.length === 0 || pdfLoading}
            onClick={async () => {
              setPdfLoading(true);
              try {
                await exportKontoblattPDF({
                  rows, eroeff, kontoNr,
                  currentKonto: konten.find(k => k.konto_nr === kontoNr),
                  von, bis,
                  mandantName: mandant?.name,
                });
              } finally { setPdfLoading(false); }
            }}
            style={{
              padding: '5px 13px', borderRadius: 7, border: 'none',
              background: (!kontoNr || rows.length === 0) ? '#e4e9e4' : '#7a9b7f',
              color: (!kontoNr || rows.length === 0) ? '#94a394' : '#fff',
              fontSize: 12, fontWeight: 500, cursor: (!kontoNr || rows.length === 0) ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >{pdfLoading ? '⏳' : '📄'} PDF Export</button>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#fafcfa' }}>
                <th style={th}>BelDatum</th>
                <th style={{ ...th, minWidth: 200 }}>Text</th>
                <th style={th}>Gegenkonto</th>
                <th style={th}>Beleg</th>
                <th style={{ ...th, textAlign: 'right' }}>Soll</th>
                <th style={{ ...th, textAlign: 'right' }}>Haben</th>
                <th style={{ ...th, textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Saldovortrag ── */}
              <tr style={{ background: '#e8f0e8' }}>
                <td style={{ ...td, fontStyle: 'italic', color: '#6b826b', fontSize: 12 }}>Saldovortrag</td>
                <td style={td} />
                <td style={td} />
                <td style={td} />
                <td style={tdR} />
                <td style={tdR} />
                <td style={{ ...tdR, fontWeight: 700 }}>{N2(eroeff)}</td>
              </tr>

              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '24px 16px', textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>
                    Keine Buchungen in diesem Zeitraum
                  </td>
                </tr>
              )}

              {rows.map((r, i) => {
                const bg1 = i % 2 === 0 ? '#fff' : '#fafcfa';
                const bg2 = i % 2 === 0 ? '#f7fbf7' : '#f2f7f2';
                const bel = shortBeleg(r.beleg_ref);
                const hasMwst = r.mwst_betrag && Math.abs(r.mwst_betrag) > 0.005 && r.konto_vorsteuer;
                return (
                  <React.Fragment key={r.buchungs_nr ?? i}>
                    {/* ── Zeile 1: Hauptbuchung ─────────────────────── */}
                    <tr style={{ background: bg1 }}>
                      {/* BelDatum */}
                      <td style={{ ...td, color: '#6b826b', whiteSpace: 'nowrap', fontSize: 12, verticalAlign: 'top', paddingTop: 8 }}>
                        {fmtDate(r.buchungsdatum)}
                      </td>
                      {/* Text (Buchungstext) */}
                      <td style={{ ...td, color: '#1a1a2e', verticalAlign: 'top', paddingTop: 8 }}>
                        {r.buch_text || '—'}
                      </td>
                      {/* Gegenkonto */}
                      <td style={{ ...tdMono, fontWeight: 600, color: '#1a1a2e', verticalAlign: 'top', paddingTop: 8 }}>
                        {r.gegenkonto}
                      </td>
                      {/* Beleg kurz + 📎 Pin wenn Beleg anhängt */}
                      <td style={{ ...tdMono, color: '#4a5a4a', verticalAlign: 'top', paddingTop: 8 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {r.quelle_id && (
                            <button
                              onClick={() => navigate(`../kreditoren/erfassen/${r.quelle_id}`)}
                              title="Beleg öffnen"
                              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '0', lineHeight: 1, color: '#94a394' }}
                            >📎</button>
                          )}
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{bel}</span>
                        </span>
                      </td>
                      {/* Soll */}
                      <td style={{ ...tdR, fontVariantNumeric: 'tabular-nums', verticalAlign: 'top', paddingTop: 8,
                        color: r.soll > 0 ? '#1a1a2e' : '#d1d5db' }}>
                        {r.soll > 0 ? N2(r.soll) : ''}
                      </td>
                      {/* Haben */}
                      <td style={{ ...tdR, fontVariantNumeric: 'tabular-nums', verticalAlign: 'top', paddingTop: 8,
                        color: r.haben > 0 ? '#1a1a2e' : '#d1d5db' }}>
                        {r.haben > 0 ? N2(r.haben) : ''}
                      </td>
                      {/* Saldo */}
                      <td style={{ ...tdR, fontWeight: 600, verticalAlign: 'top', paddingTop: 8,
                        color: r.saldo_lfd < 0 ? '#991b1b' : '#1a1a2e' }}>
                        {N2(r.saldo_lfd)}
                      </td>
                    </tr>

                    {/* ── Zeile 2: MWST-Sub-Zeile ───────────────────── */}
                    {/* Zeigt: 📎 Beleg-Nr | | konto_vorsteuer | | MWST-Betrag | | (Saldo unverändert) */}
                    {hasMwst && (
                      <tr style={{ background: bg2, borderBottom: `1px solid #e8ede8` }}>
                        {/* BelDatum: leer */}
                        <td style={{ ...td2 }} />
                        {/* Text: leer */}
                        <td style={{ ...td2 }} />
                        {/* Gegenkonto: konto_vorsteuer (z.B. "1172") */}
                        <td style={{ ...td2, fontFamily: 'monospace', fontWeight: 600, color: '#4a5a8a' }}>
                          {r.konto_vorsteuer}
                        </td>
                        {/* Beleg: 📎 + Nr – klickbar */}
                        <td style={{ ...td2 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#6b826b', fontFamily: 'monospace', fontSize: 11 }}>
                            📎 {bel}
                          </span>
                        </td>
                        {/* Soll: MWST-Betrag (informativ) */}
                        <td style={{ ...tdR, fontSize: 11.5, color: '#4a5a8a', fontVariantNumeric: 'tabular-nums', paddingTop: 3, paddingBottom: 5 }}>
                          {N2(r.mwst_betrag)}
                        </td>
                        <td style={{ ...td2 }} />
                        {/* Saldo: gleich wie Zeile 1 (informativ) */}
                        <td style={{ ...tdR, fontSize: 11.5, color: '#94a394', fontVariantNumeric: 'tabular-nums', paddingTop: 3, paddingBottom: 5 }}>
                          {N2(r.saldo_lfd)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {/* ── Perioden-Total ── */}
              {rows.length > 0 && (
                <>
                  <tr style={{ background: '#e4ede4', borderTop: '2px solid #c5cfc5' }}>
                    <td colSpan={2} style={{ ...td, fontWeight: 600, fontSize: 12, color: '#3d6641' }}>
                      Saldo {von} – {bis}
                    </td>
                    <td style={td} />
                    <td style={td} />
                    <td style={{ ...tdR, fontWeight: 700 }}>{N2(totalSoll)}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{N2(totalHaben)}</td>
                    <td style={{ ...tdR, fontWeight: 700, color: schluss < 0 ? '#991b1b' : '#1a1a2e' }}>{N2(schluss)}</td>
                  </tr>
                  <tr style={{ background: '#e8f0e8' }}>
                    <td colSpan={6} style={{ ...td, fontStyle: 'italic', color: '#6b826b', fontSize: 12 }}>Saldovortrag</td>
                    <td style={{ ...tdR, fontWeight: 600, color: '#6b826b' }}>{N2(eroeff)}</td>
                  </tr>
                  <tr style={{ background: '#d4e4d4' }}>
                    <td colSpan={6} style={{ ...td, fontWeight: 700, color: '#1a1a2e', fontSize: 12 }}>Saldo Buchungsjahr</td>
                    <td style={{ ...tdR, fontWeight: 800, color: schluss < 0 ? '#991b1b' : '#166534' }}>{N2(schluss)}</td>
                  </tr>
                </>
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
