/**
 * Tests für die Kernlogik der Triage und den Betrags-Parser.
 *
 * Bewusst ohne Browser-APIs: getestet wird, was auch ohne DOM läuft.
 * Der XML-Parser selbst braucht DOMParser und wird erst mit einem echten
 * Muster-eSteuerauszug sinnvoll testbar (Backlog V11).
 *
 * Aufruf: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { triageRegeln, brauchtKi, findePeriode, normalize, SCHWELLE_KI }
  from "../src/lib/triage.js";
import { parseBetrag } from "../src/lib/ech0196.js";
import { BELEGART_BY_KEY, echPfadFuer } from "../src/lib/belegarten.js";

// ── normalize ─────────────────────────────────────────────────────
test("normalize macht Umlaute und Diakritika vergleichbar", () => {
  assert.equal(normalize("Säule 3a"), "saeule 3a");
  assert.equal(normalize("Prämien"), "praemien");
  assert.equal(normalize("  MEHRFACH   Leer "), "mehrfach leer");
});

// ── Betrags-Parser ────────────────────────────────────────────────
test("parseBetrag versteht Schweizer Formatierung", () => {
  assert.equal(parseBetrag("1'234.50"), 1234.5);
  assert.equal(parseBetrag("CHF 1'234.50"), 1234.5);
  assert.equal(parseBetrag("12345"), 12345);
  assert.equal(parseBetrag("-500.25"), -500.25);
});

test("parseBetrag versteht deutsche Formatierung mit Komma", () => {
  assert.equal(parseBetrag("1.234,50"), 1234.5);
  assert.equal(parseBetrag("1234,50"), 1234.5);
});

test("parseBetrag gibt null statt zu raten", () => {
  assert.equal(parseBetrag(""), null);
  assert.equal(parseBetrag(null), null);
  assert.equal(parseBetrag("kein Betrag"), null);
});

// ── Periodenerkennung ─────────────────────────────────────────────
test("findePeriode bevorzugt das erwartete Jahr, wenn es vorkommt", () => {
  const text = "Rechnung vom 03.02.2024, Steuerperiode 2025, gedruckt 2026";
  assert.equal(findePeriode(text, 2025), 2025);
});

test("findePeriode gewichtet Kontexttreffer stärker als lose Jahreszahlen", () => {
  const text = "Kundennummer 2019 — Steuerperiode 2025";
  assert.equal(findePeriode(text, null), 2025);
});

test("findePeriode gibt null ohne Jahresangabe", () => {
  assert.equal(findePeriode("kein Datum enthalten", 2025), null);
});

// ── Triage: strukturierte Quellen ─────────────────────────────────
test("eCH-0196 setzt die Belegart ohne KI fest", () => {
  const r = triageRegeln(
    { text: "irgendein Inhalt", parseMethode: "ech0196" },
    { periode: 2025 }
  );
  assert.equal(r.belegart, "esteuerauszug");
  assert.equal(r.relevanz, "relevant");
  assert.equal(r.confidence, 1);
  assert.equal(brauchtKi(r), false, "strukturierte Quelle darf die KI nicht bemühen");
});

// ── Triage: Duplikate ─────────────────────────────────────────────
test("Duplikat schlägt jedes andere Signal", () => {
  const r = triageRegeln(
    { text: "Lohnausweis Bruttolohn AHV", dateiHash: "abc", parseMethode: "pdf_text" },
    { periode: 2025, bekannteHashes: ["abc"] }
  );
  assert.equal(r.relevanz, "nicht_relevant");
  assert.equal(r.grund, "duplikat");
  assert.equal(brauchtKi(r), false);
});

// ── Triage: Keyword-Erkennung ─────────────────────────────────────
test("Lohnausweis wird über starke Signale erkannt", () => {
  const r = triageRegeln(
    { text: "Lohnausweis 2025\nBruttolohn 85'000\nAHV/ALV Beiträge", parseMethode: "pdf_text" },
    { periode: 2025 }
  );
  assert.equal(r.belegart, "lohnausweis");
  assert.equal(r.relevanz, "relevant");
  assert.ok(r.confidence >= SCHWELLE_KI, `Confidence ${r.confidence} sollte über der Schwelle liegen`);
});

test("Werbung wird aussortiert, aber mit Grund", () => {
  const r = triageRegeln(
    { text: "Newsletter — jetzt profitieren von unserem Angebot!", parseMethode: "pdf_text" },
    { periode: 2025 }
  );
  assert.equal(r.relevanz, "nicht_relevant");
  assert.equal(r.grund, "werbung");
});

test("Unbekannter Beleg geht als unklar an die KI", () => {
  const r = triageRegeln(
    { text: "Lorem ipsum dolor sit amet", parseMethode: "ocr" },
    { periode: 2025 }
  );
  assert.equal(r.relevanz, "unklar");
  assert.equal(r.confidence, 0);
  assert.equal(brauchtKi(r), true);
});

// ── Triage: Plausi Periode ────────────────────────────────────────
test("Falsche Periode wird nie stillschweigend verworfen", () => {
  const r = triageRegeln(
    { text: "Lohnausweis Steuerperiode 2019 Bruttolohn AHV", parseMethode: "pdf_text" },
    { periode: 2025 }
  );
  assert.equal(r.relevanz, "unklar", "muss dem Menschen vorgelegt werden");
  assert.equal(r.grund, "falsche_periode");
  assert.notEqual(r.relevanz, "nicht_relevant", "darf nicht automatisch aussortiert werden");
});

// ── Belegarten-Katalog ────────────────────────────────────────────
test("Jede Belegart hat ein Ziel oder ist ausdrücklich eine Prüfgrösse", () => {
  for (const [key, art] of Object.entries(BELEGART_BY_KEY)) {
    if (key === "veranlagung_vorjahr") {
      assert.equal(art.ech_pfad, null, "Vorjahres-Veranlagung ist Prüfgrösse, kein Zielfeld");
    } else {
      assert.ok(art.ech_pfad, `${key} braucht ein eCH-0119-Ziel`);
    }
    assert.ok(art.label, `${key} braucht ein Label`);
    assert.ok(Array.isArray(art.keywords), `${key} braucht Keywords`);
  }
});

test("echPfadFuer liefert null statt zu werfen", () => {
  assert.equal(echPfadFuer("gibtsnicht"), null);
  assert.equal(echPfadFuer("esteuerauszug"), "listOfSecurities");
});
