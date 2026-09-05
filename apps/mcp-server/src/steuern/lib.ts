/**
 * Laedt die gemeinsame Ableitungslogik aus dem Frontend (src/lib/steuern/*.js),
 * damit Tool /Steuern und MCP-Server exakt dieselben Zahlen liefern.
 * Typen sind hier deklariert; die Implementierung liegt nur einmal im Repo.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export interface Konto {
  kontonummer: string; kontoname: string;
  saldo_ist: number | string | null; saldo_vorjahr: number | string | null; position_id: string | null;
}
export type EkKlasse = "aktienkapital" | "gesetzl_kapitalreserve" | "kapitaleinlagereserve" | "gesetzl_gewinnreserve" | "freiwillige_reserve" | "uebrige_reserve" | "versteuerte_stille_reserven" | "eigene_kapitalanteile" | "gewinnvortrag" | "jahresergebnis_konto" | "unbekannt";
export interface EkKonto { kontonummer: string; kontoname: string; klasse: EkKlasse; ist: number; vorjahr: number | null; quelle: "name" | "nummer" | "position" }
export interface Gewinnverwendung {
  dividende?: number; tantiemen?: number; zuweisung_gesetzl_gewinnreserve?: number; zuweisung_freiwillige_reserve?: number;
  uebrige?: { bezeichnung: string; betrag: number }[];
}
export interface Kennzahlen {
  jahr: number;
  vorzeichen: { passiven_negativ: boolean; ertrag_negativ: boolean };
  bilanzsumme: number; bilanzsumme_vorjahr: number | null;
  jahresergebnis: number; jahresergebnis_vorjahr: number | null;
  jahresergebnis_herkunft: "bilanzdifferenz" | "erfolgsrechnung" | "konto"; jahresergebnis_er: number;
  gewinnvortrag: number; gewinnvortrag_vorjahr: number | null; bilanzgewinn: number;
  aktienkapital: number; gesetzl_kapitalreserve: number; kapitaleinlagereserve: number; gesetzl_gewinnreserve: number;
  freiwillige_reserve: number; uebrige_reserve: number; versteuerte_stille_reserven: number; eigene_kapitalanteile: number;
  eigenkapital_total: number; ek_konten: EkKonto[];
  gewinnverwendung: { dividende: number; tantiemen: number; zuweisung_gesetzl_gewinnreserve: number; zuweisung_freiwillige_reserve: number; uebrige: { bezeichnung: string; betrag: number }[]; total: number; vortrag_neu: number };
  ek_nach_verwendung: { aktienkapital: number; gesetzl_kapitalreserve: number; gesetzl_gewinnreserve: number; freiwillige_reserve: number; uebrige_reserve: number; versteuerte_stille_reserven: number; eigene_kapitalanteile: number; gewinnvortrag: number; total: number };
  gesetzliche_reserve: { fuenf_prozent: number; ziel: number; bestand: number; empfohlene_zuweisung: number; hinweis: string };
  warnungen: string[];
}
export type Kanton = "ZH" | "SG" | "TG";
export interface Stammdaten {
  firma_name: string; strasse?: string | null; plz?: string | null; ort?: string | null; kanton?: string | null; uid?: string | null;
  register_nr?: string | null; gj_von: string; gj_bis: string; vertreter_artis?: boolean; gemeinde_zh?: string | null;
}
export interface Verlustvortrag { betrag: number; jahre?: { jahr: number; betrag: number }[]; quelle: string }
export type Felder = Record<string, unknown>;

export interface SteuernLib {
  berechneKennzahlen: (konten: Konto[], jahr: number, gv?: Gewinnverwendung) => Kennzahlen;
  verlustvortragAusErklaerungen: (fruehere: { steuerjahr: number; felder: Felder }[]) => Verlustvortrag | null;
  kontonummerAlsZahl: (k: Konto) => number;
  alsZahl: (v: unknown) => number;
  round2: (n: number) => number;
  felderFuerKanton: (kanton: Kanton, k: Kennzahlen, st: Stammdaten, vv: Verlustvortrag | null) => Felder | null;
  zusammenfuehren: (bestehend: Felder, vorschlag: Felder, ueberschreiben: boolean) => { felder: Felder; neu: string[]; geaendert: string[]; konflikte: { feld: string; bestehend: unknown; vorschlag: unknown }[] };
}

const hier = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(hier, "../../../../src/lib/steuern");
let cache: Promise<SteuernLib> | null = null;

export function steuernLib(): Promise<SteuernLib> {
  if (!cache) {
    cache = (async () => {
      for (const f of ["kennzahlen.js", "formular.js"]) {
        if (!fs.existsSync(path.join(libDir, f))) throw new Error(`Gemeinsame Steuer-Bibliothek fehlt: ${path.join(libDir, f)} (Server muss im mailflow-Repo liegen).`);
      }
      const k = await import(pathToFileURL(path.join(libDir, "kennzahlen.js")).href);
      const f = await import(pathToFileURL(path.join(libDir, "formular.js")).href);
      return { ...k, ...f } as SteuernLib;
    })();
  }
  return cache;
}
