import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape, type ZodObject } from "npm:zod@3.23.8";
import { ToolContext, ToolError } from "./scope.ts";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Erfolgs-Antwort. Objekte werden als huebsch formatiertes JSON ausgegeben. */
export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Fehler-Antweis (isError=true, vom Client als Tool-Fehler erkennbar). */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wirft bei Supabase-Fehlern, liefert sonst data zurueck.
 */
export function unwrap(res: { data: unknown; error: { message: string } | null }): any {
  if (res.error) throw new ToolError(`Datenbankfehler: ${res.error.message}`);
  return res.data;
}

export interface ToolDef<S extends ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  handler: (args: z.infer<ZodObject<S>>, context: ToolContext) => Promise<ToolResult> | ToolResult;
}

/**
 * Globale Registry, um die Tools für den In-Memory-Aufruf (Claude) bereitzuhalten.
 * Da Deno.serve zustandslos pro Request läuft, leeren wir diese in der index.ts
 * vor jeder Tool-Registrierung via localToolRegistry.clear().
 */
export const localToolRegistry = new Map<
    string,
    {
      name: string;
      description: string;
      inputSchema: ZodObject<any>;
      handler: (args: any) => Promise<ToolResult> | ToolResult;
    }
>();

/**
 * Registriert ein Tool mit zentralem Error-Handling, Context-Injektion und Logging.
 * Speichert es zusätzlich in der lokalen Registry für den direkten Zugriff.
 */
export function registerTool<S extends ZodRawShape>(
    server: McpServer,
    def: ToolDef<S>,
    context: ToolContext // Der Context wird pro HTTP-Request hier hineingereicht
): void {

  const callback = async (args: unknown): Promise<ToolResult> => {
    const start = Date.now();
    try {
      // Wir übergeben die KI-Argumente UND den aktuellen Request-Kontext an den Handler
      const result = await def.handler(args as z.infer<ZodObject<S>>, context);

      console.info("tool_ok", {
        tool: def.name,
        ms: Date.now() - start,
        customer_id: context.customerId,
        mandant_id: context.mandantId,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const known = err instanceof ToolError;

      console.error("tool_error", {
        tool: def.name,
        ms: Date.now() - start,
        customer_id: context.customerId,
        mandant_id: context.mandantId,
        error: message,
      });
      return fail(known ? message : `Interner Fehler im Tool '${def.name}': ${message}`);
    }
  };

  // 1. Im echten MCP-Server registrieren (falls das SDK unter der Haube doch Code validiert)
  server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.input },
      callback as never,
  );

  // 2. In der lokalen Registry ablegen, damit index.ts direkt darauf zugreifen kann.
  // Wir verpacken das ZodRawShape hier in ein ZodObject, damit das Anthropic SDK es als input_schema frisst.
  localToolRegistry.set(def.name, {
    name: def.name,
    description: def.description,
    inputSchema: z.object(def.input),
    handler: callback,
  });
}