import { McpServer } from "npm:@modelcontextprotocol/sdk@1.0.1/server/mcp.js";
import { z } from "npm:zod@3.23.8";
import { supabase } from "../supabase.ts";
import { registerTool, ok, unwrap } from "../tool.ts";
import {requireMandantId, requireWritesEnabled, type ToolContext, ToolError} from "../scope.ts";

/**
 * Modul: Finanzverwaltung (Finanzbuchhaltung)
 *
 * Tabellen (alle mandant_id-gescoped): fibu_kreditoren_belege,
 * fibu_kreditoren_positionen, fibu_lieferanten, fibu_konten, fibu_buchungen.
 * Scope: fibu_mandanten.id (MANDANT_ID).
 *
 * WICHTIG (CH-Recht / Projektregel): MwSt wird NICHT nachgerechnet. Betraege
 * (netto/mwst/brutto) werden so uebernommen, wie sie uebergeben werden.
 */

const BELEG_FIELDS =
  "id, beleg_nr, lieferant_id, lieferant_beleg_nr, belegdatum, faelligkeit, " +
  "waehrung, betrag_netto, betrag_mwst, betrag_brutto, betrag_bezahlt, bezahlt_am, " +
  "status, belegtyp, notiz, created_at";

const PositionSchema = z.object({
  konto_nr: z.string().describe("Aufwand-/Bilanzkonto (fibu_konten.konto_nr)"),
  betrag_netto: z.number(),
  betrag_mwst: z.number().default(0),
  betrag_brutto: z.number(),
  mwst_code: z.string().default("VS81"),
  mwst_satz: z.number().default(8.1),
  bezeichnung: z.string().optional(),
  kostenstelle: z.string().optional(),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function registerFinanceTools(server: McpServer, context: ToolContext): void {
  registerTool(server, {
    name: "finance_list_creditor_invoices",
    title: "Kreditor-Rechnungen abfragen",
    description:
      "Listet Kreditoren-Belege (Lieferantenrechnungen) des Mandanten. Filterbar nach " +
      "Status, Lieferant und Belegdatum.",
    input: {
      status: z
        .enum(["offen", "ausstehend", "teilbezahlt", "bezahlt", "ebanking", "storniert"])
        .optional(),
      lieferant_id: z.string().uuid().optional(),
      from: z.string().optional().describe("Belegdatum ab (ISO/YYYY-MM-DD)"),
      to: z.string().optional().describe("Belegdatum bis (ISO/YYYY-MM-DD)"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: async (args, ctx) => {
      const mandantId = requireMandantId(ctx);
      let q = supabase
        .from("fibu_kreditoren_belege")
        .select(BELEG_FIELDS)
        .eq("mandant_id", mandantId)
        .order("belegdatum", { ascending: false })
        .limit(args.limit);
      if (args.status) q = q.eq("status", args.status);
      if (args.lieferant_id) q = q.eq("lieferant_id", args.lieferant_id);
      if (args.from) q = q.gte("belegdatum", args.from);
      if (args.to) q = q.lte("belegdatum", args.to);
      const data = unwrap(await q);
      return ok({ count: data.length, invoices: data });
    },
  }, context);

  registerTool(server, {
    name: "finance_get_creditor_invoice",
    title: "Kreditor-Rechnung abrufen",
    description: "Liest einen Kreditoren-Beleg inkl. Buchungspositionen (Kontierung).",
    input: { id: z.string().uuid() },
    handler: async (args, ctx) => {
      const mandantId = requireMandantId(ctx);
      const beleg = unwrap(
        await supabase
          .from("fibu_kreditoren_belege")
          .select(`${BELEG_FIELDS}, scan_url, verbucht, freigabe_status`)
          .eq("mandant_id", mandantId)
          .eq("id", args.id)
          .maybeSingle(),
      );
      if (!beleg) throw new ToolError(`Kein Kreditoren-Beleg mit ID ${args.id} fuer diesen Mandanten gefunden.`);
      const positionen = unwrap(
        await supabase
          .from("fibu_kreditoren_positionen")
          .select("position, konto_nr, bezeichnung, mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto, kostenstelle")
          .eq("mandant_id", mandantId)
          .eq("beleg_id", args.id)
          .order("position", { ascending: true }),
      );
      return ok({ ...beleg, positionen });
    },
  }, context);

  registerTool(server, {
    name: "finance_create_creditor_invoice",
    title: "Kreditor-Rechnung erstellen",
    description:
      "Erstellt einen Kreditoren-Beleg (Lieferantenrechnung) mit optionalen " +
      "Buchungspositionen. MwSt wird NICHT nachgerechnet – Betraege werden uebernommen. " +
      "Fehlen Beleg-Summen, werden sie aus den Positionen aufsummiert.",
    input: {
      lieferant_id: z.string().uuid(),
      belegdatum: z.string().describe("YYYY-MM-DD"),
      faelligkeit: z.string().describe("YYYY-MM-DD"),
      beleg_nr: z.string().optional().describe("default: automatisch generiert"),
      lieferant_beleg_nr: z.string().optional(),
      waehrung: z.string().length(3).default("CHF"),
      belegtyp: z.enum(["rechnung", "gutschrift"]).default("rechnung"),
      betrag_netto: z.number().optional(),
      betrag_mwst: z.number().optional(),
      betrag_brutto: z.number().optional(),
      notiz: z.string().optional(),
      positionen: z.array(PositionSchema).optional(),
    },
    handler: async (args,ctx) => {
      requireWritesEnabled(ctx);
      const mandantId = requireMandantId(ctx);

      const pos = args.positionen ?? [];
      // Summen aus Positionen ableiten (reine Summe, KEINE MwSt-Neuberechnung),
      // falls die Beleg-Summen nicht explizit uebergeben wurden.
      const netto = args.betrag_netto ?? round2(pos.reduce((s, p) => s + p.betrag_netto, 0));
      const mwst = args.betrag_mwst ?? round2(pos.reduce((s, p) => s + p.betrag_mwst, 0));
      const brutto = args.betrag_brutto ?? round2(pos.reduce((s, p) => s + p.betrag_brutto, 0));

      const belegNr = args.beleg_nr ?? `KRD-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-5)}`;

      const beleg = unwrap(
        await supabase
          .from("fibu_kreditoren_belege")
          .insert({
            mandant_id: mandantId,
            beleg_nr: belegNr,
            lieferant_id: args.lieferant_id,
            lieferant_beleg_nr: args.lieferant_beleg_nr ?? null,
            belegdatum: args.belegdatum,
            faelligkeit: args.faelligkeit,
            waehrung: args.waehrung,
            belegtyp: args.belegtyp,
            betrag_netto: netto,
            betrag_mwst: mwst,
            betrag_brutto: brutto,
            betrag_bezahlt: 0,
            status: "offen",
            notiz: args.notiz ?? null,
          })
          .select(BELEG_FIELDS)
          .single(),
      );

      let positionen: unknown[] = [];
      if (pos.length > 0) {
        positionen = unwrap(
          await supabase
            .from("fibu_kreditoren_positionen")
            .insert(
              pos.map((p, i) => ({
                mandant_id: mandantId,
                beleg_id: beleg.id,
                position: i + 1,
                konto_nr: p.konto_nr,
                bezeichnung: p.bezeichnung ?? null,
                mwst_code: p.mwst_code,
                mwst_satz: p.mwst_satz,
                betrag_netto: p.betrag_netto,
                betrag_mwst: p.betrag_mwst,
                betrag_brutto: p.betrag_brutto,
                kostenstelle: p.kostenstelle ?? null,
              })),
            )
            .select("position, konto_nr, betrag_brutto, kostenstelle"),
        );
      }

      return ok({ created: true, invoice: beleg, positionen });
    },
  }, context);

  registerTool(server, {
    name: "finance_record_payment",
    title: "Zahlung erfassen (Zahlungsabgleich)",
    description:
      "Erfasst eine (Teil-)Zahlung auf einen Kreditoren-Beleg. Erhoeht betrag_bezahlt " +
      "und setzt den Status (teilbezahlt/bezahlt) anhand des Bruttobetrags.",
    input: {
      beleg_id: z.string().uuid(),
      betrag: z.number().positive(),
      bezahlt_am: z.string().optional().describe("YYYY-MM-DD, default heute"),
      zahlungsreferenz: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWritesEnabled(ctx);
      const mandantId = requireMandantId(ctx);
      const beleg = unwrap(
        await supabase
          .from("fibu_kreditoren_belege")
          .select("id, betrag_brutto, betrag_bezahlt, status")
          .eq("mandant_id", mandantId)
          .eq("id", args.beleg_id)
          .maybeSingle(),
      );
      if (!beleg) throw new ToolError(`Kein Kreditoren-Beleg mit ID ${args.beleg_id} fuer diesen Mandanten gefunden.`);
      if (beleg.status === "storniert") throw new ToolError("Beleg ist storniert – keine Zahlung moeglich.");

      const neuBezahlt = round2(Number(beleg.betrag_bezahlt) + args.betrag);
      const brutto = Number(beleg.betrag_brutto);
      const status = neuBezahlt + 0.005 >= brutto ? "bezahlt" : "teilbezahlt";

      const row = unwrap(
        await supabase
          .from("fibu_kreditoren_belege")
          .update({
            betrag_bezahlt: neuBezahlt,
            bezahlt_am: args.bezahlt_am ?? new Date().toISOString().slice(0, 10),
            zahlungsreferenz: args.zahlungsreferenz ?? null,
            status,
            updated_at: new Date().toISOString(),
          })
          .eq("mandant_id", mandantId)
          .eq("id", args.beleg_id)
          .select("id, betrag_brutto, betrag_bezahlt, status, bezahlt_am")
          .single(),
      );
      return ok({ updated: true, invoice: row });
    },
  }, context);

  registerTool(server, {
    name: "finance_list_suppliers",
    title: "Lieferanten abfragen",
    description: "Listet die Lieferanten (Kreditoren-Stammdaten) des Mandanten.",
    input: {
      query: z.string().optional().describe("Freitext in name/nr"),
      only_active: z.boolean().default(true),
      limit: z.number().int().min(1).max(200).default(100),
    },
    handler: async (args, ctx) => {
      const mandantId = requireMandantId(ctx);
      let q = supabase
        .from("fibu_lieferanten")
        .select("id, nr, name, uid, ort, iban, zahlungsbedingung_tage, standard_konto_nr, mwst_code, aktiv")
        .eq("mandant_id", mandantId)
        .order("name", { ascending: true })
        .limit(args.limit);
      if (args.only_active) q = q.eq("aktiv", true);
      if (args.query) {
        const s = args.query.replace(/[%,]/g, " ");
        q = q.or(`name.ilike.%${s}%,nr.ilike.%${s}%`);
      }
      const data = unwrap(await q);
      return ok({ count: data.length, suppliers: data });
    },
  }, context);

  registerTool(server, {
    name: "finance_list_accounts",
    title: "Kontenplan abfragen",
    description: "Listet den Kontenplan (fibu_konten) des Mandanten für die Kontierung.",
    input: {
      konto_typ: z.enum(["aktiv", "passiv", "ertrag", "aufwand", "abschluss"]).optional(),
      limit: z.number().int().min(1).max(500).default(300),
    },
    handler: async (args, ctx) => {
      const mandantId = requireMandantId(ctx);
      let q = supabase
        .from("fibu_konten")
        .select("konto_nr, bezeichnung, konto_typ, mwst_code, waehrung, aktiv")
        .eq("mandant_id", mandantId)
        .order("konto_nr", { ascending: true })
        .limit(args.limit);
      if (args.konto_typ) q = q.eq("konto_typ", args.konto_typ);
      const data = unwrap(await q);
      return ok({ count: data.length, accounts: data });
    },
  }, context);

  registerTool(server, {
    name: "finance_creditors_summary",
    title: "Kreditoren-Reporting",
    description:
      "Aggregiertes Reporting der Kreditoren-Belege: Summen und Anzahl je Status sowie " +
      "offener Gesamtsaldo (brutto minus bezahlt). Optional auf einen Belegdatum-Zeitraum " +
      "eingeschraenkt.",
    input: {
      from: z.string().optional().describe("Belegdatum ab (YYYY-MM-DD)"),
      to: z.string().optional().describe("Belegdatum bis (YYYY-MM-DD)"),
    },
    handler: async (args, ctx) => {
      const mandantId = requireMandantId(ctx);
      let q = supabase
        .from("fibu_kreditoren_belege")
        .select("status, betrag_brutto, betrag_bezahlt, waehrung")
        .eq("mandant_id", mandantId)
        .neq("status", "storniert")
        .limit(10000);
      if (args.from) q = q.gte("belegdatum", args.from);
      if (args.to) q = q.lte("belegdatum", args.to);
      const rows = unwrap(await q);

      const byStatus: Record<string, { count: number; brutto: number; bezahlt: number }> = {};
      let openTotal = 0;
      for (const r of rows) {
        const s = (byStatus[r.status] ??= { count: 0, brutto: 0, bezahlt: 0 });
        s.count += 1;
        s.brutto = round2(s.brutto + Number(r.betrag_brutto));
        s.bezahlt = round2(s.bezahlt + Number(r.betrag_bezahlt));
        openTotal = round2(openTotal + (Number(r.betrag_brutto) - Number(r.betrag_bezahlt)));
      }
      return ok({ total_invoices: rows.length, open_total: openTotal, by_status: byStatus });
    },
  }, context);

  registerTool(server, {
    name: "finance_cost_center_report",
    title: "Kostenstellen-Auswertung",
    description:
      "Summiert die Kreditoren-Positionen (netto/brutto) je Kostenstelle. Basis: " +
      "fibu_kreditoren_positionen des Mandanten.",
    input: {
      limit: z.number().int().min(1).max(20000).default(10000).describe("max. Positionen"),
    },
    handler: async (args, ctx) => {
      const mandantId = requireMandantId(ctx);
      const rows = unwrap(
        await supabase
          .from("fibu_kreditoren_positionen")
          .select("kostenstelle, betrag_netto, betrag_brutto")
          .eq("mandant_id", mandantId)
          .limit(args.limit),
      );
      const byCostCenter: Record<string, { count: number; netto: number; brutto: number }> = {};
      for (const r of rows) {
        const key = r.kostenstelle ?? "(ohne Kostenstelle)";
        const c = (byCostCenter[key] ??= { count: 0, netto: 0, brutto: 0 });
        c.count += 1;
        c.netto = round2(c.netto + Number(r.betrag_netto));
        c.brutto = round2(c.brutto + Number(r.betrag_brutto));
      }
      return ok({ positions: rows.length, by_cost_center: byCostCenter });
    },
  }, context);
}
