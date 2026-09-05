/**
 * Verrechnungssteuer: Datenblatt fuer die ESTV-Formulare 103 (AG) / 110 (GmbH)
 * und die Pruefung, ob das Meldeverfahren (Formular 106) in Frage kommt.
 *
 * Die amtlichen Formulare liegen nur als QDF (Snapform) vor und lassen sich
 * nicht mit pdf-lib befuellen; die ESTV nimmt die Deklaration im ePortal
 * entgegen (estvportal.estv.admin.ch). Das Datenblatt enthaelt darum alle
 * Werte in der Reihenfolge der Portal-Erfassung, damit sie in einem Zug
 * uebertragen werden koennen (von Hand oder durch den Browser-Agenten).
 */
import type { Kennzahlen } from "./kennzahlen.js";

export interface Aktionaer {
  name: string;
  anzahl: number;
  nominalwert: number;
  anteil_prozent: number;
}

export interface VstInput {
  firma: string;
  rechtsform: string | null;
  uid: string | null;
  adresse: string;
  jahr: number;
  gj_von: string;
  gj_bis: string;
  gv_datum: string | null;       // ISO
  faelligkeit: string | null;    // ISO, default = GV-Datum
  dividende_brutto: number;
  davon_aus_kapitaleinlagereserven: number;
  aktionaere: Aktionaer[];
}

export interface VstDatenblatt {
  formular: "103" | "110" | "unbekannt";
  formular_hinweis: string;
  deklarationspflicht: { pflicht: boolean; gruende: string[] };
  frist: { faelligkeit: string | null; einreichen_bis: string | null; hinweis: string };
  positionen: { position: string; wert: string | number | null; hinweis?: string }[];
  verrechnungssteuer: { steuerbare_leistung: number; satz: number; betrag: number; nettodividende: number };
  meldeverfahren: {
    moeglich: boolean;
    formular: "106" | null;
    begruendung: string;
    berechtigte: Aktionaer[];
  };
  beilagen: string[];
  portal: { url: string; schritte: string[] };
  warnungen: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r05 = (n: number) => Math.round(n * 20) / 20; // auf 5 Rappen

function plusTage(iso: string, tage: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export function formularNachRechtsform(rechtsform: string | null, firma: string): VstDatenblatt["formular"] {
  const rf = (rechtsform ?? "").toLowerCase();
  const fn = firma.toLowerCase();
  if (/gmbh|s\.à r\.l|sarl|sagl/.test(rf) || /\bgmbh\b|\bsàrl\b|\bsagl\b/.test(fn)) return "110";
  if (/aktiengesellschaft|\bag\b|\bsa\b|kommandit/.test(rf) || /\bag\b|\bsa\b|\bltd\b|\binc\b/.test(fn)) return "103";
  return "unbekannt";
}

export function erstelleVstDatenblatt(k: Kennzahlen, inp: VstInput): VstDatenblatt {
  const warnungen: string[] = [];
  const formular = formularNachRechtsform(inp.rechtsform, inp.firma);
  if (formular === "unbekannt") warnungen.push("Rechtsform unbekannt – Formular 103 (AG) oder 110 (GmbH) von Hand waehlen; Rechtsform im Kunden (Zefix-Abgleich) nachtragen.");

  const steuerbar = r2(Math.max(0, inp.dividende_brutto - inp.davon_aus_kapitaleinlagereserven));
  const vst = r05(steuerbar * 0.35);
  const gruende: string[] = [];
  if (k.bilanzsumme > 5_000_000) gruende.push("Bilanzsumme ueber CHF 5 Mio. (Art. 21 Abs. 1 VStV)");
  if (steuerbar > 0) gruende.push("Beschlossene Gewinnverteilung ist eine steuerbare Leistung");
  if (inp.davon_aus_kapitaleinlagereserven > 0) gruende.push("Rueckzahlung aus Kapitaleinlagereserven – zusaetzlich Formular 170 pruefen");

  const faelligkeit = inp.faelligkeit ?? inp.gv_datum;
  const frist = {
    faelligkeit,
    einreichen_bis: faelligkeit ? plusTage(faelligkeit, 30) : null,
    hinweis: faelligkeit
      ? "Formular muss innert 30 Tagen nach Faelligkeit der Dividende bei der ESTV eintreffen; die Verrechnungssteuer ist gleichzeitig zu bezahlen (Verzugszins ab Tag 31)."
      : "GV-Datum/Faelligkeit fehlt – Frist kann nicht berechnet werden.",
  };
  if (!inp.gv_datum) warnungen.push("GV-Datum fehlt (Parameter gv_datum).");

  // Meldeverfahren (Formular 106): inlaendische Kapitalgesellschaft haelt >= 20 %? Nein – seit 2023
  // gilt fuer Formular 106 die Schwelle 10 % (Art. 26a VStV); nur juristische Personen/Genossenschaften
  // mit Sitz in der Schweiz als Empfaengerinnen. Natuerliche Personen: kein Meldeverfahren.
  const berechtigte = inp.aktionaere.filter((a) => a.anteil_prozent >= 10 && /\b(ag|gmbh|sa|sàrl|sagl|holding|genossenschaft|stiftung)\b/i.test(a.name));
  const natPers10 = inp.aktionaere.filter((a) => a.anteil_prozent >= 10 && !berechtigte.includes(a));
  const meldeverfahren = {
    moeglich: berechtigte.length > 0 && steuerbar > 0,
    formular: berechtigte.length > 0 && steuerbar > 0 ? ("106" as const) : null,
    begruendung: inp.aktionaere.length === 0
      ? "Kein Aktienbuch erfasst – Beteiligungsverhaeltnisse unbekannt. Meldeverfahren nur fuer inlaendische Kapitalgesellschaften/Genossenschaften mit Beteiligung ab 10 % (Art. 26a VStV)."
      : berechtigte.length > 0
        ? `Beteiligte Kapitalgesellschaft(en) mit >= 10 %: ${berechtigte.map((b) => `${b.name} (${b.anteil_prozent} %)`).join(", ")}. Formular 106 zusammen mit ${formular === "unbekannt" ? "103/110" : formular} einreichen; fuer den Rest der Aktionaere Verrechnungssteuer entrichten.`
        : natPers10.length > 0
          ? "Nur natuerliche Personen als Aktionaere – kein Meldeverfahren, Verrechnungssteuer ist zu entrichten (Rueckforderung durch den Aktionaer in der privaten Steuererklaerung)."
          : "Keine Beteiligung ab 10 % durch eine Kapitalgesellschaft – kein Meldeverfahren.",
    berechtigte,
  };

  const positionen: VstDatenblatt["positionen"] = [
    { position: "Gesellschaft", wert: inp.firma },
    { position: "UID", wert: inp.uid, hinweis: inp.uid ? undefined : "UID fehlt – im Kunden nachtragen (Zefix)." },
    { position: "Adresse", wert: inp.adresse },
    { position: "Geschaeftsjahr von", wert: inp.gj_von },
    { position: "Geschaeftsjahr bis", wert: inp.gj_bis },
    { position: "Datum der Generalversammlung", wert: inp.gv_datum },
    { position: "Faelligkeit der Dividende", wert: faelligkeit },
    { position: "Bilanzsumme", wert: k.bilanzsumme },
    { position: "Einbezahltes Aktien-/Stammkapital", wert: k.aktienkapital },
    { position: "Gesetzliche Kapitalreserve (inkl. KER)", wert: r2(k.gesetzl_kapitalreserve + k.kapitaleinlagereserve) },
    { position: "davon Reserven aus Kapitaleinlagen (KER)", wert: k.kapitaleinlagereserve },
    { position: "Gesetzliche Gewinnreserve", wert: k.gesetzl_gewinnreserve },
    { position: "Freiwillige / uebrige Reserven", wert: r2(k.freiwillige_reserve + k.uebrige_reserve) },
    { position: "Gewinnvortrag Vorjahr", wert: k.gewinnvortrag },
    { position: "Jahresgewinn / -verlust", wert: k.jahresergebnis },
    { position: "Bilanzgewinn (zur Verfuegung der GV)", wert: k.bilanzgewinn },
    { position: "Dividende brutto (beschlossen)", wert: inp.dividende_brutto },
    { position: "davon aus Kapitaleinlagereserven (steuerfrei)", wert: inp.davon_aus_kapitaleinlagereserven },
    { position: "Steuerbare Leistung", wert: steuerbar },
    { position: "Verrechnungssteuer 35 %", wert: vst },
    { position: "Zuweisung gesetzliche Gewinnreserve", wert: k.gewinnverwendung.zuweisung_gesetzl_gewinnreserve },
    { position: "Zuweisung freiwillige Gewinnreserve", wert: k.gewinnverwendung.zuweisung_freiwillige_reserve },
    { position: "Tantiemen", wert: k.gewinnverwendung.tantiemen },
    { position: "Vortrag auf neue Rechnung", wert: k.gewinnverwendung.vortrag_neu },
    { position: "Dividende in % des Kapitals", wert: k.aktienkapital > 0 ? r2((inp.dividende_brutto / k.aktienkapital) * 100) : null },
  ];

  if (k.gewinnverwendung.dividende > 0 && Math.abs(k.gewinnverwendung.dividende - inp.dividende_brutto) > 0.05)
    warnungen.push(`Dividende im Datenblatt (${inp.dividende_brutto}) weicht von der Gewinnverwendung (${k.gewinnverwendung.dividende}) ab.`);
  if (inp.dividende_brutto > k.bilanzgewinn + 0.005 && k.bilanzgewinn >= 0)
    warnungen.push("Dividende uebersteigt den Bilanzgewinn.");

  const beilagen = [
    "Unterzeichnete Jahresrechnung (Bilanz und Erfolgsrechnung) als EIN PDF",
    "GV-Protokoll bzw. Beschluss ueber die Gewinnverwendung (Pflicht, wenn Faelligkeit vom GV-Datum abweicht; empfohlen immer)",
  ];
  if (meldeverfahren.moeglich) beilagen.push("Formular 106 (Meldung statt Entrichtung) je berechtigter Aktionaerin");
  if (inp.davon_aus_kapitaleinlagereserven > 0) beilagen.push("Formular 170 (Meldung Reserven aus Kapitaleinlagen)");

  return {
    formular,
    formular_hinweis: formular === "103" ? "Formular 103 – Ertrag inlaendischer Aktien (AG)" : formular === "110" ? "Formular 110 – Ertrag von Gesellschaftsanteilen (GmbH)" : "Formular 103 oder 110 je nach Rechtsform",
    deklarationspflicht: { pflicht: gruende.length > 0, gruende: gruende.length ? gruende : ["Keine Deklarationspflicht nach Art. 21 VStV erkennbar (keine steuerbare Leistung, Bilanzsumme unter CHF 5 Mio.)."] },
    frist,
    positionen,
    verrechnungssteuer: { steuerbare_leistung: steuerbar, satz: 35, betrag: vst, nettodividende: r2(inp.dividende_brutto - vst) },
    meldeverfahren,
    beilagen,
    portal: {
      url: "https://estvportal.estv.admin.ch",
      schritte: [
        "ESTV-Portal mit AGOV anmelden, Gesellschaft ueber Dossier-Nr./UID waehlen (Berechtigung als Treuhaender muss in der Benutzerverwaltung hinterlegt sein)",
        `Neue Deklaration ${formular === "unbekannt" ? "103/110" : formular} eroeffnen, Geschaeftsjahr und GV-Datum erfassen`,
        "Kapital, Reserven, Gewinnvortrag, Jahresergebnis und Bilanzgewinn gemaess Positionen oben eintragen",
        "Gewinnverwendung erfassen: Dividende brutto, Faelligkeit, Zuweisungen, Vortrag",
        meldeverfahren.moeglich ? "Meldeverfahren waehlen und Formular 106 je berechtigter Gesellschaft anfuegen" : "Zahlung der Verrechnungssteuer innert 30 Tagen veranlassen (QR-Rechnung aus dem Portal)",
        "Jahresrechnung (und GV-Protokoll) hochladen, Zusammenfassung pruefen, einreichen, Quittung im E-Binder ablegen",
      ],
    },
    warnungen,
  };
}
