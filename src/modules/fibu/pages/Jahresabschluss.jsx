/**
 * Jahresabschluss — Schweizer KMU Jahreswechsel
 * Route: /fibu/:mandantId/jahresabschluss
 *
 * Schritt 1: Prüfung — Kontosalden, Warnungen, Abschluss-Konten konfigurieren
 * Schritt 2: Abschluss durchführen — Preview + Bestätigung
 * Schritt 3: Ergebnis — Zusammenfassung, neues Geschäftsjahr aktiv
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

// ── Helpers ──────────────────────────────────────────────────────────
const N2  = (n) => (n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const abs = Math.abs;

// ── Farben ────────────────────────────────────────────────────────────
const C = {
  green:  '#3d6641',
  greenL: '#e8f0e8',
  greenM: '#7a9b7f',
  red:    '#991b1b',
  redL:   '#fee2e2',
  blue:   '#1e40af',
  blueL:  '#dbeafe',
  yellow: '#92400e',
  yellowL:'#fef3c7',
  border: '#d4dcd4',
  bg:     '#f2f5f2',
  panel:  '#ffffff',
  text:   '#1a1a2e',
  muted:  '#6b826b',
};

const inp = {
  background: '#f7faf7', border: `1px solid ${C.border}`, borderRadius: 7,
  padding: '5px 9px', fontSize: 12.5, color: C.text, outline: 'none', width: '100%',
};
const lbl = { fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 3, display: 'block' };

// ── Konto-Typ Metadaten ───────────────────────────────────────────────
const TYPEN = {
  aktiv:    { label: 'Aktiven',       color: '#1e40af', bg: '#dbeafe' },
  passiv:   { label: 'Passiven',      color: '#6b21a8', bg: '#f3e8ff' },
  ertrag:   { label: 'Ertrag',        color: '#166534', bg: '#dcfce7' },
  aufwand:  { label: 'Aufwand',       color: '#991b1b', bg: '#fee2e2' },
  abschluss:{ label: 'Abschlusskonten', color: '#374151', bg: '#f3f4f6' },
};

function TypBadge({ typ }) {
  const t = TYPEN[typ] ?? TYPEN.abschluss;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
      color: t.color, background: t.bg, border: `1px solid ${t.color}30` }}>
      {t.label}
    </span>
  );
}

// ── Schritt-Indikator ────────────────────────────────────────────────
function StepBar({ step }) {
  const steps = ['Prüfung', 'Abschluss', 'Ergebnis'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 24px' }}>
      {steps.map((s, i) => {
        const done    = i < step;
        const active  = i === step;
        return (
          <React.Fragment key={s}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 12,
                background: done ? C.green : active ? C.greenM : '#e4e9e4',
                color: (done || active) ? '#fff' : C.muted,
                border: active ? `2px solid ${C.green}` : '2px solid transparent',
                transition: 'all .2s',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 400,
                color: active ? C.green : done ? C.greenM : C.muted }}>
                {s}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? C.green : '#e4e9e4',
                margin: '0 12px', transition: 'background .3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Salden-Tabelle ────────────────────────────────────────────────────
function SaldenTabelle({ salden, typ }) {
  const rows = salden.filter(s => s.konto_typ === typ);
  if (rows.length === 0) return null;
  const meta = TYPEN[typ];
  const total = rows.reduce((s, r) => s + (r.saldo ?? 0), 0);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: meta.bg, borderRadius: '8px 8px 0 0', borderBottom: `2px solid ${meta.color}30` }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '.08em', color: meta.color }}>{meta.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: meta.color }}>
          Total: CHF {N2(total)}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff',
        border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
        <thead>
          <tr style={{ background: '#fafcfa' }}>
            <th style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
              color: C.muted, textAlign: 'left', letterSpacing: '.06em' }}>Konto</th>
            <th style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
              color: C.muted, textAlign: 'left', letterSpacing: '.06em' }}>Bezeichnung</th>
            <th style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
              color: C.muted, textAlign: 'right', letterSpacing: '.06em' }}>Soll</th>
            <th style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
              color: C.muted, textAlign: 'right', letterSpacing: '.06em' }}>Haben</th>
            <th style={{ padding: '6px 12px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
              color: meta.color, textAlign: 'right', letterSpacing: '.06em' }}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.konto_nr} style={{ borderTop: `1px solid #f0f3f0` }}>
              <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12, color: C.muted }}>{r.konto_nr}</td>
              <td style={{ padding: '6px 12px', fontSize: 12.5, color: C.text }}>{r.bezeichnung}</td>
              <td style={{ padding: '6px 12px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}>{N2(r.saldo_soll)}</td>
              <td style={{ padding: '6px 12px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}>{N2(r.saldo_haben)}</td>
              <td style={{ padding: '6px 12px', fontSize: 12.5, textAlign: 'right', fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: (r.saldo ?? 0) < 0 ? C.red : meta.color }}>
                {N2(r.saldo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Ergebnis-Karte ────────────────────────────────────────────────────
function ErgebnisKarte({ label, value, isGewinn }) {
  return (
    <div style={{ flex: 1, padding: '20px 24px', borderRadius: 12,
      background: isGewinn ? '#dcfce7' : value < 0 ? '#fee2e2' : '#f0f7ff',
      border: `2px solid ${isGewinn ? '#86efac' : value < 0 ? '#fca5a5' : '#93c5fd'}`,
      textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.1em', color: isGewinn ? '#166534' : value < 0 ? C.red : C.blue, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800,
        color: isGewinn ? '#166534' : value < 0 ? C.red : C.blue }}>
        CHF {N2(abs(value ?? 0))}
      </div>
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────
export default function Jahresabschluss() {
  const { mandant, canWrite } = useMandant();

  const [step,        setStep]        = useState(0);   // 0=Prüfung, 1=Abschluss, 2=Ergebnis
  const [salden,      setSalden]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [executing,   setExecuting]   = useState(false);
  const [ergebnis,    setErgebnis]    = useState(null); // JSONB aus RPC
  const [error,       setError]       = useState(null);

  // Konfigurierbare Abschluss-Konten (Defaults CH-KMU)
  const [konten, setKonten] = useState({
    jahresergebnis:  '9999',
    gewinnvortrag:   '2970',
    verlustvortrag:  '2979',
    eroeffnung:      '9900',
  });

  const jahr = useMemo(() => {
    // Aktuelles GJ aus Mandant, oder Vorjahr als Default
    return mandant?.geschaeftsjahr ?? (new Date().getFullYear() - 1);
  }, [mandant]);

  // ── Salden laden ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mandant?.id || step !== 0) return;
    loadSalden();
  }, [mandant?.id, step]);

  async function loadSalden() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('fibu_jahresabschluss_salden', {
        p_mandant_id: mandant.id,
        p_jahr:       jahr,
      });
      if (err) throw err;
      setSalden(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Abschluss durchführen ─────────────────────────────────────────
  async function handleAbschluss() {
    if (!canWrite) return;
    setExecuting(true);
    setError(null);
    try {
      // Abschluss-Konten zuerst auf den Record schreiben (upsert)
      await supabase.from('fibu_jahresabschluss').upsert({
        mandant_id:           mandant.id,
        jahr,
        konto_jahresergebnis: konten.jahresergebnis,
        konto_gewinnvortrag:  konten.gewinnvortrag,
        konto_verlustvortrag: konten.verlustvortrag,
        konto_eroeffnung:     konten.eroeffnung,
      }, { onConflict: 'mandant_id,jahr' });

      // RPC ausführen
      const { data, error: err } = await supabase.rpc('fibu_jahresabschluss_durchfuehren', {
        p_mandant_id: mandant.id,
        p_jahr:       jahr,
      });
      if (err) throw err;
      setErgebnis(data);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setExecuting(false);
    }
  }

  // ── Aggregierte Werte ─────────────────────────────────────────────
  const totalErtrag  = salden.filter(s => s.konto_typ === 'ertrag').reduce((s, r) => s + (r.saldo ?? 0), 0);
  const totalAufwand = salden.filter(s => s.konto_typ === 'aufwand').reduce((s, r) => s + (r.saldo ?? 0), 0);
  const totalAktiv   = salden.filter(s => s.konto_typ === 'aktiv').reduce((s, r) => s + (r.saldo ?? 0), 0);
  const totalPassiv  = salden.filter(s => s.konto_typ === 'passiv').reduce((s, r) => s + (r.saldo ?? 0), 0);
  const jahresergebnis = totalErtrag - totalAufwand;
  const isGewinn = jahresergebnis >= 0;
  const keineumsatz = totalErtrag === 0 && totalAufwand === 0;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${C.border}`,
        padding: '16px 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
              Jahresabschluss
            </h1>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Geschäftsjahr <strong>{jahr}</strong> — {mandant?.name}
            </div>
          </div>
          {step === 0 && (
            <button onClick={loadSalden} disabled={loading}
              style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: '#fff', fontSize: 12.5, cursor: 'pointer', color: C.muted }}>
              {loading ? '⏳ Lädt…' : '↻ Aktualisieren'}
            </button>
          )}
        </div>
        <StepBar step={step} />
      </div>

      {/* Inhalt */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

        {/* Fehler */}
        {error && (
          <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10,
            background: C.redL, border: `1px solid #fca5a5`, color: C.red, fontSize: 12.5 }}>
            ❌ {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 12, border: 'none',
              background: 'none', cursor: 'pointer', color: C.red, fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* ── SCHRITT 0: Prüfung ─────────────────────────────────── */}
        {step === 0 && (
          <>
            {/* Jahresergebnis-Banner */}
            {!loading && salden.length > 0 && (
              <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                <ErgebnisKarte label={`Ertrag ${jahr}`} value={totalErtrag} isGewinn={false} />
                <ErgebnisKarte label={`Aufwand ${jahr}`} value={totalAufwand} isGewinn={false} />
                <ErgebnisKarte
                  label={isGewinn ? `Jahresgewinn ${jahr}` : `Jahresverlust ${jahr}`}
                  value={jahresergebnis}
                  isGewinn={isGewinn && !keineumsatz}
                />
              </div>
            )}

            {/* Warnungen */}
            {keineumsatz && !loading && (
              <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10,
                background: C.yellowL, border: '1px solid #fde68a', color: C.yellow, fontSize: 12 }}>
                ⚠️ Keine Buchungen im Geschäftsjahr {jahr} gefunden. Bitte prüfen Sie ob das korrekte Jahr ausgewählt ist.
              </div>
            )}

            {/* Abschluss-Konten konfigurieren */}
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
              padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.1em', color: C.muted, marginBottom: 12 }}>
                Abschluss-Konten (CH-KMU Standard)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['jahresergebnis', 'Jahresergebnis-Konto (Schlussbilanzkonto)', '9999'],
                  ['gewinnvortrag',  'Gewinnvortrag-Konto', '2970'],
                  ['verlustvortrag', 'Verlustvortrag-Konto', '2979'],
                  ['eroeffnung',     'Eröffnungsbilanzkonto', '9900'],
                ].map(([key, label, placeholder]) => (
                  <div key={key}>
                    <label style={lbl}>{label}</label>
                    <input style={inp} value={konten[key]}
                      onChange={e => setKonten(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder} />
                  </div>
                ))}
              </div>
            </div>

            {/* Kontosalden */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>⏳ Salden werden berechnet…</div>
            ) : (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.1em', color: C.muted, marginBottom: 12 }}>
                  Kontosalden Geschäftsjahr {jahr}
                </div>
                {['aktiv', 'passiv', 'ertrag', 'aufwand', 'abschluss'].map(typ => (
                  <SaldenTabelle key={typ} salden={salden} typ={typ} />
                ))}
                {salden.length === 0 && (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                    Keine Konten gefunden.
                  </div>
                )}
              </>
            )}

            {/* Weiter-Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setStep(1)}
                disabled={loading || salden.length === 0}
                style={{ padding: '10px 24px', borderRadius: 9, border: 'none',
                  background: (loading || salden.length === 0) ? '#e4e9e4' : C.greenM,
                  color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                  opacity: (loading || salden.length === 0) ? .6 : 1 }}>
                Weiter zur Abschluss-Vorschau →
              </button>
            </div>
          </>
        )}

        {/* ── SCHRITT 1: Abschluss-Vorschau ──────────────────────── */}
        {step === 1 && (
          <div style={{ maxWidth: 700 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12,
              overflow: 'hidden', marginBottom: 20 }}>

              {/* Was wird gemacht */}
              <div style={{ padding: '14px 20px', background: C.greenL, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
                  Jahresabschluss {jahr} — Vorschau
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                  Diese Buchungen werden erstellt (vollständig rückführbar via Storno bis Abschluss gesperrt):
                </div>
              </div>

              {/* Schritt A */}
              <div style={{ padding: '14px 20px', borderBottom: `1px solid #f0f3f0` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                  Schritt A — Erfolgskonten schliessen (31.12.{jahr})
                </div>
                {[
                  { typ: 'ertrag',  label: `${salden.filter(s => s.konto_typ === 'ertrag'  && (s.saldo ?? 0) > 0).length} Ertragskonten`, konto: konten.jahresergebnis, seite: 'Soll → Haben Kto. ' + konten.jahresergebnis },
                  { typ: 'aufwand', label: `${salden.filter(s => s.konto_typ === 'aufwand' && (s.saldo ?? 0) > 0).length} Aufwandkonten`,  konto: konten.jahresergebnis, seite: 'Soll Kto. ' + konten.jahresergebnis + ' → Haben' },
                ].map(x => (
                  <div key={x.typ} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px', borderRadius: 7, background: '#f7faf7', marginBottom: 4 }}>
                    <TypBadge typ={x.typ} />
                    <span style={{ flex: 1, fontSize: 12, color: C.text }}>{x.label} → Kto. {x.konto}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>{x.seite}</span>
                  </div>
                ))}
              </div>

              {/* Schritt B */}
              <div style={{ padding: '14px 20px', borderBottom: `1px solid #f0f3f0` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                  Schritt B — Jahresergebnis übertragen (31.12.{jahr})
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 8, borderLeft: `4px solid ${isGewinn ? '#22c55e' : '#ef4444'}`,
                  background: isGewinn ? '#f0fdf4' : '#fff5f5' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isGewinn ? '#166534' : C.red }}>
                    {isGewinn ? '🟢 Jahresgewinn' : '🔴 Jahresverlust'}: CHF {N2(abs(jahresergebnis))}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted, marginLeft: 12 }}>
                    → Kto. {isGewinn ? konten.gewinnvortrag + ' (Gewinnvortrag)' : konten.verlustvortrag + ' (Verlustvortrag)'}
                  </span>
                </div>
              </div>

              {/* Schritt C */}
              <div style={{ padding: '14px 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                  Schritt C — Eröffnungsbuchungen neues Jahr (01.01.{jahr + 1})
                </div>
                {[
                  { typ: 'aktiv',  label: `${salden.filter(s => s.konto_typ === 'aktiv'  && (s.saldo ?? 0) > 0).length} Aktivkonten`, seite: `Soll Konto → Haben Kto. ${konten.eroeffnung}` },
                  { typ: 'passiv', label: `${salden.filter(s => s.konto_typ === 'passiv' && (s.saldo ?? 0) > 0).length} Passivkonten`, seite: `Soll Kto. ${konten.eroeffnung} → Haben Konto` },
                ].map(x => (
                  <div key={x.typ} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px', borderRadius: 7, background: '#f7faf7', marginBottom: 4 }}>
                    <TypBadge typ={x.typ} />
                    <span style={{ flex: 1, fontSize: 12, color: C.text }}>{x.label}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>{x.seite}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>
                  + Gewinn/Verlust-Vortrag auf Kto. {isGewinn ? konten.gewinnvortrag : konten.verlustvortrag} als Eröffnungsbuchung
                </div>
              </div>
            </div>

            {/* Hinweis */}
            <div style={{ padding: '12px 16px', borderRadius: 10, background: C.yellowL,
              border: '1px solid #fde68a', marginBottom: 20, fontSize: 12, color: C.yellow, lineHeight: 1.6 }}>
              ⚠️ <strong>Dieser Vorgang kann nicht automatisch rückgängig gemacht werden.</strong><br />
              Nach dem Abschluss wird das Geschäftsjahr auf <strong>{jahr + 1}</strong> gesetzt.
              Buchungen in {jahr} sind weiterhin möglich (Korrekturbuchungen).
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setStep(0)}
                style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${C.border}`,
                  background: '#fff', fontSize: 13, cursor: 'pointer', color: C.muted }}>
                ← Zurück
              </button>
              {canWrite ? (
                <button
                  onClick={handleAbschluss}
                  disabled={executing}
                  style={{ padding: '10px 24px', borderRadius: 9, border: 'none',
                    background: executing ? '#e4e9e4' : C.green, color: '#fff',
                    fontSize: 13.5, fontWeight: 700, cursor: executing ? 'wait' : 'pointer',
                    boxShadow: executing ? 'none' : '0 2px 8px #3d664130' }}>
                  {executing ? '⏳ Abschluss läuft…' : `✓ Jahresabschluss ${jahr} jetzt durchführen`}
                </button>
              ) : (
                <div style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>
                  Keine Schreibberechtigung
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SCHRITT 2: Ergebnis ─────────────────────────────────── */}
        {step === 2 && ergebnis && (
          <div style={{ maxWidth: 600 }}>

            {/* Erfolgs-Banner */}
            <div style={{ padding: '20px 24px', borderRadius: 12, background: '#dcfce7',
              border: '2px solid #86efac', textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#166534' }}>
                Jahresabschluss {ergebnis.jahr} erfolgreich!
              </div>
              <div style={{ fontSize: 13, color: '#166534', marginTop: 6, opacity: 0.8 }}>
                Geschäftsjahr wurde auf <strong>{ergebnis.neues_jahr}</strong> gesetzt
              </div>
            </div>

            {/* Ergebnis-Karten */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
              <ErgebnisKarte
                label={ergebnis.gewinn_verlust >= 0 ? 'Jahresgewinn' : 'Jahresverlust'}
                value={ergebnis.gewinn_verlust}
                isGewinn={ergebnis.gewinn_verlust >= 0}
              />
            </div>

            {/* Details */}
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
              padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.1em', color: C.muted, marginBottom: 14 }}>
                Erstellte Buchungen
              </div>
              {[
                [`Abschluss-Buchungen (31.12.${ergebnis.jahr})`, ergebnis.anzahl_abschluss_buchungen],
                [`Eröffnungs-Buchungen (01.01.${ergebnis.neues_jahr})`, ergebnis.anzahl_eb_buchungen],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px solid #f0f3f0' }}>
                  <span style={{ fontSize: 12.5, color: C.text }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{val} Buchungen</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>Total</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: C.green }}>
                  {(ergebnis.anzahl_abschluss_buchungen ?? 0) + (ergebnis.anzahl_eb_buchungen ?? 0)} Buchungen
                </span>
              </div>
            </div>

            {/* Nächste Schritte */}
            <div style={{ padding: '14px 18px', borderRadius: 10, background: C.blueL,
              border: '1px solid #93c5fd', fontSize: 12, color: C.blue, lineHeight: 1.7 }}>
              <strong>Nächste Schritte:</strong><br />
              • Das Belegjournal zeigt jetzt auch die Abschluss-Buchungen<br />
              • Neue Rechnungen werden automatisch im GJ {ergebnis.neues_jahr} erfasst<br />
              • MWST-Abrechnung Q4 {ergebnis.jahr} bitte vor Jahresende einreichen
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
