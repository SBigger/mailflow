/**
 * eCH-0119 «E-Tax Filing» — Erzeugung des Übermittlungspakets.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️  DIESER GENERATOR IST NOCH NICHT SCHEMAKONFORM.
 *
 * Die XSD zu eCH-0119 V4.0.0 konnte bisher nicht eingesehen werden
 * (Backlog V1 in docs/recherche-und-architektur.md). Die Elementnamen
 * unten stammen aus dem Standarddokument; Kardinalitäten, Datentypen,
 * Reihenfolge und Pflichtfelder sind NICHT verifiziert.
 *
 * Das Paket darf deshalb NICHT an eine Steuerverwaltung übermittelt
 * werden. `paketBauen()` wirft, solange `validieren` keinen echten
 * Validator bekommt — das ist Absicht, nicht ein fehlendes Feature.
 *
 * Die gesamte Schema-Annahme steckt in SCHEMA und baueXml(). Sobald die
 * XSD vorliegt, ist die Korrektur ein Eingriff an einer Stelle.
 * ══════════════════════════════════════════════════════════════════════
 */

/** Alles, was nach XSD-Erhalt zu prüfen ist, an einem Ort. */
export const SCHEMA = {
  version: "4.0.0",
  // Namespace ist geraten — Kap. 3.5 des Standards regelt zudem die
  // kantonalen Namespaces für cantonExtension.
  namespace: "http://www.ech.ch/xmlns/eCH-0119/4",
  wurzel: "taxDeclaration",
  // Bekannte Elemente aus dem Standarddokument (§2.1 der Recherche)
  bekannteElemente: [
    "mainForm", "listOfSecurities", "listOfLiabilities",
    "qualifiedInvestmentsPrivate", "qualifiedInvestmentsBusiness",
    "jobExpenses", "jobOrientedFurtherEducationCost", "insurancePremiums",
    "diseaseAndAccidentExpenses", "handicapExpenses", "cantonExtension",
  ],
  verifiziert: false,   // ← auf true setzen, wenn gegen die XSD geprüft
};

// ══════════════════════════════════════════════════════════════════════
// XML-Bau
// ══════════════════════════════════════════════════════════════════════

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function tag(name, inhalt, tiefe = 0) {
  const ein = "  ".repeat(tiefe);
  if (inhalt == null || inhalt === "") return "";
  return `${ein}<${name}>${inhalt}</${name}>\n`;
}

function betrag(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n).toFixed(2);
}

/**
 * Gruppiert die Positionen nach ihrem ech_pfad.
 * Der Pfad ist punktsepariert ('listOfSecurities.totalTaxValue') und wird
 * in verschachtelte Elemente übersetzt.
 */
function nachPfadGruppieren(positionen) {
  const baum = {};
  for (const p of positionen) {
    if (!p.ech_pfad) continue;
    const teile = p.ech_pfad.split(".");
    let knoten = baum;
    for (let i = 0; i < teile.length - 1; i++) {
      knoten[teile[i]] ||= {};
      knoten = knoten[teile[i]];
    }
    const blatt = teile[teile.length - 1];
    // Mehrere Belege auf dasselbe Zielfeld werden summiert — das ist der
    // Normalfall (drei Spendenbescheinigungen, ein Abzug).
    knoten[blatt] = (knoten[blatt] ?? 0) + (Number(p.wert_num) || 0);
  }
  return baum;
}

function baumZuXml(knoten, tiefe) {
  let out = "";
  for (const [name, wert] of Object.entries(knoten)) {
    if (wert && typeof wert === "object") {
      const inneres = baumZuXml(wert, tiefe + 1);
      if (inneres) {
        out += `${"  ".repeat(tiefe)}<${name}>\n${inneres}${"  ".repeat(tiefe)}</${name}>\n`;
      }
    } else {
      const b = betrag(wert);
      if (b != null) out += tag(name, b, tiefe);
    }
  }
  return out;
}

/**
 * Erzeugt taxDeclaration.xml.
 *
 * @param {object} eingabe
 *   @param {object} eingabe.deklaration  Zeile aus `deklarationen`
 *   @param {object} eingabe.person       Zeile aus `np_personen`
 *   @param {Array}  eingabe.positionen   bestätigte Positionen
 *   @param {Array}  [eingabe.beilagen]   [{ dateiname }]
 * @returns {string}
 */
export function baueXml({ deklaration, person, positionen = [], beilagen = [] }) {
  if (!deklaration) throw new Error("deklaration fehlt");
  if (!person) throw new Error("person fehlt");

  const inhalt = baumZuXml(nachPfadGruppieren(positionen), 3);

  const beilagenXml = beilagen.length
    ? `    <attachments>\n` +
      beilagen.map(b => `      <attachment>${esc(b.dateiname)}</attachment>\n`).join("") +
      `    </attachments>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<${SCHEMA.wurzel} xmlns="${SCHEMA.namespace}" version="${SCHEMA.version}">
  <header>
    <canton>${esc(deklaration.kanton)}</canton>
    <taxPeriod>${esc(deklaration.periode)}</taxPeriod>
  </header>
  <content>
    <personalData>
      <name>${esc(person.name)}</name>
      <firstName>${esc(person.vorname || "")}</firstName>
      <maritalStatus>${esc(person.zivilstand || "")}</maritalStatus>
      <municipality>${esc(person.gemeinde || "")}</municipality>
    </personalData>
${inhalt || "    <!-- keine bestätigten Positionen -->\n"}${beilagenXml}  </content>
</${SCHEMA.wurzel}>
`;
}

// ══════════════════════════════════════════════════════════════════════
// Validierung
// ══════════════════════════════════════════════════════════════════════

/**
 * Platzhalter für die XSD-Validierung.
 *
 * Solange SCHEMA.verifiziert false ist, meldet diese Funktion das ehrlich
 * zurück, statt ein „gültig" vorzutäuschen. Wenn die XSD vorliegt, hier
 * einen echten Validator einhängen (z.B. libxmljs2 oder xmllint im Backend).
 */
export function validieren(xml) {
  const fehler = [];

  if (!xml?.startsWith("<?xml")) fehler.push("Keine XML-Deklaration");
  if (!xml?.includes(`<${SCHEMA.wurzel}`)) fehler.push(`Wurzelelement ${SCHEMA.wurzel} fehlt`);

  // Wohlgeformtheit prüfen wir schon heute — das ist unabhängig von der XSD.
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) fehler.push("XML ist nicht wohlgeformt");
  }

  return {
    wohlgeformt: fehler.length === 0,
    schemakonform: false,
    schemaGeprueft: SCHEMA.verifiziert,
    fehler,
    hinweis: SCHEMA.verifiziert
      ? null
      : "Die eCH-0119-XSD liegt noch nicht vor. Das Paket ist nicht übermittlungsfähig.",
  };
}

// ══════════════════════════════════════════════════════════════════════
// Paket
// ══════════════════════════════════════════════════════════════════════

async function sha256Hex(text) {
  const daten = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", daten);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Baut das Übermittlungspaket: taxDeclaration.xml plus Beilagenliste.
 *
 * @param {object} eingabe            wie baueXml
 * @param {object} [opt]
 *   @param {boolean} [opt.entwurf]   true erlaubt den Bau trotz fehlender XSD —
 *                                     das Ergebnis ist ausdrücklich ein Entwurf
 * @returns {Promise<{xml: string, hash: string, validierung: object, entwurf: boolean}>}
 */
export async function paketBauen(eingabe, opt = {}) {
  const xml = baueXml(eingabe);
  const validierung = validieren(xml);

  if (!validierung.wohlgeformt) {
    throw new Error(`Paket ungültig: ${validierung.fehler.join(", ")}`);
  }

  // Der eigentliche Schutz: ohne verifizierte XSD gibt es kein Paket,
  // das jemand versehentlich einreichen könnte.
  if (!SCHEMA.verifiziert && !opt.entwurf) {
    throw new Error(
      "Kein übermittlungsfähiges Paket möglich: die eCH-0119-XSD ist nicht verifiziert " +
      "(Backlog V1). Für eine Vorschau paketBauen(…, { entwurf: true }) aufrufen."
    );
  }

  return {
    xml,
    hash: await sha256Hex(xml),
    validierung,
    entwurf: !SCHEMA.verifiziert,
  };
}
