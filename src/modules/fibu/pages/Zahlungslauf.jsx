import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi, zahlungslaufApi } from '../api';

const CHF = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const toISO = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : d;

function addDays(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function generatePain001(lauf, positionen, mandant) {
  const msgId = `ARTIS-${Date.now()}`;
  const now = new Date().toISOString().replace(/\.\d{3}Z/, '');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">',
    '<CstmrCdtTrfInitn>',
    '<GrpHdr>',
    `  <MsgId>${msgId}</MsgId>`,
    `  <CreDtTm>${now}</CreDtTm>`,
    `  <NbOfTxs>${positionen.length}</NbOfTxs>`,
    `  <CtrlSum>${lauf.total_betrag.toFixed(2)}</CtrlSum>`,
    '  <InitgPty><Nm>Artis Treuhand GmbH</Nm></InitgPty>',
    '</GrpHdr>',
    '<PmtInf>',
    `  <PmtInfId>${msgId}-001</PmtInfId>`,
    '  <PmtMtd>TRF</PmtMtd>',
    `  <NbOfTxs>${positionen.length}</NbOfTxs>`,
    `  <CtrlSum>${lauf.total_betrag.toFixed(2)}</CtrlSum>`,
    '  <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>',
    `  <ReqdExctnDt><Dt>${lauf.valutadatum}</Dt></ReqdExctnDt>`,
    `  <DbtrAcct><Id><IBAN>${lauf.zahlungskonto_iban ?? ''}</IBAN></Id></DbtrAcct>`,
    ...positionen.flatMap(p => [
      '  <CdtTrfTxInf>',
      `    <PmtId><EndToEndId>${p.beleg?.beleg_nr ?? 'NOTPROVIDED'}</EndToEndId></PmtId>`,
      `    <Amt><InstdAmt Ccy="${mandant?.waehrung ?? 'CHF'}">${p.betrag.toFixed(2)}</InstdAmt></Amt>`,
      `    <CdtrAcct><Id><IBAN>${p.iban}</IBAN></Id></CdtrAcct>`,
      `    <Cdtr><Nm>${p.beleg?.lieferant?.name ?? ''}</Nm></Cdtr>`,
      p.zahlungsreferenz ? `    <RmtInf><Strd><CdtrRefInf><Ref>${p.zahlungsreferenz}</Ref></CdtrRefInf></Strd></RmtInf>` : `    <RmtInf><Ustrd>${p.beleg?.beleg_nr ?? ''}</Ustrd></RmtInf>`,
      '  </CdtTrfTxInf>',
    ]),
    '</PmtInf>',
    '</CstmrCdtTrfInitn>',
    '</Document>',
  ];
  return lines.join('\n');
}

const STEP_LABELS = ['1. Auswahl', '2. Prüfung', '3. Export'];

export default function Zahlungslauf() {
  const { mandant, canWrite } = useMandant();
  const [belege, setBelege] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [step, setStep] = useState(0);
  const [fälligBis, setFälligBis] = useState(addDays(7));
  const [valuta, setValuta] = useState(addDays(2));
  const [zahlungsKontoNr, setZahlungsKontoNr] = useState('1020');
  const [zahlungsKontoIban, setZahlungsKontoIban] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mandant) return;
    setLoading(true);
    kreditorenApi.listOffen(mandant.id)
      .then(data => {
        setBelege(data);
        const auto = new Set(data.filter(b => b.faelligkeit <= fälligBis).map(b => b.id));
        setSelected(auto);
      })
      .finally(() => setLoading(false));
  }, [mandant?.id]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectedBelege = belege.filter(b => selected.has(b.id));
  const totalBetrag = selectedBelege.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);

  const handleExport = async () => {
    if (!canWrite || selectedBelege.length === 0) return;
    setSaving(true);
    try {
      const laufNr = `ZL-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
      const positionen = selectedBelege.map(b => ({
        beleg_id: b.id,
        lieferant_id: b.lieferant_id,
        iban: b.lieferant?.iban ?? '',
        betrag: b.betrag_brutto - b.betrag_bezahlt,
        zahlungsreferenz: b.zahlungsreferenz,
        zahlungsmitteilung: b.beleg_nr,
      }));
      const lauf = {
        lauf_nr: laufNr,
        valutadatum: valuta,
        zahlungskonto_nr: zahlungsKontoNr,
        zahlungskonto_iban: zahlungsKontoIban,
        total_betrag: totalBetrag,
        anzahl_zahlungen: selectedBelege.length,
        status: 'exportiert',
        exportiert_am: new Date().toISOString(),
      };
      const xml = generatePain001(lauf, selectedBelege.map((b, i) => ({ ...positionen[i], beleg: b })), mandant);
      lauf.pain001_xml = xml;
      await zahlungslaufApi.create(mandant.id, lauf, positionen);
      // Download XML
      const blob = new Blob([xml], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pain001_${laufNr}_${valuta}.xml`;
      a.click();
      setStep(2);
    } finally {
      setSaving(false);
    }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fff', whiteSpace: 'nowrap' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, outline: 'none', width: '100%' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Stepper */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, background: i < step ? '#7a9b7f' : i === step ? '#fff' : '#e4e9e4', border: i === step ? '2px solid #7a9b7f' : 'none', color: i < step ? '#fff' : i === step ? '#3d6641' : '#94a394' }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: i === step ? '#3d6641' : '#94a394' }}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && <div style={{ flex: 0, width: 50, height: 2, background: i < step ? '#7a9b7f' : '#e4e9e4' }} />}
          </React.Fragment>
        ))}
        <div style={{ flex: 1 }} />
        {step > 0 && <button onClick={() => setStep(s => s - 1)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Zurück</button>}
        {step < 2 && (
          <button
            onClick={step === 1 ? handleExport : () => setStep(1)}
            disabled={selectedBelege.length === 0 || saving}
            style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: selectedBelege.length === 0 ? .5 : 1 }}
          >{step === 1 ? (saving ? 'Exportiert…' : 'pain.001 exportieren') : 'Weiter →'}</button>
        )}
      </div>

      {step === 2 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Zahlungslauf exportiert</div>
          <div style={{ fontSize: 12.5, color: '#6b826b' }}>pain.001 XML wurde heruntergeladen · {selectedBelege.length} Zahlungen · CHF {CHF(totalBetrag)}</div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Invoice list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e4e9e4' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Rechnungen auswählen</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 }}>
                <span style={{ fontSize: 11.5, color: '#6b826b' }}>Fällig bis:</span>
                <input type="date" value={fälligBis} onChange={e => setFälligBis(e.target.value)} style={{ ...inp, width: 140, padding: '4px 8px' }} />
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: '#94a394' }}>{selected.size} von {belege.length} ausgewählt · CHF {CHF(totalBetrag)}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...hdr, width: 36 }}><input type="checkbox" checked={selected.size === belege.length && belege.length > 0} onChange={e => setSelected(e.target.checked ? new Set(belege.map(b => b.id)) : new Set())} /></th>
                    <th style={hdr}>Beleg-Nr.</th><th style={hdr}>Lieferant</th>
                    <th style={hdr}>Fälligkeit</th>
                    <th style={{ ...hdr, textAlign: 'right' }}>Betrag CHF</th>
                    <th style={hdr}>IBAN</th>
                  </tr></thead>
                  <tbody>
                    {belege.map(b => {
                      const isOver = b.faelligkeit < toISO(new Date());
                      return (
                        <tr key={b.id} style={{ background: selected.has(b.id) ? '#f0f7f0' : undefined, cursor: 'pointer' }} onClick={() => toggle(b.id)}>
                          <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} onClick={e => e.stopPropagation()} /></td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                          <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                          <td style={{ ...td, color: isOver ? '#8a2d2d' : undefined, fontWeight: isOver ? 500 : undefined }}>{DATE(b.faelligkeit)}{isOver ? ' ⚠' : ''}</td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: isOver ? '#8a2d2d' : undefined }}>{CHF(b.betrag_brutto - b.betrag_bezahlt)}</td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: '#94a394' }}>{b.lieferant?.iban ?? '—'}</td>
                        </tr>
                      );
                    })}
                    {belege.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine offenen Rechnungen</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right: payment details */}
          <div style={{ flexShrink: 0, width: 280, overflowY: 'auto', background: '#fff', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Zahlungsdetails</div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>Zahlungskonto-Nr.</label>
              <input style={inp} value={zahlungsKontoNr} onChange={e => setZahlungsKontoNr(e.target.value)} placeholder="z.B. 1020" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>IBAN Belastungskonto</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 12 }} value={zahlungsKontoIban} onChange={e => setZahlungsKontoIban(e.target.value)} placeholder="CH00 0000 0000 0000 0000 0" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>Valutadatum</label>
              <input type="date" style={inp} value={valuta} onChange={e => setValuta(e.target.value)} />
            </div>
            <div style={{ height: 1, background: '#e4e9e4' }} />
            <div style={{ background: '#f0f7f0', border: '1px solid #b8d4b8', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#3d6641', marginBottom: 10 }}>Zusammenfassung</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b826b' }}>Zahlungen</span><span style={{ fontWeight: 600 }}>{selected.size}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#6b826b' }}>Valuta</span><span style={{ fontWeight: 600 }}>{DATE(valuta)}</span></div>
                <div style={{ height: 1, background: '#c8d8c8', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 700, fontSize: 13 }}>Total CHF</span><span style={{ fontWeight: 700, fontSize: 13 }}>{CHF(totalBetrag)}</span></div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a394', textAlign: 'center' }}>ISO 20022 pain.001 · Swiss Payment Standard 2.0</div>
          </div>
        </div>
      )}
    </div>
  );
}
