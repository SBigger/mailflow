import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "../supabase.js";
import { registerTool, ok, unwrap } from "../tool.js";
import { requireCustomerId, requireWritesEnabled, ToolError } from "../scope.js";

/**
 * Modul: Dokumentenverwaltung
 *
 * Tabellen: dokumente (customer_id NOT NULL, category, year, tag_ids[],
 * content_text, search_vector), dok_tags (Tag-Katalog). Storage-Bucket:
 * "dokumente", Pfad-Konvention "dokumente/<docId>/<ts>-<name>".
 * Volltext (content_text/search_vector) wird asynchron von der Edge Function
 * "index-document" befuellt.
 *
 * Hinweis: Check-out/Check-in (checked_out_*) ist laut Projektvorgaben tabu und
 * wird hier bewusst NICHT angeboten.
 */

const BUCKET = "dokumente";
const DOC_META =
  "id, customer_id, name, filename, category, year, tag_ids, file_type, file_size, " +
  "notes, storage_path, created_at, updated_at";

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 120) || "datei";
}

export function registerDocumentTools(server: McpServer): void {
  registerTool(server, {
    name: "documents_search",
    title: "Dokumente suchen",
    description:
      "Sucht Dokumente des konfigurierten Kunden ueber Metadaten (Kategorie, Jahr, Tag) " +
      "und Volltext (Name/Inhalt). Liefert nur Metadaten zurueck, nicht den Volltext.",
    input: {
      query: z.string().optional().describe("Freitext in Name und Inhalt (content_text)"),
      category: z.string().optional(),
      year: z.number().int().optional(),
      tag_id: z.string().uuid().optional().describe("Filter auf ein dok_tags.id (in tag_ids enthalten)"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: async (args) => {
      const customerId = requireCustomerId();
      let q = supabase
        .from("dokumente")
        .select(DOC_META)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(args.limit);

      if (args.category) q = q.eq("category", args.category);
      if (args.year !== undefined) q = q.eq("year", args.year);
      if (args.tag_id) q = q.contains("tag_ids", [args.tag_id]);
      if (args.query) {
        const s = args.query.replace(/[%,]/g, " ");
        q = q.or(`name.ilike.%${s}%,content_text.ilike.%${s}%`);
      }

      const data = unwrap(await q);
      return ok({ count: data.length, documents: data });
    },
  });

  registerTool(server, {
    name: "documents_get",
    title: "Dokument abrufen",
    description:
      "Liest Metadaten eines Dokuments. Mit include_content=true wird zusaetzlich der " +
      "extrahierte Volltext (content_text) zurueckgegeben.",
    input: {
      id: z.string().uuid(),
      include_content: z.boolean().default(false),
    },
    handler: async (args) => {
      const customerId = requireCustomerId();
      const select = args.include_content ? `${DOC_META}, content_text` : DOC_META;
      const data = unwrap(
        await supabase
          .from("dokumente")
          .select(select)
          .eq("customer_id", customerId)
          .eq("id", args.id)
          .maybeSingle(),
      );
      if (!data) throw new ToolError(`Kein Dokument mit ID ${args.id} fuer diesen Kunden gefunden.`);
      return ok(data);
    },
  });

  registerTool(server, {
    name: "documents_get_download_url",
    title: "Download-Link erzeugen",
    description:
      "Erzeugt eine zeitlich begrenzte signierte Download-URL fuer die hinterlegte Datei.",
    input: {
      id: z.string().uuid(),
      expires_in_seconds: z.number().int().min(60).max(86400).default(3600),
    },
    handler: async (args) => {
      const customerId = requireCustomerId();
      const doc = unwrap(
        await supabase
          .from("dokumente")
          .select("id, storage_path, filename")
          .eq("customer_id", customerId)
          .eq("id", args.id)
          .maybeSingle(),
      );
      if (!doc) throw new ToolError(`Kein Dokument mit ID ${args.id} fuer diesen Kunden gefunden.`);
      if (!doc.storage_path) throw new ToolError("Dokument hat keinen storage_path (noch nicht hochgeladen?).");
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, args.expires_in_seconds);
      if (error || !data) throw new ToolError(`Signierte URL fehlgeschlagen: ${error?.message ?? "unbekannt"}`);
      return ok({ filename: doc.filename, signed_url: data.signedUrl, expires_in_seconds: args.expires_in_seconds });
    },
  });

  registerTool(server, {
    name: "documents_upload",
    title: "Dokument hochladen",
    description:
      "Laedt eine neue Datei (Base64) fuer den konfigurierten Kunden hoch, legt den " +
      "dokumente-Eintrag an und stoesst die Volltext-Indexierung an.",
    input: {
      filename: z.string().min(1).describe("Originaldateiname inkl. Endung"),
      content_base64: z.string().min(1).describe("Dateiinhalt als Base64"),
      category: z.string().default("korrespondenz"),
      name: z.string().optional().describe("Anzeigename, default = Dateiname"),
      year: z.number().int().optional().describe("default = aktuelles Jahr"),
      notes: z.string().optional(),
      tag_ids: z.array(z.string().uuid()).optional(),
      file_type: z.string().optional().describe("MIME-Type, z.B. application/pdf"),
    },
    handler: async (args) => {
      requireWritesEnabled();
      const customerId = requireCustomerId();
      const buffer = Buffer.from(args.content_base64, "base64");
      if (buffer.length === 0) throw new ToolError("content_base64 ist leer oder ungueltig.");

      // 1. Eintrag anlegen, um die ID zu erhalten (storage_path wird danach gesetzt).
      const inserted = unwrap(
        await supabase
          .from("dokumente")
          .insert({
            customer_id: customerId,
            category: args.category,
            year: args.year ?? new Date().getFullYear(),
            name: (args.name ?? args.filename).trim(),
            filename: args.filename,
            storage_path: "",
            file_size: buffer.length,
            file_type: args.file_type ?? null,
            notes: args.notes ?? null,
            tag_ids: args.tag_ids ?? [],
          })
          .select("id")
          .single(),
      );

      // 2. Datei hochladen (Pfad-Konvention wie im Frontend).
      const storagePath = `dokumente/${inserted.id}/${Date.now()}-${safeName(args.filename)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
        upsert: true,
        contentType: args.file_type ?? "application/octet-stream",
      });
      if (upErr) {
        await supabase.from("dokumente").delete().eq("id", inserted.id);
        throw new ToolError(`Storage-Upload fehlgeschlagen: ${upErr.message}`);
      }

      // 3. storage_path nachtragen.
      const row = unwrap(
        await supabase
          .from("dokumente")
          .update({ storage_path: storagePath })
          .eq("id", inserted.id)
          .select(DOC_META)
          .single(),
      );

      // 4. Volltext-Indexierung anstossen (best effort, kein Blocker).
      supabase.functions.invoke("index-document", { body: { doc_id: inserted.id } }).catch(() => {});

      return ok({ uploaded: true, document: row });
    },
  });

  registerTool(server, {
    name: "documents_categorize",
    title: "Dokument kategorisieren",
    description:
      "Setzt Kategorie und/oder Tags (tag_ids) eines Dokuments. set_tags ersetzt die " +
      "Tag-Liste komplett.",
    input: {
      id: z.string().uuid(),
      category: z.string().optional(),
      set_tags: z.array(z.string().uuid()).optional().describe("Ersetzt tag_ids vollstaendig"),
    },
    handler: async (args) => {
      requireWritesEnabled();
      const customerId = requireCustomerId();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (args.category !== undefined) patch.category = args.category;
      if (args.set_tags !== undefined) patch.tag_ids = args.set_tags;
      if (Object.keys(patch).length === 1) throw new ToolError("category oder set_tags angeben.");
      const row = unwrap(
        await supabase
          .from("dokumente")
          .update(patch)
          .eq("customer_id", customerId)
          .eq("id", args.id)
          .select(DOC_META)
          .maybeSingle(),
      );
      if (!row) throw new ToolError(`Kein Dokument mit ID ${args.id} fuer diesen Kunden gefunden.`);
      return ok({ updated: true, document: row });
    },
  });

  registerTool(server, {
    name: "documents_list_tags",
    title: "Dokument-Tags abfragen",
    description: "Listet den Tag-Katalog (dok_tags) zum Kategorisieren von Dokumenten.",
    input: {},
    handler: async () => {
      const data = unwrap(
        await supabase
          .from("dok_tags")
          .select("id, name, color, category, parent_id, sort_order")
          .order("sort_order", { ascending: true }),
      );
      return ok({ count: data.length, tags: data });
    },
  });
}
