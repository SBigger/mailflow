import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape, type ZodObject } from "zod";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { ToolError } from "./scope.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Erfolgs-Antwort. Objekte werden als huebsch formatiertes JSON ausgegeben. */
export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Fehler-Antwort (isError=true, vom Client als Tool-Fehler erkennbar). */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wirft bei Supabase-Fehlern, liefert sonst data zurueck. Rueckgabe ist
 * bewusst untypisiert (any), da kein generierter DB-Typ vorliegt – die Felder
 * werden in den Modulen ueber die select()-Strings festgelegt.
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
  handler: (args: z.infer<ZodObject<S>>) => Promise<ToolResult> | ToolResult;
}

/**
 * Registriert ein Tool mit zentralem Error-Handling und strukturiertem
 * Logging. Erwartete (ToolError) vs. unerwartete Fehler werden unterschiedlich
 * geloggt; Inhalte/Argumente werden NICHT mitgeloggt.
 */
export function registerTool<S extends ZodRawShape>(server: McpServer, def: ToolDef<S>): void {
  const callback = async (args: unknown): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const result = await def.handler(args as z.infer<ZodObject<S>>);
        logger.info("tool_ok", {
          tool: def.name,
          ms: Date.now() - start,
          customer_id: config.customerId,
          mandant_id: config.mandantId,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const known = err instanceof ToolError;
        logger[known ? "warn" : "error"]("tool_error", {
          tool: def.name,
          ms: Date.now() - start,
          customer_id: config.customerId,
          mandant_id: config.mandantId,
          error: message,
        });
        return fail(known ? message : `Interner Fehler im Tool '${def.name}': ${message}`);
      }
  };

  server.registerTool(
    def.name,
    { title: def.title, description: def.description, inputSchema: def.input },
    callback as never,
  );
}
