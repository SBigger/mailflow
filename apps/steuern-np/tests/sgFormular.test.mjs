/**
 * Tests für das SG-Formularmodell und den sortierten Export.
 *
 * Der Kern ist die Reihenfolge: Wer eine Steuererklärung ausfüllt,
 * arbeitet das Formular von Seite 1 nach Seite 4 ab. Der Export muss
 * dieser Reihenfolge folgen, nicht der Erfassungsreihenfolge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POSITIONEN, POSITION_BY_ZIFFER, SEITEN, positionenDerSeite,
  positionenFuerBelegart, sortSchluessel, summenBerechnen, VERIFIZIERT,
} from "../src/lib/sgFormular.js";
import { zeilenBauen, alsUebersicht, alsCsv, alsJsonExport } from "../src/lib/export.js";

const deklaration = { periode: 2025, kanton: "SG" };
const person = { name: "Muster", vorname: "Anna", gemeinde: "Wil", zivilstand: "ledig" };

// ── Modell ────────────────────────────────────────────────────────
test("Es gibt genau vier Formularseiten", () => {
  assert.equal(SEITEN.length, 4);
  assert.deepEqual(SEITEN.map(s => s.nr), [1, 2, 3, 4]);
});

test("Jede Position liegt auf einer gültigen Seite und hat eine Ziffer", () => {
  for (const p of POSITIONEN) {
    assert.ok(p.seite >= 1 && p.seite <= 4, `${p.ziffer} hat Seite ${p.seite}`);
    assert.ok(p.ziffer, "Ziffer fehlt");
    assert.ok(p.label, `${p.ziffer} hat kein Label`);
    assert.ok(Array.isArray(p.belegarten), `${p.ziffer} ohne Belegarten-Liste`);
  }
});

test("Ziffern sind eindeutig", () => {
  const gesehen = new Set();
  for (const p of POSITIONEN) {
    assert.ok(!gesehen.has(p.ziffer), `Ziffer ${p.ziffer} doppelt`);
    gesehen.add(p.ziffer);
  }
});

test("Jede Seite trägt mindestens eine Position", () => {
  for (const s of SEITEN) {
    assert.ok(positionenDerSeite(s.nr).length > 0, `Seite ${s.nr} ist leer`);
  }
});

test("Belegarten führen auf die erwarteten Positionen", () => {
  const lohn = positionenFuerBelegart("lohnausweis").map(p => p.ziffer);
  assert.ok(lohn.includes("100"), "Lohnausweis muss auf Ziffer 100 zeigen");

  // Ein eSteuerauszug zahlt auf zwei Positionen ein: Ertrag und Steuerwert
  const auszug = positionenFuerBelegart("esteuerauszug").map(p => p.ziffer);
  assert.ok(auszug.includes("140"), "Ertrag fehlt");
  assert.ok(auszug.includes("400"), "Steuerwert fehlt");

  assert.deepEqual(positionenFuerBelegart(null), []);
  assert.deepEqual(positionenFuerBelegart("gibtsnicht"), []);
});

test("Schuldzinsen und Schulden bleiben getrennt (Bruttoprinzip)", () => {
  assert.equal(POSITION_BY_ZIFFER["210"].seite, 3, "Schuldzinsen gehören zu den Abzügen");
  assert.equal(POSITION_BY_ZIFFER["420"].seite, 4, "Schulden gehören zum Vermögen");
});

// ── Sortierung ────────────────────────────────────────────────────
test("Sortierschlüssel ordnet über Seiten hinweg korrekt", () => {
  const s = (z) => sortSchluessel(POSITION_BY_ZIFFER[z]);
  assert.ok(s("1.1") < s("100"), "Seite 1 vor Seite 2");
  assert.ok(s("100") < s("140"), "innerhalb Seite 2 numerisch");
  assert.ok(s("199") < s("200"), "Seite 2 vor Seite 3");
  assert.ok(s("299") < s("300"), "Seite 3 vor Seite 4");
});

test("Unterziffern werden numerisch sortiert, nicht alphabetisch", () => {
  // 1.10 gäbe es alphabetisch vor 1.2 — numerisch muss 1.2 zuerst kommen
  const a = sortSchluessel({ seite: 1, ziffer: "1.2" });
  const b = sortSchluessel({ seite: 1, ziffer: "1.10" });
  assert.ok(a < b, "1.2 muss vor 1.10 liegen");
});

// ── Summen ────────────────────────────────────────────────────────
test("Total der Einkünfte summiert die Einzelpositionen", () => {
  const s = summenBerechnen({ "100": 80000, "140": 1200, "150": 9000 });
  assert.equal(s["199"], 90200);
});

test("Steuerbares Einkommen ist Einkünfte abzüglich Abzüge", () => {
  const s = summenBerechnen({ "100": 90000, "200": 3000, "235": 7258 });
  assert.equal(s["199"], 90000);
  assert.equal(s["299"], 10258);
  assert.equal(s["300"], 79742);
});

test("Steuerbares Vermögen zieht Schulden ab", () => {
  const s = summenBerechnen({ "400": 125000, "415": 600000, "420": 420000 });
  assert.equal(s["499"], 305000, "725'000 Aktiven minus 420'000 Schulden");
});

// ── Export ────────────────────────────────────────────────────────
const positionen = [
  // bewusst in falscher Reihenfolge erfasst
  { ziffer: "400", bezeichnung: "Steuerwert", betrag: 125000, herkunft: "ech0196", beleg_id: "b1" },
  { ziffer: "100", bezeichnung: "Nettolohn",  betrag: 87066,  herkunft: "ki",      beleg_id: "b2" },
  { ziffer: "235", bezeichnung: "Säule 3a",   betrag: 7258,   herkunft: "manuell", bestaetigt_von: "u1" },
  { ziffer: "235", bezeichnung: "Säule 3a Partner", betrag: 3000, herkunft: "manuell", bestaetigt_von: "u1" },
];
const belege = [
  { id: "b1", dateiname: "esteuerauszug.xml", relevanz: "relevant" },
  { id: "b2", dateiname: "lohnausweis.pdf",   relevanz: "relevant" },
  { id: "b3", dateiname: "werbung.pdf", relevanz: "nicht_relevant", relevanz_grund: "werbung" },
];

test("Zeilen kommen in Formularreihenfolge, nicht in Erfassungsreihenfolge", () => {
  const z = zeilenBauen(positionen, belege).map(x => x.ziffer);
  const iLohn = z.indexOf("100"), i3a = z.indexOf("235"), iVerm = z.indexOf("400");
  assert.ok(iLohn < i3a && i3a < iVerm, `Reihenfolge falsch: ${z.join(", ")}`);
});

test("Mehrere Belege auf derselben Ziffer werden summiert und einzeln ausgewiesen", () => {
  const zeile = zeilenBauen(positionen, belege).find(z => z.ziffer === "235");
  assert.equal(zeile.betrag, 10258);
  assert.equal(zeile.teile.length, 2, "beide Teilbeträge bleiben sichtbar");
});

test("Summenzeilen erscheinen im Export", () => {
  const z = zeilenBauen(positionen, belege);
  const total = z.find(x => x.ziffer === "199");
  assert.ok(total, "Total der Einkünfte fehlt");
  assert.equal(total.istSumme, true);
});

test("Übersicht nennt alle vier Seiten mit Inhalt und weist auf ungeprüfte Ziffern hin", () => {
  const t = alsUebersicht({ deklaration, person, positionen, belege });
  assert.match(t, /Seite 2 · Einkünfte/);
  assert.match(t, /Seite 3 · Abzüge/);
  assert.match(t, /Seite 4 · Vermögen/);
  assert.match(t, /Anna Muster/);
  if (!VERIFIZIERT) assert.match(t, /nicht gegen die Wegleitung/i);
});

test("CSV nutzt Semikolon als Trenner und die amtliche Bezeichnung", () => {
  const csv = alsCsv({ deklaration, person, positionen, belege });
  assert.match(csv, /Seite;Ziffer;Bezeichnung/);
  // Die Spalte zeigt die Formularbezeichnung, nicht den frei erfassten Text
  assert.match(csv, /;100;Einkünfte aus unselbständiger Erwerbstätigkeit;/);
});

test("Dateinamen mit Sonderzeichen werden in der CSV maskiert", () => {
  // Der Dateiname ist das einzige Feld mit echtem Fremdtext — und unter
  // Linux darf darin ein Semikolon stehen.
  const csv = alsCsv({
    deklaration, person,
    belege: [{ id: "bx", dateiname: 'quittung;"gross".pdf', relevanz: "relevant" }],
    positionen: [{ ziffer: "100", bezeichnung: "Lohn", betrag: 1, beleg_id: "bx" }],
  });
  assert.match(csv, /"quittung;""gross"".pdf"/,
    "Semikolon und Anführungszeichen müssen maskiert sein");
});

test("JSON-Export führt die aussortierten Belege mit", () => {
  const j = JSON.parse(alsJsonExport({ deklaration, person, positionen, belege }));
  assert.equal(j.steuerperiode, 2025);
  assert.equal(j.seiten.length, 4);
  assert.equal(j.ziffernGeprueft, VERIFIZIERT);
  assert.equal(j.aussortiert.length, 1);
  assert.equal(j.aussortiert[0].dateiname, "werbung.pdf");
});

test("Export übersteht eine leere Deklaration", () => {
  const leer = { deklaration, person, positionen: [], belege: [] };
  assert.doesNotThrow(() => alsUebersicht(leer));
  assert.doesNotThrow(() => alsCsv(leer));
  assert.doesNotThrow(() => JSON.parse(alsJsonExport(leer)));
});
