import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { supabase } from "../supabase.js";
import { config } from "../config.js";
import { registerTool, ok, unwrap } from "../tool.js";
import { requireWritesEnabled, ToolError } from "../scope.js";
import { steuernLib, type Gewinnverwendung, type Konto, type Kanton, type Stammdaten, type Verlustvortrag, type Felder } from "../steuern/lib.js";
import { erstelleVstDatenblatt, type Aktionaer } from "../steuern/vst.js";
import { erzeugeEbilanzXml } from "../steuern/ebilanz.js";
import { erzeugePdf, ladeFormDef, ladeZhGemeinden, repoSrcVorhanden } from "../steuern/pdf.js";

/**
 * Modul: Steuererklaerungen juristische Personen
 *
 * Quelle der Zahlen ist der Smartis-Abschluss (Tabellen abschluss +
 * abschluss_konten = importierte Saldenliste mit Vorjahr, dieselbe Basis wie
 * die Abschlussdokumentation/Jahresauswertung). Daraus werden die wenigen
 * Kennzahlen abgeleitet, die eine JP-Steuererklaerung wirklich braucht
 * (Reingewinn, Gewinnvortrag, Kapital, Reserven, Gewinnverwendung,
 * Verlustverrechnung) und in die Formularfelder der Tabelle steuerdaten
 * (kanton ZH/SG/TG) uebersetzt – dieselben Felder, die das Tool
 * /Steuern in Smartis anzeigt und ins PDF druckt.
 *
 * Zusaetzlich: Datenblatt fuer die ESTV-Verrechnungssteuer (Formulare 103/110,
 * Meldeverfahren 106), eCH-0276 E-Bilanz-XML fuer ZHcorporateTax & Co.
 * und das fertige Formular-PDF, wahlweise direkt in den E-Binder abgelegt.
 */

const KANTON = z.enum(["ZH", "SG", "TG"]);

const GV_SCHEMA = z.object({
  dividende: z.number().min(0).optional().describe("Brutto-Dividende gemaess GV-Beschluss"),
  tantiemen: z.number().min(0).optional(),
  zuweisung_gesetzl_gewinnreserve: z.number().min(0).optional(),
  zuweisung_freiwillige_reserve: z.number().min(0).optional(),
  uebrige: z.array(z.object({ bezeichnung: z.string(), betrag: z.number() })).optional(),
  auto_gesetzliche_reserve: z.boolean().optional().describe("true = Pflichtzuweisung 5 % (OR 672) automatisch einsetzen, wenn keine Zuweisung angegeben"),
}).optional().describe("Gewinnverwendung gemaess GV-Antrag; fehlt sie, wird alles auf neue Rechnung vorgetragen");

const KUNDE_INPUT = {
  customer_id: z.string().uuid().optional().describe("customers.id; ohne Angabe CUSTOMER_ID aus der .env"),
  firma: z.string().optional().describe("Alternativ: Firmenname (Teilstring), muss eindeutig sein"),
};

interface Kunde {
  id: string; company_name: string | null; name: string | null; strasse: string | null; plz: string | null; ort: string | null;
  kanton: string | null; uid_nr: string | null; rechtsform: string | null; contact_persons: unknown;
}

async function kundeAufloesen(args: { customer_id?: string; firma?: string }): Promise<Kunde> {
  const FIELDS = "id, company_name, name, strasse, plz, ort, kanton, uid_nr, rechtsform, contact_persons";
  if (args.firma && !args.customer_id) {
    const s = args.firma.replace(/[%,]/g, " ");
    const rows: Kunde[] = unwrap(await supabase.from("customers").select(FIELDS).ilike("company_name", `%${s}%`).eq("aktiv", true).limit(10));
    if (rows.length === 0) throw new ToolError(`Keine Firma gefunden fuer "${args.firma}".`);
    if (rows.length > 1) {
      const exakt = rows.filter((r) => (r.company_name ?? "").toLowerCase() === args.firma!.toLowerCase());
      if (exakt.length === 1) return exakt[0];
      throw new ToolError(`Mehrdeutig: ${rows.map((r) => `${r.company_name} (${r.id})`).join("; ")}`);
    }
    return rows[0];
  }
  const id = args.customer_id ?? config.customerId;
  if (!id) throw new ToolError("customer_id oder firma angeben (oder CUSTOMER_ID konfigurieren).");
  const row: Kunde | null = unwrap(await supabase.from("customers").select(FIELDS).eq("id", id).maybeSingle());
  if (!row) throw new ToolError(`Kein Kunde mit ID ${id}.`);
  return row;
}

interface AbschlussRow { id: string; customer_id: string; geschaeftsjahr: number; status: string; updated_at: string; einstellungen: Record<string, unknown> | null }

async function abschlussLaden(customerId: string, jahr: number, abschlussId?: string): Promise<{ abschluss: AbschlussRow; konten: Konto[]; hinweise: string[] }> {
  const hinweise: string[] = [];
  let abschluss: AbschlussRow | null;
  if (abschlussId) {
    abschluss = unwrap(await supabase.from("abschluss").select("id, customer_id, geschaeftsjahr, status, updated_at, einstellungen").eq("id", abschlussId).maybeSingle());
    if (!abschluss) throw new ToolError(`Abschluss ${abschlussId} nicht gefunden.`);
    if (abschluss.customer_id !== customerId) throw new ToolError("Abschluss gehoert zu einem anderen Kunden.");
  } else {
    const rows: (AbschlussRow & { abschluss_konten?: { count: number }[] })[] = unwrap(
      await supabase.from("abschluss").select("id, customer_id, geschaeftsjahr, status, updated_at, einstellungen, abschluss_konten(count)")
        .eq("customer_id", customerId).eq("geschaeftsjahr", jahr).order("updated_at", { ascending: false }),
    );
    if (rows.length === 0) throw new ToolError(`Kein Abschluss ${jahr} fuer diesen Kunden in Smartis (Abschlussdokumentation) vorhanden.`);
    // Bei Duplikaten den zuletzt geaenderten Abschluss MIT Saldenliste nehmen (leere Huellen ueberspringen).
    const mitKonten = rows.filter((r) => (r.abschluss_konten?.[0]?.count ?? 0) > 0);
    const gewaehlt = mitKonten[0] ?? rows[0];
    abschluss = gewaehlt;
    if (rows.length > 1) hinweise.push(`${rows.length} Abschluesse fuer ${jahr} vorhanden – verwendet: ${gewaehlt.id} (${gewaehlt.abschluss_konten?.[0]?.count ?? 0} Konten, geaendert ${gewaehlt.updated_at}); mit abschluss_id gezielt waehlen.`);
  }
  const konten: Konto[] = unwrap(
    await supabase.from("abschluss_konten").select("kontonummer, kontoname, saldo_ist, saldo_vorjahr, position_id")
      .eq("abschluss_id", abschluss.id).order("kontonummer").range(0, 4999),
  );
  if (konten.length === 0) throw new ToolError("Der Abschluss hat keine Konten (Saldenliste noch nicht importiert).");
  return { abschluss, konten, hinweise };
}

async function gvAusInput(gv: z.infer<typeof GV_SCHEMA>, konten: Konto[], jahr: number): Promise<Gewinnverwendung> {
  const basis: Gewinnverwendung = {
    dividende: gv?.dividende, tantiemen: gv?.tantiemen,
    zuweisung_gesetzl_gewinnreserve: gv?.zuweisung_gesetzl_gewinnreserve,
    zuweisung_freiwillige_reserve: gv?.zuweisung_freiwillige_reserve,
    uebrige: gv?.uebrige,
  };
  if (gv?.auto_gesetzliche_reserve && basis.zuweisung_gesetzl_gewinnreserve == null) {
    const k = (await steuernLib()).berechneKennzahlen(konten, jahr, basis);
    basis.zuweisung_gesetzl_gewinnreserve = k.gesetzliche_reserve.empfohlene_zuweisung;
  }
  return basis;
}

async function steuerdatenLesen(customerId: string, kanton: string, jahr: number): Promise<{ felder: Felder; updated_at: string } | null> {
  return unwrap(await supabase.from("steuerdaten").select("felder, updated_at").eq("customer_id", customerId).eq("kanton", kanton).eq("steuerjahr", jahr).maybeSingle());
}

/** Verlustvortraege aus frueheren, in Smartis erfassten Steuererklaerungen desselben Kantons. */
async function verlustvortragErmitteln(customerId: string, kanton: string, jahr: number, override?: number): Promise<Verlustvortrag | null> {
  if (override != null) return { betrag: override, quelle: "Parameter verlustvortrag" };
  const rows: { steuerjahr: number; felder: Felder }[] = unwrap(
    await supabase.from("steuerdaten").select("steuerjahr, felder").eq("customer_id", customerId).eq("kanton", kanton)
      .gte("steuerjahr", jahr - 7).lt("steuerjahr", jahr).order("steuerjahr", { ascending: false }),
  );
  if (!rows.length) return null;
  return (await steuernLib()).verlustvortragAusErklaerungen(rows);
}

async function aktionaereLaden(customerId: string): Promise<Aktionaer[]> {
  const rows: { aktionaer_name: string; anzahl: number; nominalwert: number }[] = unwrap(
    await supabase.from("aktienbuch").select("aktionaer_name, anzahl, nominalwert").eq("customer_id", customerId).eq("aktiv", true),
  );
  const by = new Map<string, { anzahl: number; nominal: number }>();
  let total = 0;
  for (const r of rows) {
    const v = Number(r.anzahl) * Number(r.nominalwert);
    total += v;
    const e = by.get(r.aktionaer_name) ?? { anzahl: 0, nominal: 0 };
    e.anzahl += Number(r.anzahl); e.nominal += v;
    by.set(r.aktionaer_name, e);
  }
  return [...by.entries()].map(([name, e]) => ({ name, anzahl: e.anzahl, nominalwert: e.nominal, anteil_prozent: total ? Math.round((e.nominal / total) * 10000) / 100 : 0 }))
    .sort((a, b) => b.anteil_prozent - a.anteil_prozent);
}

function stammdaten(k: Kunde, jahr: number, gemeindeZh: string | null, registerNr: string | null): Stammdaten {
  return {
    firma_name: k.company_name ?? k.name ?? "",
    strasse: k.strasse, plz: k.plz, ort: k.ort, kanton: k.kanton, uid: k.uid_nr,
    register_nr: registerNr,
    gj_von: `${jahr}-01-01`, gj_bis: `${jahr}-12-31`,
    vertreter_artis: true,
    gemeinde_zh: gemeindeZh,
  };
}

async function gemeindeZhFinden(ort: string | null): Promise<{ name: string | null; bfs: number | null }> {
  if (!ort) return { name: null, bfs: null };
  const g = await ladeZhGemeinden();
  const treffer = Object.keys(g).find((n) => n.toLowerCase() === ort.toLowerCase())
    ?? Object.keys(g).find((n) => n.toLowerCase().startsWith(ort.toLowerCase()));
  return treffer ? { name: treffer, bfs: parseInt(String(g[treffer]), 10) || null } : { name: null, bfs: null };
}

/**
 * BFS-Gemeindenummer ueber den oeffentlichen Suchdienst von geo.admin.ch (Layer gg25 =
 * Gemeindegrenzen; featureId = BFS-Nummer). Kein Schluessel noetig; nur der Ortsname
 * verlaesst das System.
 */
async function bfsNummerFinden(ort: string | null, kanton: string | null): Promise<number | null> {
  if (!ort) return null;
  try {
    const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(ort)}&type=locations&origins=gg25&limit=8`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: { attrs: { featureId?: string | number; detail?: string; label?: string } }[] };
    const o = ort.toLowerCase();
    const kt = (kanton ?? "").toLowerCase();
    const list = j.results ?? [];
    const hit =
      list.find((x) => (x.attrs.detail ?? "").toLowerCase() === `${o} ${kt}`.trim()) ??
      list.find((x) => (x.attrs.detail ?? "").toLowerCase().startsWith(o + " ") && (!kt || (x.attrs.detail ?? "").toLowerCase().endsWith(" " + kt))) ??
      list.find((x) => (x.attrs.detail ?? "").toLowerCase().startsWith(o));
    const id = hit ? parseInt(String(hit.attrs.featureId), 10) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function vorschlagBerechnen(args: {
  kunde: Kunde; jahr: number; kanton: Kanton; abschluss_id?: string;
  gv: z.infer<typeof GV_SCHEMA>; verlustvortrag?: number; register_nr?: string;
}) {
  const lib = await steuernLib();
  const { abschluss, konten, hinweise } = await abschlussLaden(args.kunde.id, args.jahr, args.abschluss_id);
  const gv = await gvAusInput(args.gv, konten, args.jahr);
  const kennzahlen = lib.berechneKennzahlen(konten, args.jahr, gv);
  const vv = await verlustvortragErmitteln(args.kunde.id, args.kanton, args.jahr, args.verlustvortrag);
  const gespeichert = await steuerdatenLesen(args.kunde.id, args.kanton, args.jahr);
  const registerNr = args.register_nr ?? (gespeichert?.felder?.register_nr as string | undefined) ?? null;
  const gemeinde = args.kanton === "ZH" ? await gemeindeZhFinden(args.kunde.ort) : { name: null, bfs: null };
  const st = stammdaten(args.kunde, args.jahr, gemeinde.name, registerNr);
  const vorschlag = lib.felderFuerKanton(args.kanton, kennzahlen, st, vv) ?? {};
  return { abschluss, konten, kennzahlen, vv, gespeichert, vorschlag, hinweise, gemeinde };
}

export function registerSteuernTools(server: McpServer): void {
  registerTool(server, {
    name: "steuern_abschluesse",
    title: "Abschluesse eines Kunden auflisten",
    description: "Listet die in Smartis vorhandenen Jahresabschluesse (Saldenlisten) eines Kunden mit Jahr, Status und Kontenzahl – die Datenbasis fuer alle steuern_*-Tools.",
    input: { ...KUNDE_INPUT, jahr: z.number().int().optional() },
    handler: async (args) => {
      const kunde = await kundeAufloesen(args);
      let q = supabase.from("abschluss").select("id, geschaeftsjahr, status, updated_at, abschluss_konten(count)").eq("customer_id", kunde.id).order("geschaeftsjahr", { ascending: false });
      if (args.jahr) q = q.eq("geschaeftsjahr", args.jahr);
      const rows: any[] = unwrap(await q);
      return ok({
        kunde: { id: kunde.id, firma: kunde.company_name, kanton: kunde.kanton, rechtsform: kunde.rechtsform, uid: kunde.uid_nr },
        abschluesse: rows.map((r) => ({ id: r.id, jahr: r.geschaeftsjahr, status: r.status, geaendert: r.updated_at, konten: r.abschluss_konten?.[0]?.count ?? null })),
      });
    },
  });

  registerTool(server, {
    name: "steuern_kennzahlen",
    title: "Steuer-Kennzahlen aus dem Abschluss",
    description:
      "Leitet aus der Saldenliste eines Abschlusses die Kennzahlen fuer die JP-Steuererklaerung ab: Bilanzsumme, Reingewinn, " +
      "Gewinnvortrag, Bilanzgewinn, Aktienkapital, gesetzliche/freiwillige Reserven, Eigenkapital vor und nach Gewinnverwendung, " +
      "Pflichtzuweisung an die gesetzliche Gewinnreserve (OR 672). Zeigt je Eigenkapital-Konto die Zuordnung und alle Warnungen.",
    input: {
      ...KUNDE_INPUT,
      jahr: z.number().int().min(2000).max(2099),
      abschluss_id: z.string().uuid().optional(),
      gewinnverwendung: GV_SCHEMA,
    },
    handler: async (args) => {
      const kunde = await kundeAufloesen(args);
      const { abschluss, konten, hinweise } = await abschlussLaden(kunde.id, args.jahr, args.abschluss_id);
      const gv = await gvAusInput(args.gewinnverwendung, konten, args.jahr);
      const k = (await steuernLib()).berechneKennzahlen(konten, args.jahr, gv);
      return ok({ kunde: { id: kunde.id, firma: kunde.company_name }, abschluss: { id: abschluss.id, jahr: abschluss.geschaeftsjahr, status: abschluss.status, konten: konten.length }, hinweise, kennzahlen: k });
    },
  });

  registerTool(server, {
    name: "steuern_formular_felder",
    title: "Formularfelder eines Kantons",
    description: "Listet die Feld-IDs, Bezeichnungen und Typen des Smartis-Steuerformulars (ZH Form. 500, SG JP 1b, TG 50I, ESTV 19), damit einzelne Felder gezielt gesetzt werden koennen.",
    input: { kanton: z.enum(["ZH", "SG", "TG", "ESTV"]) },
    handler: async (args) => {
      if (!repoSrcVorhanden()) throw new ToolError("Formulardefinitionen (mailflow/src/forms) sind auf diesem Server nicht vorhanden.");
      const def = await ladeFormDef(args.kanton);
      return ok({ formular: def.name, typ: def.typ, sections: def.sections.map((s) => ({ id: s.id, titel: s.titel, felder: s.felder.map((f) => ({ id: f.id, label: f.label, typ: f.typ })) })) });
    },
  });

  registerTool(server, {
    name: "steuern_daten",
    title: "Gespeicherte Steuererklaerungsdaten lesen",
    description: "Liest die in Smartis (Tool /Steuern) gespeicherten Formularfelder eines Kunden – optional gefiltert nach Kanton und Steuerjahr.",
    input: { ...KUNDE_INPUT, kanton: z.enum(["ZH", "SG", "TG", "ESTV"]).optional(), jahr: z.number().int().optional() },
    handler: async (args) => {
      const kunde = await kundeAufloesen(args);
      let q = supabase.from("steuerdaten").select("kanton, steuerjahr, felder, notizen, updated_at").eq("customer_id", kunde.id).neq("kanton", "_VERANLAGUNG").order("steuerjahr", { ascending: false });
      if (args.kanton) q = q.eq("kanton", args.kanton);
      if (args.jahr) q = q.eq("steuerjahr", args.jahr);
      const rows = unwrap(await q);
      return ok({ kunde: { id: kunde.id, firma: kunde.company_name }, eintraege: rows });
    },
  });

  registerTool(server, {
    name: "steuern_formular_vorschlag",
    title: "Steuererklaerung aus dem Abschluss vorbefuellen",
    description:
      "Erzeugt aus dem Smartis-Abschluss den vollstaendigen Feldsatz fuer die kantonale JP-Steuererklaerung (ZH/SG/TG): Stammdaten, " +
      "Reingewinn, Gewinnverwendung, Eigenkapital nach Gewinnverwendung, Verlustverrechnung (aus frueheren Erklaerungen). " +
      "Mit speichern=true wird der Vorschlag in steuerdaten geschrieben und erscheint sofort im Tool /Steuern (PDF-Download dort). " +
      "Bereits von Hand erfasste Werte bleiben stehen, ausser ueberschreiben=true.",
    input: {
      ...KUNDE_INPUT,
      jahr: z.number().int().min(2000).max(2099),
      kanton: KANTON,
      abschluss_id: z.string().uuid().optional(),
      gewinnverwendung: GV_SCHEMA,
      verlustvortrag: z.number().min(0).optional().describe("Steuerlich verrechenbare Vorjahresverluste (uebersteuert die Ableitung aus frueheren Erklaerungen)"),
      register_nr: z.string().optional().describe("Register-Nr. des Kantons (ZH: J + 10 Ziffern aus dem Zugangscodeschreiben)"),
      zusatzfelder: z.record(z.unknown()).optional().describe("Weitere Felder (Feld-ID → Wert), z.B. Aufrechnungen; siehe steuern_formular_felder"),
      speichern: z.boolean().default(false),
      ueberschreiben: z.boolean().default(false),
    },
    handler: async (args) => {
      const kunde = await kundeAufloesen(args);
      const r = await vorschlagBerechnen({ kunde, jahr: args.jahr, kanton: args.kanton, abschluss_id: args.abschluss_id, gv: args.gewinnverwendung, verlustvortrag: args.verlustvortrag, register_nr: args.register_nr });
      const vorschlag: Felder = { ...r.vorschlag, ...(args.zusatzfelder ?? {}) };
      const bestehend = { ...(r.gespeichert?.felder ?? {}) };
      const { _erledigt, _autofill, ...bestehendOhneMeta } = bestehend as Felder & { _erledigt?: unknown; _autofill?: unknown };
      const merge = (await steuernLib()).zusammenfuehren(bestehendOhneMeta, vorschlag, args.ueberschreiben);
      const hinweise = [...r.hinweise, ...r.kennzahlen.warnungen];
      if (args.kanton === "ZH" && !r.gemeinde.name) hinweise.push(`Gemeinde "${kunde.ort ?? "?"}" nicht in der ZH-Gemeindeliste gefunden – Feld gemeinde von Hand waehlen.`);
      if (!r.vv) hinweise.push("Kein Verlustvortrag aus frueheren Erklaerungen ermittelt (0 angenommen).");

      let gespeichert = false;
      if (args.speichern) {
        requireWritesEnabled();
        const felder = { ...merge.felder, _erledigt: _erledigt ?? false, _autofill: { abschluss_id: r.abschluss.id, zeit: new Date().toISOString(), quelle: "mcp steuern_formular_vorschlag" } };
        unwrap(await supabase.from("steuerdaten").upsert(
          { customer_id: kunde.id, kanton: args.kanton, steuerjahr: args.jahr, felder, updated_at: new Date().toISOString() },
          { onConflict: "customer_id,kanton,steuerjahr" },
        ).select("id").single());
        gespeichert = true;
      }
      return ok({
        kunde: { id: kunde.id, firma: kunde.company_name, kanton: kunde.kanton },
        abschluss: { id: r.abschluss.id, jahr: r.abschluss.geschaeftsjahr, konten: r.konten.length },
        kennzahlen_kurz: {
          reingewinn: r.kennzahlen.jahresergebnis, gewinnvortrag: r.kennzahlen.gewinnvortrag, bilanzgewinn: r.kennzahlen.bilanzgewinn,
          aktienkapital: r.kennzahlen.aktienkapital, gesetzliche_reserven: r.kennzahlen.gesetzl_kapitalreserve + r.kennzahlen.kapitaleinlagereserve + r.kennzahlen.gesetzl_gewinnreserve,
          freiwillige_reserven: r.kennzahlen.freiwillige_reserve + r.kennzahlen.uebrige_reserve, dividende: r.kennzahlen.gewinnverwendung.dividende,
          vortrag_neu: r.kennzahlen.gewinnverwendung.vortrag_neu, verlustvortrag: r.vv?.betrag ?? 0, verlustvortrag_quelle: r.vv?.quelle ?? null,
          eigenkapital_nach_verwendung: r.kennzahlen.ek_nach_verwendung.total,
        },
        gesetzliche_reserve: r.kennzahlen.gesetzliche_reserve,
        felder: merge.felder,
        neu: merge.neu, geaendert: merge.geaendert, konflikte: merge.konflikte,
        gespeichert,
        hinweise,
      });
    },
  });

  registerTool(server, {
    name: "steuern_vst_datenblatt",
    title: "Verrechnungssteuer Formular 103/110 (+106) vorbereiten",
    description:
      "Stellt alle Angaben fuer die ESTV-Verrechnungssteuerdeklaration (Formular 103 AG / 110 GmbH) zusammen: Kapital, Reserven, " +
      "Gewinnvortrag, Jahresergebnis, Bilanzgewinn, Dividende, 35 % Verrechnungssteuer, Frist (30 Tage nach Faelligkeit), Deklarationspflicht " +
      "nach Art. 21 VStV, Meldeverfahren-Pruefung (Formular 106) anhand des Aktienbuchs sowie die Beilagen und die Schritte im ESTV-Portal.",
    input: {
      ...KUNDE_INPUT,
      jahr: z.number().int().min(2000).max(2099),
      abschluss_id: z.string().uuid().optional(),
      dividende_brutto: z.number().min(0).default(0),
      davon_kapitaleinlagereserven: z.number().min(0).default(0).describe("Anteil der Ausschuettung aus Reserven aus Kapitaleinlagen (verrechnungssteuerfrei)"),
      gv_datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO-Datum der Generalversammlung"),
      faelligkeit: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Faelligkeit der Dividende, default = GV-Datum"),
      gewinnverwendung: GV_SCHEMA,
    },
    handler: async (args) => {
      const kunde = await kundeAufloesen(args);
      const { abschluss, konten, hinweise } = await abschlussLaden(kunde.id, args.jahr, args.abschluss_id);
      const gvIn = args.gewinnverwendung ?? {};
      const gv = await gvAusInput({ ...gvIn, dividende: gvIn.dividende ?? args.dividende_brutto }, konten, args.jahr);
      const k = (await steuernLib()).berechneKennzahlen(konten, args.jahr, gv);
      const aktionaere = await aktionaereLaden(kunde.id);
      const blatt = erstelleVstDatenblatt(k, {
        firma: kunde.company_name ?? kunde.name ?? "", rechtsform: kunde.rechtsform, uid: kunde.uid_nr,
        adresse: [kunde.strasse, [kunde.plz, kunde.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        jahr: args.jahr, gj_von: `${args.jahr}-01-01`, gj_bis: `${args.jahr}-12-31`,
        gv_datum: args.gv_datum ?? null, faelligkeit: args.faelligkeit ?? null,
        dividende_brutto: args.dividende_brutto, davon_aus_kapitaleinlagereserven: args.davon_kapitaleinlagereserven, aktionaere,
      });
      // Beilagen im E-Binder suchen
      let docs: { id: string; name: string; category: string; year: number }[] = [];
      try {
        docs = unwrap(
          await supabase.from("dokumente").select("id, name, category, year").eq("customer_id", kunde.id).is("deleted_at", null)
            .or(`year.eq.${args.jahr},year.eq.${args.jahr + 1}`).or("name.ilike.%jahresrechnung%,name.ilike.%bilanz%,name.ilike.%protokoll%,name.ilike.%generalversammlung%").limit(20),
        );
      } catch (e) {
        hinweise.push(`Beilagen-Suche im E-Binder nicht moeglich: ${e instanceof Error ? e.message : String(e)}`);
      }
      return ok({ kunde: { id: kunde.id, firma: kunde.company_name }, abschluss: { id: abschluss.id, jahr: abschluss.geschaeftsjahr }, hinweise: [...hinweise, ...k.warnungen], datenblatt: blatt, beilagen_im_ebinder: docs });
    },
  });

  registerTool(server, {
    name: "steuern_ebilanz_xml",
    title: "E-Bilanz (eCH-0276) erzeugen",
    description:
      "Erzeugt aus dem Smartis-Abschluss die E-Bilanz nach eCH-0276 V1.0.0 (Bilanz, Erfolgsrechnung, Gewinnverwendung) als XML – das Austauschformat " +
      "fuer den Import in ZHcorporateTax (ab Steuerperiode 2025) und die ab 2026 folgenden kantonalen Deklarationsloesungen. " +
      "Betraege in ganzen Franken. Optional als Datei schreiben.",
    input: {
      ...KUNDE_INPUT,
      jahr: z.number().int().min(2000).max(2099),
      abschluss_id: z.string().uuid().optional(),
      gewinnverwendung: GV_SCHEMA,
      register_nr: z.number().int().optional().describe("Register-/PID-Nr. des Kantons als ganze Zahl (Pflichtfeld des Standards)"),
      bfs_nr: z.number().int().optional().describe("BFS-Gemeindenummer des Sitzes (ZH wird automatisch nachgeschlagen)"),
      ausgabe_pfad: z.string().optional().describe("Lokaler Dateipfad fuer die XML-Datei"),
    },
    handler: async (args) => {
      const kunde = await kundeAufloesen(args);
      const { abschluss, konten, hinweise } = await abschlussLaden(kunde.id, args.jahr, args.abschluss_id);
      const gv = await gvAusInput(args.gewinnverwendung, konten, args.jahr);
      const k = (await steuernLib()).berechneKennzahlen(konten, args.jahr, gv);
      const gemeinde = kunde.kanton === "ZH" ? await gemeindeZhFinden(kunde.ort) : { name: null, bfs: null };
      const bfs = args.bfs_nr ?? gemeinde.bfs ?? (await bfsNummerFinden(kunde.ort, kunde.kanton));
      if (bfs == null) hinweise.push(`BFS-Gemeindenummer fuer "${kunde.ort ?? "?"}" nicht ermittelbar – Parameter bfs_nr angeben.`);
      const m = /^(.*?)\s+(\d+[a-zA-Z]?)\s*$/.exec(kunde.strasse ?? "");
      const erg = erzeugeEbilanzXml(konten, k, {
        organisationName: kunde.company_name ?? kunde.name ?? "",
        registerNumber: args.register_nr ?? null,
        uid: kunde.uid_nr ? kunde.uid_nr.replace(/[^A-Z0-9]/gi, "").toUpperCase() : null,
        assessmentMunicipality: gemeinde.name ?? kunde.ort ?? "",
        assessmentMunicipalityId: bfs,
        street: m ? m[1] : (kunde.strasse ?? ""), houseNumber: m ? m[2] : "",
        zip: kunde.plz ?? "", town: kunde.ort ?? "", municipalityId: bfs, canton: kunde.kanton ?? "",
        taxPeriodFrom: `${args.jahr}-01-01`, taxPeriodTo: `${args.jahr}-12-31`,
      });
      let datei: string | null = null;
      if (args.ausgabe_pfad) {
        fs.mkdirSync(path.dirname(args.ausgabe_pfad), { recursive: true });
        fs.writeFileSync(args.ausgabe_pfad, erg.xml, "utf8");
        datei = args.ausgabe_pfad;
      }
      return ok({ kunde: { id: kunde.id, firma: kunde.company_name }, abschluss: { id: abschluss.id, jahr: abschluss.geschaeftsjahr }, hinweise: [...hinweise, ...k.warnungen, ...erg.warnungen], pflichtfelder_fehlen: erg.pflichtfelder_fehlen, datei, xml: datei ? undefined : erg.xml, summen: erg.summen });
    },
  });

  registerTool(server, {
    name: "steuern_pdf",
    title: "Steuererklaerungs-PDF erzeugen (optional in den E-Binder)",
    description:
      "Fuellt das amtliche Formular (ZH 500 / SG JP 1b / TG 50I) mit den gespeicherten Feldern oder direkt mit dem Vorschlag aus dem Abschluss " +
      "und speichert das PDF lokal und/oder als Dokument im E-Binder des Kunden (Kategorie steuern, Jahr = Steuerjahr). Nutzt denselben Fuell-Code wie das Tool /Steuern.",
    input: {
      ...KUNDE_INPUT,
      jahr: z.number().int().min(2000).max(2099),
      kanton: KANTON,
      quelle: z.enum(["gespeichert", "vorschlag"]).default("gespeichert").describe("gespeichert = Felder aus steuerdaten; vorschlag = frisch aus dem Abschluss (ohne zu speichern)"),
      gewinnverwendung: GV_SCHEMA,
      ausgabe_pfad: z.string().optional().describe("Lokaler Pfad fuer die PDF-Datei"),
      in_ebinder: z.boolean().default(false).describe("true = PDF als Dokument im E-Binder ablegen (Schreibzugriff noetig)"),
    },
    handler: async (args) => {
      if (!repoSrcVorhanden()) throw new ToolError("mailflow/src (Formulardefinitionen, pdfFill.js) ist auf diesem Server nicht vorhanden.");
      const kunde = await kundeAufloesen(args);
      let felder: Felder;
      const hinweise: string[] = [];
      if (args.quelle === "gespeichert") {
        const g = await steuerdatenLesen(kunde.id, args.kanton, args.jahr);
        if (!g) throw new ToolError(`Keine gespeicherten Felder ${args.kanton} ${args.jahr} – zuerst steuern_formular_vorschlag mit speichern=true oder quelle=vorschlag.`);
        felder = g.felder;
      } else {
        const r = await vorschlagBerechnen({ kunde, jahr: args.jahr, kanton: args.kanton, gv: args.gewinnverwendung });
        felder = (await steuernLib()).zusammenfuehren(r.gespeichert?.felder ?? {}, r.vorschlag, false).felder;
        hinweise.push(...r.hinweise, ...r.kennzahlen.warnungen);
      }
      const { bytes, formDef } = await erzeugePdf(args.kanton, felder);
      const safe = (kunde.company_name ?? "Firma").replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, "_");
      const dateiname = `SE_${args.kanton}_${args.jahr}_${safe}.pdf`;
      let datei: string | null = null;
      if (args.ausgabe_pfad) {
        const p = args.ausgabe_pfad.toLowerCase().endsWith(".pdf") ? args.ausgabe_pfad : path.join(args.ausgabe_pfad, dateiname);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, bytes);
        datei = p;
      }
      let dokument: unknown = null;
      if (args.in_ebinder) {
        requireWritesEnabled();
        const inserted = unwrap(await supabase.from("dokumente").insert({
          customer_id: kunde.id, category: "steuern", year: args.jahr,
          name: `Steuererklärung ${args.kanton} ${args.jahr} (${formDef.name})`, filename: dateiname, storage_path: "",
          file_size: bytes.length, file_type: "application/pdf", notes: "Automatisch erzeugt (MCP steuern_pdf)", tag_ids: [],
        }).select("id").single());
        const storagePath = `dokumente/${inserted.id}/${Date.now()}-${dateiname}`;
        const { error } = await supabase.storage.from("dokumente").upload(storagePath, Buffer.from(bytes), { upsert: true, contentType: "application/pdf" });
        if (error) { await supabase.from("dokumente").delete().eq("id", inserted.id); throw new ToolError(`Storage-Upload fehlgeschlagen: ${error.message}`); }
        dokument = unwrap(await supabase.from("dokumente").update({ storage_path: storagePath }).eq("id", inserted.id).select("id, name, filename, category, year, storage_path").single());
        supabase.functions.invoke("index-document", { body: { doc_id: inserted.id } }).catch(() => {});
      }
      return ok({ kunde: { id: kunde.id, firma: kunde.company_name }, formular: formDef.name, bytes: bytes.length, datei, dokument, felder_gesetzt: Object.keys(felder).filter((k) => felder[k] !== "" && felder[k] != null && !k.startsWith("_")).length, hinweise });
    },
  });
}
