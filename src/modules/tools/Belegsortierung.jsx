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
  Download, GripVertical, Search, Save, ChevronDown, Maximize2,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

import { supabase } from '@/api/supabaseClient';
import { extractPageTexts, pdfSeiteAlsBild, pdfSeitenMiniaturen, fileToBase64 }
  from '../../lib/batchAiSuggest.js';
import { triageRegeln, triageMitKi, brauchtKi, istGesundheitsbeleg, betraegePerBild,
         positionWaehlen, ausschnittFuerKi }
  from '../../lib/steuerBelege/triage.js';
import { positionenFuer, offeneDimensionen } from '../../lib/steuerBelege/belegartZuPosition.js';
import { BELEGART_BY_KEY, BELEGARTEN } from '../../lib/steuerBelege/belegarten.js';
import { findAhvInText, dateiHash } from '../../lib/steuerBelege/belegHelfer.js';
import { findeSeiten } from '../../lib/steuerBelege/betrag.js';
import { trenneBelege, seitenLabel } from '../../lib/steuerBelege/belegTrennung.js';
import { findeDoppel } from '../../lib/steuerBelege/doppelErkennung.js';
import { KATALOG, KATALOG_NACH_ID, AUSSORTIERT, DIMENSIONEN, katalogFuerPrompt,
         VERZEICHNISSE, VERZEICHNIS_NACH_ID, migriereId }
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

// Die Seitenleiste zeigt die VERZEICHNISSE aus dem Katalog — die echten
// Stapel, in die sortiert wird. Arbeitspapiere und Aussortiertes stehen
// unten, getrennt vom Fachlichen.
const NAV_OBEN  = VERZEICHNISSE.filter(v => !['arbeitspapiere', 'aussortiert'].includes(v.id));
const NAV_UNTEN = VERZEICHNISSE.filter(v =>  ['arbeitspapiere', 'aussortiert'].includes(v.id));

// Beide Betragsseiten zur Position suchen. Der Katalog sagt, was gesucht
// wird — beim Lohnausweis der Nettolohn (Einkommen), bei der Bank Ertrag UND
// Steuerwert, beim Kaufvertrag nur der Wert (Vermögen).
function seitenFuer(positionId, text) {
  const p = positionId ? KATALOG_NACH_ID[positionId] : null;
  const leer = { einkommen: null, vermoegen: null, betragQuelle: null, betragAnker: null };
  if (!p || (!p.einkommen && !p.vermoegen) || !text) return leer;
  const t = findeSeiten(text, positionId);
  if (t.einkommen == null && t.vermoegen == null) return leer;
  return { einkommen: t.einkommen, vermoegen: t.vermoegen,
           betragQuelle: 'regel', betragAnker: t.anker };
}

// Bei diesen Positionen hiess das alte Feld `betrag` der Vermögensbestand
// (und `betrag2` der Ertrag/Zins) — bei allen übrigen war `betrag` die
// Einkommensseite. Nur für das Lesen gespeicherter Stände von vor dem Umbau.
const ALT_BETRAG_WAR_VERMOEGEN = new Set([
  'wertschriften', 'beteiligung_qualifiziert', 'krypto', 'liegenschaften',
  'schulden', 'bargeld', 'lebensversicherung', 'fahrzeuge', 'uebriges_vermoegen',
]);

// Gespeicherten Beleg auf die zwei Seiten heben: alte betrag/betrag2-Felder
// der Position entsprechend umhängen, und leere Seiten aus dem gespeicherten
// Text nachfüllen — Handeingaben bleiben unangetastet.
function migriereBetraege(b) {
  const position = migriereId(b.position);
  let { einkommen = null, vermoegen = null } = b;
  if (b.einkommen === undefined && b.vermoegen === undefined
      && (b.betrag != null || b.betrag2 != null)) {
    if (ALT_BETRAG_WAR_VERMOEGEN.has(position)) {
      vermoegen = b.betrag ?? null; einkommen = b.betrag2 ?? null;
    } else {
      einkommen = b.betrag ?? null; vermoegen = b.betrag2 ?? null;
    }
  }
  // Regel-Werte mit der HEUTIGEN Regel neu rechnen — die Anker sind seit dem
  // Speichern besser geworden (kumulierte «Gesamttotale» und OCR-Monsterzahlen
  // flogen raus). Was die heutige Regel nicht mehr findet, wird leer und
  // damit wieder Prüfarbeit statt falscher Zahl. Handeingaben bleiben stehen,
  // und per Bild-KI abgelesene Beträge auch — die Regel würde sie nur wieder
  // verlieren, gefunden hat sie sie ja schon damals nicht.
  if (b.betragQuelle !== 'hand' && b.betragQuelle !== 'ki' && b.text && position) {
    const p = KATALOG_NACH_ID[position];
    if (p?.einkommen || p?.vermoegen) {
      const t = findeSeiten(b.text, position);
      einkommen = p?.einkommen ? t.einkommen : einkommen;
      vermoegen = p?.vermoegen ? t.vermoegen : vermoegen;
    }
  }
  return { ...b, position, einkommen, vermoegen };
}

const chf = n => (n || n === 0)
  ? Number(n).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  : '—';

// Beim parallelen Einlesen entscheidet das Wettrennen, wer bei einem
// Doppel-Paar «Original» wird — liegt der Zweitscan vorn, sortiert er das
// echte Original aus und sitzt selbst zugeordnet in den Rubriken. Der
// Nachlauf macht es deterministisch: die alphabetisch frühere Datei ist das
// Original, die fachliche Erkennung wandert beim Tausch mit.
function konsolidiereDoppel(liste) {
  let geaendert = false;
  const neu = liste.map(b => ({ ...b }));
  const proId = new Map(neu.map(b => [b.id, b]));
  const FACH = ['position', 'belegart', 'confidence', 'begruendung', 'quelle',
    'vorschlag', 'kandidaten', 'offenGrund', 'hinweis', 'einkommen', 'vermoegen',
    'betragQuelle', 'betragAnker', 'jahr', 'merkmale', 'kiBegruendung',
    'widerspruch', 'regelBelegart', 'kiBelegart', 'vonHand', 'ahv'];
  for (const d of neu) {
    if (!d.doppelVon) continue;
    const o = proId.get(d.doppelVon);
    if (!o || o.doppelVon) continue;
    if ((o.name || '') > (d.name || '')) {
      geaendert = true;
      for (const f of FACH) { const t = d[f]; d[f] = o[f]; o[f] = t; }
      d.doppelVon = null;
      o.doppelVon = d.id;
      o.position = '_aussortiert';
      o.vonHand = false;
      o.begruendung = `Doppelt eingescannt – gleicht «${d.name}». `
                    + `Bleibt sichtbar liegen, kommt aber nicht ins Bündel.`;
    }
  }
  return geaendert ? neu : liste;
}

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
  const [abschnitt, setAbschnitt]   = useState('erwerb');
  // Vollbild-Durchsicht: null = zu, sonst { schritt: 1|2|3, index }
  const [durchsicht, setDurchsicht] = useState(null);
  // Seiten-Aufteilen-Dialog: null = zu, sonst { basisHash, dateiName, quelle,
  // dateiPfad, teile, arbeitet, fortschritt }
  const [aufteilen, setAufteilen] = useState(null);
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

  // «Leeren» merkt sich Mandant+Jahr: react-query holt den gespeicherten
  // Stand bei jedem Fokuswechsel neu, und ohne diese Notiz füllte der
  // Effekt die eben geleerte Liste gleich wieder auf.
  const geleertFuer = useRef(null);

  // Ein Wechsel von Mandant oder Jahr hebt die Notiz auf — wer zurückkommt,
  // will den gespeicherten Stand wieder sehen. (Läuft VOR dem Füll-Effekt.)
  useEffect(() => { geleertFuer.current = null; }, [kunde?.id, steuerjahr]);

  useEffect(() => {
    if (!gespeichert?.belege?.length) return;
    if (geleertFuer.current === `${kunde?.id}|${steuerjahr}`) return;
    setBelege(v => v.length ? v : gespeichert.belege.map((b, i) => ({
      // migriereBetraege hebt alte betrag/betrag2-Felder auf die zwei Seiten
      // und füllt Lücken aus dem gespeicherten Text nach
      ...migriereBetraege(b), id: `gespeichert-${i}-${b.hash}`,
      stand: 'fertig', ohneDatei: true,
    })));
  }, [gespeichert, kunde?.id, steuerjahr]);

  const belegeRef = useRef(belege);
  useEffect(() => { belegeRef.current = belege; }, [belege]);
  const kundeRef = useRef(kunde);
  useEffect(() => { kundeRef.current = kunde; }, [kunde]);

  // Solange hier gearbeitet wird, darf ein frisches Deployment die Seite
  // NICHT neu laden (siehe main.jsx onNeedRefresh) – sonst ist ein laufender
  // OCR-Stapel oder eine ungespeicherte Sortierung kommentarlos weg.
  useEffect(() => {
    const aktiv = (window.smartisArbeitAktiv ||= new Set());
    if (laeuft || belege.length) aktiv.add('Belegsortierung');
    else aktiv.delete('Belegsortierung');
    return () => aktiv.delete('Belegsortierung');
  }, [laeuft, belege.length]);

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

        // Original in die Ablage -- einmal je Inhalt. Ohne Mandant gibt es
        // keinen Zielordner; dann holt Speichern das spaeter nach.
        let dateiPfad = null;
        if (kundeRef.current?.id) {
          try { dateiPfad = await db.dateiHochladen(kundeRef.current.id, hash, datei); }
          catch (e) { console.warn('[Ablage] Hochladen fehlgeschlagen:', e.message); }
        }

        const bekannt = belegeRef.current.find(b => b.hash === hash && b.ohneDatei);
        if (bekannt) {
          setBelege(v => v.filter(b => b.id !== id).map(b => b.id === bekannt.id
            ? { ...b, datei, url, istPdf: /\.pdf$/i.test(datei.name),
                ohneDatei: false, name: datei.name, stand: 'fertig',
                dateiPfad: b.dateiPfad || dateiPfad }
            : b));
          return;
        }

        setBelege(v => v.map(b => b.id === id ? { ...b, stand: 'liest' } : b));

        // Text JE SEITE holen und das PDF in einzelne Belege zerlegen. Ein
        // gescanntes Buendel enthaelt selten einen Beleg -- der Umbau-Ordner
        // hat 38 Seiten und darauf 30 Verguetungsauftraege.
        const { seiten: seitenTexte, vertrauen } = await extractPageTexts(datei, {
          onStage: st => setBelege(v => v.map(b => b.id === id ? { ...b, stand: st } : b)),
        });
        const teile = trenneBelege(seitenTexte);

        setBelege(v => v.map(b => b.id === id
          ? { ...b, stand: 'trennt', teileGesamt: teile.length } : b));

        // Jeder Teil wird ein eigener Beleg. Die Datei bleibt dieselbe, nur
        // der Seitenbereich unterscheidet sie.
        const neueBelege = [];
        for (let i = 0; i < teile.length; i++) {
          const teil = teile[i];
          const teilName = teile.length > 1 ? `${datei.name} · ${seitenLabel(teil)}` : datei.name;

          // Doppelt eingescannt? Gleiches Papier, anderer Scan — der Datei-Hash
          // sieht das nicht, der erkannte Text schon. Gemessen: zwei Scans
          // derselben Seite ≈ 0.84 Uebereinstimmung, verschiedene Belege ≤ 0.11.
          const doppel = findeDoppel({ text: teil.text },
            [...belegeRef.current, ...neueBelege].filter(b => b.text && b.stand !== 'fehler'));

          // Gleicht der Teil einem GESPEICHERTEN Beleg ohne Datei, ist das
          // kein Doppel, sondern der alte Stand, der seine Datei wiederkriegt:
          // Datei anheften, Zuordnung und Beträge bleiben stehen. So heilt
          // «einmal neu hineinziehen» auch getrennte Bündel, bei denen die
          // Hash-Abkürzung oben nie greift.
          const alterStand = doppel
            && belegeRef.current.find(b => b.id === doppel.doppelVon && b.ohneDatei);
          if (alterStand) {
            setBelege(v => v.map(b => b.id === alterStand.id
              ? { ...b, datei, url, istPdf: /\.pdf$/i.test(datei.name),
                  ohneDatei: false, stand: 'fertig',
                  vonSeite: teil.von, bisSeite: teil.bis,
                  hash: `${hash}#${teil.von}-${teil.bis}`,
                  dateiPfad: b.dateiPfad || dateiPfad }
              : b));
            continue;
          }

          // Vermutete Doppel werden MARKIERT, nicht weggeworfen. Heute
          // zeigte sich in beiden Richtungen, wie unsicher der Textvergleich
          // ist: drei echte Quartalsrechnungen galten als Kopie, ein echter
          // Zweitscan blieb unerkannt. Ein still verschwundener Beleg ist der
          // teurere Fehler — also läuft die normale Erkennung weiter und der
          // Verdacht steht als Hinweis daneben, den der Mensch in Schritt 1
          // der Durchsicht mit einem Blick bestätigt.

          const eingang = {
            text: teil.text,
            dateiname: datei.name,
            parseMethode: 'ocr',
            dateiHash: `${hash}#${teil.von}-${teil.bis}`,
          };
          const kontext = { ...kontextBasis, bekannteHashes };

          // Wie sicher war die OCR über die Seiten dieses Teils? null heisst
          // digitale Textebene (perfekt); unter ~70 ist der Text löchrig.
          const vWerte = vertrauen.slice(teil.von - 1, teil.bis).filter(x => x != null);
          const teilVertrauen = vWerte.length
            ? Math.round(vWerte.reduce((s, x) => s + x, 0) / vWerte.length) : null;

          // Erste Seite des Teils als Bild — von mehreren Stellen gebraucht.
          const istPdf = /\.pdf$/i.test(datei.name);
          const bildTyp = istPdf ? 'image/jpeg' : (datei.type || 'image/jpeg');
          const bildVomTeil = () => istPdf
            ? pdfSeiteAlsBild(datei, teil.von)
            : /\.(jpe?g|png|webp|gif)$/i.test(datei.name)
              ? fileToBase64(datei) : Promise.resolve(null);

          let tri = triageRegeln(eingang, kontext);
          let bildDabei = false;
          if (kiNutzen && brauchtKi(tri)) {
            setBelege(v => v.map(b => b.id === id
              ? { ...b, stand: 'ki', teilNr: i + 1 } : b));
            // Bei Scans das Seitenbild GLEICH mitgeben: OCR-Text ist löchrig,
            // und ein Aufruf mit Bild trifft besser als zwei gestaffelte.
            // Krankheitsbelege nie — im Bild lässt sich nichts maskieren.
            let anfrage = eingang;
            if (teilVertrauen != null && !istGesundheitsbeleg({ text: teil.text })) {
              const bild = await bildVomTeil();
              if (bild) { anfrage = { ...eingang, bild, bildTyp }; bildDabei = true; }
            }
            tri = await triageMitKi(supabase, anfrage, kontext);
          }

          // Krankheits- und Behandlungsbelege gehen NIE als Bild raus —
          // im Bild lässt sich keine AHV-Nummer und keine Diagnose maskieren.
          const gesundheit = istGesundheitsbeleg({
            text: teil.text, belegart: tri.belegart,
            positionen: tri.positionen || [],
          });

          // Bild-Nachschlag, falls es noch keins gab: (a) weder Regeln noch
          // Text-KI erkennen den Teil — bei Handnotizen steht die Antwort im
          // Layout; (b) die OCR war so schwach, dass auch eine gefundene
          // Zuordnung auf Sand steht («Kontoauszug» aus Buchstabensalat).
          const unerkannt = !tri.belegart && !(tri.positionen || []).length;
          const ocrSchwach = teilVertrauen != null && teilVertrauen < 70
                          && tri.confidence < 0.85;
          if (kiNutzen && !gesundheit && !bildDabei && tri.grund !== 'duplikat'
              && (unerkannt || ocrSchwach)) {
            setBelege(v => v.map(b => b.id === id
              ? { ...b, stand: 'ki-bild', teilNr: i + 1 } : b));
            const bild = await bildVomTeil();
            if (bild) {
              tri = await triageMitKi(supabase, { ...eingang, bild, bildTyp }, kontext);
              bildDabei = true;
            }
          }
          bekannteHashes.push(eingang.dateiHash);

          const zuord = tri.belegart ? positionenFuer(tri.belegart) : { positionen: [], offen: true };
          const kiPos = (tri.positionen || []).map(x => KATALOG_NACH_ID[x]).filter(Boolean);
          const vorschlag = kiPos.length ? kiPos : (zuord.positionen || []);
          let position = tri.grund === 'duplikat' ? '_aussortiert'
                       : (vorschlag.length === 1 ? vorschlag[0].id : null);

          // Bei Widerspruch (Regeln und KI beide sicher, aber uneins) wird
          // NICHTS automatisch zugeordnet — der Beleg geht mit beiden
          // Sichten in die Handprüfung.
          if (tri.widerspruch) position = null;

          // Wahl-Stufe: Belegart erkannt, aber MEHRERE mögliche Ziele
          // (Kontoauszug → Wertschriften oder Schulden; Rente → AHV, PK oder
          // Säule 3). Die Regeln sind sich hier ihrer Sache sicher, darum kam
          // die KI bisher nie dran — und der Beleg blieb liegen. Genau diese
          // eine Entscheidungsfrage stellen, mehr nicht.
          // Kandidaten: aus der Belegart, sonst die von der KI selbst genannten
          // — sonst bliebe ein treffend beschriebener Beleg ohne Ziel liegen.
          const kiKand = (tri.kiKandidaten || []).map(x => KATALOG_NACH_ID[x]).filter(Boolean);
          const kandidatenListe = vorschlag.length >= 2 ? vorschlag
            : (zuord.kandidaten?.length ? zuord.kandidaten : kiKand);
          if (!position && kiNutzen && tri.grund !== 'duplikat' && !tri.widerspruch
              && kandidatenListe.length >= 2) {
            setBelege(v => v.map(b => b.id === id
              ? { ...b, stand: 'ki-wahl', teilNr: i + 1 } : b));
            try {
              const bilder = [];
              if (!gesundheit && teilVertrauen != null) {
                const bild = await bildVomTeil();
                if (bild) bilder.push(bild);
              }
              const wahl = await positionWaehlen(supabase, {
                text: ausschnittFuerKi(teil.text),
                dateiname: datei.name, periode: kontextBasis.periode,
                belegart: tri.belegart,
                kriterium: zuord.grund || '',
                kandidaten: kandidatenListe, bilder, bildTyp,
              });
              if (wahl.position && wahl.confidence >= 0.5
                  && kandidatenListe.some(k => k.id === wahl.position)) {
                position = wahl.position;
                tri = { ...tri, quelle: 'ki',
                  begruendung: `${tri.begruendung} · KI-Wahl: ${wahl.begruendung}`,
                  kiBegruendung: `${tri.kiBegruendung ? tri.kiBegruendung + ' · ' : ''}Wahl: ${wahl.begruendung}` };
              }
            } catch (e) { console.warn('[KI-Wahl]', e.message); }
          }

          // Beträge: erst die Anker im Text; lässt der OCR-Text eine Seite
          // leer, die der Katalog erwartet, die betroffenen Seiten als Bild
          // gezielt nachfragen (abgelesen, nicht gerechnet).
          let seiten = seitenFuer(position, teil.text);
          const posDef = position ? KATALOG_NACH_ID[position] : null;
          const fehltE = posDef?.einkommen && seiten.einkommen == null;
          const fehltV = posDef?.vermoegen && seiten.vermoegen == null;
          if (kiNutzen && !gesundheit && (fehltE || fehltV)
              && /\.pdf$/i.test(datei.name)) {
            setBelege(v => v.map(b => b.id === id
              ? { ...b, stand: 'ki-betrag', teilNr: i + 1 } : b));
            try {
              const bilder = [];
              for (let s = teil.von; s <= Math.min(teil.bis, teil.von + 2); s++) {
                const bild = await pdfSeiteAlsBild(datei, s);
                if (bild) bilder.push(bild);
              }
              if (bilder.length) {
                const r = await betraegePerBild(supabase, {
                  bilder,
                  einkommenLabel: fehltE ? posDef.einkommen : null,
                  vermoegenLabel: fehltV ? posDef.vermoegen : null,
                  dateiname: datei.name, periode: kontextBasis.periode,
                });
                if (fehltE && r.einkommen != null) seiten.einkommen = r.einkommen;
                if (fehltV && r.vermoegen != null) seiten.vermoegen = r.vermoegen;
                if (r.einkommen != null || r.vermoegen != null) {
                  seiten = { ...seiten, betragQuelle: 'ki',
                    betragAnker: `KI (Bild): ${r.begruendung || 'abgelesen'}` };
                }
              }
            } catch (e) { console.warn('[Betrag per Bild]', e.message); }
          }

          neueBelege.push({
            id: `${id}#${teil.von}`,
            name: teilName,
            stand: 'fertig',
            groesse: datei.size, url, datei,
            istPdf: /\.pdf$/i.test(datei.name),
            hash: eingang.dateiHash, dateiPfad,
            vonSeite: teil.von, bisSeite: teil.bis,
            trennGrund: teil.grund,
            text: teil.text,
            ocrVertrauen: teilVertrauen,
            doppelVerdacht: doppel
              ? { name: doppel.name, score: doppel.score } : null,
            belegart: tri.belegart, confidence: tri.confidence,
            begruendung: tri.begruendung, quelle: tri.quelle || 'regel',
            merkmale: tri.merkmale || [], kiBegruendung: tri.kiBegruendung || null,
            widerspruch: !!tri.widerspruch,
            regelBelegart: tri.regelBelegart || null, kiBelegart: tri.kiBelegart || null,
            vorschlag, kandidaten: (zuord.kandidaten?.length ? zuord.kandidaten : kiKand),
            offenGrund: kiPos.length ? null : (zuord.offen ? zuord.grund : null),
            hinweis: zuord.hinweis || null,
            position,
            ahv: findAhvInText(teil.text),
            jahr: tri.periodeBeleg ?? null,
            ...seiten,
          });
        }

        // Platzhalter durch die Teilbelege ersetzen
        setBelege(v => {
          const i = v.findIndex(b => b.id === id);
          if (i < 0) return v;
          return [...v.slice(0, i), ...neueBelege, ...v.slice(i + 1)];
        });
        setGewaehlt(g => (g === id ? neueBelege[0]?.id ?? null : g));
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

    // Nachlauf: Doppel-Paare deterministisch ausrichten (Original = die
    // alphabetisch frühere Datei), egal in welcher Reihenfolge sie fertig
    // wurden.
    setBelege(v => konsolidiereDoppel(v));
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
            ...(b.betragQuelle === 'hand' ? {} : seitenFuer(positionId, b.text)) }
        : b);
      const naechster = neu.find(b => b.id !== id && b.stand === 'fertig' && !b.position);
      queueMicrotask(() => setGewaehlt(naechster ? naechster.id : id));
      return neu;
    });
  }

  // ── Manuelles Nacherkennen ──────────────────────────────────────────────

  // Ein Seitenbereich durch die Erkennungs-Pipeline (Regeln → KI mit Bild →
  // Wahl-Stufe → Beträge). Gleiches Verhalten wie beim Einlesen.
  async function erkenneNeu({ datei, dateiName, basisHash, dateiPfad, von, bis,
                              seitenTexte, vertrauenWerte, urlAlt }) {
    const text = seitenTexte.join('\n');
    const eingang = { text, dateiname: dateiName, parseMethode: 'ocr',
                      dateiHash: `${basisHash}#${von}-${bis}` };
    const kontext = {
      katalog: katalogFuerPrompt(),
      belegarten: BELEGARTEN.map(x => `${x.key} = ${x.label}`).join('\n'),
      periode: Number(steuerjahr) || null, bekannteHashes: [],
    };
    const vWerte = (vertrauenWerte || []).filter(x => x != null);
    const teilVertrauen = vWerte.length
      ? Math.round(vWerte.reduce((s, x) => s + x, 0) / vWerte.length) : null;

    let tri = triageRegeln(eingang, kontext);
    if (kiNutzen && brauchtKi(tri)) {
      let anfrage = eingang;
      if (datei && !istGesundheitsbeleg({ text })) {
        const bild = await pdfSeiteAlsBild(datei, von);
        if (bild) anfrage = { ...eingang, bild, bildTyp: 'image/jpeg' };
      }
      tri = await triageMitKi(supabase, anfrage, kontext);
    }
    const gesundheit = istGesundheitsbeleg({
      text, belegart: tri.belegart, positionen: tri.positionen || [] });

    const zuord = tri.belegart ? positionenFuer(tri.belegart) : { positionen: [], offen: true };
    const kiPos = (tri.positionen || []).map(x => KATALOG_NACH_ID[x]).filter(Boolean);
    const vorschlag = kiPos.length ? kiPos : (zuord.positionen || []);
    let position = vorschlag.length === 1 ? vorschlag[0].id : null;
    if (tri.widerspruch) position = null;

    const kiKand = (tri.kiKandidaten || []).map(x => KATALOG_NACH_ID[x]).filter(Boolean);
    const kandidatenListe = vorschlag.length >= 2 ? vorschlag
      : (zuord.kandidaten?.length ? zuord.kandidaten : kiKand);
    if (!position && kiNutzen && !tri.widerspruch && kandidatenListe.length >= 2) {
      try {
        const bilder = [];
        if (!gesundheit && datei) {
          const bild = await pdfSeiteAlsBild(datei, von);
          if (bild) bilder.push(bild);
        }
        const wahl = await positionWaehlen(supabase, {
          text: ausschnittFuerKi(text), dateiname: dateiName,
          periode: Number(steuerjahr) || null, belegart: tri.belegart,
          kriterium: zuord.grund || '', kandidaten: kandidatenListe, bilder,
        });
        if (wahl.position && wahl.confidence >= 0.5
            && kandidatenListe.some(k => k.id === wahl.position)) {
          position = wahl.position;
          tri = { ...tri, quelle: 'ki',
            kiBegruendung: `${tri.kiBegruendung ? tri.kiBegruendung + ' · ' : ''}Wahl: ${wahl.begruendung}` };
        }
      } catch (e) { console.warn('[KI-Wahl]', e.message); }
    }

    let seiten = seitenFuer(position, text);
    const posDef = position ? KATALOG_NACH_ID[position] : null;
    const fehltE = posDef?.einkommen && seiten.einkommen == null;
    const fehltV = posDef?.vermoegen && seiten.vermoegen == null;
    if (kiNutzen && !gesundheit && (fehltE || fehltV) && datei) {
      try {
        const bilder = [];
        for (let s = von; s <= Math.min(bis, von + 2); s++) {
          const bild = await pdfSeiteAlsBild(datei, s);
          if (bild) bilder.push(bild);
        }
        if (bilder.length) {
          const r = await betraegePerBild(supabase, {
            bilder,
            einkommenLabel: fehltE ? posDef.einkommen : null,
            vermoegenLabel: fehltV ? posDef.vermoegen : null,
            dateiname: dateiName, periode: Number(steuerjahr) || null,
          });
          if (fehltE && r.einkommen != null) seiten.einkommen = r.einkommen;
          if (fehltV && r.vermoegen != null) seiten.vermoegen = r.vermoegen;
          if (r.einkommen != null || r.vermoegen != null)
            seiten = { ...seiten, betragQuelle: 'ki' };
        }
      } catch (e) { console.warn('[Betrag per Bild]', e.message); }
    }

    return {
      id: `hand-${basisHash.slice(0, 8)}-${von}-${bis}-${Math.random().toString(36).slice(2, 7)}`,
      name: bis > von ? `${dateiName} · Seiten ${von}–${bis}` : `${dateiName} · Seite ${von}`,
      stand: 'fertig', groesse: null, url: urlAlt || null,
      datei: datei && datei.name ? datei : undefined, istPdf: true,
      hash: `${basisHash}#${von}-${bis}`, dateiPfad: dateiPfad || null,
      vonSeite: von, bisSeite: bis, trennGrund: 'von Hand',
      text, ocrVertrauen: teilVertrauen,
      belegart: tri.belegart, confidence: tri.confidence,
      begruendung: tri.begruendung, quelle: tri.quelle || 'regel',
      merkmale: tri.merkmale || [], kiBegruendung: tri.kiBegruendung || null,
      widerspruch: !!tri.widerspruch,
      regelBelegart: tri.regelBelegart || null, kiBelegart: tri.kiBelegart || null,
      vorschlag, kandidaten: (zuord.kandidaten?.length ? zuord.kandidaten : kiKand),
      offenGrund: kiPos.length ? null : (zuord.offen ? zuord.grund : null),
      hinweis: zuord.hinweis || null, position,
      ahv: findAhvInText(text), jahr: tri.periodeBeleg ?? null,
      ...seiten,
    };
  }

  // ── Seiten aufteilen: Übersicht statt Seitenzahlen tippen ──────────────
  //
  // Alle Seiten der Datei als Miniaturen, Trennstellen per Klick setzen und
  // entfernen, EINMAL übernehmen. Bereiche, deren Grenzen sich nicht ändern,
  // behalten ihren Beleg samt Zuordnung und Beträgen — nur die geänderten
  // werden neu gelesen und erkannt.

  // Alle eingelesenen Dateien mit ihren Belegen — die Auswahlliste des Editors.
  const dateiListe = useMemo(() => {
    const proDatei = new Map();
    for (const b of belege) {
      if (b.stand !== 'fertig') continue;
      const basis = String(b.hash || '').split('#')[0];
      if (!basis) continue;
      const istPdf = b.istPdf || /\.pdf($|\?)/i.test(b.dateiPfad || '') || /\.pdf$/i.test(b.name || '');
      if (!istPdf || !(b.datei || b.dateiPfad)) continue;
      if (!proDatei.has(basis)) {
        proDatei.set(basis, { basis, name: (b.name || '').split(' · ')[0] || b.name,
                              vertreter: b, teile: 0, seiten: 0 });
      }
      const e = proDatei.get(basis);
      e.teile += 1;
      e.seiten = Math.max(e.seiten, b.bisSeite || b.vonSeite || 1);
    }
    return [...proDatei.values()].sort((a, z) => a.name.localeCompare(z.name));
  }, [belege]);

  async function oeffneAufteilen(b) {
    b = b || dateiListe[0]?.vertreter;
    if (!b) return;
    const basis = String(b.hash || '').split('#')[0];
    if (!basis) return;
    let quelle = b.datei || null;
    if (!quelle && b.dateiPfad) {
      try { quelle = await db.dateiLaden(b.dateiPfad); }
      catch (e) { console.warn('[Aufteilen] Datei nicht ladbar:', e.message); return; }
    }
    if (!quelle) return;
    const teile = belegeRef.current
      .filter(x => x.stand === 'fertig' && String(x.hash || '').split('#')[0] === basis)
      .map(x => ({ von: x.vonSeite || 1, bis: x.bisSeite || x.vonSeite || 1 }))
      .sort((a, z) => a.von - z.von);
    if (!teile.length) return;
    setAufteilen({ basisHash: basis, dateiName: (b.name || '').split(' · ')[0] || b.name,
                   quelle, dateiPfad: b.dateiPfad || null, teile,
                   arbeitet: false, fortschritt: '' });
  }

  async function wendeAufteilungAn(neueBereiche) {
    const a = aufteilen;
    if (!a || a.arbeitet) return;
    setAufteilen(x => ({ ...x, arbeitet: true, fortschritt: 'liest geänderte Seiten …' }));
    try {
      const alte = belegeRef.current.filter(x => x.stand === 'fertig'
        && String(x.hash || '').split('#')[0] === a.basisHash);
      const nachRange = new Map(alte.map(x =>
        [`${x.vonSeite || 1}-${x.bisSeite || x.vonSeite || 1}`, x]));

      const behalten = [], frisch = [];
      for (const r of neueBereiche) {
        const alt = nachRange.get(`${r.von}-${r.bis}`);
        if (alt) behalten.push(alt); else frisch.push(r);
      }

      const neue = [];
      if (frisch.length) {
        const minS = Math.min(...frisch.map(r => r.von));
        const maxS = Math.max(...frisch.map(r => r.bis));
        const { seiten, vertrauen } = await extractPageTexts(a.quelle,
          { vonSeite: minS, maxPages: maxS });
        for (let i = 0; i < frisch.length; i++) {
          const r = frisch[i];
          setAufteilen(x => x && ({ ...x,
            fortschritt: `erkennt Bereich ${i + 1} von ${frisch.length} (Seiten ${r.von}–${r.bis}) …` }));
          neue.push(await erkenneNeu({
            datei: a.quelle, dateiName: a.dateiName, basisHash: a.basisHash,
            dateiPfad: a.dateiPfad, von: r.von, bis: r.bis,
            seitenTexte: seiten.slice(r.von - minS, r.bis - minS + 1),
            vertrauenWerte: vertrauen.slice(r.von - minS, r.bis - minS + 1),
            urlAlt: alte[0]?.url || null,
          }));
        }
      }

      const zusammen = [...behalten, ...neue]
        .sort((x, z) => (x.vonSeite || 1) - (z.vonSeite || 1));
      setBelege(v => {
        const erste = v.findIndex(x => alte.some(al => al.id === x.id));
        const rest = v.filter(x => !alte.some(al => al.id === x.id));
        const stelle = erste < 0 ? rest.length : Math.min(erste, rest.length);
        return [...rest.slice(0, stelle), ...zusammen, ...rest.slice(stelle)];
      });
      setGewaehlt(zusammen[0]?.id ?? null);
      setAufteilen(null);
    } catch (e) {
      console.warn('[Aufteilen]', e);
      setAufteilen(x => x && ({ ...x, arbeitet: false, fortschritt: `Fehler: ${e.message}` }));
    }
  }

  async function speichern() {
    if (!kunde?.id) return;
    setSpeichert(true);
    try {
      // Dateien, die vor der Mandantenwahl eingelesen wurden, jetzt ablegen
      const mitPfad = belege.map(b => ({ ...b }));
      for (const b of mitPfad) {
        if (b.datei && !b.dateiPfad && b.hash) {
          const basisHash = String(b.hash).split('#')[0];
          try { b.dateiPfad = await db.dateiHochladen(kunde.id, basisHash, b.datei); }
          catch { /* Anzeige bleibt dann sitzungsgebunden */ }
        }
      }
      setBelege(v => v.map(x => mitPfad.find(m => m.id === x.id) || x));
      await db.upsert(kunde.id, steuerjahr, mitPfad);
      setGespeichertUm(new Date());
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e.message || e));
    } finally { setSpeichert(false); }
  }

  async function bundelHerunterladen() {
    setBaut(true);
    try {
      // Nach einem Neuladen fehlen die File-Objekte -- aus der Ablage holen,
      // einmal je Datei (mehrere Teilbelege teilen sich dieselbe).
      const dateiCache = new Map();
      const fuersBundle = [];
      for (const b of belege.filter(x => x.position)) {
        if (b.datei || !b.dateiPfad) { fuersBundle.push(b); continue; }
        try {
          if (!dateiCache.has(b.dateiPfad)) {
            const blob = await db.dateiLaden(b.dateiPfad);
            dateiCache.set(b.dateiPfad, new File([blob], b.name || 'beleg.pdf',
              { type: blob.type || 'application/pdf' }));
          }
          fuersBundle.push({ ...b, datei: dateiCache.get(b.dateiPfad) });
        } catch { fuersBundle.push(b); }
      }
      const bytes = await baueBeilagenBundle(fuersBundle, {
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
  const { proVerz, proPosition, ohne } = useMemo(() => {
    const proVerz = new Map(), proPosition = new Map(), ohne = [];
    for (const b of belege) {
      const p = b.position ? KATALOG_NACH_ID[b.position] : null;
      if (!p) { ohne.push(b); continue; }
      if (!proVerz.has(p.verzeichnis)) proVerz.set(p.verzeichnis, []);
      proVerz.get(p.verzeichnis).push(b);
      if (!proPosition.has(p.id)) proPosition.set(p.id, []);
      proPosition.get(p.id).push(b);
    }
    return { proVerz, proPosition, ohne };
  }, [belege]);

  // Drei Summen je Liste: Einkünfte und Abzüge (Einkommensseite, getrennt
  // nach Wirkung der Position) und Vermögen. So trägt jedes Verzeichnis
  // seine Zeilen der Erklärung schon fertig zusammen.
  const summen = liste => (liste || []).reduce((s, b) => {
    const p = b.position ? KATALOG_NACH_ID[b.position] : null;
    const e = parseFloat(b.einkommen) || 0;
    if (p?.wirkung === 'abzug') s.abzug += e; else s.einkunft += e;
    s.vermoegen += parseFloat(b.vermoegen) || 0;
    return s;
  }, { einkunft: 0, abzug: 0, vermoegen: 0 });

  const geprueft = belege.filter(b =>
    b.position && (b.vonHand || b.einkommen != null || b.vermoegen != null)).length;
  const fortschritt = belege.length ? Math.round(geprueft / belege.length * 100) : 0;

  // Gesamtzeile über alles — die Erklärung im Kleinformat. Schulden zählen
  // nicht zum Vermögen, sie stehen als eigener Posten daneben.
  const total = useMemo(() => {
    const t = { einkunft: 0, abzug: 0, vermoegen: 0, schulden: 0 };
    for (const b of belege) {
      const p = b.position ? KATALOG_NACH_ID[b.position] : null;
      if (!p || p.verzeichnis === 'aussortiert') continue;
      const e = parseFloat(b.einkommen) || 0;
      if (p.wirkung === 'abzug') t.abzug += e; else t.einkunft += e;
      const v = parseFloat(b.vermoegen) || 0;
      if (p.verzeichnis === 'schulden') t.schulden += v; else t.vermoegen += v;
    }
    return t;
  }, [belege]);

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
    const alle = [...KATALOG, AUSSORTIERT].filter(p => p.verzeichnis === abschnitt);
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

  // Aus dem gespeicherten Stand geladen und Datei nicht zur Hand? Aus der
  // Ablage holen -- erst beim Anklicken, nicht fuer alle 50 auf Vorrat.
  useEffect(() => {
    const b = belege.find(x => x.id === gewaehlt);
    if (!b || b.url || !b.dateiPfad) return;
    let aktivFlag = true;
    db.dateiUrl(b.dateiPfad)
      .then(url => { if (aktivFlag) aendere(b.id, {
        url, istPdf: /\.(pdf)(\?|$)/i.test(b.dateiPfad) || /\.pdf$/i.test(b.dateiPfad),
        ausAblage: true }); })
      .catch(e => console.warn('[Ablage] Vorschau nicht ladbar:', e.message));
    return () => { aktivFlag = false; };
  }, [gewaehlt, belege]);

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
          <div style={{ position: 'relative' }}>
          <input
            value={kunde ? (kunde.company_name || '') : kundenSuche}
            onChange={e => { setKundenSuche(e.target.value); setKunde(null); }}
            onFocus={() => setKundenListe(true)}
            onBlur={() => setTimeout(() => setKundenListe(false), 180)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { setKundenListe(true); return; }
              if (e.key === 'Enter') {
                const treffer = kunden.filter(k => !kundenSuche
                  || k.company_name?.toLowerCase().includes(kundenSuche.toLowerCase()));
                if (treffer.length) { setKunde(treffer[0]); setKundenSuche(''); setKundenListe(false); }
              }
              if (e.key === 'Escape') setKundenListe(false);
            }}
            placeholder="anklicken oder tippen …"
            style={{
              width: '100%', boxSizing: 'border-box', backgroundColor: C.inputBg,
              border: `1px solid ${kunde ? C.accent : C.panelBdr}`, borderRadius: 5,
              padding: '5px 24px 5px 8px', fontSize: 12, color: C.heading, outline: 'none',
            }}
          />
          <ChevronDown size={14} onMouseDown={e => { e.preventDefault(); setKundenListe(o => !o); }}
            style={{ position: 'absolute', right: 7, top: 8, color: C.muted, cursor: 'pointer' }} />
          </div>
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
            {/* Die Erklärung im Kleinformat: beide Dimensionen auf einen Blick */}
            {(total.einkunft > 0 || total.abzug > 0 || total.vermoegen > 0 || total.schulden > 0) && (
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr',
                            gap: '3px 10px', fontSize: 10 }}>
                <span style={{ color: C.muted }}>Einkünfte</span>
                <span style={{ color: C.heading, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {total.einkunft > 0 ? chf(total.einkunft) : '—'}</span>
                <span style={{ color: C.muted }}>Abzüge</span>
                <span style={{ color: C.heading, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {total.abzug > 0 ? chf(total.abzug) : '—'}</span>
                <span style={{ color: C.muted }}>Vermögen</span>
                <span style={{ color: C.heading, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {total.vermoegen > 0 ? chf(total.vermoegen) : '—'}</span>
                <span style={{ color: C.muted }}>Schulden</span>
                <span style={{ color: C.heading, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {total.schulden > 0 ? chf(total.schulden) : '—'}</span>
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                        letterSpacing: '.08em', padding: '0 6px 6px 6px' }}>Verzeichnisse</div>
          {NAV_OBEN.map((v, i) => (
            <NavEintrag key={v.id} nummer={String(i + 1).padStart(2, '0')}
              label={v.label} unter={v.unter}
              anzahl={(proVerz.get(v.id) || []).length}
              summen={summen(proVerz.get(v.id))} istSchulden={v.id === 'schulden'}
              aktiv={abschnitt === v.id} onClick={() => setAbschnitt(v.id)} />
          ))}

          <div style={{ height: 10 }} />
          <NavEintrag nummer="?" label="Nicht zugeordnet" unter="Manuell prüfen"
            anzahl={ohne.length} farbe={C.offen}
            aktiv={abschnitt === 'ohne'} onClick={() => setAbschnitt('ohne')} />
          {NAV_UNTEN.map(v => (
            <NavEintrag key={v.id} nummer="–" label={v.label} unter={v.unter}
              anzahl={(proVerz.get(v.id) || []).length} farbe={C.muted}
              aktiv={abschnitt === v.id} onClick={() => setAbschnitt(v.id)} />
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
                {VERZEICHNIS_NACH_ID[abschnitt]?.fuehrung
                  ? `geführt je ${DIMENSIONEN[VERZEICHNIS_NACH_ID[abschnitt].fuehrung] || VERZEICHNIS_NACH_ID[abschnitt].fuehrung}`
                  : 'Verzeichnis'}
              </div>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: C.heading, margin: '2px 0 0 0' }}>
                {abschnittName(abschnitt)}
              </h1>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                {abschnitt === 'ohne'
                  ? `${ohne.length} ohne Zuordnung`
                  : (() => {
                      const s = summen(proVerz.get(abschnitt));
                      const teile = [`${(proVerz.get(abschnitt) || []).length} Belege`];
                      if (s.einkunft > 0)  teile.push(`Einkünfte CHF ${chf(s.einkunft)}`);
                      if (s.abzug > 0)     teile.push(`Abzüge CHF ${chf(s.abzug)}`);
                      if (s.vermoegen > 0) teile.push(`${abschnitt === 'schulden'
                        ? 'Schulden' : 'Vermögen'} CHF ${chf(s.vermoegen)}`);
                      if (VERZEICHNIS_NACH_ID[abschnitt]?.speist)
                        teile.push(`speist ${VERZEICHNIS_NACH_ID[abschnitt].speist}`);
                      return teile.join(' · ');
                    })()}
              </div>
            </div>
            <button onClick={() => eingabe.current?.click()}
              style={{ ...knopf(C, true, C.accent), width: 'auto', padding: '6px 12px' }}>
              <Upload size={12} /> Belege hinzufügen
            </button>
            {dateiListe.length > 0 && (
              <button onClick={() => oeffneAufteilen(null)}
                style={{ ...knopf(C, true, C.heading), width: 'auto', padding: '6px 12px' }}>
                <GripVertical size={12} /> Aufteilen
              </button>
            )}
            {belege.some(b => b.stand === 'fertig') && (
              <button onClick={() => setDurchsicht({ schritt: 1, index: 0 })}
                style={{ ...knopf(C, true, C.heading), width: 'auto', padding: '6px 12px' }}>
                <Maximize2 size={12} /> Durchsicht
              </button>
            )}
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
                                       geleertFuer.current = `${kunde?.id}|${steuerjahr}`;
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
          {abschnitt === 'ohne' && ohne.map(b => (
            <BelegKarte key={b.id} beleg={b} aktiv={b.id === gewaehlt} onWaehlen={setGewaehlt}
              onDragStart={zieheAn(b.id)} onDragEnd={zieheAus} zieht={zieht === b.id} />
          ))}

          {/* Positionen des Abschnitts als Ablagestellen */}
          {abschnitt !== 'ohne' && sichtbarePositionen.map(p => {
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
                  {liste.length > 0 && (p.einkommen || p.vermoegen) && (() => {
                    const s = summen(liste);
                    const haupt = p.wirkung === 'abzug' || p.einkommen == null
                      ? (s.abzug || s.einkunft || s.vermoegen)
                      : (s.einkunft || s.abzug || s.vermoegen);
                    const neben = p.einkommen && p.vermoegen && s.vermoegen > 0
                      && haupt !== s.vermoegen ? s.vermoegen : 0;
                    if (!haupt) return null;
                    return (
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: C.sub }}>
                        CHF {chf(haupt)}
                        {neben > 0 && (
                          <span style={{ color: C.muted, fontWeight: 400 }}>
                            {' '}· Verm. {chf(neben)}
                          </span>
                        )}
                      </span>
                    );
                  })()}
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

      <Vorschau beleg={aktiverBeleg} breite={vorschauBreite} steuerjahr={steuerjahr}
                onAendern={aendere} onPosition={setzePosition}
                onAufteilen={oeffneAufteilen} />

      {durchsicht && (
        <Durchsicht belege={belege} C={C}
          schritt={durchsicht.schritt} index={durchsicht.index}
          setDurchsicht={setDurchsicht}
          onAendern={aendere} onPosition={setzePosition}
          onAufteilen={oeffneAufteilen} onWaehlen={setGewaehlt} />
      )}

      {aufteilen && (
        <AufteilenDialog auftrag={aufteilen} C={C} dateien={dateiListe}
          onDateiWechsel={oeffneAufteilen}
          onUebernehmen={wendeAufteilungAn}
          onSchliessen={() => { if (!aufteilen.arbeitet) setAufteilen(null); }} />
      )}
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

function abschnittName(id) {
  if (id === 'ohne') return 'Nicht zugeordnet';
  return VERZEICHNIS_NACH_ID[id]?.label || '';
}

function NavEintrag({ nummer, label, unter, anzahl, summen, istSchulden, aktiv, farbe, onClick }) {
  const C = useFarben();
  // Kompakte Summenzeile des Verzeichnisses: Einkommensseite zuerst, das
  // Vermögen läuft nebenher mit — leere Seiten erscheinen gar nicht.
  const teile = [];
  if (summen?.einkunft > 0) teile.push(`CHF ${chf(summen.einkunft)}`);
  if (summen?.abzug > 0)    teile.push(`Abzug ${chf(summen.abzug)}`);
  if (summen?.vermoegen > 0)
    teile.push(`${istSchulden ? 'Schuld' : 'Verm.'} ${chf(summen.vermoegen)}`);
  const betragText = teile.join(' · ');
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
        {(unter || betragText) && (
          <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {betragText || unter}
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
                 : b.doppelVerdacht ? `möglicherweise doppelt – wie «${b.doppelVerdacht.name}»`
                 : b.doppelVon ? 'Doppelt eingescannt'
                 : b.widerspruch ? '⚠ Regeln und KI uneins – prüfen'
                 : [BELEGART_BY_KEY[b.belegart]?.label, pos?.label].filter(Boolean).join(' · ')
                   || 'noch nicht zugeordnet'}
        </div>
      </div>

      {!laden && (b.einkommen > 0 || b.vermoegen > 0) && (
        <div style={{ fontSize: 12, fontWeight: 700, color: C.heading, flexShrink: 0,
                      textAlign: 'right' }}>
          CHF {chf(b.einkommen > 0 ? b.einkommen : b.vermoegen)}
          {b.einkommen > 0 && b.vermoegen > 0 && (
            <div style={{ fontSize: 10, fontWeight: 400, color: C.muted }}>
              Verm. {chf(b.vermoegen)}
            </div>
          )}
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
// ── Seiten aufteilen: der Dialog ───────────────────────────────────────────
//
// Links alle Seiten der Datei als Miniaturen mit klickbaren Trennstellen
// («✂» zwischen den Seiten), rechts die angeklickte Seite gross — mit Klick
// zum Vergrössern, denn ohne Lesen entscheidet niemand, wo eine Rechnung
// anfängt. Übernehmen baut die Belege der Datei neu; unveränderte Bereiche
// behalten Zuordnung und Beträge.
function AufteilenDialog({ auftrag, C, dateien = [], onDateiWechsel, onUebernehmen, onSchliessen }) {
  const { quelle, dateiName, teile, arbeitet, fortschritt } = auftrag;
  const von = teile[0]?.von || 1;
  const bis = teile[teile.length - 1]?.bis || 1;

  const [minis, setMinis] = useState(null);
  const [schnitte, setSchnitte] = useState(() => new Set(teile.slice(1).map(t => t.von)));
  const [gross, setGross] = useState(von);
  const [grossBild, setGrossBild] = useState(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let aktiv = true;
    (async () => {
      const { bilder } = await pdfSeitenMiniaturen(quelle, { maxSeiten: bis });
      if (aktiv) setMinis(bilder);
    })();
    return () => { aktiv = false; };
  }, []);

  useEffect(() => {
    let aktiv = true;
    setGrossBild(null); setZoom(false);
    (async () => {
      const b64 = await pdfSeiteAlsBild(quelle, gross, 1.8);
      if (aktiv && b64) setGrossBild(`data:image/jpeg;base64,${b64}`);
    })();
    return () => { aktiv = false; };
  }, [gross]);

  const bereiche = useMemo(() => {
    const starts = [von, ...[...schnitte].filter(x => x > von && x <= bis).sort((a, z) => a - z)];
    return starts.map((s, i) => ({ von: s, bis: (starts[i + 1] ?? bis + 1) - 1 }));
  }, [schnitte, von, bis]);

  const unveraendert = bereiche.length === teile.length
    && bereiche.every((r, i) => r.von === teile[i].von && r.bis === teile[i].bis);

  const bereichVon = seite => bereiche.findIndex(r => seite >= r.von && seite <= r.bis);

  // Esc schliesst, solange nichts läuft.
  useEffect(() => {
    const h = e => { if (e.key === 'Escape' && !arbeitet) onSchliessen(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [arbeitet, onSchliessen]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, backgroundColor: C.pageBg }}>
      <div style={{ position: 'absolute', inset: 0, backgroundColor: C.panelBg,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderBottom: `1px solid ${C.panelBdr}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.heading }}>
            {dateiName} · Seiten {von}–{bis}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>
            {bereiche.length} {bereiche.length === 1 ? 'Beleg' : 'Belege'}
            {unveraendert ? ' (unverändert)' : ' nach Übernehmen'}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted }}>
            Klick zwischen die Seiten = trennen oder zusammenlegen · Klick auf die
            Seite = gross · nochmals klicken = Lupe
          </div>
          <button onClick={onSchliessen} disabled={arbeitet}
            style={{ border: 'none', background: 'none', color: C.sub,
                     cursor: 'pointer', padding: 4, display: 'flex' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Dateien der Sortierung — Wechsel ohne den Editor zu verlassen */}
          {dateien.length > 1 && (
            <div style={{ width: 210, flexShrink: 0, overflowY: 'auto',
                          borderRight: `1px solid ${C.panelBdr}`, padding: 8 }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                            letterSpacing: '.08em', padding: '2px 6px 6px' }}>Dateien</div>
              {dateien.map(d => (
                <div key={d.basis}
                  onClick={() => !arbeitet && d.basis !== auftrag.basisHash && onDateiWechsel(d.vertreter)}
                  style={{ padding: '7px 8px', borderRadius: 6, marginBottom: 3,
                           cursor: arbeitet ? 'default' : 'pointer',
                           backgroundColor: d.basis === auftrag.basisHash ? C.accentBg : 'transparent' }}>
                  <div style={{ fontSize: 11, fontWeight: d.basis === auftrag.basisHash ? 700 : 500,
                                color: C.heading, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>
                    {d.seiten} Seiten · {d.teile} {d.teile === 1 ? 'Beleg' : 'Belege'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Miniaturen mit Trennstellen */}
          <div style={{ width: 360, flexShrink: 0, overflowY: 'auto',
                        borderRight: `1px solid ${C.panelBdr}`, padding: 10 }}>
            {!minis && (
              <div style={{ fontSize: 11, color: C.muted, display: 'flex',
                            alignItems: 'center', gap: 6, padding: 8 }}>
                <Loader2 size={12} className="animate-spin" /> Seiten werden gerendert …
              </div>
            )}
            {minis && Array.from({ length: bis - von + 1 }, (_, idx) => {
              const seite = von + idx;
              const bi = bereichVon(seite);
              const istStart = bereiche.some(r => r.von === seite);
              return (
                <React.Fragment key={seite}>
                  {seite > von && (
                    <button onClick={() => setSchnitte(alt => {
                        const neu = new Set(alt);
                        if (neu.has(seite)) neu.delete(seite); else neu.add(seite);
                        return neu;
                      })}
                      disabled={arbeitet}
                      style={{ width: '100%', margin: '4px 0', padding: '3px 6px',
                               fontSize: 10, borderRadius: 5, cursor: 'pointer',
                               border: schnitte.has(seite)
                                 ? `1px solid ${C.accent}` : `1px dashed ${C.panelBdr}`,
                               backgroundColor: schnitte.has(seite) ? C.accentBg : 'transparent',
                               color: schnitte.has(seite) ? C.accent : C.muted }}>
                      {schnitte.has(seite)
                        ? `✂ Beleg-Grenze — klicken zum Zusammenlegen`
                        : 'hier trennen'}
                    </button>
                  )}
                  <div onClick={() => setGross(seite)}
                    style={{ display: 'flex', gap: 8, alignItems: 'center',
                             padding: 5, borderRadius: 6, cursor: 'pointer',
                             backgroundColor: gross === seite ? C.accentBg : 'transparent',
                             borderLeft: `3px solid ${istStart ? C.accent : 'transparent'}` }}>
                    <img src={minis[seite - 1]} alt={`Seite ${seite}`}
                      style={{ width: 76, borderRadius: 3,
                               border: `1px solid ${C.panelBdr}`, flexShrink: 0 }} />
                    <div style={{ fontSize: 10, color: C.sub }}>
                      Seite {seite}
                      <div style={{ color: C.muted }}>Beleg {bi + 1}</div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* grosse Ansicht */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto',
                        backgroundColor: '#3a3a3e', display: 'flex',
                        alignItems: 'flex-start', justifyContent: 'center' }}>
            {grossBild ? (
              <img src={grossBild} alt={`Seite ${gross}`}
                onClick={() => setZoom(z => !z)}
                style={{ width: zoom ? '175%' : '100%', maxWidth: zoom ? 'none' : '100%',
                         cursor: zoom ? 'zoom-out' : 'zoom-in', display: 'block' }} />
            ) : (
              <div style={{ fontSize: 12, color: '#bbb', padding: 30 }}>
                Seite {gross} wird gerendert …
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderTop: `1px solid ${C.panelBdr}` }}>
          <div style={{ fontSize: 10, color: C.muted }}>
            Unveränderte Bereiche behalten Zuordnung und Beträge — nur geänderte
            werden neu gelesen und erkannt.
          </div>
          {(arbeitet || fortschritt) && (
            <div style={{ fontSize: 11, color: C.sub, display: 'flex',
                          alignItems: 'center', gap: 6 }}>
              {arbeitet && <Loader2 size={12} className="animate-spin" />}
              {fortschritt}
            </div>
          )}
          <button onClick={() => onUebernehmen(bereiche)}
            disabled={unveraendert || arbeitet}
            style={{ marginLeft: 'auto', padding: '8px 16px', fontSize: 12,
                     fontWeight: 600, borderRadius: 6,
                     border: `1px solid ${unveraendert || arbeitet ? C.panelBdr : C.accent}`,
                     backgroundColor: unveraendert || arbeitet ? 'transparent' : C.accentBg,
                     color: unveraendert || arbeitet ? C.muted : C.accent,
                     cursor: unveraendert || arbeitet ? 'default' : 'pointer' }}>
            {arbeitet ? 'arbeitet …' : `Übernehmen (${bereiche.length} Belege)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Vollbild-Durchsicht ────────────────────────────────────────────────────
//
// Der Arbeitsmodus zum Abarbeiten, in drei Schritten und mit Platz:
//   1 Trennung   – stimmt die Zerlegung je Dokument? (trennen/zusammenlegen)
//   2 Relevanz   – braucht es den Beleg für die Steuern oder nicht?
//   3 Zuordnung  – noch offene Belege der richtigen Position zuweisen.
// Grosse Vorschau links, rechts nur die Bedienung des aktuellen Schritts.
// Esc schliesst, Pfeiltasten blättern. Erledigtes verlässt die Liste von
// selbst — der Zähler im Reiter ist der Fortschritt.
const DURCHSICHT_SCHRITTE = [
  { nr: 1, label: 'Trennung' },
  { nr: 2, label: 'Relevanz' },
  { nr: 3, label: 'Zuordnung' },
];

function Durchsicht({ belege, C, schritt, index, setDurchsicht,
                      onAendern, onPosition, onAufteilen, onWaehlen }) {
  const fertige = belege.filter(x => x.stand === 'fertig');
  const istPdfQ = x => (x.istPdf || /\.pdf($|\?)/i.test(x.dateiPfad || '') || /\.pdf$/i.test(x.name || ''));
  // Schritt 1 arbeitet je DATEI (erster Teil vertritt sie) — die
  // Seitenübersicht zeigt und ändert ohnehin die ganze Datei.
  const proDatei = [];
  const gesehen = new Set();
  for (const x of fertige) {
    const basis = String(x.hash || '').split('#')[0];
    if (!basis || gesehen.has(basis)) continue;
    if (istPdfQ(x) && (x.datei || x.dateiPfad)) { gesehen.add(basis); proDatei.push(x); }
  }
  const listen = {
    1: proDatei,
    2: fertige.filter(x => x.position !== '_aussortiert'),
    3: fertige.filter(x => !x.position),
  };
  const liste = listen[schritt] || [];
  const i = Math.min(index, Math.max(0, liste.length - 1));
  const b = liste[i] || null;

  useEffect(() => { if (b) onWaehlen(b.id); }, [b?.id]);

  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') setDurchsicht(null);
      if (e.key === 'ArrowRight') setDurchsicht(d => d && ({ ...d, index: d.index + 1 }));
      if (e.key === 'ArrowLeft')  setDurchsicht(d => d && ({ ...d, index: Math.max(0, d.index - 1) }));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setDurchsicht]);

  const weiter  = () => setDurchsicht(d => ({ ...d, index: d.index + 1 }));
  const zurueck = () => setDurchsicht(d => ({ ...d, index: Math.max(0, d.index - 1) }));

  const feld = {
    width: '100%', boxSizing: 'border-box', backgroundColor: C.inputBg,
    border: `1px solid ${C.panelBdr}`, borderRadius: 5,
    padding: '6px 8px', fontSize: 12, color: C.heading, outline: 'none',
  };
  const aktion = (rand, farbe) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '8px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${rand}`, background: 'none', color: farbe, width: '100%',
  });

  const posDef = b?.position ? KATALOG_NACH_ID[b.position] : null;
  const dateiTeile = b ? fertige.filter(x =>
    String(x.hash || '').split('#')[0] === String(b.hash || '').split('#')[0])
    .sort((x, z) => (x.vonSeite || 1) - (z.vonSeite || 1)) : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: C.pageBg,
                  display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                    borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.panelBg }}>
        {DURCHSICHT_SCHRITTE.map(s => (
          <button key={s.nr} onClick={() => setDurchsicht({ schritt: s.nr, index: 0 })}
            style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                     border: `1px solid ${schritt === s.nr ? C.accent : C.panelBdr}`,
                     backgroundColor: schritt === s.nr ? C.accentBg : 'transparent',
                     color: schritt === s.nr ? C.accent : C.sub,
                     fontWeight: schritt === s.nr ? 700 : 500 }}>
            {s.nr} · {s.label}
            <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>
              {(listen[s.nr] || []).length}
            </span>
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>
          {liste.length ? `${i + 1} von ${liste.length}` : 'Schritt erledigt'}
        </span>
        <button onClick={() => setDurchsicht(null)}
          style={{ border: 'none', background: 'none', color: C.sub, cursor: 'pointer',
                   padding: 6, display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {b ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, backgroundColor: '#3a3a3e',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {b.url ? (
              <iframe title="Beleg"
                src={b.vonSeite > 1 ? `${b.url}#page=${b.vonSeite}` : b.url}
                style={{ width: '100%', height: '100%', border: 'none' }} />
            ) : (
              <div style={{ fontSize: 12, color: '#bbb' }}>
                {b.dateiPfad ? 'Vorschau wird aus der Ablage geladen …'
                             : 'Keine Ablage-Kopie vorhanden'}
              </div>
            )}
          </div>

          <div style={{ width: 380, flexShrink: 0, backgroundColor: C.panelBg,
                        borderLeft: `1px solid ${C.panelBdr}`, padding: 14,
                        display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.heading }}>{b.name}</div>
            {(b.belegart || b.kiBegruendung) && (
              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5,
                            display: 'grid', gap: 2 }}>
                {b.belegart && (
                  <div>
                    <span style={{ color: C.sub, fontWeight: 600 }}>Erkannt als: </span>
                    {BELEGART_BY_KEY[b.belegart]?.label || b.belegart}
                    {b.confidence != null && ` · ${Math.round(b.confidence * 100)} %`}
                  </div>
                )}
                {b.merkmale?.length > 0 && (
                  <div><span style={{ color: C.sub, fontWeight: 600 }}>Woran: </span>
                    {b.merkmale.join(', ')}</div>
                )}
                {b.kiBegruendung && (
                  <div><span style={{ color: C.sub, fontWeight: 600 }}>KI: </span>
                    {b.kiBegruendung}</div>
                )}
              </div>
            )}
            {b.widerspruch && (
              <div style={{ fontSize: 10, color: C.warn }}>
                ⚠ Regeln sahen «{BELEGART_BY_KEY[b.regelBelegart]?.label || b.regelBelegart}»,
                die KI «{BELEGART_BY_KEY[b.kiBelegart]?.label || b.kiBelegart}».
              </div>
            )}

            {schritt === 1 && (
              <>
                <div style={{ fontSize: 11, color: C.sub }}>
                  Diese Datei ist in {dateiTeile.length}
                  {dateiTeile.length === 1 ? ' Beleg' : ' Belege'} zerlegt:
                </div>
                <div style={{ display: 'grid', gap: 3, fontSize: 10, color: C.muted }}>
                  {dateiTeile.map(x => (
                    <div key={x.id}>
                      Seiten {x.vonSeite || 1}
                      {(x.bisSeite || 0) > (x.vonSeite || 1) ? `–${x.bisSeite}` : ''} ·{' '}
                      {x.position ? (KATALOG_NACH_ID[x.position]?.label || x.position) : 'offen'}
                    </div>
                  ))}
                </div>
                <button onClick={() => onAufteilen(b)} style={aktion(C.panelBdr, C.heading)}>
                  Seiten ansehen und aufteilen …
                </button>
                <button onClick={weiter} style={aktion(C.accent, C.accent)}>
                  Zerlegung stimmt – weiter <ChevronRight size={13} />
                </button>
              </>
            )}

            {schritt === 2 && (
              <>
                <div style={{ fontSize: 11, color: C.sub }}>
                  Braucht es diesen Beleg für die Steuererklärung?
                </div>
                <button onClick={() => onAendern(b.id, { position: '_aussortiert', vonHand: true })}
                  style={aktion(C.warn, C.warn)}>
                  Nicht benötigt – aussortieren
                </button>
                <button onClick={weiter} style={aktion(C.accent, C.accent)}>
                  Braucht's – weiter <ChevronRight size={13} />
                </button>
              </>
            )}

            {schritt === 3 && (
              <>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>Zuordnung</div>
                  <select value={b.position || ''}
                    onChange={e => onPosition(b.id, e.target.value)} style={feld}>
                    <option value="">— noch offen —</option>
                    {[...KATALOG, AUSSORTIERT].map(p => (
                      <option key={p.id} value={p.id}>S{p.seite} · {p.label}</option>
                    ))}
                  </select>
                </div>
                {b.kandidaten?.length > 0 && (
                  <div style={{ display: 'grid', gap: 5 }}>
                    <div style={{ fontSize: 10, color: C.muted }}>Kandidaten:</div>
                    {b.kandidaten.map(k => (
                      <button key={k.id} onClick={() => onPosition(b.id, k.id)}
                        style={aktion(C.panelBdr, C.heading)}>
                        {k.label}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={weiter} style={aktion(C.panelBdr, C.sub)}>
                  später entscheiden – weiter <ChevronRight size={13} />
                </button>
              </>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={zurueck} disabled={i === 0}
                style={{ ...aktion(C.panelBdr, i === 0 ? C.muted : C.sub), width: '50%' }}>
                <ChevronLeft size={13} /> zurück
              </button>
              <button onClick={weiter} disabled={i >= liste.length - 1}
                style={{ ...aktion(C.panelBdr, i >= liste.length - 1 ? C.muted : C.sub), width: '50%' }}>
                weiter <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12,
                      alignItems: 'center', justifyContent: 'center' }}>
          <Check size={30} style={{ color: C.accent }} />
          <div style={{ fontSize: 13, color: C.heading, fontWeight: 600 }}>
            Schritt {schritt} ist durch.
          </div>
          {schritt < 3 ? (
            <button onClick={() => setDurchsicht({ schritt: schritt + 1, index: 0 })}
              style={{ ...aktion(C.accent, C.accent), width: 'auto', padding: '8px 16px' }}>
              Weiter zu Schritt {schritt + 1} <ChevronRight size={13} />
            </button>
          ) : (
            <button onClick={() => setDurchsicht(null)}
              style={{ ...aktion(C.accent, C.accent), width: 'auto', padding: '8px 16px' }}>
              Durchsicht abschliessen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Vorschau({ beleg: b, breite, steuerjahr, onAendern, onPosition, onAufteilen }) {
  const C = useFarben();
  const [holtBetraege, setHoltBetraege] = useState(false);
  const [holErgebnis, setHolErgebnis] = useState(null);
  useEffect(() => { setHolErgebnis(null); }, [b?.id]);

  // Fehlende Beträge auf Zuruf per Bild-KI ablesen — für gespeicherte Belege
  // (etwa den Schuldzins, den die OCR im ZKB-Ausweis nicht fand). Explizit
  // per Klick, und für Krankheitsbelege gar nicht erst angeboten.
  const posDef = b?.position ? KATALOG_NACH_ID[b.position] : null;
  const fehltE = !!(posDef?.einkommen && b?.einkommen == null);
  const fehltV = !!(posDef?.vermoegen && b?.vermoegen == null);
  // istPdf wird erst beim Laden der Vorschau gesetzt — für gespeicherte
  // Belege zählt darum auch die Endung des Ablage-Pfads, sonst fehlt der
  // Knopf, bis die Vorschau durch ist.
  const istPdfQuelle = b?.istPdf || /\.pdf($|\?)/i.test(b?.dateiPfad || '')
    || /\.pdf$/i.test(b?.name || '');
  const kannBetraegeHolen = (fehltE || fehltV) && istPdfQuelle
    && (b?.datei || b?.dateiPfad) && !istGesundheitsbeleg(b || {});

  // Offene Belege per KI zuordnen lassen — die Wahl-Stufe auf Zuruf.
  // Mit erkannter Belegart wird nur die Entscheidungsfrage gestellt
  // (Kontoauszug: Guthaben oder Sollsaldo?); ohne Belegart läuft die volle
  // Klassifikation, bei Scans mit Seitenbild. Krankheitsbelege ohne Bild.
  const [bestimmt, setBestimmt] = useState(false);
  const kannPositionBestimmen = b && !b.position && b.stand === 'fertig'
    && (b.text || b.datei || b.dateiPfad);

  async function positionBestimmen() {
    setBestimmt(true); setHolErgebnis(null);
    try {
      const gesund = istGesundheitsbeleg(b);
      const bilder = [];
      if (!gesund && istPdfQuelle && (b.datei || b.dateiPfad)) {
        const quelle = b.datei || await db.dateiLaden(b.dateiPfad);
        const bild = await pdfSeiteAlsBild(quelle, b.vonSeite || 1);
        if (bild) bilder.push(bild);
      }
      const zuord = b.belegart ? positionenFuer(b.belegart) : null;
      const kand = (b.kandidaten?.length ? b.kandidaten : zuord?.kandidaten) || [];

      const anwenden = (pos, begr) => onAendern(b.id, {
        position: pos, quelle: 'ki',
        begruendung: `${b.begruendung ? b.begruendung + ' · ' : ''}${begr}`,
        ...(b.betragQuelle === 'hand' ? {} : seitenFuer(pos, b.text)),
      });

      if (kand.length >= 2) {
        const wahl = await positionWaehlen(supabase, {
          text: ausschnittFuerKi(b.text), dateiname: b.name,
          periode: steuerjahr ?? null, belegart: b.belegart,
          kriterium: zuord?.grund || '', kandidaten: kand, bilder,
        });
        if (wahl.position && kand.some(k => k.id === wahl.position)) {
          anwenden(wahl.position, `KI-Wahl: ${wahl.begruendung}`);
          setHolErgebnis(wahl.begruendung || 'zugeordnet');
        } else {
          setHolErgebnis('KI konnte nicht entscheiden'
            + (wahl.begruendung ? ` — ${wahl.begruendung}` : ''));
        }
      } else {
        const tri = await triageMitKi(supabase, {
          text: b.text || '', dateiname: b.name,
          ...(bilder.length ? { bild: bilder[0], bildTyp: 'image/jpeg' } : {}),
        }, { periode: steuerjahr ?? null, katalog: katalogFuerPrompt() });
        const kiPos = (tri.positionen || []).map(x => KATALOG_NACH_ID[x]).filter(Boolean);
        if (kiPos.length === 1) {
          anwenden(kiPos[0].id, `KI: ${tri.begruendung}`);
          setHolErgebnis(tri.begruendung || 'zugeordnet');
        } else if (kiPos.length >= 2) {
          const wahl = await positionWaehlen(supabase, {
            text: ausschnittFuerKi(b.text), dateiname: b.name,
            periode: steuerjahr ?? null, belegart: tri.belegart,
            kandidaten: kiPos, bilder,
          });
          if (wahl.position) {
            anwenden(wahl.position, `KI-Wahl: ${wahl.begruendung}`);
            setHolErgebnis(wahl.begruendung || 'zugeordnet');
          } else {
            setHolErgebnis(`Zwei Kandidaten, keine Entscheidung: ${kiPos.map(k => k.label).join(' / ')}`);
          }
        } else {
          setHolErgebnis('KI hat keine Position erkannt'
            + (tri.begruendung ? ` — ${tri.begruendung}` : ''));
        }
      }
    } catch (e) {
      setHolErgebnis(`Fehlgeschlagen: ${e.message}`);
    } finally {
      setBestimmt(false);
    }
  }

  async function betraegeHolen() {
    setHoltBetraege(true); setHolErgebnis(null);
    try {
      const quelle = b.datei || await db.dateiLaden(b.dateiPfad);
      const von = b.vonSeite || 1;
      const bis = Math.min(b.bisSeite || von, von + 2);
      const bilder = [];
      for (let s = von; s <= bis; s++) {
        const bild = await pdfSeiteAlsBild(quelle, s);
        if (bild) bilder.push(bild);
      }
      if (!bilder.length) throw new Error('Seiten liessen sich nicht rendern');
      const r = await betraegePerBild(supabase, {
        bilder,
        einkommenLabel: fehltE ? posDef.einkommen : null,
        vermoegenLabel: fehltV ? posDef.vermoegen : null,
        dateiname: b.name, periode: steuerjahr ?? null,
      });
      const neu = {};
      if (fehltE && r.einkommen != null) neu.einkommen = r.einkommen;
      if (fehltV && r.vermoegen != null) neu.vermoegen = r.vermoegen;
      if (Object.keys(neu).length) {
        onAendern(b.id, { ...neu, betragQuelle: 'ki' });
        setHolErgebnis(r.begruendung || 'abgelesen');
      } else {
        setHolErgebnis('Auf den Seiten nicht gefunden'
          + (r.begruendung ? ` — ${r.begruendung}` : ''));
      }
    } catch (e) {
      setHolErgebnis(`Fehlgeschlagen: ${e.message}`);
    } finally {
      setHoltBetraege(false);
    }
  }
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
            {b.dateiPfad
              ? 'Beleg wird aus der Ablage geholt …'
              : 'Aus einem älteren Stand ohne Ablage-Kopie – einmal neu hineinziehen, dann liegt er künftig bereit.'}
          </div>
        ) : b.istPdf ? (
          // Bei einem Buendel auf der Seite dieses Belegs aufgehen
          <iframe title={b.name}
                  src={b.vonSeite > 1 ? `${b.url}#page=${b.vonSeite}` : b.url}
                  style={{ width: '100%', height: '100%', border: 'none' }} />
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
          {kannPositionBestimmen && (
            <button onClick={positionBestimmen} disabled={bestimmt}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                       gap: 6, padding: '6px 8px', fontSize: 11, borderRadius: 5,
                       border: `1px solid ${C.accent}`, background: 'none',
                       color: C.accent, cursor: bestimmt ? 'wait' : 'pointer' }}>
              {bestimmt
                ? <><Loader2 size={11} className="animate-spin" /> KI entscheidet …</>
                : <>Position per KI bestimmen</>}
            </button>
          )}
          {/* Jeder Beleg führt BEIDE Seiten der Erklärung — Einkommen und
              Vermögen. Wo der Katalog nichts erwartet, bleibt das Feld leer,
              steht aber da (Lohnausweis: nur Einkommen; Kaufvertrag: nur
              Vermögen; Bank-Steuerausweis: beides). */}
          <div>
            <div style={etikett(C)}>
              {(b.position && KATALOG_NACH_ID[b.position]?.einkommen) || 'Einkommen im Jahr'}
              {b.position && KATALOG_NACH_ID[b.position]?.wirkung === 'abzug' ? ' (Abzug)' : ''} – CHF
            </div>
            <input type="number" value={b.einkommen ?? ''}
              placeholder={b.position && KATALOG_NACH_ID[b.position]?.einkommen
                ? 'noch nicht ausgelesen' : 'bleibt meist leer'}
              onChange={e => onAendern(b.id, { einkommen: e.target.value, betragQuelle: 'hand' })}
              style={feld} />
          </div>
          <div>
            <div style={etikett(C)}>
              {(b.position && KATALOG_NACH_ID[b.position]?.vermoegen) || 'Vermögen per 31.12.'} – CHF
            </div>
            <input type="number" value={b.vermoegen ?? ''}
              placeholder={b.position && KATALOG_NACH_ID[b.position]?.vermoegen
                ? 'noch nicht ausgelesen' : 'bleibt meist leer'}
              onChange={e => onAendern(b.id, { vermoegen: e.target.value, betragQuelle: 'hand' })}
              style={feld} />
          </div>
          {kannBetraegeHolen && (
            <button onClick={betraegeHolen} disabled={holtBetraege}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                       gap: 6, padding: '6px 8px', fontSize: 11, borderRadius: 5,
                       border: `1px solid ${C.panelBdr}`, background: 'none',
                       color: C.accent, cursor: holtBetraege ? 'wait' : 'pointer' }}>
              {holtBetraege
                ? <><Loader2 size={11} className="animate-spin" /> liest vom Beleg ab …</>
                : <>Fehlende Beträge per KI vom Beleg ablesen</>}
            </button>
          )}
          {holErgebnis && (
            <div style={{ fontSize: 10, color: C.muted }}>{holErgebnis}</div>
          )}
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

          {/* Manuell aufteilen: Seitenübersicht mit Miniaturen statt
              Seitenzahlen tippen — trennt und legt zusammen in einem. */}
          {b.stand === 'fertig' && istPdfQuelle && (b.datei || b.dateiPfad) && (
            <button onClick={() => onAufteilen(b)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                       gap: 6, padding: '6px 8px', fontSize: 11, borderRadius: 5,
                       border: `1px solid ${C.panelBdr}`, background: 'none',
                       color: C.heading, cursor: 'pointer' }}>
              <GripVertical size={11} /> Seiten dieser Datei aufteilen …
            </button>
          )}
        </div>

        {/* Erklärung strukturiert statt als Fliesstext-Wurst: was erkannt
            wurde, woran, und was die KI dazu sagte — jede Zeile für sich.
            Alte Stände ohne die neuen Felder zeigen weiter die Prosa. */}
        {(b.belegart || b.merkmale?.length > 0 || b.kiBegruendung || b.begruendung) && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 8,
                        display: 'grid', gap: 3, lineHeight: 1.5 }}>
            {b.belegart && (
              <div>
                <span style={{ color: C.sub, fontWeight: 600 }}>Erkannt als: </span>
                {BELEGART_BY_KEY[b.belegart]?.label || b.belegart}
                {b.confidence != null && ` · ${Math.round(b.confidence * 100)} % sicher`}
              </div>
            )}
            {b.merkmale?.length > 0 && (
              <div>
                <span style={{ color: C.sub, fontWeight: 600 }}>Woran: </span>
                {b.merkmale.join(', ')}
              </div>
            )}
            {b.kiBegruendung && (
              <div>
                <span style={{ color: C.sub, fontWeight: 600 }}>KI: </span>
                {b.kiBegruendung}
              </div>
            )}
            {!b.belegart && !b.kiBegruendung && b.begruendung && (
              <div>{b.begruendung}</div>
            )}
          </div>
        )}
        {b.widerspruch && (
          <Hinweis farbe={C.warn}>
            Widerspruch: Regeln sahen «{BELEGART_BY_KEY[b.regelBelegart]?.label || b.regelBelegart}»,
            die KI «{BELEGART_BY_KEY[b.kiBelegart]?.label || b.kiBelegart}» — bitte von Hand entscheiden.
          </Hinweis>
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
  if (stand === 'trennt') return 'wird in einzelne Belege zerlegt …';
  if (stand === 'liest') return 'wird gelesen …';
  if (stand === 'ocr')   return 'Scan erkannt – OCR läuft, das dauert';
  if (stand === 'pdf')   return 'PDF-Text wird gelesen …';
  if (stand === 'ki')    return 'Regeln reichten nicht – KI wird gefragt …';
  if (stand === 'ki-bild') return 'Text half nicht – Seite geht als Bild an die KI …';
  if (stand === 'ki-betrag') return 'Beträge fehlen – werden vom Beleg abgelesen …';
  if (stand === 'ki-wahl') return 'Mehrere mögliche Ziele – KI entscheidet …';
  return String(stand || '') + ' …';
}
