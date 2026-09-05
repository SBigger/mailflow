/**
 * Node-Loader-Hook (node:module register), damit src/lib/pdfFill.js aus dem
 * mailflow-Frontend unveraendert im MCP-Server laufen kann:
 *
 *   • "@/lib/steuerFormularPdf" (Vite-Alias, loest Signed URLs ueber den
 *     Browser-Supabase-Client auf) → unser Shim mit dem Service-Role-Client
 *   • "pdf-lib" aus src/lib/ → die Kopie in apps/mcp-server/node_modules
 *     (das Frontend-node_modules ist auf dem Server nicht zwingend vorhanden)
 *
 * So bleibt pdfFill.js die EINE Quelle fuer die Formularbefuellung – Fixes an
 * den pdf-lib-Fallen (siehe Memory) wirken automatisch auch hier.
 */
interface InitData { shimUrl: string; pdfLibParent: string }
let data: InitData;

export async function initialize(d: InitData): Promise<void> {
  data = d;
}

export async function resolve(
  specifier: string,
  context: { parentURL?: string; conditions: string[]; importAttributes: Record<string, string> },
  next: (spec: string, ctx: typeof context) => Promise<{ url: string; format?: string; shortCircuit?: boolean }>,
) {
  if (specifier === "@/lib/steuerFormularPdf") {
    return { url: data.shimUrl, shortCircuit: true };
  }
  if (specifier === "pdf-lib" && context.parentURL && /\/src\/(lib|forms)\//.test(context.parentURL)) {
    return next(specifier, { ...context, parentURL: data.pdfLibParent });
  }
  return next(specifier, context);
}
