// Belegsortierung natürliche Personen.
//
// Ein Belegstapel eines Mandanten wird eingelesen, erkannt und in die
// Reihenfolge der Steuererklärung gebracht — Seite 2 Einkünfte, 3 Abzüge,
// 4 Vermögen. Heraus fällt ein Bündel als PDF mit Beilagenverzeichnis.
//
// Aufbau in drei Spalten, weil das der Arbeitsweise entspricht:
//   links   welcher Abschnitt, wie weit bin ich
//   mitte   die Belege dieses Abschnitts, nach Ziffer gruppiert
//   rechts  der Beleg selbst und was daraus erkannt wurde
//
// Nur der gewählte Abschnitt wird angezeigt. Eine Liste über alle 41
// Positionen war unübersichtlich und liess sich nicht sinnvoll durchscrollen.
//
// Erkennung und OCR laufen im Browser; nur was die Regeln nicht schaffen,
// geht als Briefkopf an die KI (abschaltbar, AHV-Nr. maskiert).

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, FileText, AlertTriangle, Check, HelpCircle, X, Loader2,
  Download, GripVertical, Search, Save,
} from 'lucide-react';

import { supabase } from '@/api/supabaseClient';
import { extractDocumentText } from '../../lib/batchAiSuggest.js';
import { triageRegeln, triageMitKi, brauchtKi } from '../../lib/steuerBelege/triage.js';
import { positionenFuer, offeneDimensionen } from '../../lib/steuerBelege/belegartZuPosition.js';
import { BELEGART_BY_KEY, BELEGARTEN } from '../../lib/steuerBelege/belegarten.js';
import { findAhvInText, dateiHash } from '../../lib/steuerBelege/belegHelfer.js';
import { findeBetrag } from '../../lib/steuerBelege/betrag.js';
import { KATALOG, KATALOG_NACH_ID, GRUPPEN, AUSSORTIERT, DIMENSIONEN, katalogFuerPrompt }
  from '../../forms/steuer_np_katalog.js';
import { baueBeilagenBundle } from '../../lib/steuerBelege/beilagenBundle.js';
import { belegsortierung as db } from '../../api/belegsortierung.js';
import { useTheme } from '../../components/useTheme.jsx';
import { chartisTheme, SEM } from '../../lib/chartisTheme.js';

// Farben kommen aus dem gewaehlten Theme (artis / light / dark), nicht aus
// festen Werten – sonst bliebe das Modul in der dunklen Ansicht hellgruen.
// Die beiden Warnfarben sind bewusst themeunabhaengig: sie muessen auf allen
// drei Untergruenden gleich deutlich sein.
function useFarben() {
  const { theme } = useTheme();
  return useMemo(() => {
    const t = chartisTheme(theme);
    return {
      pageBg:   t.sunken,
      panelBg:  t.raised,
      panelBdr: t.borderSubtle,
      heading:  t.textPrimary,
      sub:      t.textSecondary,
      muted:    t.textMuted,
      accent:   t.accent,
      accentBg: t.accentSoft,
      rowHov:   t.activeRow,
      inputBg:  t.base,
      warn:     SEM.away,        // fachlich zu pruefen
      offen:    t.accentFill,    // Entscheidung noetig
    };
  }, [theme]);
}

const SEITE_KEY = 'belegsortierung-seitenleiste-breite';
const SEITE_MIN = 200, SEITE_MAX = 460;
const VORSCHAU_KEY = 'belegsortierung-vorschau-breite';
const VORSCHAU_MIN = 340;
// Obergrenze haengt am Fenster, nicht an einer festen Zahl: sonst sind die drei
// Spalten zusammen breiter als der Bildschirm und links wie rechts wird
// abgeschnitten. 240 Seitenleiste + 320 Mindestbreite fuer die Belegliste.
const maxBreite = seite => Math.max(VORSCHAU_MIN, window.innerWidth - (seite || 240) - 320);
function ladeSeitenBreite() {
  const g = parseInt(localStorage.getItem(SEITE_KEY), 10);
  return isNaN(g) ? 240 : Math.min(SEITE_MAX, Math.max(SEITE_MIN, g));
}

function ladeVorschauBreite() {
  const g = parseInt(localStorage.getItem(VORSCHAU_KEY), 10);
  const wunsch = !isNaN(g) ? g : Math.round(window.innerWidth * 0.34);
  return Math.min(maxBreite(ladeSeitenBreite()), Math.max(VORSCHAU_MIN, wunsch));
}

// Abschnitte der Seitenleiste. 0 und 99 sind keine Seiten der Erklärung,
// sondern Ablagen — sie stehen deshalb unten und ohne Betrag.
const ABSCHNITTE = [
  { seite: 1, label: 'Allgemein' },
  { seite: 2, label: 'Einkünfte' },
  { seite: 3, label: 'Abzüge' },
  { seite: 4, label: 'Vermögen' },
];
const ABLAGEN = [
  { seite: 0,  label: 'Arbeitspapiere', unter: 'Keine Beilage' },
  { seite: 99, label: 'Nicht benötigt', unter: 'Vom Bündel ausgeschlossen' },
];

// Betrag zur Position suchen. Der Katalog sagt, welcher gesucht wird –
// beim Lohnausweis der Nettolohn, bei der Bank der Bestand per 31.12.
function betragFuer(positionId, text) {
  const p = positionId ? KATALOG_NACH_ID[positionId] : null;
  if (!p?.betrag || !text) return { betrag: null, betragQuelle: null, betragAnker: null };
  const t = findeBetrag(text, positionId);
  if (!t) return { betrag: null, betragQuelle: null, betragAnker: null };
  return { betrag: t.betrag, betragQuelle: 'regel', betragAnker: t.anker };
}

const chf = n => (n || n === 0)
  ? Number(n).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  : '—';

export default function Belegsortierung() {
  const C = useFarben();
  const [belege, setBelege]         = useState([]);
  const [laeuft, setLaeuft]         = useState(false);
  const [ueber, setUeber]           = useState(false);
  const [gewaehlt, setGewaehlt]     = useState(null);
  const [kiNutzen, setKiNutzen]     = useState(true);
  const [zieht, setZieht]           = useState(null);
  const [ueberZiel, setUeberZiel]   = useState(null);
  const [vorschauBreite, setVorschauBreite] = useState(ladeVorschauBreite);
  const [ziehtGriff, setZiehtGriff] = useState(false);
  const [seitenBreite, setSeitenBreite] = useState(ladeSeitenBreite);
  const [kunde, setKunde]           = useState(null);
  const [steuerjahr, setSteuerjahr] = useState(new Date().getFullYear() - 1);
  const [kundenSuche, setKundenSuche] = useState('');
  const [kundenListe, setKundenListe] = useState(false);
  const [suche, setSuche]           = useState('');
  const [speichert, setSpeichert]   = useState(false);
  const [gespeichertUm, setGespeichertUm] = useState(null);
  const [baut, setBaut]             = useState(false);
  const [abschnitt, setAbschnitt]   = useState(2);   // Seite 2 = Einkünfte
  const eingabe = useRef(null);

  // ── Mandant und gespeicherter Stand ─────────────────────────────────────
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

  const { data: gespeichert } = useQuery({
    queryKey: ['belegsortierung', kunde?.id, steuerjahr],
    queryFn: () => db.get(kunde.id, steuerjahr),
    enabled: !!kunde?.id,
  });

  useEffect(() => {
    if (!gespeichert?.belege?.length) return;
    setBelege(v => v.length ? v : gespeichert.belege.map((b, i) => ({
      ...b, id: `gespeichert-${i}-${b.hash}`, stand: 'fertig', ohneDatei: true,
    })));
  }, [gespeichert]);

  const belegeRef = useRef(belege);
  useEffect(() => { belegeRef.current = belege; }, [belege]);

  // ── Einlesen ────────────────────────────────────────────────────────────
  async function verarbeite(dateien) {
    const liste = Array.from(dateien).filter(f => /\.(pdf|png|jpe?g)$/i.test(f.name));
    if (!liste.length) return;
    setLaeuft(true);

    const bekannteHashes = belege.map(b => b.hash).filter(Boolean);
    const kontextBasis = {
      katalog: katalogFuerPrompt(),
      belegarten: BELEGARTEN.map(b => `${b.key} = ${b.label}`).join('\n'),
    };

    // Alle Belege sofort anlegen, damit die Liste gleich steht und man
    // waehrend der Erkennung schon blaettern kann.
    const eintraege = liste.map(datei => ({
      datei,
      id: `${datei.name}-${datei.size}-${Math.random().toString(36).slice(2, 8)}`,
      url: URL.createObjectURL(datei),
    }));
    setBelege(v => [...v, ...eintraege.map(e => ({
      id: e.id, name: e.datei.name, stand: 'wartet', groesse: e.datei.size,
      url: e.url, datei: e.datei, istPdf: /\.pdf$/i.test(e.datei.name),
    }))]);
    setGewaehlt(g => g ?? eintraege[0].id);

    const einen = async ({ datei, id, url }) => {
      try {
        const hash = await dateiHash(datei);

        // Schon einmal einsortiert? Datei nur anhaengen — OCR und KI kosten
        // Minuten, der Hash kostet nichts.
        const bekannt = belegeRef.current.find(b => b.hash === hash && b.ohneDatei);
        if (bekannt) {
          setBelege(v => v.filter(b => b.id !== id).map(b => b.id === bekannt.id
            ? { ...b, datei, url, istPdf: /\.pdf$/i.test(datei.name),
                ohneDatei: false, name: datei.name, stand: 'fertig' }
            : b));
          return;
        }

        setBelege(v => v.map(b => b.id === id ? { ...b, stand: 'liest' } : b));
        // Zwei Seiten reichen fuer die Zuordnung: die Belegart steht im
        // Briefkopf. Fuenf Seiten je Beleg waren der Hauptgrund fuer die
        // lange Wartezeit.
        const text = await extractDocumentText(datei, {
          maxOcrPages: 2,
          onStage: st => setBelege(v => v.map(b => b.id === id ? { ...b, stand: st } : b)),
        });

        const eingang = { text, dateiname: datei.name, parseMethode: 'ocr', dateiHash: hash };
        const kontext = { ...kontextBasis, bekannteHashes };

        let tri = triageRegeln(eingang, kontext);
        if (kiNutzen && brauchtKi(tri)) {
          setBelege(v => v.map(b => b.id === id ? { ...b, stand: 'ki' } : b));
          tri = await triageMitKi(supabase, eingang, kontext);
        }
        bekannteHashes.push(hash);

        const zuord = tri.belegart ? positionenFuer(tri.belegart) : { positionen: [], offen: true };
        const kiPos = (tri.positionen || []).map(x => KATALOG_NACH_ID[x]).filter(Boolean);
        const vorschlag = kiPos.length ? kiPos : (zuord.positionen || []);
        const position = vorschlag.length === 1 ? vorschlag[0].id : null;

        setBelege(v => v.map(b => b.id === id ? {
          ...b, stand: 'fertig', hash, text,
          belegart: tri.belegart, confidence: tri.confidence,
          begruendung: tri.begruendung, quelle: tri.quelle || 'regel',
          vorschlag, kandidaten: zuord.kandidaten || [],
          offenGrund: kiPos.length ? null : (zuord.offen ? zuord.grund : null),
          hinweis: zuord.hinweis || null,
          position,
          ahv: findAhvInText(text),
          jahr: tri.periodeBeleg ?? null,
          ...betragFuer(position, text),
        } : b));
      } catch (e) {
        setBelege(v => v.map(b => b.id === id
          ? { ...b, stand: 'fehler', fehler: e.message || String(e) } : b));
      }
    };

    // Muster aus der Massenablage: erste Datei allein — sie laedt die
    // OCR-Arbeiter und waermt den Prompt-Zwischenspeicher. Der Rest laeuft
    // zu dritt, so wie dort.
    await einen(eintraege[0]);
    const rest = eintraege.slice(1);
    let naechster = 0;
    await Promise.all(Array.from({ length: Math.min(3, rest.length) }, async () => {
      while (naechster < rest.length) await einen(rest[naechster++]);
    }));

    setLaeuft(false);
  }

  // ── Ändern ──────────────────────────────────────────────────────────────
  const aendere = (id, felder) =>
    setBelege(v => v.map(b => b.id === id ? { ...b, ...felder } : b));

  function setzePosition(id, positionId) {
    setBelege(v => {
      const neu = v.map(b => b.id === id
        // Beim Umhaengen den Betrag neu suchen – der Anker haengt an der
        // Position. Ein von Hand eingetippter Betrag bleibt aber stehen.
        ? { ...b, position: positionId || null, vonHand: true,
            ...(b.betragQuelle === 'hand' ? {} : betragFuer(positionId, b.text)) }
        : b);
      const naechster = neu.find(b => b.id !== id && b.stand === 'fertig' && !b.position);
      queueMicrotask(() => setGewaehlt(naechster ? naechster.id : id));
      return neu;
    });
  }

  async function speichern() {
    if (!kunde?.id) return;
    setSpeichert(true);
    try {
      await db.upsert(kunde.id, steuerjahr, belege);
      setGespeichertUm(new Date());
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e.message || e));
    } finally { setSpeichert(false); }
  }

  async function bundelHerunterladen() {
    setBaut(true);
    try {
      const bytes = await baueBeilagenBundle(belege.filter(b => b.position), {
        mandant: kunde?.company_name, steuerjahr,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Beilagen ${kunde?.company_name || ''} ${steuerjahr}.pdf`.trim();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      alert('Bündel konnte nicht erzeugt werden: ' + (e.message || e));
    } finally { setBaut(false); }
  }

  // ── Aufteilung ──────────────────────────────────────────────────────────
  const { proSeite, proPosition, ohne } = useMemo(() => {
    const proSeite = new Map(), proPosition = new Map(), ohne = [];
    for (const b of belege) {
      const p = b.position ? KATALOG_NACH_ID[b.position] : null;
      if (!p) { ohne.push(b); continue; }
      if (!proSeite.has(p.seite)) proSeite.set(p.seite, []);
      proSeite.get(p.seite).push(b);
      if (!proPosition.has(p.id)) proPosition.set(p.id, []);
      proPosition.get(p.id).push(b);
    }
    return { proSeite, proPosition, ohne };
  }, [belege]);

  const summe = liste => (liste || []).reduce((s, b) => s + (parseFloat(b.betrag) || 0), 0);
  const geprueft = belege.filter(b => b.position && (b.vonHand || b.betrag)).length;
  const fortschritt = belege.length ? Math.round(geprueft / belege.length * 100) : 0;

  // ── Ziehen ──────────────────────────────────────────────────────────────
  const zieheAn = id => e => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setZieht(id);
  };
  const zieheAus = () => { setZieht(null); setUeberZiel(null); };
  const zielProps = pid => ({
    onDragOver:  e => { e.preventDefault(); setUeberZiel(pid); },
    onDragLeave: () => setUeberZiel(z => z === pid ? null : z),
    onDrop: e => {
      e.preventDefault(); e.stopPropagation();
      const id = e.dataTransfer.getData('text/plain');
      if (id) setzePosition(id, pid);
      zieheAus();
    },
  });

  // Ein Regler fuer beide Kanten. `richtung` sagt, ob Ziehen nach rechts
  // breiter (Seitenleiste) oder schmaler (Vorschau liegt rechts) macht.
  const macheGriff = (wert, setzen, min, max, key, richtung) => e => {
    e.preventDefault();
    setZiehtGriff(true);
    const startX = e.clientX, start = wert;
    const bewegen = me => {
      const grenze = typeof max === 'function' ? max() : max;
      setzen(Math.min(grenze, Math.max(min, start + richtung * (me.clientX - startX))));
    };
    const los = () => {
      setZiehtGriff(false);
      document.removeEventListener('mousemove', bewegen);
      document.removeEventListener('mouseup', los);
      setzen(b => { localStorage.setItem(key, String(b)); return b; });
    };
    document.addEventListener('mousemove', bewegen);
    document.addEventListener('mouseup', los);
  };

  const seiteZiehen = macheGriff(seitenBreite, setSeitenBreite, SEITE_MIN, SEITE_MAX, SEITE_KEY, 1);

  const griffZiehen = e => {
    e.preventDefault();
    setZiehtGriff(true);
    const startX = e.clientX, startBreite = vorschauBreite;
    const bewegen = me => setVorschauBreite(
      Math.min(maxBreite(seitenBreite), Math.max(VORSCHAU_MIN, startBreite - (me.clientX - startX))));
    const los = () => {
      setZiehtGriff(false);
      document.removeEventListener('mousemove', bewegen);
      document.removeEventListener('mouseup', los);
      setVorschauBreite(b => { localStorage.setItem(VORSCHAU_KEY, String(b)); return b; });
    };
    document.addEventListener('mousemove', bewegen);
    document.addEventListener('mouseup', los);
  };

  // Fenster kleiner gezogen? Vorschau mitnehmen, sonst laeuft die Liste raus.
  useEffect(() => {
    const anpassen = () => setVorschauBreite(b => Math.min(maxBreite(seitenBreite), b));
    window.addEventListener('resize', anpassen);
    return () => window.removeEventListener('resize', anpassen);
  }, [seitenBreite]);

  // Positionen des gewählten Abschnitts, gefiltert nach Suche
  const sichtbarePositionen = useMemo(() => {
    const alle = [...KATALOG, AUSSORTIERT].filter(p => p.seite === abschnitt);
    if (zieht) return alle;
    return alle.filter(p => {
      const liste = proPosition.get(p.id) || [];
      if (!liste.length) return false;
      if (!suche) return true;
      const s = suche.toLowerCase();
      return p.label.toLowerCase().includes(s) || liste.some(b => b.name.toLowerCase().includes(s));
    });
  }, [abschnitt, proPosition, zieht, suche]);

  const aktiverBeleg = belege.find(b => b.id === gewaehlt);

  return (
    <div style={{
      backgroundColor: C.pageBg, height: '100%', boxSizing: 'border-box',
      // flex:1 ist noetig, weil das App-MAIN selbst ein Flex-Container ist:
      // ohne das schrumpft das Modul auf Inhaltsbreite und rechts bleibt der
      // halbe Bildschirm leer.
      display: 'flex', overflow: 'hidden', flex: 1, width: '100%', minWidth: 0,
    }}>

      {/* ══ links: Abschnitte und Stand ══ */}
      <div style={{
        width: seitenBreite, flexShrink: 0, backgroundColor: C.panelBg,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 14px 10px 14px', borderBottom: `1px solid ${C.pageBg}` }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                        letterSpacing: '.08em', marginBottom: 6 }}>Mandant</div>
          <input
            value={kunde ? (kunde.company_name || '') : kundenSuche}
            onChange={e => { setKundenSuche(e.target.value); setKunde(null); }}
            onFocus={() => setKundenListe(true)}
            onBlur={() => setTimeout(() => setKundenListe(false), 180)}
            placeholder="anklicken oder tippen …"
            style={{
              width: '100%', boxSizing: 'border-box', backgroundColor: C.inputBg,
              border: `1px solid ${kunde ? C.accent : C.panelBdr}`, borderRadius: 5,
              padding: '5px 8px', fontSize: 12, color: C.heading, outline: 'none',
            }}
          />
          {kundenListe && (
            <div style={{
              marginTop: 4, maxHeight: 180, overflowY: 'auto',
              border: `1px solid ${C.panelBdr}`, borderRadius: 5,
            }}>
              {kunden.filter(k => !kundenSuche
                  || k.company_name?.toLowerCase().includes(kundenSuche.toLowerCase()))
                .slice(0, 40).map(k => (
                  <div key={k.id} onMouseDown={() => { setKunde(k); setKundenSuche(''); setKundenListe(false); }}
                    style={{ padding: '5px 8px', fontSize: 12, cursor: 'pointer',
                             borderBottom: `1px solid ${C.pageBg}`, color: C.heading }}>
                    {k.company_name}{k.ort && <span style={{ color: C.muted }}> · {k.ort}</span>}
                  </div>
                ))}
            </div>
          )}
          <select value={steuerjahr} onChange={e => setSteuerjahr(Number(e.target.value))}
            style={{
              marginTop: 6, width: '100%', backgroundColor: C.inputBg,
              border: `1px solid ${C.panelBdr}`, borderRadius: 5,
              padding: '4px 6px', fontSize: 12, color: C.heading,
            }}>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)
              .map(j => <option key={j} value={j}>Steuerjahr {j}</option>)}
          </select>
        </div>

        {/* Bearbeitungsstand */}
        {belege.length > 0 && (
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.pageBg}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          fontSize: 11, color: C.sub, marginBottom: 5 }}>
              <span>Bearbeitungsstand</span>
              <span style={{ fontWeight: 700, color: C.heading }}>{fortschritt}%</span>
            </div>
            <div style={{ height: 4, backgroundColor: C.pageBg, borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${fortschritt}%`,
                            backgroundColor: C.accent, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>
              {geprueft} von {belege.length} Belegen geprüft
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                        letterSpacing: '.08em', padding: '0 6px 6px 6px' }}>Hauptformular</div>
          {ABSCHNITTE.map(a => (
            <NavEintrag key={a.seite} nummer={String(a.seite).padStart(2, '0')}
              label={a.label} anzahl={(proSeite.get(a.seite) || []).length}
              betrag={summe(proSeite.get(a.seite))}
              aktiv={abschnitt === a.seite} onClick={() => setAbschnitt(a.seite)} />
          ))}

          <div style={{ height: 10 }} />
          <NavEintrag nummer="?" label="Nicht zugeordnet" unter="Manuell prüfen"
            anzahl={ohne.length} farbe={C.offen}
            aktiv={abschnitt === -1} onClick={() => setAbschnitt(-1)} />
          {ABLAGEN.map(a => (
            <NavEintrag key={a.seite} nummer="–" label={a.label} unter={a.unter}
              anzahl={(proSeite.get(a.seite) || []).length} farbe={C.muted}
              aktiv={abschnitt === a.seite} onClick={() => setAbschnitt(a.seite)} />
          ))}
        </div>

        <div style={{ padding: 10, borderTop: `1px solid ${C.pageBg}`, display: 'grid', gap: 6 }}>
          <button onClick={speichern} disabled={!kunde || speichert || !belege.length}
            style={knopf(C, kunde && belege.length, C.accent)}>
            <Save size={12} /> {speichert ? 'speichert …' : 'Speichern'}
          </button>
          <button onClick={bundelHerunterladen} disabled={baut || !belege.some(b => b.position)}
            style={knopf(C, belege.some(b => b.position), C.heading)}>
            <Download size={12} /> {baut ? 'wird gebaut …' : 'Bündel als PDF'}
          </button>
          {gespeichertUm && (
            <div style={{ fontSize: 9, color: C.muted, textAlign: 'center' }}>
              gespeichert {gespeichertUm.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
          {!kunde && belege.length > 0 && (
            <div style={{ fontSize: 9, color: C.warn, textAlign: 'center' }}>
              ohne Mandant kein Speichern
            </div>
          )}
        </div>
      </div>

      <div onMouseDown={seiteZiehen} style={{
        width: 8, flexShrink: 0, cursor: 'col-resize', backgroundColor: C.pageBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRight: `1px solid ${C.panelBdr}`,
      }}>
        <div style={{ width: 3, height: 46, borderRadius: 2,
                      backgroundColor: ziehtGriff ? C.accent : C.panelBdr }} />
      </div>

      {/* ══ mitte: der gewählte Abschnitt ══ */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                    overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px 10px 18px', borderBottom: `1px solid ${C.panelBdr}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                            letterSpacing: '.08em' }}>
                {abschnitt >= 1 && abschnitt <= 4 ? `Seite ${abschnitt}` : 'Ablage'}
              </div>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: C.heading, margin: '2px 0 0 0' }}>
                {abschnittName(abschnitt)}
              </h1>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                {abschnitt === -1
                  ? `${ohne.length} ohne Zuordnung`
                  : `${(proSeite.get(abschnitt) || []).length} Belege` +
                    (abschnitt >= 1 && abschnitt <= 4
                      ? ` · Total CHF ${chf(summe(proSeite.get(abschnitt)))}` : '')}
              </div>
            </div>
            <button onClick={() => eingabe.current?.click()}
              style={{ ...knopf(C, true, C.accent), width: 'auto', padding: '6px 12px' }}>
              <Upload size={12} /> Belege hinzufügen
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5,
                            fontSize: 10, color: C.sub, cursor: 'pointer' }}>
              <input type="checkbox" checked={kiNutzen}
                     onChange={e => setKiNutzen(e.target.checked)} />
              KI für Unklares
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: C.muted }} />
              <input value={suche} onChange={e => setSuche(e.target.value)}
                placeholder="Belege durchsuchen …"
                style={{
                  width: '100%', boxSizing: 'border-box', backgroundColor: C.inputBg,
                  border: `1px solid ${C.panelBdr}`, borderRadius: 6,
                  padding: '5px 8px 5px 26px', fontSize: 12, color: C.heading, outline: 'none',
                }} />
            </div>
            {laeuft && (
              <span style={{ fontSize: 11, color: C.sub, display: 'flex',
                             alignItems: 'center', gap: 5 }}>
                <Loader2 size={12} className="animate-spin" /> liest ein
              </span>
            )}
            {belege.length > 0 && (
              <button onClick={() => { belege.forEach(b => b.url && URL.revokeObjectURL(b.url));
                                       setBelege([]); setGewaehlt(null); }}
                style={{ fontSize: 10, color: C.sub, background: 'none',
                         border: `1px solid ${C.panelBdr}`, borderRadius: 5,
                         padding: '3px 8px', cursor: 'pointer' }}>Leeren</button>
            )}
          </div>
        </div>

        {/* Ablagefläche + Inhalt */}
        <div
          onDragOver={e => { e.preventDefault(); if (!zieht) setUeber(true); }}
          onDragLeave={() => setUeber(false)}
          onDrop={e => {
            if (zieht) return;
            e.preventDefault(); setUeber(false); verarbeite(e.dataTransfer.files);
          }}
          style={{
            flex: 1, overflowY: 'auto', padding: 14,
            backgroundColor: ueber ? C.accentBg : 'transparent',
            outline: ueber ? `2px dashed ${C.accent}` : 'none', outlineOffset: -8,
          }}>
          <input ref={eingabe} type="file" multiple accept=".pdf,.png,.jpg,.jpeg"
            style={{ display: 'none' }}
            onChange={e => { verarbeite(e.target.files); e.target.value = ''; }} />

          {!belege.length && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted }}>
              <Upload size={26} style={{ color: C.accent, marginBottom: 8 }} />
              <div style={{ fontSize: 13, color: C.heading, fontWeight: 600 }}>
                Belegstapel hierher ziehen
              </div>
              <div style={{ fontSize: 11, marginTop: 3 }}>
                Gescannte Belege brauchen OCR – rechne mit ein paar Sekunden pro Seite
              </div>
            </div>
          )}

          {/* Nicht zugeordnet */}
          {abschnitt === -1 && ohne.map(b => (
            <BelegKarte key={b.id} beleg={b} aktiv={b.id === gewaehlt} onWaehlen={setGewaehlt}
              onDragStart={zieheAn(b.id)} onDragEnd={zieheAus} zieht={zieht === b.id} />
          ))}

          {/* Positionen des Abschnitts als Ablagestellen */}
          {abschnitt !== -1 && sichtbarePositionen.map(p => {
            const liste = proPosition.get(p.id) || [];
            return (
              <div key={p.id} {...zielProps(p.id)} style={{
                marginBottom: 10, borderRadius: 8,
                outline: ueberZiel === p.id ? `2px dashed ${C.accent}` : 'none',
                outlineOffset: 2, backgroundColor: ueberZiel === p.id ? C.accentBg : 'transparent',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 4px 5px 4px',
                  borderBottom: `1px solid ${C.panelBdr}`, marginBottom: 6,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600,
                                 color: liste.length ? C.heading : C.muted }}>{p.label}</span>
                  {p.dimensionen && (
                    <span style={{ fontSize: 10, color: C.muted }}>
                      {p.dimensionen.map(d => DIMENSIONEN[d]).join(' + ')}
                    </span>
                  )}
                  {liste.length > 0 && p.seite >= 1 && p.seite <= 4 && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600,
                                   color: C.sub }}>CHF {chf(summe(liste))}</span>
                  )}
                </div>
                {liste.map(b => (
                  <BelegKarte key={b.id} beleg={b} aktiv={b.id === gewaehlt} onWaehlen={setGewaehlt}
                    onDragStart={zieheAn(b.id)} onDragEnd={zieheAus} zieht={zieht === b.id} />
                ))}
                {!liste.length && (
                  <div style={{ fontSize: 10, color: C.muted, padding: '4px 6px 8px 6px' }}>
                    hierher ziehen
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ rechts: Beleg und erkannte Angaben ══ */}
      {/* Waehrend des Ziehens eine unsichtbare Flaeche ueber alles: sonst
          verschluckt das eingebettete PDF-Fenster die Mausbewegungen und der
          Zug bricht ab, sobald der Zeiger darueber kommt. */}
      {ziehtGriff && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          cursor: 'col-resize', userSelect: 'none',
        }} />
      )}

      <div onMouseDown={griffZiehen} style={{
        width: 10, flexShrink: 0, cursor: 'col-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: C.pageBg,
      }}>
        <div style={{ width: 3, height: 46, borderRadius: 2,
                      backgroundColor: ziehtGriff ? C.accent : C.panelBdr }} />
      </div>

      <Vorschau beleg={aktiverBeleg} breite={vorschauBreite}
                onAendern={aendere} onPosition={setzePosition} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════

function knopf(C, aktiv, farbe) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    width: '100%', fontSize: 11, fontWeight: 600,
    color: aktiv ? '#fff' : C.muted,
    backgroundColor: aktiv ? farbe : 'transparent',
    border: `1px solid ${aktiv ? farbe : C.panelBdr}`,
    borderRadius: 5, padding: '5px 10px',
    cursor: aktiv ? 'pointer' : 'default',
  };
}

function abschnittName(seite) {
  if (seite === -1) return 'Nicht zugeordnet';
  if (seite === 0)  return 'Arbeitspapiere';
  if (seite === 99) return 'Nicht benötigt';
  return GRUPPEN.find(g => g.seite === seite)?.label || '';
}

function NavEintrag({ nummer, label, unter, anzahl, betrag, aktiv, farbe, onClick }) {
  const C = useFarben();
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '7px 6px',
      borderRadius: 6, cursor: 'pointer', marginBottom: 2,
      backgroundColor: aktiv ? C.accentBg : 'transparent',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
        backgroundColor: aktiv ? C.accent : C.pageBg,
        color: aktiv ? '#fff' : (farbe || C.sub),
        fontSize: 10, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{nummer}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: aktiv ? 700 : 500,
                      color: farbe || C.heading }}>{label}</div>
        {(unter || betrag > 0) && (
          <div style={{ fontSize: 10, color: C.muted }}>
            {betrag > 0 ? `CHF ${chf(betrag)}` : unter}
          </div>
        )}
      </div>
      {anzahl > 0 && (
        <span style={{ fontSize: 10, color: C.sub, fontWeight: 600 }}>{anzahl}</span>
      )}
    </div>
  );
}

function BelegKarte({ beleg: b, aktiv, onWaehlen, onDragStart, onDragEnd, zieht }) {
  const C = useFarben();
  const laden = b.stand !== 'fertig' && b.stand !== 'fehler';
  const kuerzel = (BELEGART_BY_KEY[b.belegart]?.label || b.name || '??')
    .replace(/[^A-Za-zÄÖÜäöü]/g, '').slice(0, 2).toUpperCase();
  const pos = b.position ? KATALOG_NACH_ID[b.position] : null;

  return (
    <div draggable={!laden} onDragStart={!laden ? onDragStart : undefined} onDragEnd={onDragEnd}
      onClick={() => onWaehlen(b.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
        marginBottom: 5, borderRadius: 8, cursor: laden ? 'default' : 'grab',
        backgroundColor: aktiv ? C.accentBg : C.panelBg,
        border: `1px solid ${aktiv ? C.accent : C.panelBdr}`,
        opacity: zieht ? 0.4 : 1,
      }}>
      <div style={{
        width: 30, height: 34, borderRadius: 5, flexShrink: 0,
        backgroundColor: laden ? C.pageBg : C.accent, color: laden ? C.muted : '#fff',
        fontSize: 10, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {laden ? <Loader2 size={13} className="animate-spin" />
               : b.stand === 'fehler' ? <X size={13} /> : kuerzel}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.heading,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.name}
        </div>
        <div style={{ fontSize: 10, color: C.muted }}>
          {laden ? standText(b.stand)
                 : b.stand === 'fehler' ? b.fehler
                 : [BELEGART_BY_KEY[b.belegart]?.label, pos?.label].filter(Boolean).join(' · ')
                   || 'noch nicht zugeordnet'}
        </div>
      </div>

      {!laden && b.betrag > 0 && (
        <div style={{ fontSize: 12, fontWeight: 700, color: C.heading, flexShrink: 0 }}>
          CHF {chf(b.betrag)}
        </div>
      )}
      {!laden && b.confidence != null && (
        <div style={{ fontSize: 10, color: C.muted, flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: b.confidence >= 0.85 ? C.accent
                           : b.confidence >= 0.5 ? C.warn : C.offen,
          }} />
          {Math.round((b.confidence || 0) * 100)}% sicher
        </div>
      )}
      {!laden && <GripVertical size={13} style={{ color: C.muted, flexShrink: 0 }} />}
    </div>
  );
}

/**
 * Rechte Spalte: der Beleg selbst und was daraus erkannt wurde.
 *
 * Bewusst der eingebaute PDF-Betrachter des Browsers — damit lässt sich
 * blättern und zoomen. Bei einem 38-seitigen Umbaubündel ist die erste Seite
 * selten die, an der man entscheidet.
 */
function Vorschau({ beleg: b, breite, onAendern, onPosition }) {
  const C = useFarben();
  const rahmen = {
    width: breite, flexShrink: 0, flexGrow: 1, height: '100%', backgroundColor: C.panelBg,
    borderLeft: `1px solid ${C.panelBdr}`,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  if (!b) return (
    <div style={{ ...rahmen, alignItems: 'center', justifyContent: 'center' }}>
      <FileText size={26} style={{ color: C.muted, marginBottom: 8 }} />
      <div style={{ fontSize: 12, color: C.muted }}>Beleg anklicken für die Vorschau</div>
    </div>
  );

  const feld = {
    width: '100%', boxSizing: 'border-box', backgroundColor: C.inputBg,
    border: `1px solid ${C.panelBdr}`, borderRadius: 5,
    padding: '5px 8px', fontSize: 12, color: C.heading, outline: 'none',
  };

  return (
    <div style={rahmen}>
      <div style={{
        padding: '9px 12px', borderBottom: `1px solid ${C.panelBdr}`,
        fontSize: 12, fontWeight: 600, color: C.heading,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <FileText size={13} style={{ color: C.accent, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.name}
        </span>
        {b.url && (
          <a href={b.url} target="_blank" rel="noreferrer"
             style={{ marginLeft: 'auto', fontSize: 10, color: C.accent, flexShrink: 0 }}>
            neues Fenster
          </a>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, backgroundColor: C.pageBg }}>
        {!b.url ? (
          <div style={{ padding: 20, fontSize: 11, color: C.muted, textAlign: 'center' }}>
            Aus dem gespeicherten Stand geladen – die Datei liegt nicht mehr vor.<br />
            Denselben Beleg nochmals hineinziehen, dann erscheint er hier.
          </div>
        ) : b.istPdf ? (
          <iframe title={b.name} src={b.url} style={{ width: '100%', height: '100%', border: 'none' }} />
        ) : (
          <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
            <img src={b.url} alt={b.name} style={{ width: '100%' }} />
          </div>
        )}
      </div>

      {/* Erkannte Angaben */}
      <div style={{ borderTop: `1px solid ${C.panelBdr}`, padding: 12,
                    maxHeight: '42%', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.heading }}>Erkannte Angaben</span>
          {b.quelle && (
            <span style={{
              marginLeft: 'auto', fontSize: 9, color: C.sub,
              backgroundColor: C.accentBg, borderRadius: 3, padding: '1px 6px',
            }}>{b.quelle === 'ki' ? 'von der KI' : 'aus Regeln'}</span>
          )}
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={etikett(C)}>Betrag CHF</div>
            <input type="number" value={b.betrag ?? ''} placeholder="noch nicht ausgelesen"
              onChange={e => onAendern(b.id, { betrag: e.target.value, betragQuelle: 'hand' })} style={feld} />
          </div>
          <div>
            <div style={etikett(C)}>Steuerjahr</div>
            <input value={b.jahr ?? ''} onChange={e => onAendern(b.id, { jahr: e.target.value })}
              style={feld} />
          </div>
          <div>
            <div style={etikett(C)}>Zuordnung</div>
            <select value={b.position || ''} onChange={e => onPosition(b.id, e.target.value)}
              style={feld}>
              <option value="">— noch offen —</option>
              {[...KATALOG, AUSSORTIERT].map(p => (
                <option key={p.id} value={p.id}>S{p.seite} · {p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {b.begruendung && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
            {b.begruendung}
          </div>
        )}
        {b.offenGrund && (
          <Hinweis farbe={C.offen}>Entscheidet sich an: {b.offenGrund}</Hinweis>
        )}
        {b.position && KATALOG_NACH_ID[b.position]?.pruefen && (
          <Hinweis farbe={C.warn}>
            Fachlich zu prüfen: {KATALOG_NACH_ID[b.position].pruefen}
          </Hinweis>
        )}
        {b.vorschlag?.length > 1 && (
          <Hinweis farbe={C.sub}>
            Füllt zwei Positionen: {b.vorschlag.map(p => `S${p.seite} ${p.label}`).join(' · ')}
          </Hinweis>
        )}
        {b.ahv && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
            AHVN13 im Beleg gefunden – hilft später bei der Zuordnung zum Ehegatten
          </div>
        )}
      </div>
    </div>
  );
}

const etikett = C => ({ fontSize: 10, color: C.sub, marginBottom: 3 });

function Hinweis({ farbe, children }) {
  const C = useFarben();
  return (
    <div style={{ fontSize: 10, color: farbe, marginTop: 6,
                  display: 'flex', gap: 5, lineHeight: 1.5 }}>
      <AlertTriangle size={11} style={{ marginTop: 2, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

function standText(stand) {
  if (stand === 'wartet') return 'wartet …';
  if (stand === 'liest') return 'wird gelesen …';
  if (stand === 'ocr')   return 'Scan erkannt – OCR läuft, das dauert';
  if (stand === 'pdf')   return 'PDF-Text wird gelesen …';
  if (stand === 'ki')    return 'Regeln reichten nicht – KI wird gefragt …';
  return String(stand || '') + ' …';
}
