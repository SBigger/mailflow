// modules/tasks.ts
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.0.1/server/mcp.js";
import { z } from "npm:zod@3.23.8";
import { supabase } from "../supabase.ts";
import { registerTool, ok, unwrap } from "../tool.ts";
import { requireCustomerId, requireWritesEnabled, type ToolContext, ToolError } from "../scope.ts";

/**
 * Modul: Aufgabenverwaltung (Tasks)
 *
 * Tabellen: tasks (customer_id, status, priority, column_id, assigned_to, ...),
 * task_columns (Kanban-Spalten, instanzweiter Katalog), priorities.
 * Scope: customers.id (CUSTOMER_ID). task_columns/priorities sind geteilte
 * Kataloge ohne customer_id und werden ungefiltert gelesen.
 */

const TASK_FIELDS =
    "id, title, description, status, priority, priority_id, completed, due_date, " +
    "reminder_date, column_id, assigned_to, assignee, verantwortlich, tags, project, " +
    "customer_id, created_at, updated_at";

export function registerTaskTools(server: McpServer, context: ToolContext): void {

  registerTool(server, {
    name: "tasks_list",
    title: "Aufgaben abfragen",
    description:
        "Listet Aufgaben des konfigurierten Kunden. Optional filterbar nach Status, " +
        "Spalte (Kanban), zugewiesener Person, Erledigt-Flag, Faelligkeit und Freitext " +
        "(Titel/Beschreibung).",
    input: {
      status: z.string().optional().describe("z.B. 'open', 'in_progress', 'done'"),
      column_id: z.string().uuid().optional().describe("Kanban-Spalte (task_columns.id)"),
      assigned_to: z.string().uuid().optional().describe("Benutzer-ID (profiles.id)"),
      completed: z.boolean().optional(),
      due_before: z.string().optional().describe("ISO-Datum: nur Aufgaben faellig vor diesem Zeitpunkt"),
      search: z.string().optional().describe("Freitextsuche in Titel/Beschreibung"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: async (args, ctx) => {
      const customerId = requireCustomerId(ctx);
      let q = supabase
          .from("tasks")
          .select(TASK_FIELDS)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(args.limit);

      if (args.status) q = q.eq("status", args.status);
      if (args.column_id) q = q.eq("column_id", args.column_id);
      if (args.assigned_to) q = q.eq("assigned_to", args.assigned_to);
      if (args.completed !== undefined) q = q.eq("completed", args.completed);
      if (args.due_before) q = q.lte("due_date", args.due_before);
      if (args.search) {
        const s = args.search.replace(/[%,]/g, " ");
        q = q.or(`title.ilike.%${s}%,description.ilike.%${s}%`);
      }

      const data = unwrap(await q);
      return ok({ count: data.length, tasks: data });
    },
  }, context);

  registerTool(server, {
    name: "tasks_get",
    title: "Aufgabe abrufen",
    description: "Liest eine einzelne Aufgabe (inkl. Anhaenge) anhand der ID.",
    input: { id: z.string().uuid() },
    handler: async (args, ctx) => {
      const customerId = requireCustomerId(ctx);
      const data = unwrap(
          await supabase
              .from("tasks")
              .select(`${TASK_FIELDS}, attachments`)
              .eq("customer_id", customerId)
              .eq("id", args.id)
              .maybeSingle(),
      );
      if (!data) throw new ToolError(`Keine Aufgabe mit ID ${args.id} fuer diesen Kunden gefunden.`);
      return ok(data);
    },
  }, context);

  registerTool(server, {
    name: "tasks_create",
    title: "Aufgabe anlegen",
    description:
        "Erstellt eine neue Aufgabe fuer den konfigurierten Kunden. customer_id wird " +
        "automatisch gesetzt.",
    input: {
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.string().default("open"),
      priority: z.string().optional().describe("Freitext-Prioritaet, z.B. 'hoch'/'normal'"),
      priority_id: z.string().uuid().optional(),
      column_id: z.string().uuid().optional().describe("Kanban-Spalte (task_columns.id)"),
      assigned_to: z.string().uuid().optional(),
      assignee: z.string().optional().describe("Anzeigename der zugewiesenen Person"),
      due_date: z.string().optional().describe("ISO-Datum"),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWritesEnabled(ctx);
      const customerId = requireCustomerId(ctx);
      const row = unwrap(
          await supabase
              .from("tasks")
              .insert({ ...args, customer_id: customerId })
              .select(TASK_FIELDS)
              .single(),
      );
      return ok({ created: true, task: row });
    },
  }, context);

  registerTool(server, {
    name: "tasks_update",
    title: "Aufgabe aendern",
    description:
        "Aktualisiert beliebige Felder einer Aufgabe. Nur gesetzte Felder werden " +
        "geaendert; der Kunden-Scope wird erzwungen.",
    input: {
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      priority_id: z.string().uuid().optional(),
      column_id: z.string().uuid().optional(),
      assigned_to: z.string().uuid().optional(),
      assignee: z.string().optional(),
      completed: z.boolean().optional(),
      due_date: z.string().optional(),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
    },
    handler: async (args, ctx) => {
      requireWritesEnabled(ctx);
      const customerId = requireCustomerId(ctx);
      const { id, ...patch } = args;
      if (Object.keys(patch).length === 0) throw new ToolError("Keine Felder zum Aktualisieren angegeben.");
      const row = unwrap(
          await supabase
              .from("tasks")
              .update({ ...patch, updated_at: new Date().toISOString() })
              .eq("customer_id", customerId)
              .eq("id", id)
              .select(TASK_FIELDS)
              .maybeSingle(),
      );
      if (!row) throw new ToolError(`Keine Aufgabe mit ID ${id} fuer diesen Kunden gefunden.`);
      return ok({ updated: true, task: row });
    },
  }, context);

  registerTool(server, {
    name: "tasks_set_status",
    title: "Aufgaben-Status aendern",
    description:
        "Setzt Status (und optional das completed-Flag) einer Aufgabe. Praktisch fuer " +
        "schnelle Statuswechsel ohne vollen Update.",
    input: {
      id: z.string().uuid(),
      status: z.string(),
      completed: z.boolean().optional(),
    },
    handler: async (args, ctx) => {
      requireWritesEnabled(ctx);
      const customerId = requireCustomerId(ctx);
      const patch: Record<string, unknown> = { status: args.status, updated_at: new Date().toISOString() };
      if (args.completed !== undefined) patch.completed = args.completed;
      const row = unwrap(
          await supabase
              .from("tasks")
              .update(patch)
              .eq("customer_id", customerId)
              .eq("id", args.id)
              .select("id, status, completed")
              .maybeSingle(),
      );
      if (!row) throw new ToolError(`Keine Aufgabe mit ID ${args.id} fuer diesen Kunden gefunden.`);
      return ok({ updated: true, task: row });
    },
  }, context);

  registerTool(server, {
    name: "tasks_assign",
    title: "Aufgabe zuweisen",
    description: "Weist eine Aufgabe einer Person zu (assigned_to UUID und/oder Anzeigename).",
    input: {
      id: z.string().uuid(),
      assigned_to: z.string().uuid().nullable().optional().describe("profiles.id oder null zum Entfernen"),
      assignee: z.string().nullable().optional().describe("Anzeigename oder null"),
    },
    handler: async (args, ctx) => {
      requireWritesEnabled(ctx);
      const customerId = requireCustomerId(ctx);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (args.assigned_to !== undefined) patch.assigned_to = args.assigned_to;
      if (args.assignee !== undefined) patch.assignee = args.assignee;
      if (Object.keys(patch).length === 1) throw new ToolError("assigned_to oder assignee angeben.");
      const row = unwrap(
          await supabase
              .from("tasks")
              .update(patch)
              .eq("customer_id", customerId)
              .eq("id", args.id)
              .select("id, assigned_to, assignee")
              .maybeSingle(),
      );
      if (!row) throw new ToolError(`Keine Aufgabe mit ID ${args.id} fuer diesen Kunden gefunden.`);
      return ok({ updated: true, task: row });
    },
  }, context);

  registerTool(server, {
    name: "tasks_list_columns",
    title: "Kanban-Spalten abfragen",
    description:
        "Listet die verfuegbaren Kanban-Spalten (task_columns). Geteilter Katalog der " +
        "Instanz, nicht kundenspezifisch.",
    input: {},
    handler: async (_args, _ctx) => {
      const data = unwrap(
          await supabase
              .from("task_columns")
              .select("id, name, color, order")
              .order("order", { ascending: true }),
      );
      return ok({ count: data.length, columns: data });
    },
  }, context);
}