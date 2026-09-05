#!/usr/bin/env node
// Schreibtest: Vorschlag speichern (steuerdaten) und PDF in den E-Binder legen.
// Aufruf: MCP_ALLOW_WRITES=true node scripts/test-steuern-write.mjs "<Firma>" <Jahr> <Kanton> [dividende]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [firma = "Ankab", jahrArg = "2025", kanton = "ZH", divArg = "50000"] = process.argv.slice(2);
const jahr = parseInt(jahrArg, 10);
const dividende = parseFloat(divArg);
const hier = path.dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(hier, "..", "dist", "index.js")],
  env: { ...process.env, MCP_ALLOW_WRITES: "true", LOG_LEVEL: "warn" },
  stderr: "inherit",
});
const client = new Client({ name: "test-steuern-write", version: "0.0.1" });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) { console.log(`### ${name} FEHLER: ${text}`); return null; }
  try { return JSON.parse(text); } catch { return text; }
}

const vorher = await call("steuern_daten", { firma, kanton, jahr });
console.log("Vorher gespeichert:", vorher?.eintraege?.length ?? 0, "Eintrag/Eintraege");

const v = await call("steuern_formular_vorschlag", { firma, jahr, kanton, gewinnverwendung: { dividende, auto_gesetzliche_reserve: true }, speichern: true });
if (v) console.log("Gespeichert:", v.gespeichert, "| neu:", v.neu.length, "| geaendert:", v.geaendert.length, "| konflikte:", v.konflikte.length, "\nKennzahlen:", v.kennzahlen_kurz);

const nachher = await call("steuern_daten", { firma, kanton, jahr });
const e = nachher?.eintraege?.[0];
console.log("Nachher:", e ? { kanton: e.kanton, jahr: e.steuerjahr, felder: Object.keys(e.felder).length, autofill: e.felder._autofill, updated_at: e.updated_at } : "kein Eintrag");

const p = await call("steuern_pdf", { firma, jahr, kanton, quelle: "gespeichert", in_ebinder: true });
if (p) console.log("PDF im E-Binder:", p.dokument, "| Bytes:", p.bytes, "| Felder gesetzt:", p.felder_gesetzt);

await client.close();
