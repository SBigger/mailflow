/**
 * PDF-Erzeugung mit den Formulardefinitionen und dem Fuell-Code des Frontends
 * (src/forms/*.js, src/lib/pdfFill.js) – geladen zur Laufzeit aus dem
 * mailflow-Repo, in dem dieser Server liegt (apps/mcp-server → ../../src).
 */
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const hier = path.dirname(fileURLToPath(import.meta.url));           // .../apps/mcp-server/dist/steuern
const repoSrc = path.resolve(hier, "../../../../src");               // .../mailflow/src

let registriert = false;
function loaderSicherstellen(): void {
  if (registriert) return;
  register(pathToFileURL(path.join(hier, "aliasLoader.js")).href, {
    parentURL: import.meta.url,
    data: {
      shimUrl: pathToFileURL(path.join(hier, "steuerFormularPdfShim.js")).href,
      pdfLibParent: import.meta.url,
    },
  });
  registriert = true;
}

export interface FormDef {
  kanton: string;
  name: string;
  pdfUrl: string;
  typ: string;
  sections: { id: string; titel: string; felder: { id: string; label: string; typ: string }[] }[];
  [k: string]: unknown;
}

const FORM_DATEIEN: Record<string, { datei: string; exportName: string }> = {
  ZH: { datei: "zh_500.js", exportName: "ZH_500" },
  SG: { datei: "sg_jp1b.js", exportName: "SG_JP1B" },
  TG: { datei: "tg_50i.js", exportName: "TG_50I" },
  ESTV: { datei: "estv_19.js", exportName: "ESTV_19" },
};

export function repoSrcVorhanden(): boolean {
  return fs.existsSync(path.join(repoSrc, "lib", "pdfFill.js"));
}

export async function ladeFormDef(kanton: string): Promise<FormDef> {
  const spec = FORM_DATEIEN[kanton];
  if (!spec) throw new Error(`Kein Formular fuer Kanton ${kanton}`);
  const datei = path.join(repoSrc, "forms", spec.datei);
  if (!fs.existsSync(datei)) throw new Error(`Formulardefinition fehlt: ${datei}`);
  const mod = await import(pathToFileURL(datei).href);
  return mod[spec.exportName] as FormDef;
}

export async function ladeZhGemeinden(): Promise<Record<string, string>> {
  const datei = path.join(repoSrc, "forms", "zh_gemeinden.js");
  if (!fs.existsSync(datei)) return {};
  const mod = await import(pathToFileURL(datei).href);
  return (mod.ZH_GEMEINDEN ?? {}) as Record<string, string>;
}

interface PdfFillModul {
  fetchPdfBytes: (pdfUrl: string) => Promise<Uint8Array>;
  fillPdfBytes: (formDef: FormDef, felder: Record<string, unknown>, src: Uint8Array) => Promise<Uint8Array>;
  listPdfFields: (pdfUrl: string) => Promise<{ name: string; typ: string }[]>;
}

export async function ladePdfFill(): Promise<PdfFillModul> {
  loaderSicherstellen();
  const datei = path.join(repoSrc, "lib", "pdfFill.js");
  if (!fs.existsSync(datei)) throw new Error(`pdfFill.js fehlt: ${datei}`);
  return (await import(pathToFileURL(datei).href)) as PdfFillModul;
}

/** Fuellt das Formular des Kantons mit den Feldern und liefert die PDF-Bytes. */
export async function erzeugePdf(kanton: string, felder: Record<string, unknown>): Promise<{ bytes: Uint8Array; formDef: FormDef }> {
  const formDef = await ladeFormDef(kanton);
  const pdfFill = await ladePdfFill();
  const src = await pdfFill.fetchPdfBytes(formDef.pdfUrl);
  const bytes = await pdfFill.fillPdfBytes(formDef, felder, src);
  return { bytes, formDef };
}
