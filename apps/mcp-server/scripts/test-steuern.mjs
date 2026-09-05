#!/usr/bin/env node
// Ende-zu-Ende-Test des Moduls "steuern" ueber einen echten MCP-Client (stdio).
// Aufruf:  node scripts/test-steuern.mjs "<Firma>" <Jahr> <Kanton> [ausgabeordner]
// Erwartet SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in der Umgebung oder .env.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [firma = "smarterion", jahrArg = "2025", kanton = "SG", ausgabe = ""] = process.argv.slice(2);
const jahr = parseInt(jahrArg, 10);
const hier = path.dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(hier, "..", "dist", "index.js")],
  env: { ...process.env, MCP_ALLOW_WRITES: process.env.MCP_ALLOW_WRITES ?? "false", LOG_LEVEL: "warn" },
  stderr: "inherit",
});
const client = new Client({ name: "test-steuern", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
const steuern = tools.tools.filter((t) => t.name.startsWith("steuern_")).map((t) => t.name);
console.log("Tools:", tools.tools.length, "davon steuern_*:", steuern.join(", "));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) { console.log(`\n### ${name} FEHLER:\n${text}`); return null; }
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return json;
}

const a = await call("steuern_abschluesse", { firma });
console.log("\n### Abschluesse:", JSON.stringify(a, null, 1).slice(0, 800));

const k = await call("steuern_kennzahlen", { firma, jahr, gewinnverwendung: { dividende: 50000, auto_gesetzliche_reserve: true } });
if (k) {
  const z = k.kennzahlen;
  console.log("\n### Kennzahlen", firma, jahr);
  console.log({ bilanzsumme: z.bilanzsumme, jahresergebnis: z.jahresergebnis, herkunft: z.jahresergebnis_herkunft, er: z.jahresergebnis_er, gewinnvortrag: z.gewinnvortrag, bilanzgewinn: z.bilanzgewinn, aktienkapital: z.aktienkapital, gesKap: z.gesetzl_kapitalreserve, gesGew: z.gesetzl_gewinnreserve, frei: z.freiwillige_reserve, uebrige: z.uebrige_reserve, stille: z.versteuerte_stille_reserven, ekTotal: z.eigenkapital_total });
  console.log("EK-Konten:", z.ek_konten.map((e) => `${e.kontonummer} ${e.kontoname} -> ${e.klasse} (${e.quelle}) ${e.ist}`));
  console.log("Gewinnverwendung:", z.gewinnverwendung, "\nEK nach Verwendung:", z.ek_nach_verwendung, "\nGes. Reserve:", z.gesetzliche_reserve, "\nWarnungen:", z.warnungen);
}

const v = await call("steuern_formular_vorschlag", { firma, jahr, kanton, gewinnverwendung: { dividende: 50000, auto_gesetzliche_reserve: true }, speichern: false });
if (v) { console.log("\n### Vorschlag", kanton, "Felder:", Object.keys(v.felder).length, "neu:", v.neu.length, "konflikte:", v.konflikte.length); console.log(v.kennzahlen_kurz); console.log(v.felder); console.log("Hinweise:", v.hinweise); }

const d = await call("steuern_vst_datenblatt", { firma, jahr, dividende_brutto: 50000, gv_datum: `${jahr + 1}-06-15` });
if (d) { console.log("\n### VSt-Datenblatt:", d.datenblatt.formular, d.datenblatt.frist, d.datenblatt.verrechnungssteuer); console.log(d.datenblatt.positionen.map((p) => `${p.position}: ${p.wert}`).join("\n")); console.log(d.datenblatt.meldeverfahren.begruendung); console.log("Beilagen im E-Binder:", d.beilagen_im_ebinder?.length); }

const x = await call("steuern_ebilanz_xml", { firma, jahr, gewinnverwendung: { dividende: 50000 }, register_nr: 123456, ausgabe_pfad: ausgabe ? path.join(ausgabe, `ebilanz_${kanton}_${jahr}.xml`) : undefined });
if (x) { console.log("\n### E-Bilanz:", x.datei ?? `${x.xml.length} Zeichen`, "\nHinweise:", x.hinweise, "\nSummen:", x.summen); if (!x.datei) console.log(x.xml.slice(0, 1500)); }

if (ausgabe) {
  const p = await call("steuern_pdf", { firma, jahr, kanton, quelle: "vorschlag", gewinnverwendung: { dividende: 50000, auto_gesetzliche_reserve: true }, ausgabe_pfad: ausgabe });
  if (p) console.log("\n### PDF:", p.formular, p.bytes, "Bytes ->", p.datei, "Felder gesetzt:", p.felder_gesetzt, "Hinweise:", p.hinweise);
}

await client.close();
