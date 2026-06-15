import { config } from "./config.js";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[config.logLevel];

/**
 * Strukturiertes Logging als JSON-Lines auf stderr.
 *
 * WICHTIG: stdout ist beim stdio-Transport ausschliesslich fuer JSON-RPC
 * reserviert – jede Log-Ausgabe MUSS nach stderr gehen.
 *
 * Es werden bewusst nur Metadaten geloggt (Tool-Name, Mandant/Kunde, Dauer,
 * Fehlermeldung) – niemals sensible Inhalte wie Dokumenttext, Betraege oder
 * Personendaten.
 */
function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });
  process.stderr.write(line + "\n");
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
