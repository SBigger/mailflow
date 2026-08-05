/**
 * Tests für den eCH-0119-Export.
 *
 * Der wichtigste Test hier ist der letzte: dass sich OHNE verifizierte XSD
 * kein übermittlungsfähiges Paket bauen lässt. Das ist die Schutzschranke,
 * die verhindert, dass jemand ein geratenes Schema an eine Steuerverwaltung
 * schickt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { baueXml, validieren, paketBauen, SCHEMA } from "../src/lib/ech0119.js";

const person = {
  name: "Muster", vorname: "Anna", zivilstand: "verheiratet", gemeinde: "Winterthur",
};
const deklaration = { kanton: "ZH", periode: 2026 };

test("baueXml erzeugt wohlgeformtes XML mit Kopfdaten", () => {
  const xml = baueXml({ deklaration, person, positionen: [] });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<taxDeclaration/);
  assert.match(xml, /<canton>ZH<\/canton>/);
  assert.match(xml, /<taxPeriod>2026<\/taxPeriod>/);
  assert.match(xml, /<name>Muster<\/name>/);
  assert.match(xml, /<firstName>Anna<\/firstName>/);
});

test("Positionen werden nach ech_pfad verschachtelt", () => {
  const xml = baueXml({
    deklaration, person,
    positionen: [
      { ech_pfad: "listOfSecurities.totalTaxValue", wert_num: 125000 },
      { ech_pfad: "listOfLiabilities.totalInterest", wert_num: 4200.5 },
    ],
  });
  assert.match(xml, /<listOfSecurities>[\s\S]*<totalTaxValue>125000\.00<\/totalTaxValue>/);
  assert.match(xml, /<listOfLiabilities>[\s\S]*<totalInterest>4200\.50<\/totalInterest>/);
});

test("Mehrere Belege auf dasselbe Zielfeld werden summiert", () => {
  const xml = baueXml({
    deklaration, person,
    positionen: [
      { ech_pfad: "mainForm.deduction.donation", wert_num: 300 },
      { ech_pfad: "mainForm.deduction.donation", wert_num: 250 },
    ],
  });
  assert.match(xml, /<donation>550\.00<\/donation>/);
});

test("Sonderzeichen werden escaped", () => {
  const xml = baueXml({
    deklaration,
    person: { ...person, name: "Müller & Söhne <AG>" },
    positionen: [],
  });
  assert.match(xml, /<name>Müller &amp; Söhne &lt;AG&gt;<\/name>/);
  assert.ok(!xml.includes("<AG>"), "rohe spitze Klammern dürfen nicht durchrutschen");
});

test("baueXml verlangt Deklaration und Person", () => {
  assert.throws(() => baueXml({ person, positionen: [] }), /deklaration fehlt/);
  assert.throws(() => baueXml({ deklaration, positionen: [] }), /person fehlt/);
});

test("validieren meldet die fehlende Schema-Prüfung ehrlich", () => {
  const xml = baueXml({ deklaration, person, positionen: [] });
  const v = validieren(xml);
  assert.equal(v.wohlgeformt, true);
  assert.equal(v.schemakonform, false, "ohne XSD darf nie 'konform' gemeldet werden");
  assert.equal(v.schemaGeprueft, SCHEMA.verifiziert);
  assert.ok(v.hinweis, "es muss ein Hinweis auf die fehlende XSD erscheinen");
});

test("paketBauen verweigert ein Paket, solange die XSD nicht verifiziert ist", async () => {
  assert.equal(SCHEMA.verifiziert, false, "Vorbedingung dieses Tests");
  await assert.rejects(
    () => paketBauen({ deklaration, person, positionen: [] }),
    /nicht verifiziert/,
    "ohne XSD darf kein übermittlungsfähiges Paket entstehen"
  );
});

test("paketBauen liefert im Entwurfsmodus XML samt Hash", async () => {
  const p = await paketBauen({ deklaration, person, positionen: [] }, { entwurf: true });
  assert.ok(p.xml.includes("<taxDeclaration"));
  assert.match(p.hash, /^[0-9a-f]{64}$/, "SHA-256 als Hex erwartet");
  assert.equal(p.entwurf, true);
});
