import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi, zahlungslaufApi } from '../api';
import {
  generatePain001, validatePayment, paymentType,
  normIban, isValidIban, isQrIban,
} from '../utils/pain001';

const CHF = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const toISO = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : d;

function addDays(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// IBAN gruppiert anzeigen: CH93 0076 2011 6238 5295 7
const fmtIban = (s) => normIban(s).replace(/(.{4})/g, '$1 ').trim();

const STEP_LABELS = ['1. Auswahl', '2. Prüfung', '3. Export'];

const TYP_BADGE = {
  '1': { bg: '#dbeafe', color: '#1e40af' },
  '3': { bg: '#dcfce7', color: '#166534' },
};

export default function Zahlungslauf() {
  const { mandant, canWrite } = useMandant();
  const [belege, setBelege] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [step, setStep] = useState(0);
  const [fälligBis, setFälligBis] = useState(addDays(7));
  const [valuta, setValuta] = useState(addDays(2));
  const [zahlungsKontoNr, setZahlungsKontoNr] = useState('1020');
  const [zahlungsKontoIban, setZahlungsKontoIban] = useState('');
  const [zahlungsKontoBic, setZahlungsKontoBic] = useState('');
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

  // ── Zahlungspositionen aufbereiten (für pain.001 + Prüfung) ──
  const payments = useMemo(() => selectedBelege.map(b => ({
    beleg:        b,
    endToEndId:   b.beleg_nr,
    amount:       b.betrag_brutto - b.betrag_bezahlt,
    currency:     b.waehrung || mandant?.waehrung || 'CHF',
    creditorName: b.lieferant?.name,
    creditorAddr: {
      street:   b.lieferant?.adresse,
      postCode: b.lieferant?.plz,
      town:     b.lieferant?.ort,
      country:  b.lieferant?.land,
    },
    creditorIban: b.lieferant?.iban,
    reference:    b.zahlungsreferenz,
    message:      b.lieferant_beleg_nr || b.beleg_nr,
  })), [selectedBelege, mandant?.waehrung]);

  // ── Validierung ──
  const validations = useMemo(
    () => payments.map(p => ({ p, errs: validatePayment(p) })),
    [payments],
  );
  const errorCount  = validations.filter(v => v.errs.length > 0).length;
  const debtorIbanOk = isValidIban(zahlungsKontoIban);
  const canExport   = canWrite && payments.length > 0 && errorCount === 0 && debtorIbanOk;

  const handleExport = async () => {
    if (!canExport) return;
    setSaving(true);
    try {
      const laufNr = `ZL-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
      const xml = generatePain001({
        msgId:         `ARTIS-${Date.now()}`,
        debtorName:    mandant.name,
        debtorAddr:    { street: mandant.adresse, postCode: mandant.plz, town: mandant.ort, country: mandant.land },
        debtorIban:    zahlungsKontoIban,
        debtorBic:     zahlungsKontoBic,
        executionDate: valuta,
        currency:      mandant.waehrung || 'CHF',
        payments,
      });

      const positionen = payments.map(p => ({
        beleg_id:           p.beleg.id,
        lieferant_id:       p.beleg.lieferant_id,
        iban:               normIban(p.creditorIban),
        betrag:             p.amount,
        zahlungsreferenz:   p.reference,
        zahlungsmitteilung: p.message,
      }));
      const lauf = {
        lauf_nr:            laufNr,
        valutadatum:        valuta,
        zahlungskonto_nr:   zahlungsKontoNr,
        zahlungskonto_iban: normIban(zahlungsKontoIban),
        total_betrag:       totalBetrag,
        anzahl_zahlungen:   payments.length,
        status:             'exportiert',
        pain001_xml:        xml,
        exportiert_am:      new Date().toISOString(),
      };
      await zahlungslaufApi.create(mandant.id, lauf, positionen);

      // Download XML
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pain001_${laufNr}_${valuta}.xml`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStep(2);
    } finally {
      setSaving(false);
    }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fff', whiteSpace: 'nowrap' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box' };

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
        {step > 0 && step < 2 && <button onClick={() => setStep(s => s - 1)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Zurück</button>}
        {step === 0 && (
          <button
            onClick={() => setStep(1)}
            disabled={payments.length === 0}
            style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: payments.length === 0 ? .5 : 1 }}
          >Weiter →</button>
        )}
        {step === 1 && (
          <button
            onClick={handleExport}
            disabled={!canExport || saving}
            title={!canExport ? 'Bitte zuerst alle Fehler beheben' : ''}
            style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: canExport ? '#7a9b7f' : '#c5b0b0', color: '#fff', fontSize: 12, fontWeight: 500, cursor: canExport ? 'pointer' : 'not-allowed' }}
          >{saving ? 'Exportiert…' : '↓ pain.001 exportieren'}</button>
        )}
      </div>

      {step === 2 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Zahlungslauf exportiert</div>
          <div style={{ fontSize: 12.5, color: '#6b826b' }}>pain.001 XML wurde heruntergeladen · {payments.length} Zahlungen · CHF {CHF(totalBetrag)}</div>
          <div style={{ fontSize: 11.5, color: '#94a394', maxWidth: 420, textAlign: 'center', marginTop: 4 }}>
            Datei jetzt im E-Banking deiner Bank hochladen (Datentransfer / Zahlungen importieren) und dort freigeben.
          </div>
          <button onClick={() => { setStep(0); }} style={{ marginTop: 6, padding: '6px 16px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Neuer Zahlungslauf</button>
        </div>
      ) : step === 1 ? (
        /* ── Schritt 2: Prüfung ── */
        <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
          {/* Belastungskonto-Check */}
          <div style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, background: '#fff', border: `1px solid ${debtorIbanOk ? '#b8d4b8' : '#e0b8b8'}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#6b826b', marginBottom: 8 }}>Belastungskonto</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{mandant?.name}</div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: debtorIbanOk ? '#3d6641' : '#8a2d2d', marginTop: 3 }}>
                  {zahlungsKontoIban ? fmtIban(zahlungsKontoIban) : '— keine IBAN —'} {debtorIbanOk ? '✓' : '⚠'}
                </div>
                {!debtorIbanOk && <div style={{ fontSize: 11, color: '#8a2d2d', marginTop: 4 }}>Gültige IBAN im Schritt 1 erfassen.</div>}
              </div>
              <div style={{ flex: 1, minWidth: 240, background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#6b826b', marginBottom: 8 }}>Zusammenfassung</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}><span style={{ color: '#6b826b' }}>Zahlungen</span><span style={{ fontWeight: 600 }}>{payments.length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}><span style={{ color: '#6b826b' }}>Valuta</span><span style={{ fontWeight: 600 }}>{DATE(valuta)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginTop: 4, paddingTop: 4, borderTop: '1px solid #e4e9e4' }}><span>Total CHF</span><span>{CHF(totalBetrag)}</span></div>
              </div>
            </div>

            {errorCount > 0 && (
              <div style={{ marginTop: 12, background: '#fdf0f0', border: '1px solid #e0b8b8', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#8a2d2d' }}>
                ⚠ {errorCount} {errorCount === 1 ? 'Zahlung hat' : 'Zahlungen haben'} Fehler – Export ist blockiert bis alle Fehler behoben sind.
              </div>
            )}
          </div>

          {/* Positionsliste mit Prüfstatus */}
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Status</th>
              <th style={hdr}>Empfänger</th>
              <th style={hdr}>IBAN</th>
              <th style={hdr}>Zahlungsart</th>
              <th style={hdr}>Referenz</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Betrag</th>
            </tr></thead>
            <tbody>
              {validations.map(({ p, errs }, i) => {
                const pt = paymentType(p.creditorIban, p.reference);
                const badge = TYP_BADGE[pt.code] ?? TYP_BADGE['3'];
                const ok = errs.length === 0;
                return (
                  <tr key={i} style={{ background: ok ? undefined : '#fdf6f6' }}>
                    <td style={{ ...td, width: 60 }}>
                      <span style={{ fontSize: 15 }}>{ok ? '✅' : '⚠️'}</span>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 500 }}>{p.creditorName || <span style={{ color: '#8a2d2d' }}>— Name fehlt —</span>}</div>
                      <div style={{ fontSize: 11, color: '#94a394' }}>{p.beleg.beleg_nr}</div>
                      {!ok && (
                        <div style={{ fontSize: 11, color: '#8a2d2d', marginTop: 2 }}>
                          {errs.map((e, j) => <div key={j}>• {e}</div>)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>
                      {p.creditorIban ? fmtIban(p.creditorIban) : <span style={{ color: '#8a2d2d' }}>—</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, ...badge }}>
                        Typ {pt.code} · {pt.label}
                      </span>
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: '#6b826b' }}>{p.reference || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{CHF(p.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '10px 20px', fontSize: 11, color: '#94a394' }}>
            ISO 20022 pain.001.001.09 · Swiss Payment Standards · Typ 1 = QR-IBAN/QR-Referenz, Typ 3 = IBAN
          </div>
        </div>
      ) : (
        /* ── Schritt 1: Auswahl ── */
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
                      const hasIban = !!b.lieferant?.iban;
                      return (
                        <tr key={b.id} style={{ background: selected.has(b.id) ? '#f0f7f0' : undefined, cursor: 'pointer' }} onClick={() => toggle(b.id)}>
                          <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} onClick={e => e.stopPropagation()} /></td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                          <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                          <td style={{ ...td, color: isOver ? '#8a2d2d' : undefined, fontWeight: isOver ? 500 : undefined }}>{DATE(b.faelligkeit)}{isOver ? ' ⚠' : ''}</td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: isOver ? '#8a2d2d' : undefined }}>{CHF(b.betrag_brutto - b.betrag_bezahlt)}</td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: hasIban ? '#94a394' : '#c08a8a' }}>
                            {hasIban ? fmtIban(b.lieferant.iban) : '⚠ keine IBAN'}
                          </td>
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
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>Zahlungskonto-Nr. (Fibu)</label>
              <input style={inp} value={zahlungsKontoNr} onChange={e => setZahlungsKontoNr(e.target.value)} placeholder="z.B. 1020" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>IBAN Belastungskonto</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 12, borderColor: zahlungsKontoIban && !debtorIbanOk ? '#e0b8b8' : '#d4dcd4' }} value={zahlungsKontoIban} onChange={e => setZahlungsKontoIban(e.target.value)} placeholder="CH00 0000 0000 0000 0000 0" />
              {zahlungsKontoIban && !debtorIbanOk && <div style={{ fontSize: 10.5, color: '#8a2d2d', marginTop: 3 }}>IBAN ungültig (Prüfziffer)</div>}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>BIC Belastungsbank <span style={{ color: '#94a394', fontWeight: 400 }}>(optional)</span></label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 12 }} value={zahlungsKontoBic} onChange={e => setZahlungsKontoBic(e.target.value)} placeholder="z.B. POFICHBEXXX" />
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
            <div style={{ fontSize: 11, color: '#94a394', textAlign: 'center' }}>ISO 20022 pain.001.001.09 · Swiss Payment Standards 2026</div>
          </div>
        </div>
      )}
    </div>
  );
}
