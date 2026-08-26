/**
 * Lokale Datenbank — eine Datei, kein Server.
 *
 * Die Anwendung läuft ab Laufwerk. Deshalb liegt der gesamte Datenbestand
 * in einer JSON-Datei neben der Anwendung (`steuerdaten.json`), geschrieben
 * über den Electron-Hauptprozess. Läuft die Oberfläche im Browser statt in
 * Electron, weicht sie auf `localStorage` aus — dann ist es eine Demo, und
 * die App sagt das auch.
 *
 * Warum kein SQLite: das bräuchte ein natives Modul, das je Plattform
 * kompiliert werden muss. Für ein paar hundert Mandate mit ihren Belegen
 * ist eine Datei schneller als jede Datenbank und lässt sich von Hand
 * öffnen, sichern und auf ein anderes Laufwerk kopieren.
 *
 * Belegdateien liegen daneben in `belege/<mandant>/<deklaration>/`.
 */

const LEER = {
  version: 1,
  benutzer: [],
  mandanten: [],
  personen: [],
  deklarationen: [],
  belege: [],
  positionen: [],
  protokoll: [],
};

/** Läuft die Oberfläche im Electron-Hauptprozess mit Dateizugriff? */
export const istLokal = typeof window !== "undefined" && !!window.steuerAPI;

const SPEICHER_KEY = "steuern-np.db";

let cache = null;

// ══════════════════════════════════════════════════════════════════════
// Laden und Speichern
// ══════════════════════════════════════════════════════════════════════

export async function laden() {
  if (cache) return cache;

  if (istLokal) {
    const roh = await window.steuerAPI.dbLesen();
    cache = roh ? { ...LEER, ...roh } : structuredClone(LEER);
  } else {
    try {
      const roh = localStorage.getItem(SPEICHER_KEY);
      cache = roh ? { ...LEER, ...JSON.parse(roh) } : structuredClone(LEER);
    } catch {
      cache = structuredClone(LEER);
    }
  }
  return cache;
}

async function speichern() {
  if (!cache) return;
  if (istLokal) await window.steuerAPI.dbSchreiben(cache);
  else localStorage.setItem(SPEICHER_KEY, JSON.stringify(cache));
}

/** Wo liegt der Datenbestand? Für die Anzeige in der Oberfläche. */
export async function speicherOrt() {
  if (istLokal) return await window.steuerAPI.dbPfad();
  return "Browser-Speicher (Demo — nicht dauerhaft)";
}

function id() {
  return (crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function jetzt() { return new Date().toISOString(); }

/**
 * Protokolliert jede Änderung. Bei geteilten Kantonszugängen ist das die
 * einzige Stelle, an der nachvollziehbar bleibt, wer was getan hat.
 */
async function protokollieren(aktion, entitaet, entitaetId, details) {
  cache.protokoll.push({
    id: id(), ts: jetzt(), benutzer: cache.aktiverBenutzer ?? null,
    aktion, entitaet, entitaet_id: entitaetId, details: details ?? null,
  });
  // Das Protokoll wächst; die letzten 5000 Einträge genügen für die Praxis.
  if (cache.protokoll.length > 5000) cache.protokoll = cache.protokoll.slice(-5000);
}

// ══════════════════════════════════════════════════════════════════════
// Benutzer
// ══════════════════════════════════════════════════════════════════════

export async function benutzerListe() {
  const db = await laden();
  return db.benutzer;
}

export async function benutzerAnlegen({ name, kuerzel, rolle = "bearbeiter" }) {
  const db = await laden();
  if (!name?.trim()) throw new Error("Name darf nicht leer sein");
  const b = { id: id(), name: name.trim(), kuerzel: (kuerzel || name.slice(0, 2)).toUpperCase(),
              rolle, angelegt: jetzt() };
  db.benutzer.push(b);
  await protokollieren("benutzer_angelegt", "benutzer", b.id, name);
  await speichern();
  return b;
}

export async function benutzerWaehlen(benutzerId) {
  const db = await laden();
  db.aktiverBenutzer = benutzerId;
  await speichern();
}

export async function aktiverBenutzer() {
  const db = await laden();
  return db.benutzer.find(b => b.id === db.aktiverBenutzer) || null;
}

// ══════════════════════════════════════════════════════════════════════
// Mandanten, Personen, Deklarationen
// ══════════════════════════════════════════════════════════════════════

export async function mandantenListe() {
  const db = await laden();
  return db.mandanten;
}

export async function mandantAnlegen({ name, uid = "", thId = "" }) {
  const db = await laden();
  if (!name?.trim()) throw new Error("Mandantenname darf nicht leer sein");
  const m = { id: id(), name: name.trim(), uid, th_id_sg: thId, angelegt: jetzt() };
  db.mandanten.push(m);
  await protokollieren("mandant_angelegt", "mandant", m.id, name);
  await speichern();
  return m;
}

export async function personenListe(mandantId) {
  const db = await laden();
  return db.personen.filter(p => p.mandant_id === mandantId);
}

export async function personAnlegen(person) {
  const db = await laden();
  if (!person.name?.trim()) throw new Error("Name darf nicht leer sein");
  const p = { id: id(), angelegt: jetzt(), kanton: "SG", ...person };
  db.personen.push(p);
  await protokollieren("person_angelegt", "person", p.id, p.name);
  await speichern();
  return p;
}

export async function deklarationenListe(mandantId) {
  const db = await laden();
  return db.deklarationen
    .filter(d => d.mandant_id === mandantId)
    .sort((a, b) => b.periode - a.periode);
}

export async function deklarationAnlegen({ mandantId, personId, periode }) {
  const db = await laden();
  const person = db.personen.find(p => p.id === personId);
  if (!person) throw new Error("Person nicht gefunden");
  if (db.deklarationen.some(d => d.person_id === personId && d.periode === Number(periode))) {
    throw new Error("Für diese Person und Periode besteht bereits eine Deklaration");
  }
  const d = {
    id: id(), mandant_id: mandantId, person_id: personId,
    periode: Number(periode), kanton: person.kanton || "SG",
    status: "entwurf", vollmacht: "offen", angelegt: jetzt(),
  };
  db.deklarationen.push(d);
  await protokollieren("deklaration_eroeffnet", "deklaration", d.id, `${person.name} ${periode}`);
  await speichern();
  return d;
}

export async function deklarationAendern(deklarationId, aenderung) {
  const db = await laden();
  const d = db.deklarationen.find(x => x.id === deklarationId);
  if (!d) throw new Error("Deklaration nicht gefunden");
  Object.assign(d, aenderung);
  await protokollieren("deklaration_geaendert", "deklaration", d.id, JSON.stringify(aenderung));
  await speichern();
  return d;
}

// ══════════════════════════════════════════════════════════════════════
// Belege
// ══════════════════════════════════════════════════════════════════════

export async function belegeListe(deklarationId) {
  const db = await laden();
  return db.belege.filter(b => b.deklaration_id === deklarationId);
}

export async function belegAnlegen(beleg) {
  const db = await laden();
  const b = { id: id(), angelegt: jetzt(), ...beleg };
  db.belege.push(b);
  await protokollieren("beleg_erfasst", "beleg", b.id, b.dateiname);
  await speichern();
  return b;
}

export async function belegAendern(belegId, aenderung) {
  const db = await laden();
  const b = db.belege.find(x => x.id === belegId);
  if (!b) throw new Error("Beleg nicht gefunden");
  const vorher = { relevanz: b.relevanz, belegart: b.belegart };
  Object.assign(b, aenderung);
  await protokollieren("beleg_geaendert", "beleg", b.id,
    `${JSON.stringify(vorher)} → ${JSON.stringify(aenderung)}`);
  await speichern();
  return b;
}

// ══════════════════════════════════════════════════════════════════════
// Positionen
// ══════════════════════════════════════════════════════════════════════

export async function positionenListe(deklarationId) {
  const db = await laden();
  return db.positionen.filter(p => p.deklaration_id === deklarationId);
}

export async function positionAnlegen(position) {
  const db = await laden();
  // Invariante: kein Betrag ohne Herkunft.
  if (position.betrag != null && !position.beleg_id && !position.bestaetigt_von) {
    throw new Error("Position ohne Beleg muss von einem Menschen bestätigt sein");
  }
  const p = { id: id(), angelegt: jetzt(), ...position };
  db.positionen.push(p);
  await protokollieren("position_erfasst", "position", p.id, `${p.ziffer} ${p.betrag}`);
  await speichern();
  return p;
}

export async function positionAendern(positionId, aenderung) {
  const db = await laden();
  const p = db.positionen.find(x => x.id === positionId);
  if (!p) throw new Error("Position nicht gefunden");
  Object.assign(p, aenderung);
  await protokollieren("position_geaendert", "position", p.id, JSON.stringify(aenderung));
  await speichern();
  return p;
}

export async function positionLoeschen(positionId) {
  const db = await laden();
  const i = db.positionen.findIndex(x => x.id === positionId);
  if (i < 0) return;
  const [weg] = db.positionen.splice(i, 1);
  await protokollieren("position_geloescht", "position", positionId, `${weg.ziffer} ${weg.betrag}`);
  await speichern();
}

// ══════════════════════════════════════════════════════════════════════
// Sicherung
// ══════════════════════════════════════════════════════════════════════

export async function protokollListe(deklarationId) {
  const db = await laden();
  if (!deklarationId) return db.protokoll;
  return db.protokoll.filter(e => e.entitaet_id === deklarationId ||
    db.belege.some(b => b.id === e.entitaet_id && b.deklaration_id === deklarationId) ||
    db.positionen.some(p => p.id === e.entitaet_id && p.deklaration_id === deklarationId));
}

/** Gesamter Bestand als JSON — für Sicherung und Umzug auf ein anderes Laufwerk. */
export async function alsJson() {
  const db = await laden();
  return JSON.stringify(db, null, 2);
}

export async function ausJson(text) {
  const daten = JSON.parse(text);
  if (typeof daten !== "object" || !Array.isArray(daten.mandanten)) {
    throw new Error("Das ist kein gültiger Datenbestand");
  }
  cache = { ...LEER, ...daten };
  await speichern();
  return cache;
}

/** Nur für Tests: Zwischenspeicher verwerfen. */
export function _reset() { cache = null; }
