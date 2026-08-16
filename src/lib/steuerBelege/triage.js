/**
 * Relevanz-Triage für Steuerbelege.
 *
 * Zweistufig, nach dem bewährten Muster aus batchAiSuggest.js:
 *   Stufe 1  Regeln und Mustererkennung — deterministisch, kostenlos, sofort
 *   Stufe 2  LLM-Fallback, NUR wenn Stufe 1 unter dem Schwellwert bleibt
 *
 * Der Grundsatz: Was sich ableiten lässt, wird abgeleitet. Die KI wird erst
 * gefragt, wenn die Regeln nicht weiterkommen — das ist 20-40× schneller und
 * macht das Ergebnis nachvollziehbar.
 *
 * Konzept: docs/recherche-und-architektur.md §8
 */

import { BELEGARTEN, NICHT_RELEVANT_MUSTER, RELEVANZ } from "./belegarten.js";

/** Ab dieser Confidence wird die KI nicht mehr gefragt. */
export const SCHWELLE_KI = 0.85;

/** Ab dieser Confidence darf ein Wert ohne menschliche Bestätigung stehen bleiben. */
export const SCHWELLE_REVIEW = 0.85;

// ══════════════════════════════════════════════════════════════════════
// Normalisierung (gleiche Regeln wie batchAiSuggest.js)
// ══════════════════════════════════════════════════════════════════════

/**
 * Zieht die Umlaut-Dehnung wieder heraus: aus «gebaeudeversicherung» wird
 * «gebaudeversicherung».
 *
 * Wozu: normalize() schreibt ä zu ae aus — OCR verschluckt den Umlaut dagegen
 * meist ganz. Der GVZ-Briefkopf kam im Probelauf als «GEBAUDEVERSICHERUNG»
 * heraus und traf das Stichwort «gebaeudeversicherung» nie. Wird auf beiden
 * Seiten angewandt, treffen sich die Schreibweisen.
 *
 * Gleiche Idee wie die OCR-tolerante UID-Erkennung, wo das Komma als
 * Trennzeichen zugelassen ist, weil OCR aus «.» oft «,» macht.
 */
export function flach(s) {
  return normalize(s).replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
}

export function normalize(s) {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Findet ein vierstelliges Jahr im Text, das als Steuerperiode taugt.
 * Bevorzugt Treffer in typischen Formulierungen ("Steuerperiode 2025",
 * "per 31.12.2025"), weil im Belegtext viele Jahreszahlen stehen können.
 */
export function findePeriode(text, erwartet) {
  if (!text) return null;
  const n = normalize(text);
  const kandidaten = [];

  const kontext = /(steuerperiode|steuerjahr|per 31.12.|bemessungsjahr|jahr)\D{0,12}(19|20)\d{2}/g;
  for (const m of n.matchAll(kontext)) {
    const jahr = Number.parseInt(m[0].slice(-4), 10);
    kandidaten.push({ jahr, gewicht: 3 });
  }
  for (const m of n.matchAll(/\b(19|20)\d{2}\b/g)) {
    kandidaten.push({ jahr: Number.parseInt(m[0], 10), gewicht: 1 });
  }
  if (!kandidaten.length) return null;

  // Das erwartete Jahr gewinnt, wenn es überhaupt vorkommt — sonst das
  // am stärksten gewichtete, bei Gleichstand das jüngste.
  if (erwartet && kandidaten.some(k => k.jahr === erwartet)) return erwartet;
  kandidaten.sort((a, b) => b.gewicht - a.gewicht || b.jahr - a.jahr);
  return kandidaten[0].jahr;
}

/**
 * Bereitet den Text für die KI auf: Kopfbereich statt Volltext, AHV-Nummer
 * maskiert.
 *
 * Warum so wenig: Die Belegart steht praktisch immer im Briefkopf und in den
 * ersten Zeilen — wer schickt, bestimmt meist was es ist. Der Rest des
 * Dokuments trägt zur Frage «was ist das» nichts bei, wäre aber genau der
 * Teil mit den Beträgen, Diagnosen und Kontobewegungen.
 *
 * Die AHV-Nummer wird lokal für die Zuordnung zum Ehegatten gebraucht, aber
 * die KI muss sie nie sehen.
 */
export function ausschnittFuerKi(text, zeichen = 1800) {
  if (!text) return "";
  return text
    .slice(0, zeichen)
    .replace(/756[.,\s-]*\d{4}[.,\s-]*\d{4}[.,\s-]*\d{2}/g, "756.[maskiert]");
}

// ══════════════════════════════════════════════════════════════════════
// Stufe 1: Regeln
// ══════════════════════════════════════════════════════════════════════

/**
 * Klassifiziert einen Beleg allein aus Text, Dateiname und Kontext.
 *
 * @param {object} beleg
 *   @param {string} beleg.text        OCR-/PDF-Volltext
 *   @param {string} beleg.dateiname
 *   @param {string} beleg.parseMethode  'ech0196' | 'ech0270' | 'ech0275' | 'pdf_text' | 'ocr'
 *   @param {string} beleg.dateiHash
 * @param {object} kontext
 *   @param {number}   kontext.periode          Periode der Deklaration
 *   @param {string[]} kontext.bekannteHashes   Hashes bereits erfasster Belege
 * @returns {{belegart: string|null, relevanz: string, grund: string|null,
 *            confidence: number, periodeBeleg: number|null, begruendung: string}}
 */
export function triageRegeln(beleg, kontext = {}) {
  const { text = "", dateiname = "", parseMethode = "ocr", dateiHash = null } = beleg;
  const { periode = null, bekannteHashes = [] } = kontext;

  const heu = normalize(`${text}\n${dateiname}`);
  const heuFlach = flach(`${text}\n${dateiname}`);
  // Treffer gilt in der normalisierten ODER in der umlautflachen Schreibweise
  const trifft = (begriff) => heu.includes(normalize(begriff)) || heuFlach.includes(flach(begriff));

  // ─── Duplikat: schlägt alles andere ───────────────────────────────
  if (dateiHash && bekannteHashes.includes(dateiHash)) {
    return {
      belegart: null,
      relevanz: RELEVANZ.NICHT_RELEVANT,
      grund: "duplikat",
      confidence: 1,
      periodeBeleg: null,
      begruendung: "Inhaltsgleicher Beleg bereits im Dossier (Hash-Treffer).",
    };
  }

  // ─── Strukturierte Quelle: Belegart steht fest ────────────────────
  // Ein Barcode oder XML wird nie vom Steuerpflichtigen getippt — wenn er
  // da ist, ist die Belegart bekannt und die KI hat nichts zu raten.
  const ausParseMethode = {
    ech0196: "esteuerauszug",
    ech0275: "krankenkasse",
  }[parseMethode];

  if (ausParseMethode) {
    return {
      belegart: ausParseMethode,
      relevanz: RELEVANZ.RELEVANT,
      grund: null,
      confidence: 1,
      periodeBeleg: findePeriode(text, periode),
      begruendung: `Strukturiert eingelesen (${parseMethode}) — Belegart eindeutig.`,
    };
  }

  // ─── Scoring über den Belegarten-Katalog ──────────────────────────
  //
  // Mindestbeleg: Ein einzelnes schwaches Stichwort darf keine Belegart
  // bestimmen. Der erste Probelauf an einem echten Stapel zeigte, warum —
  // «einzahlung» steht auf jedem Einzahlungsschein und machte Spenden,
  // Architekten- und Versicherungsrechnungen zu Säule-3a-Belegen; «iban»
  // machte eine Rasenmäherrechnung zum Kontoauszug. Verlangt wird deshalb
  // entweder ein starkes Signal oder zwei unabhängige Stichwörter.
  let best = null;
  for (const art of BELEGARTEN) {
    let score = 0;
    const treffer = [];
    let starkTreffer = 0;
    let kwTreffer = 0;

    for (const s of art.stark) {
      if (trifft(s)) { score += 6; treffer.push(s); starkTreffer++; }
    }
    for (const k of art.keywords) {
      if (trifft(k)) { score += 1; treffer.push(k); kwTreffer++; }
    }
    // eCH-0270-Barcode wurde gelesen und die Art passt: starkes Signal
    if (parseMethode === "ech0270" && art.parse === "ech0270") { score += 6; starkTreffer++; }

    if (starkTreffer === 0 && kwTreffer < 2) continue;   // zu dünn – keine Aussage

    if (score > 0 && (!best || score > best.score)) {
      best = { art, score, treffer };
    }
  }

  // ─── Nicht-relevant-Muster ────────────────────────────────────────
  let negativ = null;
  for (const m of NICHT_RELEVANT_MUSTER) {
    const n = m.keywords.filter(k => trifft(k)).length;
    if (n > 0 && (!negativ || n > negativ.n)) negativ = { key: m.key, n };
  }

  const periodeBeleg = findePeriode(text, periode);

  // Kein positives Signal, aber ein negatives → aussortieren, aber sichtbar
  if (!best && negativ) {
    return {
      belegart: null,
      relevanz: RELEVANZ.NICHT_RELEVANT,
      grund: negativ.key,
      confidence: Math.min(0.8, 0.4 + negativ.n * 0.15),
      periodeBeleg,
      begruendung: `Muster «${negativ.key}» erkannt, kein Steuerbezug gefunden.`,
    };
  }

  // Gar nichts erkannt → unklar, geht an die KI
  if (!best) {
    return {
      belegart: null,
      relevanz: RELEVANZ.UNKLAR,
      grund: null,
      confidence: 0,
      periodeBeleg,
      begruendung: "Keine Regel gegriffen — Klassifikation durch KI nötig.",
    };
  }

  // Score in eine Confidence übersetzen: 6 Punkte ≈ 0.7, 12 ≈ 0.9
  let confidence = Math.min(0.95, 0.25 + best.score * 0.06);

  // ─── Plausi: Periode ──────────────────────────────────────────────
  // Ein Beleg aus dem falschen Jahr wird NIE stillschweigend verworfen —
  // er wird als unklar markiert und dem Menschen vorgelegt.
  let relevanz = RELEVANZ.RELEVANT;
  let grund = null;
  let hinweis = "";

  if (periode && periodeBeleg && periodeBeleg !== periode) {
    relevanz = RELEVANZ.UNKLAR;
    grund = "falsche_periode";
    confidence = Math.min(confidence, 0.5);
    hinweis = ` Periode im Beleg (${periodeBeleg}) weicht von der Deklaration (${periode}) ab.`;
  }

  return {
    belegart: best.art.key,
    relevanz,
    grund,
    confidence: Number(confidence.toFixed(2)),
    periodeBeleg,
    begruendung: `«${best.art.label}» erkannt über: ${best.treffer.slice(0, 4).join(", ")}.${hinweis}`,
  };
}

/** Braucht dieser Beleg nach Stufe 1 noch die KI? */
export function brauchtKi(ergebnis) {
  if (!ergebnis) return true;
  if (ergebnis.grund === "duplikat") return false;
  return ergebnis.confidence < SCHWELLE_KI;
}

// ══════════════════════════════════════════════════════════════════════
// Stufe 2: LLM-Fallback
// ══════════════════════════════════════════════════════════════════════

/**
 * Ruft die Edge Function steuer-suggest-position auf und mischt das Ergebnis
 * mit der Regel-Einschätzung. Die Regel gewinnt bei Gleichstand — sie ist
 * nachvollziehbar, die KI nicht.
 *
 * @param {object} supabase  Supabase-Client
 */
export async function triageMitKi(supabase, beleg, kontext = {}) {
  const regel = triageRegeln(beleg, kontext);
  if (!brauchtKi(regel)) return { ...regel, quelle: "regel" };

  try {
    const { data, error } = await supabase.functions.invoke("steuer-suggest-position", {
      body: {
        // Nur der Kopfbereich, und die AHV-Nummer vorher raus. Fuer die Frage
        // «was ist das» reicht der Briefkopf; Arzt- und Krankheitsbelege sind
        // besonders schuetzenswerte Personendaten und muessen nicht in voller
        // Laenge das Haus verlassen.
        text:       ausschnittFuerKi(beleg.text),
        dateiname:  beleg.dateiname || "",
        periode:    kontext.periode ?? null,
        // Katalog kommt vom Aufrufer, damit er nur an EINER Stelle gepflegt wird
        katalog:    kontext.katalog || "",
        belegarten: kontext.belegarten || BELEGARTEN.map(b => `${b.key} = ${b.label}`).join("\n"),
        // Bild-Fallback: erste Seite des Teils als JPEG, NUR wenn Regeln und
        // Text-KI leer ausgingen. Im Bild lässt sich nichts maskieren — darum
        // bleibt es auf die Reste beschränkt, die sonst von Hand zu sortieren
        // wären.
        bild:       beleg.bild || undefined,
        bildTyp:    beleg.bild ? (beleg.bildTyp || "image/jpeg") : undefined,
      },
    });
    if (error) throw error;
    if (!data || data.error) throw new Error(data?.error || "Leere Antwort");

    const kiConfidence = Number(data.confidence) || 0;

    // Die KI darf die Regel nur überstimmen, wenn sie deutlich sicherer ist.
    const nimmKi = !regel.belegart || kiConfidence > regel.confidence + 0.15;

    return {
      belegart:     nimmKi ? (data.belegart || regel.belegart) : regel.belegart,
      relevanz:     nimmKi ? (data.relevanz || regel.relevanz) : regel.relevanz,
      grund:        regel.grund ?? data.grund ?? null,
      confidence:   Number(Math.max(regel.confidence, nimmKi ? kiConfidence : 0).toFixed(2)),
      periodeBeleg: regel.periodeBeleg ?? data.periode ?? null,
      begruendung:  nimmKi
        ? `KI${beleg.bild ? " (Bild)" : ""}: ${data.begruendung || "keine Begründung"} (Regel sagte: ${regel.begruendung})`
        : `${regel.begruendung} (KI weniger sicher, verworfen)`,
      positionen:   Array.isArray(data.positionen) ? data.positionen : [],
      quelle:       nimmKi ? "ki" : "regel",
    };
  } catch (e) {
    // Die KI ist ein Hilfsmittel, kein Single Point of Failure. Fällt sie aus,
    // bleibt die Regel-Einschätzung stehen — der Mensch sieht sie im Review.
    return {
      ...regel,
      quelle: "regel",
      begruendung: `${regel.begruendung} (KI nicht erreichbar: ${e.message})`,
    };
  }
}

/**
 * Triage über einen ganzen Stapel. Sequenziell für die KI-Aufrufe, damit
 * wir die Edge Function nicht mit 200 parallelen Calls überfahren.
 */
export async function triageStapel(supabase, belege, kontext = {}, onProgress) {
  const hashes = [...(kontext.bekannteHashes || [])];
  const ergebnisse = [];

  for (let i = 0; i < belege.length; i++) {
    const r = await triageMitKi(supabase, belege[i], { ...kontext, bekannteHashes: hashes });
    if (belege[i].dateiHash) hashes.push(belege[i].dateiHash);
    ergebnisse.push({ beleg: belege[i], ...r });
    onProgress?.(i + 1, belege.length);
  }
  return ergebnisse;
}
