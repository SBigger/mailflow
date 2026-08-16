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

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, FileText, AlertTriangle, Check, HelpCircle, X, Loader2, Download, GripVertical } from 'lucide-react';

import { supabase } from '@/api/supabaseClient';
import { extractDocumentText } from '../../lib/batchAiSuggest.js';
import { triageRegeln, triageMitKi, brauchtKi } from '../../lib/steuerBelege/triage.js';
import { positionenFuer, offeneDimensionen } from '../../lib/steuerBelege/belegartZuPosition.js';
import { BELEGART_BY_KEY, BELEGARTEN } from '../../lib/steuerBelege/belegarten.js';
import { findAhvInText, dateiHash } from '../../lib/steuerBelege/belegHelfer.js';
import { KATALOG, KATALOG_NACH_ID, GRUPPEN, AUSSORTIERT, DIMENSIONEN, katalogFuerPrompt }
  from '../../forms/steuer_np_katalog.js';
import { baueBeilagenBundle } from '../../lib/steuerBelege/beilagenBundle.js';
import { belegsortierung as db } from '../../api/belegsortierung.js';

const C = {
  pageBg:  '#f2f5f2', panelBg: '#ffffff', panelBdr: '#ccd8cc',
  heading: '#1a3a1a', sub:     '#4a6a4a', accent:   '#5b8a5b',
  accentBg:'#eef5ee', muted:   '#9ca3af', rowHov:   '#f0f5f0',
  inputBg: '#f8faf8', warn:    '#c2833c', offen:    '#7a7a9c',
};

// Breite der Vorschau: als px in localStorage gemerkt, damit sie flexibel
// bleibt (per Ziehen am Griff) statt bei jedem Neuladen auf 46% zurückzuspringen.
const VORSCHAU_BREITE_KEY = 'belegsortierung-vorschau-breite';
const VORSCHAU_BREITE_MIN = 340;
const VORSCHAU_BREITE_MAX = 1100;
function ladeVorschauBreite() {
  const gespeichert = parseInt(localStorage.getItem(VORSCHAU_BREITE_KEY), 10);
  if (!isNaN(gespeichert)) return Math.min(VORSCHAU_BREITE_MAX, Math.max(VORSCHAU_BREITE_MIN, gespeichert));
  return Math.round(window.innerWidth * 0.42);
}

export default function Belegsortierung() {
  const [belege, setBelege] = useState([]);
  const [laeuft, setLaeuft] = useState(false);
  const [ueber, setUeber] = useState(false);
  const [gewaehlt, setGewaehlt] = useState(null);   // id des Belegs in der Vorschau
  const [kiNutzen, setKiNutzen] = useState(true);
  const [zieht, setZieht] = useState(null);      // id des Belegs, der gerade gezogen wird
  const [ueberZiel, setUeberZiel] = useState(null);
  const [vorschauBreite, setVorschauBreite] = useState(ladeVorschauBreite);
  const [ziehtGriff, setZiehtGriff] = useState(false);
  const [kunde, setKunde] = useState(null);
  const [steuerjahr, setSteuerjahr] = useState(new Date().getFullYear() - 1);
  const [suche, setSuche] = useState('');
  const [speichert, setSpeichert] = useState(false);
  const [gespeichertUm, setGespeichertUm] = useState(null);
  const eingabe = useRef(null);

  // Nur natürliche Personen – das Gegenstück zum Steuermodul, das ausschliesslich
  // juristische Personen führt.
  const { data: kunden = [] } = useQuery({
    queryKey: ['customers_np'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name, ort, plz, person_type, aktiv')
        .in('person_type', ['privatperson', 'privatperson_partner'])
        .order('company_name');
      if (error) throw new Error(error.message);
      return (data || []).filter(k => k.aktiv !== false);
    },
  });

  // Gespeicherten Stand laden, sobald Mandant und Jahr feststehen. Die Belege
  // kommen ohne Datei zurück – erst wenn derselbe Stapel wieder hineingezogen
  // wird, führt der Hash sie wieder zusammen.
  const { data: gespeichert } = useQuery({
    queryKey: ['belegsortierung', kunde?.id, steuerjahr],
    queryFn: () => db.get(kunde.id, steuerjahr),
    enabled: !!kunde?.id,
  });

  useEffect(() => {
    if (!gespeichert?.belege?.length) return;
    setBelege(v => {
      if (v.length) return v;                     // laufende Arbeit nicht überschreiben
      return gespeichert.belege.map((b, i) => ({
        ...b, id: `gespeichert-${i}-${b.hash}`, stand: 'fertig', ohneDatei: true,
      }));
    });
  }, [gespeichert]);

  async function speichern() {
    if (!kunde?.id) return;
    setSpeichert(true);
    try {
      await db.upsert(kunde.id, steuerjahr, belege);
      setGespeichertUm(new Date());
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e.message || e));
    } finally {
      setSpeichert(false);
    }
  }

  // Griff zwischen Liste und Vorschau ziehen → Vorschau breiter/schmaler machen.
  const griffZiehen = e => {
    e.preventDefault();
    setZiehtGriff(true);
    const startX = e.clientX;
    const startBreite = vorschauBreite;
    const bewegen = me => {
      const neu = startBreite - (me.clientX - startX); // Vorschau ist rechts: nach links ziehen = breiter
      setVorschauBreite(Math.min(VORSCHAU_BREITE_MAX, Math.max(VORSCHAU_BREITE_MIN, neu)));
    };
    const loslassen = () => {
      setZiehtGriff(false);
      document.removeEventListener('mousemove', bewegen);
      document.removeEventListener('mouseup', loslassen);
      setVorschauBreite(b => { localStorage.setItem(VORSCHAU_BREITE_KEY, String(b)); return b; });
    };
    document.addEventListener('mousemove', bewegen);
    document.addEventListener('mouseup', loslassen);
  };

  // Aktueller Stand für die Hash-Wiedererkennung, ohne verarbeite() bei jeder
  // Zustandsänderung neu zu erzeugen.
  const belegeRef = useRef(belege);
  useEffect(() => { belegeRef.current = belege; }, [belege]);

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
      // datei wird fuer das Beilagenbuendel gebraucht – nicht wegwerfen
      setBelege(v => [...v, { id, name: datei.name, stand: 'liest', groesse: datei.size, url,
                              datei, istPdf: /\.pdf$/i.test(datei.name) }]);
      setGewaehlt(g => g ?? id);

      try {
        const hash = await dateiHash(datei);

        // Schon einmal einsortiert? Dann Datei nur anhaengen, nicht neu
        // erkennen – OCR und KI kosten Minuten, der Hash kostet nichts.
        const bekannt = belegeRef.current.find(b => b.hash === hash && b.ohneDatei);
        if (bekannt) {
          setBelege(v => v
            .filter(b => b.id !== id)
            .map(b => b.id === bekannt.id
              ? { ...b, datei, url, istPdf: /\.pdf$/i.test(datei.name), ohneDatei: false,
                  name: datei.name, stand: 'fertig' }
              : b));
          setGewaehlt(g => (g === id ? bekannt.id : g));
          continue;
        }

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
    setBelege(v => {
      const neu = v.map(b => b.id === id
        ? { ...b, position: positionId || null, vonHand: true } : b);
      // Weiter zum naechsten Beleg der Warteschlange – sonst muss man nach
      // jedem Zug von Hand weitersuchen.
      const naechster = neu.find(b => b.id !== id && b.stand === 'fertig'
        && !b.position && !(b.vorschlag?.length === 1));
      queueMicrotask(() => setGewaehlt(naechster ? naechster.id : id));
      return neu;
    });
  }

  const [baut, setBaut] = useState(false);

  async function bundelHerunterladen() {
    setBaut(true);
    try {
      const bytes = await baueBeilagenBundle(belege.filter(b => b.position), {});
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Beilagen sortiert.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      alert('Bündel konnte nicht erzeugt werden: ' + (e.message || e));
    } finally {
      setBaut(false);
    }
  }

  function zuruecksetzen() {
    belege.forEach(b => { if (b.url) URL.revokeObjectURL(b.url); });
    setBelege([]);
    setGewaehlt(null);
  }

  // ── Belege den Positionen zuordnen ──────────────────────────────────────
  // Der Katalog ist die Ablage: jede Position ist ein Stapel, auf den man
  // einen Beleg ziehen kann. Was noch keinen Stapel hat, liegt oben in der
  // Warteschlange.
  const { proPosition, warteschlange } = useMemo(() => {
    const proPosition = new Map();
    const warteschlange = [];
    for (const b of belege) {
      if (b.stand !== 'fertig') { warteschlange.push(b); continue; }
      const pid = b.position ?? (b.vorschlag?.length === 1 ? b.vorschlag[0].id : null);
      if (!pid || !KATALOG_NACH_ID[pid]) { warteschlange.push(b); continue; }
      if (!proPosition.has(pid)) proPosition.set(pid, []);
      proPosition.get(pid).push(b);
    }
    return { proPosition, warteschlange };
  }, [belege]);

  const seitenGruppen = useMemo(() => {
    const g = new Map();
    for (const p of [...KATALOG, AUSSORTIERT]) {
      if (!g.has(p.seite)) g.set(p.seite, []);
      g.get(p.seite).push(p);
    }
    return [...g.entries()].sort((a, b) => a[0] - b[0]);
  }, []);

  const fertig = belege.filter(b => b.stand === 'fertig');
  const zugeordnet = fertig.filter(b => b.position || b.vorschlag?.length === 1).length;
  const offen = fertig.length - zugeordnet;

  // ── Ziehen und Ablegen ──────────────────────────────────────────────────
  const zieheAn = (id) => (e) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setZieht(id);
  };
  const zieheAus = () => { setZieht(null); setUeberZiel(null); };

  const zielProps = (positionId) => ({
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setUeberZiel(positionId); },
    onDragLeave: () => setUeberZiel(z => (z === positionId ? null : z)),
    onDrop: e => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData('text/plain');
      if (id) setzePosition(id, positionId);
      zieheAus();
    },
  });

  return (
    <div style={{
      backgroundColor: C.pageBg, height: '100%', padding: 20, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        maxWidth: 1600, margin: '0 auto', width: '100%',
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
      }}>

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

        {/* Mandant und Jahr – ohne die lässt sich nichts speichern */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap',
          backgroundColor: C.panelBg, border: `1px solid ${C.panelBdr}`,
          borderRadius: 8, padding: '8px 12px',
        }}>
          <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>Mandant</span>
          <input
            value={kunde ? (kunde.company_name || '') : suche}
            onChange={e => { setSuche(e.target.value); setKunde(null); }}
            placeholder="Name eingeben …"
            style={{
              backgroundColor: C.inputBg, border: `1px solid ${kunde ? C.accent : C.panelBdr}`,
              borderRadius: 5, padding: '4px 8px', fontSize: 12, color: C.heading,
              width: 240, outline: 'none',
            }}
          />
          {!kunde && suche.length >= 2 && (
            <div style={{
              position: 'relative', width: 0, height: 0,
            }}>
              <div style={{
                position: 'absolute', top: 8, left: -248, width: 240, zIndex: 20,
                backgroundColor: C.panelBg, border: `1px solid ${C.panelBdr}`,
                borderRadius: 6, maxHeight: 220, overflowY: 'auto',
                boxShadow: '0 4px 14px rgba(0,0,0,.10)',
              }}>
                {kunden
                  .filter(k => k.company_name?.toLowerCase().includes(suche.toLowerCase()))
                  .slice(0, 25)
                  .map(k => (
                    <div key={k.id} onClick={() => { setKunde(k); setSuche(''); }}
                      style={{
                        padding: '5px 9px', fontSize: 12, cursor: 'pointer',
                        borderBottom: `1px solid ${C.pageBg}`, color: C.heading,
                      }}>
                      {k.company_name}
                      {k.ort && <span style={{ color: C.muted }}> · {k.ort}</span>}
                    </div>
                  ))}
              </div>
            </div>
          )}

          <span style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginLeft: 6 }}>Jahr</span>
          <select value={steuerjahr} onChange={e => setSteuerjahr(Number(e.target.value))}
            style={{
              backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`, borderRadius: 5,
              padding: '4px 6px', fontSize: 12, color: C.heading,
            }}>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(j => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>

          <button
            onClick={speichern}
            disabled={!kunde || speichert || !belege.length}
            style={{
              marginLeft: 'auto', fontSize: 11, fontWeight: 600,
              color: kunde && belege.length ? '#fff' : C.muted,
              backgroundColor: kunde && belege.length ? C.accent : 'transparent',
              border: `1px solid ${kunde && belege.length ? C.accent : C.panelBdr}`,
              borderRadius: 5, padding: '4px 12px',
              cursor: kunde && belege.length ? 'pointer' : 'default',
            }}>
            {speichert ? 'speichert …' : 'Speichern'}
          </button>
          {gespeichertUm && (
            <span style={{ fontSize: 10, color: C.muted }}>
              gespeichert {gespeichertUm.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {!kunde && (
            <span style={{ fontSize: 10, color: C.warn }}>
              ohne Mandant kann nicht gespeichert werden
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* ── links: Liste, scrollt fuer sich ── */}
          <div style={{ flex: '1 1 0', minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>

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
              onClick={bundelHerunterladen}
              disabled={baut || !zugeordnet}
              style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                color: zugeordnet ? '#fff' : C.muted,
                backgroundColor: zugeordnet ? C.accent : 'transparent',
                border: `1px solid ${zugeordnet ? C.accent : C.panelBdr}`,
                borderRadius: 5, padding: '4px 11px',
                cursor: zugeordnet ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <Download size={12} />
              {baut ? 'wird gebaut …' : 'Bündel als PDF'}
            </button>
            <button
              onClick={zuruecksetzen}
              style={{
                fontSize: 11, color: C.sub, background: 'none',
                border: `1px solid ${C.panelBdr}`, borderRadius: 5, padding: '3px 9px',
                cursor: 'pointer',
              }}
            >Zurücksetzen</button>
          </div>
        )}

        {/* Warteschlange – von hier wird gezogen */}
        {warteschlange.length > 0 && (
          <Block titel={`Zu entscheiden · ${warteschlange.length}`} farbe={C.offen}>
            {warteschlange.map(b => (
              <Zeile key={b.id} beleg={b} aktiv={b.id === gewaehlt} onWaehlen={setGewaehlt}
                     onDragStart={zieheAn(b.id)} onDragEnd={zieheAus} zieht={zieht === b.id} />
            ))}
          </Block>
        )}

        {/* Der Katalog ist die Ablage: jede Position ein Stapel */}
        {seitenGruppen.map(([seite, positionen]) => {
          const belegt = positionen.filter(p => proPosition.get(p.id)?.length);
          // Seite 0 (Arbeitspapiere) und 99 (nicht benötigt) sind IMMER da.
          // Sie sind die zwei häufigsten Ziele beim Durchgehen eines Stapels –
          // wenn man sie erst beim Ziehen sieht, sind sie unauffindbar.
          const immer = seite === 0 || seite === 99;
          // Sonst leere Positionen nur zeigen, solange gezogen wird – die Seite
          // wäre sonst eine Wand aus 41 leeren Zeilen.
          const sichtbar = (zieht || immer) ? positionen : belegt;
          if (!sichtbar.length) return null;
          const titel = seite === 99 ? 'Nicht benötigt'
                      : seite === 0  ? 'Arbeitspapiere (keine Beilage)'
                      : `Seite ${seite} · ${seitenName(seite)}`;
          return (
            <Block key={seite} titel={titel} farbe={seite >= 90 ? C.muted : C.accent}>
              {sichtbar.map(p => (
                <Ablage key={p.id} position={p} belege={proPosition.get(p.id) || []}
                        aktivZiel={ueberZiel === p.id} zieht={!!zieht}
                        gewaehlt={gewaehlt} onWaehlen={setGewaehlt}
                        onDragStart={zieheAn} onDragEnd={zieheAus} {...zielProps(p.id)} />
              ))}
            </Block>
          );
        })}
          </div>

          {/* ── Griff: Vorschau breiter/schmaler ziehen ── */}
          <div
            onMouseDown={griffZiehen}
            title="Ziehen zum Verbreitern/Verschmälern"
            style={{
              alignSelf: 'stretch', width: 10, flexShrink: 0, cursor: 'col-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 4, height: '100%', borderRadius: 3,
              backgroundColor: ziehtGriff ? C.accent : C.panelBdr,
              transition: ziehtGriff ? 'none' : 'background-color .15s',
            }} />
          </div>

          {/* ── rechts: Vorschau ── */}
          <Vorschau beleg={belege.find(b => b.id === gewaehlt)} breite={vorschauBreite} />
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
function Vorschau({ beleg, breite }) {
  const rahmen = {
    width: breite, flexShrink: 0, height: '100%', backgroundColor: C.panelBg,
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

function seitenName(seite) {
  if (seite === 99) return 'Nicht zur Steuererklärung';
  return GRUPPEN.find(g => g.seite === seite)?.label || '';
}

/**
 * Eine Position als Ablagestelle. Belege werden daraufgezogen, statt aus
 * einer Liste mit 41 Einträgen gesucht zu werden – das entspricht dem, was
 * man auf dem Tisch macht: Blatt auf den richtigen Stapel legen.
 */
function Ablage({ position: p, belege, aktivZiel, zieht, gewaehlt, onWaehlen,
                  onDragStart, onDragEnd, ...zielProps }) {
  const leer = belege.length === 0;
  return (
    <div {...zielProps} style={{
      borderBottom: `1px solid ${C.pageBg}`,
      backgroundColor: aktivZiel ? C.accentBg : 'transparent',
      outline: aktivZiel ? `2px dashed ${C.accent}` : 'none',
      outlineOffset: -2,
      opacity: leer && zieht ? 0.55 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        fontSize: 11, color: leer ? C.muted : C.sub, fontWeight: leer ? 400 : 600,
      }}>
        <span>{p.label}</span>
        {p.dimensionen && (
          <span style={{ color: C.muted, fontWeight: 400 }}>
            · {p.dimensionen.map(d => DIMENSIONEN[d]).join(' + ')}
          </span>
        )}
        {!leer && (
          <span style={{ marginLeft: 'auto', color: C.accent }}>{belege.length}</span>
        )}
      </div>

      {belege.map(b => (
        <Zeile key={b.id} beleg={b} imStapel
               aktiv={b.id === gewaehlt} onWaehlen={onWaehlen}
               onDragStart={onDragStart(b.id)} onDragEnd={onDragEnd} />
      ))}

      {leer && (
        <div style={{ padding: '2px 12px 8px 12px', fontSize: 10, color: C.muted }}>
          hierher ziehen
        </div>
      )}
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

function Zeile({ beleg: b, aktiv, onWaehlen, onDragStart, onDragEnd, zieht, imStapel }) {
  const laden = b.stand !== 'fertig' && b.stand !== 'fehler';
  const pos = b.position ? KATALOG_NACH_ID[b.position] : null;
  const dims = offeneDimensionen(pos ? [pos] : b.vorschlag || []);
  const ziehbar = !laden && b.stand !== 'fehler';

  return (
    <div
      draggable={ziehbar}
      onDragStart={ziehbar ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      onClick={() => onWaehlen?.(b.id)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: imStapel ? '6px 12px 8px 22px' : '9px 12px',
        borderBottom: imStapel ? 'none' : `1px solid ${C.pageBg}`,
        fontSize: 12, cursor: ziehbar ? 'grab' : 'pointer',
        backgroundColor: aktiv ? C.accentBg : 'transparent',
        borderLeft: `3px solid ${aktiv ? C.accent : 'transparent'}`,
        opacity: zieht ? 0.4 : 1,
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

      {ziehbar && (
        <GripVertical size={13} style={{ color: C.muted, flexShrink: 0, marginTop: 2 }} />
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
