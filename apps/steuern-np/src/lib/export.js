/**
 * Export der zugewiesenen Positionen — sortiert wie das Formular.
 *
 * Drei Formate, drei Zwecke:
 *   Übersicht (Text)  zum Abtippen in E-Tax SG oder zur Kontrolle auf Papier
 *   CSV               für Excel und die Weiterverarbeitung
 *   JSON              als Datenformat, verlustfrei, mit Belegverweisen
 *
 * Sortiert wird immer nach Formularseite und Ziffer — nicht nach
 * Erfassungsreihenfolge. Wer die Steuererklärung ausfüllt, arbeitet
 * das Formular von vorne nach hinten ab, und der Export soll dieser
 * Reihenfolge folgen.
 */

import {
  POSITIONEN, POSITION_BY_ZIFFER, SEITEN, FORMULAR, VERIFIZIERT,
  sortSchluessel, summenBerechnen,
} from "./sgFormular.js";

const HINWEIS_UNGEPRUEFT =
  "ACHTUNG: Die Ziffern dieses Formularmodells sind noch nicht gegen die " +
  "Wegleitung des Kantons St. Gallen geprüft. Vor der Übernahme in die " +
  "Steuererklärung abgleichen.";

function chf(n) {
  if (n == null) return "";
  return Number(n).toLocaleString("de-CH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/**
 * Fasst die Positionen zu Formularzeilen zusammen: eine Zeile je Ziffer,
 * mit Summe und den beitragenden Belegen.
 */
export function zeilenBauen(positionen, belege = []) {
  const belegNachId = Object.fromEntries(belege.map(b => [b.id, b]));
  const proZiffer = new Map();

  for (const p of positionen) {
    if (!p.ziffer) continue;
    const eintrag = proZiffer.get(p.ziffer) ?? { ziffer: p.ziffer, betrag: 0, teile: [] };
    if (p.betrag != null) eintrag.betrag += Number(p.betrag) || 0;
    eintrag.teile.push({
      bezeichnung: p.bezeichnung || "",
      betrag: p.betrag ?? null,
      herkunft: p.herkunft || "manuell",
      bestaetigt: !!p.bestaetigt_von,
      beleg: belegNachId[p.beleg_id]?.dateiname ?? null,
    });
    proZiffer.set(p.ziffer, eintrag);
  }

  const betraege = Object.fromEntries([...proZiffer].map(([z, e]) => [z, e.betrag]));
  const mitSummen = summenBerechnen(betraege);

  return POSITIONEN
    .filter(p => proZiffer.has(p.ziffer) || (p.summeVon && mitSummen[p.ziffer]))
    .sort((a, b) => sortSchluessel(a) - sortSchluessel(b))
    .map(p => ({
      seite: p.seite,
      ziffer: p.ziffer,
      label: p.label,
      betrag: p.summeVon ? mitSummen[p.ziffer] : (proZiffer.get(p.ziffer)?.betrag ?? null),
      istSumme: !!p.summeVon,
      teile: proZiffer.get(p.ziffer)?.teile ?? [],
      hinweis: p.hinweis ?? null,
    }));
}

// ══════════════════════════════════════════════════════════════════════
// Übersicht zum Abtippen
// ══════════════════════════════════════════════════════════════════════

export function alsUebersicht({ deklaration, person, positionen, belege }) {
  const zeilen = zeilenBauen(positionen, belege);
  const aus = [];

  aus.push(FORMULAR);
  aus.push(`Steuerperiode ${deklaration.periode}`);
  aus.push(`${person.vorname || ""} ${person.name}`.trim() +
           (person.gemeinde ? ` · ${person.gemeinde}` : ""));
  aus.push("");
  if (!VERIFIZIERT) { aus.push(HINWEIS_UNGEPRUEFT); aus.push(""); }

  for (const seite of SEITEN) {
    const derSeite = zeilen.filter(z => z.seite === seite.nr);
    if (!derSeite.length) continue;

    aus.push(`── Seite ${seite.nr} · ${seite.titel} ${"─".repeat(Math.max(0, 44 - seite.titel.length))}`);
    for (const z of derSeite) {
      const ziffer = z.ziffer.padEnd(6);
      const label = z.label.length > 46 ? z.label.slice(0, 45) + "…" : z.label.padEnd(46);
      const betrag = chf(z.betrag).padStart(14);
      aus.push(`${z.istSumme ? "=" : " "} ${ziffer}${label}${betrag}`);

      // Beitragende Belege einrücken, damit die Herkunft sichtbar bleibt
      if (!z.istSumme && z.teile.length > 1) {
        for (const t of z.teile) {
          aus.push(`      ${(t.beleg || t.bezeichnung || "—").slice(0, 44).padEnd(46)}` +
                   `${chf(t.betrag).padStart(14)}`);
        }
      }
    }
    aus.push("");
  }

  const unbestaetigt = positionen.filter(p => p.betrag != null && !p.bestaetigt_von).length;
  if (unbestaetigt) {
    aus.push(`Offen: ${unbestaetigt} Position(en) noch nicht bestätigt.`);
  }
  aus.push(`Erstellt: ${new Date().toLocaleString("de-CH")}`);

  return aus.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// CSV
// ══════════════════════════════════════════════════════════════════════

function csvFeld(w) {
  const s = String(w ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function alsCsv({ deklaration, person, positionen, belege }) {
  const zeilen = zeilenBauen(positionen, belege);
  const kopf = ["Seite", "Ziffer", "Bezeichnung", "Betrag CHF", "Art", "Belege"];
  const daten = zeilen.map(z => [
    z.seite, z.ziffer, z.label,
    z.betrag != null ? Number(z.betrag).toFixed(2) : "",
    z.istSumme ? "Summe" : "Position",
    z.teile.map(t => t.beleg).filter(Boolean).join(" | "),
  ]);

  // Semikolon als Trenner: Excel in der Schweiz erwartet das.
  const meta = [
    [`# ${FORMULAR}`], [`# Steuerperiode ${deklaration.periode}`],
    [`# ${`${person.vorname || ""} ${person.name}`.trim()}`],
  ];
  if (!VERIFIZIERT) meta.push([`# ${HINWEIS_UNGEPRUEFT}`]);

  return [...meta, kopf, ...daten].map(r => r.map(csvFeld).join(";")).join("\r\n");
}

// ══════════════════════════════════════════════════════════════════════
// JSON
// ══════════════════════════════════════════════════════════════════════

export function alsJsonExport({ deklaration, person, positionen, belege }) {
  const zeilen = zeilenBauen(positionen, belege);
  return JSON.stringify({
    formular: FORMULAR,
    ziffernGeprueft: VERIFIZIERT,
    hinweis: VERIFIZIERT ? null : HINWEIS_UNGEPRUEFT,
    erstellt: new Date().toISOString(),
    steuerperiode: deklaration.periode,
    kanton: deklaration.kanton,
    person: {
      name: person.name, vorname: person.vorname ?? null,
      gemeinde: person.gemeinde ?? null, zivilstand: person.zivilstand ?? null,
    },
    seiten: SEITEN.map(s => ({
      seite: s.nr, titel: s.titel,
      positionen: zeilen.filter(z => z.seite === s.nr).map(z => ({
        ziffer: z.ziffer, bezeichnung: z.label,
        betrag: z.betrag != null ? Number(Number(z.betrag).toFixed(2)) : null,
        istSumme: z.istSumme,
        belege: z.teile.map(t => ({
          beleg: t.beleg, betrag: t.betrag, herkunft: t.herkunft, bestaetigt: t.bestaetigt,
        })),
      })),
    })),
    aussortiert: belege.filter(b => b.relevanz === "nicht_relevant").map(b => ({
      dateiname: b.dateiname, grund: b.relevanz_grund ?? null, belegart: b.belegart ?? null,
    })),
  }, null, 2);
}

// ══════════════════════════════════════════════════════════════════════
// Speichern
// ══════════════════════════════════════════════════════════════════════

/**
 * Schreibt die Datei. In der lokalen App über den Dateidialog des
 * Hauptprozesses, im Browser als Download.
 */
export async function exportSpeichern(dateiname, inhalt) {
  if (typeof window !== "undefined" && window.steuerAPI?.dateiSpeichern) {
    return await window.steuerAPI.dateiSpeichern(dateiname, inhalt);
  }
  const blob = new Blob([inhalt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = dateiname; a.click();
  URL.revokeObjectURL(url);
  return { pfad: dateiname, download: true };
}

export function dateinameBauen(deklaration, person, endung) {
  const sicher = (s) => String(s || "").replace(/[^\w.\-]+/g, "_");
  return `Steuererklaerung_${sicher(person.name)}_${deklaration.periode}.${endung}`;
}
