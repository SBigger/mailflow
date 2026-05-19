import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi, zahlungslaufApi, zahlstellenApi } from '../api';
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

const STATUS_BADGE = {
  entwurf:     { label: 'Entwurf',     bg: '#e4e9e4', color: '#6b826b' },
  freigegeben: { label: 'Freigegeben', bg: '#dbeafe', color: '#1e40af' },
  exportiert:  { label: 'Exportiert',  bg: '#fef3c7', color: '#92400e' },
  verbucht:    { label: 'Verbucht',    bg: '#dcfce7', color: '#166534' },
};

const DATETIME = (s) => s ? new Date(s).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function Zahlungslauf() {
  const { mandant, canWrite } = useMandant();
  const navigate = useNavigate();
  const [belege, setBelege] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [amounts, setAmounts] = useState({});   // belegId → erfasster Zahlbetrag (Teilzahlung)
  const [skonti, setSkonti] = useState(new Set());   // belegIds mit Skonto-Abzug
  const [step, setStep] = useState(0);
  const [valuta, setValuta] = useState(addDays(2));
  const [zahlungsKontoNr, setZahlungsKontoNr] = useState('1020');
  const [zahlungsKontoIban, setZahlungsKontoIban] = useState('');
  const [zahlungsKontoBic, setZahlungsKontoBic] = useState('');
  const [zahlstellen, setZahlstellen] = useState([]);
  const [zahlstelleId, setZahlstelleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('wizard');        // 'wizard' | 'historie'
  const [historie, setHistorie] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [zusatz, setZusatz] = useState(new Set());   // manuell hinzugefügte nicht-fällige Belege
  const [showHinzufügen, setShowHinzufügen] = useState(false);

  const loadHistorie = async () => {
    if (!mandant) return;
    setHistLoading(true);
    try {
      setHistorie(await zahlungslaufApi.historie(mandant.id));
    } finally { setHistLoading(false); }
  };

  const downloadXml = async (laufId) => {
    const row = await zahlungslaufApi.getXml(laufId);
    if (!row?.pain001_xml) return;
    const blob = new Blob([row.pain001_xml], { type: 'application/xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pain001_${row.lauf_nr}_${row.valutadatum}.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const today = toISO(new Date());

  useEffect(() => {
    if (!mandant) return;
    setLoading(true);
    kreditorenApi.listOffen(mandant.id)
      .then(data => {
        setBelege(data);
        // Nur fällige (faelligkeit <= heute) automatisch auswählen
        const auto = new Set(data.filter(b => b.faelligkeit <= today).map(b => b.id));
        setSelected(auto);
      })
      .finally(() => setLoading(false));
  }, [mandant?.id]);

  // Firmenzahlstellen laden + Standard vorauswählen
  useEffect(() => {
    if (!mandant) return;
    zahlstellenApi.listAktiv(mandant.id).then(zs => {
      setZahlstellen(zs);
      const std = zs.find(z => z.ist_standard) ?? zs[0];
      if (std) {
        setZahlstelleId(std.id);
        setZahlungsKontoNr(std.konto_nr ?? '');
        setZahlungsKontoIban(std.iban ?? '');
        setZahlungsKontoBic(std.bic ?? '');
      }
    });
  }, [mandant?.id]);

  const selectZahlstelle = (id) => {
    setZahlstelleId(id);
    const z = zahlstellen.find(x => x.id === id);
    if (z) {
      setZahlungsKontoNr(z.konto_nr ?? '');
      setZahlungsKontoIban(z.iban ?? '');
      setZahlungsKontoBic(z.bic ?? '');
    }
  };

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSkonto = (id) => setSkonti(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Restbetrag der Rechnung bzw. erfasster (Teil-)Zahlbetrag
  const restBetrag = (b) => (b.betrag_brutto ?? 0) - (b.betrag_bezahlt ?? 0);
  const zahlbetrag = (b) => {
    const v = amounts[b.id];
    return (v != null && v !== '') ? (parseFloat(v) || 0) : restBetrag(b);
  };

  // ── Skonto ──────────────────────────────────────────────────────
  const skontoFrist = (b) => {
    const tage = b.lieferant?.skonto_tage;
    if (tage == null || !b.belegdatum) return null;
    const d = new Date(b.belegdatum + 'T00:00:00');
    d.setDate(d.getDate() + tage);
    return d.toISOString().slice(0, 10);
  };
  const skontoFaehig = (b) => {
    const p = b.lieferant?.skonto_prozent;
    const frist = skontoFrist(b);
    return !!p && p > 0 && frist != null && valuta <= frist;
  };
  const skontoBetrag = (b) =>
    skontoFaehig(b) ? Math.round(restBetrag(b) * b.lieferant.skonto_prozent) / 100 : 0;
  // tatsächlich zu zahlender Betrag (Skonto schlägt Teilzahlung)
  const effektiverBetrag = (b) =>
    skonti.has(b.id) ? restBetrag(b) - skontoBetrag(b) : zahlbetrag(b);

  // Belege die standardmässig angezeigt werden (fällig) + manuell hinzugefügte
  const nichtFällige   = belege.filter(b => b.faelligkeit > today);
  const anzeigeBelege  = belege.filter(b => b.faelligkeit <= today || zusatz.has(b.id));

  const toggleZusatz = (id) => {
    setZusatz(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedBelege = belege.filter(b => selected.has(b.id));
  const totalBetrag = selectedBelege.reduce((s, b) => s + effektiverBetrag(b), 0);

  // ── Zahlungspositionen aufbereiten (für pain.001 + Prüfung) ──
  const payments = useMemo(() => selectedBelege.map(b => ({
    beleg:        b,
    endToEndId:   b.beleg_nr,
    amount:       effektiverBetrag(b),
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
  })), [selectedBelege, amounts, skonti, valuta, mandant?.waehrung]);

  // ── Validierung ──
  const validations = useMemo(
    () => payments.map(p => {
      const errs = validatePayment(p);
      const rest = (p.beleg.betrag_brutto ?? 0) - (p.beleg.betrag_bezahlt ?? 0);
      if (p.amount > rest + 0.005) errs.push('Betrag übersteigt den Restbetrag');
      return { p, errs };
    }),
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

      // Belege auf "ebanking" setzen – warten auf CAMT-Bestätigung
      for (const b of selectedBelege) {
        try {
          await kreditorenApi.update(b.id, { status: 'ebanking' });
        } catch (e) {
          console.error('Status-Update ebanking fehlgeschlagen für', b.beleg_nr, e);
        }
      }

      // Skonto-Abzüge verbuchen
      for (const b of selectedBelege) {
        if (skonti.has(b.id) && skontoBetrag(b) > 0) {
          try {
            await kreditorenApi.skontoBuchen(b.id, skontoBetrag(b), valuta);
          } catch (e) {
            console.error('Skonto-Buchung fehlgeschlagen für', b.beleg_nr, e);
          }
        }
      }

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

  const tabStyle = (active) => ({
    padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', background: active ? '#fff' : 'transparent',
    color: active ? '#3d6641' : '#6b826b',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Stepper / Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        {/* View-Umschalter */}
        <div style={{ display: 'flex', gap: 3, background: '#f0f3f0', borderRadius: 8, padding: 3 }}>
          <button onClick={() => setView('wizard')} style={tabStyle(view === 'wizard')}>＋ Neuer Lauf</button>
          <button onClick={() => { setView('historie'); loadHistorie(); }} style={tabStyle(view === 'historie')}>📋 Historie</button>
        </div>
        <div style={{ width: 1, height: 18, background: '#d4dcd4' }} />

        {view === 'wizard' ? (
          <>
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
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Zahlungslauf-Historie</span>
            <div style={{ flex: 1 }} />
            <button onClick={loadHistorie} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer' }}>{histLoading ? '⏳' : '↻'} Aktualisieren</button>
          </>
        )}
      </div>

      {view === 'historie' ? (
        /* ── Historie-Ansicht ── */
        <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
          {histLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
          ) : historie.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Noch keine Zahlungsläufe vorhanden</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
              <thead><tr>
                <th style={hdr}>Lauf-Nr.</th>
                <th style={hdr}>Erstellt</th>
                <th style={hdr}>Valuta</th>
                <th style={hdr}>Konto</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Zahlungen</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Total CHF</th>
                <th style={hdr}>Rückmeldung</th>
                <th style={hdr}>Status</th>
                <th style={{ ...hdr, textAlign: 'right' }}>pain.001</th>
              </tr></thead>
              <tbody>
                {historie.map(z => {
                  const sb = STATUS_BADGE[z.status] ?? STATUS_BADGE.entwurf;
                  const bezahlt = Number(z.anzahl_bezahlt ?? 0);
                  const total = Number(z.anzahl_zahlungen ?? 0);
                  const vollstaendig = total > 0 && bezahlt >= total;
                  return (
                    <tr key={z.id}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{z.lauf_nr}</td>
                      <td style={{ ...td, color: '#6b826b' }}>{DATETIME(z.created_at)}</td>
                      <td style={td}>{DATE(z.valutadatum)}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{z.zahlungskonto_nr}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{CHF(z.total_betrag)}</td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: vollstaendig ? '#166534' : '#92400e' }}>
                            {bezahlt}/{total}
                          </span>
                          <span style={{ width: 56, height: 6, borderRadius: 3, background: '#eef2ee', overflow: 'hidden', display: 'inline-block' }}>
                            <span style={{ display: 'block', height: '100%', width: `${total > 0 ? (bezahlt / total) * 100 : 0}%`, background: vollstaendig ? '#7a9b7f' : '#d9b061' }} />
                          </span>
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: sb.bg, color: sb.color }}>{sb.label}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {z.hat_xml ? (
                          <button onClick={() => downloadXml(z.id)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d4dcd4', background: '#fff', fontSize: 11.5, cursor: 'pointer', color: '#3d6641' }}>↓ XML</button>
                        ) : <span style={{ color: '#c5cdc5', fontSize: 11.5 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ padding: '10px 20px', fontSize: 11, color: '#94a394' }}>
            Rückmeldung = Anzahl Zahlungen, die per Bankabstimmung (camt.053) zurückgemeldet wurden. Status „Verbucht" sobald alle Zahlungen des Laufs abgeglichen sind.
          </div>
        </div>
      ) : step === 2 ? (
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
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {CHF(p.amount)}
                      {(() => {
                        const rest = (p.beleg.betrag_brutto ?? 0) - (p.beleg.betrag_bezahlt ?? 0);
                        if (skonti.has(p.beleg.id)) {
                          return <div style={{ fontSize: 9.5, fontWeight: 600, color: '#166534' }}>
                            inkl. {CHF(skontoBetrag(p.beleg))} Skonto
                          </div>;
                        }
                        if (p.amount < rest - 0.005) {
                          return <div style={{ fontSize: 9.5, fontWeight: 600, color: '#b9802e' }}>
                            Teilzahlung · Rest {CHF(rest - p.amount)}
                          </div>;
                        }
                        return null;
                      })()}
                    </td>
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
              <span style={{ fontWeight: 600, fontSize: 13 }}>Fällige Rechnungen</span>
              {nichtFällige.length > 0 && (
                <button
                  onClick={() => setShowHinzufügen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 7, border: '1px solid #b8d4b8', background: '#f0f7f0', fontSize: 12, fontWeight: 600, color: '#3d6641', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Hinzufügen
                  <span style={{ fontSize: 10.5, fontWeight: 400, color: '#7a9b7f' }}>({nichtFällige.length})</span>
                </button>
              )}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: '#94a394' }}>{selected.size} von {anzeigeBelege.length} ausgewählt · CHF {CHF(totalBetrag)}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...hdr, width: 36 }}><input type="checkbox" checked={anzeigeBelege.length > 0 && anzeigeBelege.every(b => selected.has(b.id))} onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) anzeigeBelege.forEach(b => next.add(b.id)); else anzeigeBelege.forEach(b => next.delete(b.id)); return next; })} /></th>
                    <th style={hdr}>Beleg-Nr.</th><th style={hdr}>Lieferant</th>
                    <th style={hdr}>Fälligkeit</th>
                    <th style={{ ...hdr, textAlign: 'right' }}>Betrag CHF</th>
                    <th style={hdr}>IBAN</th>
                  </tr></thead>
                  <tbody>
                    {anzeigeBelege.map(b => {
                      const isOver = b.faelligkeit < toISO(new Date());
                      const hasIban = !!b.lieferant?.iban;
                      const sel  = selected.has(b.id);
                      const rest = restBetrag(b);
                      const amt  = zahlbetrag(b);
                      const teil = sel && amt < rest - 0.005;
                      const skoElig = skontoFaehig(b);
                      const skoOn   = skonti.has(b.id);
                      const skoBtr  = skontoBetrag(b);
                      return (
                        <tr key={b.id} style={{ background: sel ? '#f0f7f0' : undefined, cursor: 'pointer' }} onClick={() => toggle(b.id)}>
                          <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={sel} onChange={() => toggle(b.id)} onClick={e => e.stopPropagation()} /></td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                          <td style={{ ...td, fontWeight: 500 }}>
                            {b.lieferant?.name}
                            {zusatz.has(b.id) && (
                              <span
                                title="Manuell hinzugefügt – klicken zum Entfernen"
                                onClick={e => { e.stopPropagation(); toggleZusatz(b.id); setSelected(prev => { const next = new Set(prev); next.delete(b.id); return next; }); }}
                                style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#dbeafe', color: '#1e40af', cursor: 'pointer' }}
                              >+hinzugefügt ✕</span>
                            )}
                          </td>
                          <td style={{ ...td, color: isOver ? '#8a2d2d' : undefined, fontWeight: isOver ? 500 : undefined }}>{DATE(b.faelligkeit)}{isOver ? ' ⚠' : ''}</td>
                          <td style={{ ...td, textAlign: 'right' }} onClick={e => sel && e.stopPropagation()}>
                            {sel ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                                {skoOn ? (
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{CHF(rest - skoBtr)}</div>
                                    <div style={{ fontSize: 9.5, color: '#166534' }}>{rest > 0 ? CHF(rest) : '0'} − {CHF(skoBtr)} Skonto</div>
                                  </div>
                                ) : (
                                  <>
                                    <input
                                      type="number" step="0.05" min="0"
                                      value={amounts[b.id] ?? String(rest)}
                                      onChange={e => setAmounts(a => ({ ...a, [b.id]: e.target.value }))}
                                      style={{ width: 100, textAlign: 'right', padding: '3px 6px', borderRadius: 6,
                                        border: `1px solid ${teil ? '#d9b061' : (amt > rest + 0.005 ? '#e0b8b8' : '#d4dcd4')}`,
                                        fontSize: 12, fontVariantNumeric: 'tabular-nums',
                                        background: teil ? '#fdf6ec' : '#fff' }}
                                    />
                                    {teil
                                      ? <span style={{ fontSize: 9.5, color: '#b9802e' }}>Teilzahlung · Rest {CHF(rest - amt)}</span>
                                      : <span style={{ fontSize: 9.5, color: '#c5cdc5' }}>von {CHF(rest)}</span>}
                                  </>
                                )}
                                {skoElig && (
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: '#166534', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={skoOn} onChange={() => toggleSkonto(b.id)} style={{ margin: 0 }} />
                                    {b.lieferant.skonto_prozent}% Skonto − {CHF(skoBtr)}
                                  </label>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: isOver ? '#8a2d2d' : undefined }}>{CHF(rest)}</span>
                            )}
                          </td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: hasIban ? '#94a394' : '#c08a8a' }}>
                            {hasIban ? fmtIban(b.lieferant.iban) : '⚠ keine IBAN'}
                          </td>
                        </tr>
                      );
                    })}
                    {anzeigeBelege.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>
                        {belege.length === 0 ? 'Keine offenen Rechnungen' : 'Keine fälligen Rechnungen – klick auf «+ Hinzufügen» um weitere einzuschliessen'}
                      </td></tr>
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
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' }}>Belastungskonto</label>
              {zahlstellen.length === 0 ? (
                <div style={{ background: '#fdf6ec', border: '1px solid #e8d4a8', borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: '#8a6d2d' }}>
                  Keine Firmenzahlstelle erfasst.
                  <button
                    onClick={() => navigate('../zahlstellen')}
                    style={{ display: 'block', marginTop: 6, padding: '4px 10px', borderRadius: 6, border: '1px solid #d9b061', background: '#fff', fontSize: 11.5, cursor: 'pointer', color: '#8a6d2d', fontWeight: 600 }}
                  >→ In Stammdaten anlegen</button>
                </div>
              ) : (
                <select style={inp} value={zahlstelleId} onChange={e => selectZahlstelle(e.target.value)}>
                  {zahlstellen.map(z => (
                    <option key={z.id} value={z.id}>
                      {z.bezeichnung}{z.ist_standard ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {zahlstelleId && (
              <div style={{ background: debtorIbanOk ? '#f0f7f0' : '#fdf0f0', border: `1px solid ${debtorIbanOk ? '#b8d4b8' : '#e0b8b8'}`, borderRadius: 8, padding: '8px 11px', fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontFamily: 'monospace', color: debtorIbanOk ? '#3d6641' : '#8a2d2d', fontSize: 11.5 }}>
                  {fmtIban(zahlungsKontoIban)} {debtorIbanOk ? '✓' : '⚠'}
                </div>
                <div style={{ color: '#6b826b', display: 'flex', gap: 10 }}>
                  <span>Fibu-Konto: <strong>{zahlungsKontoNr || '—'}</strong></span>
                  {zahlungsKontoBic && <span>BIC: <strong>{zahlungsKontoBic}</strong></span>}
                </div>
                {!debtorIbanOk && <div style={{ color: '#8a2d2d' }}>IBAN dieser Zahlstelle ist ungültig.</div>}
              </div>
            )}
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
      {/* ── Modal: nicht-fällige Rechnungen hinzufügen ── */}
      {showHinzufügen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowHinzufügen(false)}>
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.18)', width: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e4e9e4', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>Weitere Rechnungen hinzufügen</div>
                <div style={{ fontSize: 11.5, color: '#94a394', marginTop: 2 }}>Noch nicht fällige offene Rechnungen</div>
              </div>
              <button onClick={() => setShowHinzufügen(false)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #e4e9e4', background: '#f7faf7', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b826b' }}>✕</button>
            </div>
            {/* Tabelle */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {nichtFällige.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Alle Rechnungen sind bereits angezeigt</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...hdr, width: 36 }}></th>
                    <th style={hdr}>Beleg-Nr.</th>
                    <th style={hdr}>Lieferant</th>
                    <th style={hdr}>Fälligkeit</th>
                    <th style={{ ...hdr, textAlign: 'right' }}>Betrag CHF</th>
                  </tr></thead>
                  <tbody>
                    {nichtFällige.map(b => {
                      const inZusatz = zusatz.has(b.id);
                      const rest = restBetrag(b);
                      const daysUntil = Math.round((new Date(b.faelligkeit + 'T00:00:00') - new Date()) / 86400000);
                      return (
                        <tr key={b.id} style={{ background: inZusatz ? '#f0f7f0' : undefined, cursor: 'pointer' }}
                          onClick={() => {
                            toggleZusatz(b.id);
                            if (!inZusatz) setSelected(prev => { const next = new Set(prev); next.add(b.id); return next; });
                            else setSelected(prev => { const next = new Set(prev); next.delete(b.id); return next; });
                          }}>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <input type="checkbox" checked={inZusatz} readOnly />
                          </td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                          <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                          <td style={td}>
                            <span style={{ fontSize: 12 }}>{DATE(b.faelligkeit)}</span>
                            {daysUntil >= 0 && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#7a9b7f' }}>in {daysUntil}d</span>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{CHF(rest)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowHinzufügen(false)} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                {zusatz.size > 0 ? `${zusatz.size} hinzugefügt ✓` : 'Schliessen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
