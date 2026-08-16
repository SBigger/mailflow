// Belegsortierung natürliche Personen – Prüfstand.
//
// Belege hineinziehen, zusehen wie sie erkannt werden, Fehlgriffe von Hand
// korrigieren. Bewusst ohne Datenbank: hier wird beurteilt, ob die Erkennung
// taugt, nicht ein Dossier geführt. Was hier gut funktioniert, wandert danach
// ins Dossier.
//
// Die Erkennung läuft vollständig im Browser – Text und OCR über dieselbe
// Pipeline wie die Fibu-Belegerkennung, die Zuordnung über Regeln. Es geht
// nichts nach aussen.

import React, { useState, useMemo, useRef } from 'react';
import { Upload, FileText, AlertTriangle, Check, HelpCircle, X, Loader2 } from 'lucide-react';

import { supabase } from '@/api/supabaseClient';
import { extractDocumentText } from '../../lib/batchAiSuggest.js';
import { triageRegeln, triageMitKi, brauchtKi } from '../../lib/steuerBelege/triage.js';
import { positionenFuer, offeneDimensionen } from '../../lib/steuerBelege/belegartZuPosition.js';
import { BELEGART_BY_KEY, BELEGARTEN } from '../../lib/steuerBelege/belegarten.js';
import { findAhvInText, dateiHash } from '../../lib/steuerBelege/belegHelfer.js';
import { KATALOG, KATALOG_NACH_ID, GRUPPEN, AUSSORTIERT, DIMENSIONEN, katalogFuerPrompt }
  from '../../forms/steuer_np_katalog.js';

const C = {
  pageBg:  '#f2f5f2', panelBg: '#ffffff', panelBdr: '#ccd8cc',
  heading: '#1a3a1a', sub:     '#4a6a4a', accent:   '#5b8a5b',
  accentBg:'#eef5ee', muted:   '#9ca3af', rowHov:   '#f0f5f0',
  inputBg: '#f8faf8', warn:    '#c2833c', offen:    '#7a7a9c',
};

const SEITEN = [...GRUPPEN, { id: 'aussortiert', label: 'Nicht zur Steuererklärung', seite: 99 }];

export default function Belegsortierung() {
  const [belege, setBelege] = useState([]);
  const [laeuft, setLaeuft] = useState(false);
  const [ueber, setUeber] = useState(false);
  const [gewaehlt, setGewaehlt] = useState(null);   // id des Belegs in der Vorschau
  const [kiNutzen, setKiNutzen] = useState(true);
  const eingabe = useRef(null);

  async function verarbeite(dateien) {
    const liste = Array.from(dateien).filter(f => /\.(pdf|png|jpe?g)$/i.test(f.name));
    if (!liste.length) return;
    setLaeuft(true);

    // Hashes der bereits eingelesenen Belege – die Triage erkennt Doppel daran
    const bekannteHashes = belege.map(b => b.hash).filter(Boolean);

    for (const datei of liste) {
      const id = `${datei.name}-${datei.size}-${Date.now()}`;
      // Objekt-URL fuer die Vorschau. Der Browser bringt seinen eigenen
      // PDF-Betrachter mit – damit laesst sich blaettern und zoomen, statt
      // nur die erste Seite als Bild zu sehen.
      const url = URL.createObjectURL(datei);
      setBelege(v => [...v, { id, name: datei.name, stand: 'liest', groesse: datei.size, url,
                              istPdf: /\.pdf$/i.test(datei.name) }]);
      setGewaehlt(g => g ?? id);

      try {
        const hash = await dateiHash(datei);
        const text = await extractDocumentText(datei, {
          onStage: s => setBelege(v => v.map(b => b.id === id ? { ...b, stand: s } : b)),
        });

        const eingang = { text, dateiname: datei.name, parseMethode: 'ocr', dateiHash: hash };
        const kontext = {
          bekannteHashes,
          katalog: katalogFuerPrompt(),
          belegarten: BELEGARTEN.map(b => `${b.key} = ${b.label}`).join('\n'),
        };

        // Regeln zuerst. Nur was darunter bleibt, geht an die KI – bei einem
        // echten Stapel war das rund ein Drittel.
        let tri = triageRegeln(eingang, kontext);
        if (kiNutzen && brauchtKi(tri)) {
          setBelege(v => v.map(b => b.id === id ? { ...b, stand: 'ki' } : b));
          tri = await triageMitKi(supabase, eingang, kontext);
        }
        bekannteHashes.push(hash);

        const zuord = tri.belegart ? positionenFuer(tri.belegart) : { positionen: [], offen: true };

        // Die KI darf auch direkt Positionen nennen – dann gewinnt ihr
        // Vorschlag, sonst leitet er sich aus der Belegart ab.
        const kiPositionen = (tri.positionen || [])
          .map(pid => KATALOG_NACH_ID[pid]).filter(Boolean);

        setBelege(v => v.map(b => b.id === id ? {
          ...b, stand: 'fertig', hash, text,
          belegart: tri.belegart,
          confidence: tri.confidence,
          begruendung: tri.begruendung,
          quelle: tri.quelle || 'regel',
          kiNoetig: brauchtKi(tri),
          vorschlag: kiPositionen.length ? kiPositionen : (zuord.positionen || []),
          kandidaten: zuord.kandidaten || [],
          offenGrund: kiPositionen.length ? null : (zuord.offen ? (zuord.grund || null) : null),
          hinweis: zuord.hinweis || null,
          position: (kiPositionen.length === 1) ? kiPositionen[0].id
                  : (zuord.positionen?.length === 1 ? zuord.positionen[0].id : null),
          ahv: findAhvInText(text),
        } : b));
      } catch (e) {
        setBelege(v => v.map(b => b.id === id
          ? { ...b, stand: 'fehler', fehler: e.message || String(e) } : b));
      }
    }
    setLaeuft(false);
  }

  function setzePosition(id, positionId) {
    setBelege(v => v.map(b => b.id === id
      ? { ...b, position: positionId || null, vonHand: true } : b));
    // Nach dem Zuweisen zum naechsten Beleg springen, der eine Entscheidung
    // braucht – sonst muss man nach jedem Klick von Hand weitersuchen.
    setBelege(v => {
      const naechster = v.find(b => b.id !== id && b.stand === 'fertig' && !b.position
        && !(b.vorschlag?.length === 1));
      if (naechster) setGewaehlt(naechster.id);
      return v;
    });
  }

  function zuruecksetzen() {
    belege.forEach(b => { if (b.url) URL.revokeObjectURL(b.url); });
    setBelege([]);
    setGewaehlt(null);
  }

  // ── Nach Seiten der Steuererklärung gruppieren ──────────────────────────
  const gruppiert = useMemo(() => {
    const nachSeite = new Map();
    const ohne = [];
    for (const b of belege) {
      const pid = b.position ?? (b.vorschlag?.length === 1 ? b.vorschlag[0].id : null);
      const pos = pid ? KATALOG_NACH_ID[pid] : null;
      if (!pos) { ohne.push(b); continue; }
      if (!nachSeite.has(pos.seite)) nachSeite.set(pos.seite, []);
      nachSeite.get(pos.seite).push({ ...b, pos });
    }
    for (const [, arr] of nachSeite) arr.sort((a, b) => a.pos.sort - b.pos.sort);
    return { nachSeite, ohne };
  }, [belege]);

  const fertig = belege.filter(b => b.stand === 'fertig');
  const zugeordnet = fertig.filter(b => b.position || b.vorschlag?.length === 1).length;
  const offen = fertig.length - zugeordnet;

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: '100%', padding: 20 }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>

        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.heading, marginBottom: 4 }}>
          Belegsortierung – natürliche Personen
        </h1>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap',
        }}>
          <p style={{ fontSize: 12, color: C.sub, margin: 0, flex: 1, minWidth: 320 }}>
            Belegstapel hineinziehen. Erkannt wird zuerst über Regeln im Browser; nur was dort
            unklar bleibt, geht an die KI. Sortiert wird in die Reihenfolge der Steuererklärung.
          </p>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.sub,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <input type="checkbox" checked={kiNutzen}
                   onChange={e => setKiNutzen(e.target.checked)} />
            KI für unklare Belege
            <span style={{ color: C.muted }}>
              (sendet Briefkopf, AHV-Nr. maskiert)
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* ── links: Liste ── */}
          <div style={{ flex: '1 1 0', minWidth: 0 }}>

        {/* Ablagefläche */}
        <div
          onDragOver={e => { e.preventDefault(); setUeber(true); }}
          onDragLeave={() => setUeber(false)}
          onDrop={e => { e.preventDefault(); setUeber(false); verarbeite(e.dataTransfer.files); }}
          onClick={() => eingabe.current?.click()}
          style={{
            border: `2px dashed ${ueber ? C.accent : C.panelBdr}`,
            backgroundColor: ueber ? C.accentBg : C.panelBg,
            borderRadius: 10, padding: 26, textAlign: 'center', cursor: 'pointer',
            transition: 'all .15s', marginBottom: 16,
          }}
        >
          <Upload size={22} style={{ color: C.accent, marginBottom: 6 }} />
          <div style={{ fontSize: 13, color: C.heading, fontWeight: 600 }}>
            PDFs oder Scans hierher ziehen
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            Gescannte Belege brauchen OCR – rechne mit ein paar Sekunden pro Seite
          </div>
          <input
            ref={eingabe} type="file" multiple accept=".pdf,.png,.jpg,.jpeg"
            style={{ display: 'none' }}
            onChange={e => { verarbeite(e.target.files); e.target.value = ''; }}
          />
        </div>

        {belege.length > 0 && (
          <div style={{
            display: 'flex', gap: 18, alignItems: 'center', marginBottom: 14,
            fontSize: 12, color: C.sub,
          }}>
            <span><b style={{ color: C.heading }}>{fertig.length}</b> eingelesen</span>
            <span><b style={{ color: C.accent }}>{zugeordnet}</b> zugeordnet</span>
            {offen > 0 && <span><b style={{ color: C.offen }}>{offen}</b> brauchen eine Entscheidung</span>}
            {laeuft && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Loader2 size={13} className="animate-spin" /> läuft
              </span>
            )}
            <button
              onClick={zuruecksetzen}
              style={{
                marginLeft: 'auto', fontSize: 11, color: C.sub, background: 'none',
                border: `1px solid ${C.panelBdr}`, borderRadius: 5, padding: '3px 9px',
                cursor: 'pointer',
              }}
            >Zurücksetzen</button>
          </div>
        )}

        {/* Noch zu entscheiden */}
        {gruppiert.ohne.length > 0 && (
          <Block titel="Braucht eine Entscheidung" farbe={C.offen}>
            {gruppiert.ohne.map(b => (
              <Zeile key={b.id} beleg={b} onPosition={setzePosition}
                     aktiv={b.id === gewaehlt} onWaehlen={setGewaehlt} />
            ))}
          </Block>
        )}

        {/* In der Reihenfolge der Erklärung */}
        {SEITEN.map(g => {
          const arr = gruppiert.nachSeite.get(g.seite);
          if (!arr?.length) return null;
          return (
            <Block key={g.id} titel={`Seite ${g.seite} · ${g.label}`} farbe={C.accent}>
              {arr.map(b => <Zeile key={b.id} beleg={b} onPosition={setzePosition}
                                   aktiv={b.id === gewaehlt} onWaehlen={setGewaehlt} />)}
            </Block>
          );
        })}
          </div>

          {/* ── rechts: Vorschau ── */}
          <Vorschau beleg={belege.find(b => b.id === gewaehlt)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Vorschau des gewaehlten Belegs.
 *
 * Bewusst der eingebaute PDF-Betrachter des Browsers statt einer selbst
 * gerenderten Seite: damit laesst sich blaettern und zoomen. Bei einem
 * 38-seitigen Umbaubuendel ist die erste Seite selten die, an der man
 * entscheidet.
 */
function Vorschau({ beleg }) {
  const rahmen = {
    width: '46%', minWidth: 400, position: 'sticky', top: 16,
    height: 'calc(100vh - 150px)', backgroundColor: C.panelBg,
    border: `1px solid ${C.panelBdr}`, borderRadius: 8,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  if (!beleg) {
    return (
      <div style={{ ...rahmen, alignItems: 'center', justifyContent: 'center' }}>
        <FileText size={26} style={{ color: C.muted, marginBottom: 8 }} />
        <div style={{ fontSize: 12, color: C.muted }}>Beleg anklicken für die Vorschau</div>
      </div>
    );
  }

  return (
    <div style={rahmen}>
      <div style={{
        padding: '8px 12px', borderBottom: `1px solid ${C.panelBdr}`,
        fontSize: 12, fontWeight: 600, color: C.heading,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <FileText size={13} style={{ color: C.accent, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {beleg.name}
        </span>
        <a href={beleg.url} target="_blank" rel="noreferrer"
           style={{ marginLeft: 'auto', fontSize: 11, color: C.accent, flexShrink: 0 }}>
          neues Fenster
        </a>
      </div>
      {beleg.istPdf
        ? <iframe title={beleg.name} src={beleg.url} style={{ flex: 1, border: 'none' }} />
        : <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            <img src={beleg.url} alt={beleg.name} style={{ width: '100%' }} />
          </div>}
    </div>
  );
}

function Block({ titel, farbe, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
        color: farbe, marginBottom: 6, paddingBottom: 4,
        borderBottom: `1px solid ${C.panelBdr}`,
      }}>{titel}</h3>
      <div style={{
        backgroundColor: C.panelBg, border: `1px solid ${C.panelBdr}`,
        borderRadius: 8, overflow: 'hidden',
      }}>{children}</div>
    </div>
  );
}

function Zeile({ beleg: b, onPosition, aktiv, onWaehlen }) {
  const laden = b.stand !== 'fertig' && b.stand !== 'fehler';
  const pos = b.position ? KATALOG_NACH_ID[b.position] : null;
  const dims = offeneDimensionen(pos ? [pos] : b.vorschlag || []);

  return (
    <div
      onClick={() => onWaehlen?.(b.id)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px',
        borderBottom: `1px solid ${C.pageBg}`, fontSize: 12, cursor: 'pointer',
        backgroundColor: aktiv ? C.accentBg : 'transparent',
        borderLeft: `3px solid ${aktiv ? C.accent : 'transparent'}`,
      }}>
      <div style={{ paddingTop: 2 }}>
        {laden      ? <Loader2 size={14} className="animate-spin" style={{ color: C.muted }} />
        : b.stand === 'fehler' ? <X size={14} style={{ color: '#c25b5b' }} />
        : b.position ? <Check size={14} style={{ color: C.accent }} />
        : <HelpCircle size={14} style={{ color: C.offen }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: C.heading }}>{b.name}</span>
          {b.belegart && (
            <span style={{ color: C.sub }}>
              {BELEGART_BY_KEY[b.belegart]?.label}
              {b.confidence != null && (
                <span style={{ color: C.muted }}> · {Math.round(b.confidence * 100)}%</span>
              )}
            </span>
          )}
          {b.vonHand && <span style={{ fontSize: 10, color: C.accent }}>von Hand</span>}
          {b.quelle === 'ki' && !b.vonHand && (
            <span style={{
              fontSize: 10, color: C.offen, border: `1px solid ${C.panelBdr}`,
              borderRadius: 3, padding: '0 4px',
            }}>KI</span>
          )}
        </div>

        {laden && <div style={{ color: C.muted, marginTop: 2 }}>{standText(b.stand)}</div>}
        {b.stand === 'fehler' && (
          <div style={{ color: '#c25b5b', marginTop: 2 }}>{b.fehler}</div>
        )}

        {b.begruendung && !laden && (
          <div style={{ color: C.muted, marginTop: 2 }}>{b.begruendung}</div>
        )}

        {b.offenGrund && (
          <div style={{ color: C.offen, marginTop: 3, display: 'flex', gap: 5 }}>
            <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>Entscheidet sich an: {b.offenGrund}</span>
          </div>
        )}
        {b.hinweis && (
          <div style={{ color: C.warn, marginTop: 3 }}>{b.hinweis}</div>
        )}
        {pos?.pruefen && (
          <div style={{ color: C.warn, marginTop: 3, display: 'flex', gap: 5 }}>
            <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>Fachlich zu prüfen: {pos.pruefen}</span>
          </div>
        )}
        {dims.length > 0 && (
          <div style={{ color: C.sub, marginTop: 3 }}>
            Noch offen: {dims.map(d => DIMENSIONEN[d]).join(', ')}
            {b.ahv && <span style={{ color: C.muted }}> · AHVN13 im Beleg gefunden</span>}
          </div>
        )}
        {b.vorschlag?.length > 1 && (
          <div style={{ color: C.sub, marginTop: 3 }}>
            Füllt zwei Positionen: {b.vorschlag.map(p => `S${p.seite} ${p.label}`).join(' · ')}
          </div>
        )}
      </div>

      {!laden && b.stand !== 'fehler' && (
        <select
          value={b.position || ''}
          onClick={e => e.stopPropagation()}
          onChange={e => onPosition(b.id, e.target.value)}
          style={{
            backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`, borderRadius: 5,
            padding: '3px 6px', fontSize: 11, color: C.heading, maxWidth: 260, flexShrink: 0,
          }}
        >
          <option value="">— Position wählen —</option>
          {[...KATALOG, AUSSORTIERT].map(p => (
            <option key={p.id} value={p.id}>S{p.seite} · {p.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function standText(stand) {
  if (stand === 'liest')  return 'wird gelesen …';
  if (stand === 'ocr')    return 'Scan erkannt – OCR läuft, das dauert';
  if (stand === 'pdf')    return 'PDF-Text wird gelesen …';
  if (stand === 'ki')     return 'Regeln reichten nicht – KI wird gefragt …';
  return String(stand || '') + ' …';
}
