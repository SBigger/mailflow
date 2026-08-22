// modules/customers.ts
import { z } from "npm:zod@3.23.8";
import { supabase } from "../supabase.ts";
import { registerTool, ok, unwrap } from "../tool.ts";
import { requireWritesEnabled, type ToolContext, ToolError } from "../scope.ts";

/**
 * Modul: Kundenverwaltung
 *
 * Tabelle: customers (Stammdaten der Treuhand-Klienten). customers ist der
 * Katalog der Instanz selbst – Suche/Anlage sind darum bewusst instanzweit
 * (so findet man auch erst die ID, die als CUSTOMER_ID konfiguriert wird).
 * Operationen auf "den aktuellen Kunden" defaulten auf CUSTOMER_ID im Context.
 */

const CUST_FIELDS =
    "id, name, company_name, person_type, vorname, nachname, email, phone, " +
    "strasse, plz, ort, kanton, status, aktiv, mandatsleiter_id, sachbearbeiter_id, " +
    "notes, created_at, updated_at";

/** Liefert die explizit uebergebene ID oder faellt auf die ID aus dem Context zurueck. */
function resolveCustomerId(context: ToolContext, explicit?: string): string {
  if (explicit) return explicit;
  if (context.customerId) return context.customerId;
  throw new ToolError("Keine customer_id angegeben und CUSTOMER_ID ist im Kontext nicht konfiguriert.");
}

export function registerCustomerTools(context: ToolContext): void {

  registerTool({
    name: "customers_search",
    title: "Kunden suchen",
    description:
        "Sucht Kunden/Unternehmen instanzweit ueber Name, Firmenname oder E-Mail. " +
        "Dient auch dazu, die ID fuer die CUSTOMER_ID-Konfiguration zu finden.",
    input: {
      query: z.string().optional().describe("Freitext in name/company_name/email"),
      only_active: z.boolean().default(true),
      limit: z.number().int().min(1).max(200).default(50),
    },
    // HIER: ctx wird entgegengenommen (auch wenn in diesem speziellen, instanzweiten Tool nicht zwingend gebraucht)
    handler: async (args, _ctx) => {
      let q = supabase
          .from("customers")
          .select(CUST_FIELDS)
          .order("name", { ascending: true })
          .limit(args.limit);
      if (args.only_active) q = q.eq("aktiv", true);
      if (args.query) {
        const s = args.query.replace(/[%,]/g, " ");
        q = q.or(`name.ilike.%${s}%,company_name.ilike.%${s}%,email.ilike.%${s}%`);
      }
      const data = unwrap(await q);
      return ok({ count: data.length, customers: data });
    },
  }, context);

  registerTool({
    name: "customers_get",
    title: "Kunde abrufen",
    description:
        "Liest die vollstaendigen Stammdaten eines Kunden. Ohne id wird der konfigurierte " +
        "Kunde (CUSTOMER_ID) zurueckgegeben.",
    input: { id: z.string().uuid().optional() },
    handler: async (args, ctx) => {
      // HIER: ctx wird an resolveCustomerId übergeben
      const id = resolveCustomerId(ctx, args.id);
      const data = unwrap(
          await supabase
              .from("customers")
              .select(`${CUST_FIELDS}, contact_persons, ahv_nummer, geburtsdatum, budget`)
              .eq("id", id)
              .maybeSingle(),
      );
      if (!data) throw new ToolError(`Kein Kunde mit ID ${id} gefunden.`);
      return ok(data);
    },
  }, context);

  registerTool({
    name: "customers_create",
    title: "Kunde anlegen",
    description:
        "Legt einen neuen Kunden/ein neues Unternehmen an. person_type 'unternehmen' " +
        "(default) oder 'privat'.",
    input: {
      name: z.string().min(1).describe("Anzeigename / Firmenname"),
      person_type: z.enum(["unternehmen", "privat"]).default("unternehmen"),
      company_name: z.string().optional(),
      vorname: z.string().optional(),
      nachname: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      strasse: z.string().optional(),
      plz: z.string().optional(),
      ort: z.string().optional(),
      kanton: z.string().optional(),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      // HIER: ctx an requireWritesEnabled übergeben
      requireWritesEnabled(ctx);
      const row = unwrap(
          await supabase.from("customers").insert({ ...args, aktiv: true }).select(CUST_FIELDS).single(),
      );
      return ok({ created: true, customer: row });
    },
  }, context);

  registerTool({
    name: "customers_update",
    title: "Kunden-Stammdaten aendern",
    description:
        "Aktualisiert Stammdaten eines Kunden. Ohne id wird der konfigurierte Kunde " +
        "(CUSTOMER_ID) geaendert. Nur gesetzte Felder werden ueberschrieben.",
    input: {
      id: z.string().uuid().optional(),
      name: z.string().min(1).optional(),
      company_name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      strasse: z.string().optional(),
      plz: z.string().optional(),
      ort: z.string().optional(),
      kanton: z.string().optional(),
      status: z.string().optional(),
      aktiv: z.boolean().optional(),
      mandatsleiter_id: z.string().uuid().optional(),
      sachbearbeiter_id: z.string().uuid().optional(),
      notes: z.string().optional(),
    },
    handler: async (args, ctx) => {
      // HIER: ctx für Schreibrechte und ID-Auflösung übergeben
      requireWritesEnabled(ctx);
      const { id: explicit, ...patch } = args;
      const id = resolveCustomerId(ctx, explicit);
      if (Object.keys(patch).length === 0) throw new ToolError("Keine Felder zum Aktualisieren angegeben.");
      const row = unwrap(
          await supabase
              .from("customers")
              .update({ ...patch, updated_at: new Date().toISOString() })
              .eq("id", id)
              .select(CUST_FIELDS)
              .maybeSingle(),
      );
      if (!row) throw new ToolError(`Kein Kunde mit ID ${id} gefunden.`);
      return ok({ updated: true, customer: row });
    },
  }, context);

  registerTool({
    name: "customers_get_links",
    title: "Verknuepfungen des Kunden",
    description:
        "Listet die mit einem Kunden verknuepften Aufgaben und Dokumente. Ohne id wird der " +
        "konfigurierte Kunde (CUSTOMER_ID) verwendet.",
    input: {
      id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    handler: async (args, ctx) => {
      // HIER: ctx an resolveCustomerId übergeben
      const id = resolveCustomerId(ctx, args.id);
      const [tasks, docs] = await Promise.all([
        supabase
            .from("tasks")
            .select("id, title, status, due_date")
            .eq("customer_id", id)
            .order("created_at", { ascending: false })
            .limit(args.limit),
        supabase
            .from("dokumente")
            .select("id, name, category, year, created_at")
            .eq("customer_id", id)
            .order("created_at", { ascending: false })
            .limit(args.limit),
      ]);
      return ok({
        customer_id: id,
        tasks: unwrap(tasks),
        documents: unwrap(docs),
      });
    },
  }, context);
}