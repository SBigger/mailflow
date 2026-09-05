import { config as loadEnv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .env neben dem Server (apps/mcp-server/.env) laden – unabhaengig vom Arbeitsverzeichnis,
// aus dem der MCP-Client (Claude Desktop / Claude Code) den Prozess startet. Bereits
// gesetzte Umgebungsvariablen (z.B. aus dem env-Block der Client-Konfiguration) gewinnen.
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
loadEnv();

const uuid = z.string().uuid();

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL muss eine gueltige URL sein"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY fehlt"),
  // Optional: Module ohne konfiguriertes Scope-Id liefern beim Aufruf einen
  // klaren Fehler, statt den Server-Start zu blockieren.
  CUSTOMER_ID: uuid.optional(),
  MANDANT_ID: uuid.optional(),
  MCP_ALLOW_WRITES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  // stderr ist sicher (stdout ist fuer JSON-RPC reserviert).
  process.stderr.write(
    `\n[artis-mcp] Ungueltige Konfiguration (.env):\n${issues}\n\n` +
      `Siehe .env.example fuer die erwarteten Werte.\n\n`,
  );
  process.exit(1);
}

export const config = {
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseServiceKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  customerId: parsed.data.CUSTOMER_ID ?? null,
  mandantId: parsed.data.MANDANT_ID ?? null,
  allowWrites: parsed.data.MCP_ALLOW_WRITES,
  logLevel: parsed.data.LOG_LEVEL,
} as const;

export type Config = typeof config;
