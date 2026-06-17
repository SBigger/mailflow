import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "../supabase.js";
import { registerTool, ok, unwrap } from "../tool.js";
import { requireCustomerId, requireWritesEnabled, ToolError } from "../scope.js";

/**
 * Modul: Aktienbuch (Aktienregister)
 *
 * Tabelle: aktienbuch (customer_id-gescoped). Jede Zeile ist eine Position /
 * Transaktion eines Aktionaers. Scope: customers.id (CUSTOMER_ID).
 */

const SHARE_FIELDS =
  "id, aktionaer_name, aktionaer_adresse, wirtschaftlich_berechtigter, nutzniesser, " +
  "aktienart, anzahl, nominalwert, liberierungsgrad, zertifikat_nr, aktien_nr_von, " +
  "aktien_nr_bis, transaktionstyp, kaufdatum, verkaufsdatum, datum_vr_entscheid, " +
  "vorgaenger_id, aktiv, vinkuliert, notizen, sort_order, created_at";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function registerShareTools(server: McpServer): void {
  registerTool(server, {
    name: "shares_list",
    title: "Aktienregister abfragen",
    description:
      "Listet die Aktienbuch-Eintraege des konfigurierten Kunden. Optional nur aktive " +
      "Positionen oder gefiltert nach Aktionaer.",
    input: {
      only_active: z.boolean().default(true),
      aktionaer: z.string().optional().describe("Freitext-Filter auf Aktionaersname"),
      limit: z.number().int().min(1).max(500).default(100),
    },
    handler: async (args) => {
      const customerId = requireCustomerId();
      let q = supabase
        .from("aktienbuch")
        .select(SHARE_FIELDS)
        .eq("customer_id", customerId)
        .order("sort_order", { ascending: true })
        .limit(args.limit);
      if (args.only_active) q = q.eq("aktiv", true);
      if (args.aktionaer) {
        const s = args.aktionaer.replace(/[%,]/g, " ");
        q = q.ilike("aktionaer_name", `%${s}%`);
      }
      const data = unwrap(await q);
      return ok({ count: data.length, entries: data });
    },
  });

  registerTool(server, {
    name: "shares_get",
    title: "Aktienbuch-Eintrag abrufen",
    description: "Liest einen einzelnen Aktienbuch-Eintrag anhand der ID.",
    input: { id: z.string().uuid() },
    handler: async (args) => {
      const customerId = requireCustomerId();
      const data = unwrap(
        await supabase
          .from("aktienbuch")
          .select(SHARE_FIELDS)
          .eq("customer_id", customerId)
          .eq("id", args.id)
          .maybeSingle(),
      );
      if (!data) throw new ToolError(`Kein Aktienbuch-Eintrag mit ID ${args.id} fuer diesen Kunden gefunden.`);
      return ok(data);
    },
  });

  registerTool(server, {
    name: "shares_register_transaction",
    title: "Aktien-Transaktion erfassen",
    description:
      "Erfasst eine Transaktion im Aktienbuch (z.B. Emission, Kauf, Verkauf, Uebertragung). " +
      "Legt einen neuen Eintrag fuer den konfigurierten Kunden an. Bei Uebertragungen kann " +
      "vorgaenger_id auf den vorherigen Eintrag verweisen.",
    input: {
      aktionaer_name: z.string().min(1),
      anzahl: z.number().int().min(0),
      nominalwert: z.number().default(100),
      transaktionstyp: z.string().default("Emission").describe("z.B. Emission, Kauf, Verkauf, Uebertragung"),
      aktienart: z.string().default("Namenaktie"),
      aktionaer_adresse: z.string().optional(),
      wirtschaftlich_berechtigter: z.string().optional(),
      nutzniesser: z.string().optional(),
      liberierungsgrad: z.number().int().min(0).max(100).default(100),
      zertifikat_nr: z.string().optional(),
      aktien_nr_von: z.number().int().optional(),
      aktien_nr_bis: z.number().int().optional(),
      kaufdatum: z.string().optional().describe("YYYY-MM-DD"),
      verkaufsdatum: z.string().optional().describe("YYYY-MM-DD"),
      datum_vr_entscheid: z.string().optional().describe("YYYY-MM-DD"),
      vorgaenger_id: z.string().uuid().optional(),
      vinkuliert: z.boolean().default(false),
      notizen: z.string().optional(),
    },
    handler: async (args) => {
      requireWritesEnabled();
      const customerId = requireCustomerId();
      const row = unwrap(
        await supabase
          .from("aktienbuch")
          .insert({
            customer_id: customerId,
            aktionaer_name: args.aktionaer_name,
            aktionaer_adresse: args.aktionaer_adresse ?? "",
            wirtschaftlich_berechtigter: args.wirtschaftlich_berechtigter ?? "",
            nutzniesser: args.nutzniesser ?? "",
            aktienart: args.aktienart,
            anzahl: args.anzahl,
            nominalwert: args.nominalwert,
            liberierungsgrad: args.liberierungsgrad,
            zertifikat_nr: args.zertifikat_nr ?? "",
            aktien_nr_von: args.aktien_nr_von ?? null,
            aktien_nr_bis: args.aktien_nr_bis ?? null,
            transaktionstyp: args.transaktionstyp,
            kaufdatum: args.kaufdatum ?? null,
            verkaufsdatum: args.verkaufsdatum ?? null,
            datum_vr_entscheid: args.datum_vr_entscheid ?? null,
            vorgaenger_id: args.vorgaenger_id ?? null,
            vinkuliert: args.vinkuliert,
            notizen: args.notizen ?? "",
          })
          .select(SHARE_FIELDS)
          .single(),
      );
      return ok({ created: true, entry: row });
    },
  });

  registerTool(server, {
    name: "shares_update_shareholder",
    title: "Aktionaersdaten aendern",
    description:
      "Aktualisiert Aktionaers-/Stammdaten eines Aktienbuch-Eintrags (Name, Adresse, " +
      "wirtschaftlich Berechtigter, Vinkulierung, aktiv-Flag, Notizen).",
    input: {
      id: z.string().uuid(),
      aktionaer_name: z.string().min(1).optional(),
      aktionaer_adresse: z.string().optional(),
      wirtschaftlich_berechtigter: z.string().optional(),
      nutzniesser: z.string().optional(),
      vinkuliert: z.boolean().optional(),
      aktiv: z.boolean().optional(),
      notizen: z.string().optional(),
    },
    handler: async (args) => {
      requireWritesEnabled();
      const customerId = requireCustomerId();
      const { id, ...patch } = args;
      if (Object.keys(patch).length === 0) throw new ToolError("Keine Felder zum Aktualisieren angegeben.");
      const row = unwrap(
        await supabase
          .from("aktienbuch")
          .update(patch)
          .eq("customer_id", customerId)
          .eq("id", id)
          .select(SHARE_FIELDS)
          .maybeSingle(),
      );
      if (!row) throw new ToolError(`Kein Aktienbuch-Eintrag mit ID ${id} fuer diesen Kunden gefunden.`);
      return ok({ updated: true, entry: row });
    },
  });

  registerTool(server, {
    name: "shares_cap_table",
    title: "Aktionaersstruktur (Cap Table)",
    description:
      "Aggregiert die aktiven Aktienbuch-Eintraege je Aktionaer: Anzahl Aktien, " +
      "Nominalkapital und prozentualer Anteil.",
    input: {},
    handler: async () => {
      const customerId = requireCustomerId();
      const rows = unwrap(
        await supabase
          .from("aktienbuch")
          .select("aktionaer_name, anzahl, nominalwert")
          .eq("customer_id", customerId)
          .eq("aktiv", true)
          .limit(10000),
      );
      const byHolder: Record<string, { shares: number; nominal: number }> = {};
      let totalShares = 0;
      let totalNominal = 0;
      for (const r of rows) {
        const h = (byHolder[r.aktionaer_name] ??= { shares: 0, nominal: 0 });
        const nominal = round2(Number(r.anzahl) * Number(r.nominalwert));
        h.shares += Number(r.anzahl);
        h.nominal = round2(h.nominal + nominal);
        totalShares += Number(r.anzahl);
        totalNominal = round2(totalNominal + nominal);
      }
      const shareholders = Object.entries(byHolder)
        .map(([name, v]) => ({
          aktionaer: name,
          shares: v.shares,
          nominal: v.nominal,
          percent: totalShares > 0 ? round2((v.shares / totalShares) * 100) : 0,
        }))
        .sort((a, b) => b.shares - a.shares);
      return ok({ total_shares: totalShares, total_nominal: totalNominal, shareholders });
    },
  });
}
