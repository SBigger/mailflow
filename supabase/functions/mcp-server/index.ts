import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { zodToJsonSchema } from "npm:zod-to-json-schema@3.23.5";

import { registerTaskTools } from "./modules/tasks.ts";
import { registerDocumentTools } from "./modules/documents.ts";
import { registerCustomerTools } from "./modules/customers.ts";
import { registerFinanceTools } from "./modules/finance.ts";
import { registerShareTools } from "./modules/shares.ts";
import { registerMailTools } from "./modules/mails.ts";

import { createToolRegistry } from "./tool.ts";
import type { ToolContext } from "./scope.ts";
import { supabase } from "./supabase.ts";

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 6;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function buildSystemPrompt(ctx: ToolContext): string {
  const heute = new Date().toISOString().slice(0, 10);

  const scope: string[] = [];
  if (ctx.customerId) {
    scope.push(
      `Vorausgewaehlter Kunde: ${ctx.customerName ?? "(Name unbekannt)"} (customer_id ${ctx.customerId}). ` +
      "Kunden-Tools ohne explizite customer_id arbeiten automatisch auf diesem Kunden.",
    );
  } else {
    scope.push(
      "Es ist KEIN Kunde vorausgewaehlt. Wenn eine Frage einen konkreten Kunden betrifft, " +
      "suche ihn zuerst mit customers_search und uebergib die gefundene customer_id an die weiteren Tools.",
    );
  }
  if (ctx.mandantId) {
    scope.push(
      `Vorausgewaehlter FiBu-Mandant: ${ctx.mandantName ?? "(Name unbekannt)"} (mandant_id ${ctx.mandantId}).`,
    );
  } else {
    scope.push(
      "Es ist KEIN FiBu-Mandant vorausgewaehlt. Fuer Buchhaltungsfragen zuerst finance_list_mandanten aufrufen.",
    );
  }

  return [
    "Du bist der KI-Assistent einer Schweizer Treuhandgesellschaft und arbeitest fuer die",
    "Mitarbeitenden der Kanzlei (nicht fuer deren Kunden). Deine Themen: Buchhaltung,",
    "Steuern, Aktienbuch/Aktienregister, Dokumente, Aufgaben und Mandantenstammdaten.",
    "",
    `Heutiges Datum: ${heute}.`,
    ...scope,
    "",
    "Arbeitsweise:",
    "- Wenn eine Frage mit den Tools beantwortbar ist, rufe die Tools auf, statt zu raten.",
    "  Erfinde niemals Zahlen, Betraege, Namen oder IDs; wenn ein Tool nichts liefert, sage das.",
    "- Nenne bei Auswertungen aus der Datenbank, worauf sie beruhen (Kunde/Mandant, Zeitraum, Anzahl Datensaetze).",
    "- Schreibende Tools (anlegen, aendern, E-Mail senden) nur ausfuehren, wenn der Auftrag eindeutig ist.",
    "  Bei Unklarheit erst rueckfragen. Nach einer Aenderung kurz zusammenfassen, was genau geaendert wurde.",
    "- Bei Rechts- und Steuerfragen: Schweizer Recht (OR, DBG, StHG, MWSTG). MwSt wird nie nachgerechnet,",
    "  sondern so uebernommen, wie sie auf dem Beleg steht. Kennzeichne Einschaetzungen als solche.",
    "- Antworte auf Deutsch (Schweizer Schreibweise, kein Eszett), sachlich und knapp.",
    "",
    "Ausgabeformat: ausschliesslich rohes, valides HTML-Fragment (p, ul, li, ol, strong, em, br,",
    "table, thead, tbody, tr, th, td, h3, h4, code, pre). KEINE Markdown-Codebloecke, kein Backtick-html,",
    "kein html/body-Element, kein script, kein style, keine Inline-Event-Handler.",
    "Zahlen im Schweizer Format (1'234.50).",
  ].join("\n");
}

/**
 * Agentische Schleife: Claude darf mehrfach hintereinander Tools aufrufen
 * (z.B. erst customers_search, dann documents_search auf der gefundenen ID).
 * Vorher lief nur EINE Runde - laengere Ketten brachen mit dem Platzhalter
 * "Ergebnis verarbeitet." ab.
 */
async function callClaudeWithTools(
  chatHistory: { role: string; content: string }[],
  ctx: ToolContext,
): Promise<{ html: string; toolCalls: string[]; hadToolError: boolean }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt (Supabase-Secret fehlt).");

  const anthropic = new Anthropic({ apiKey });

  // Historie auf das reduzieren, was die API akzeptiert (keine DB-/UI-Metadaten).
  const messages: any[] = chatHistory
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    throw new Error("Die uebergebene Historie enthaelt keine verwertbaren Nachrichten.");
  }

  const tools = Array.from(ctx.registry.values()).map((tool) => {
    const full = zodToJsonSchema(tool.inputSchema) as any;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: full.properties ?? {},
        required: full.required ?? [],
      },
    };
  });

  const system = buildSystemPrompt(ctx);
  const toolCalls: string[] = [];
  let hadToolError = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // In der letzten Runde keine Tools mehr anbieten, damit garantiert eine
    // Textantwort entsteht statt eines weiteren Tool-Wunsches.
    const isLastRound = round === MAX_TOOL_ROUNDS;

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages,
      tools: isLastRound ? [] : tools,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    } as any);

    const message = await stream.finalMessage();

    if (message.stop_reason !== "tool_use") {
      const text = (message.content as any[])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { html: text || "<p>Keine Textantwort erhalten.</p>", toolCalls, hadToolError };
    }

    const toolUseBlocks = (message.content as any[]).filter((b) => b.type === "tool_use");

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const { name, input, id } = block;
        toolCalls.push(name);
        try {
          const tool = ctx.registry.get(name);
          if (!tool) throw new Error(`Tool ${name} wurde in der Registry nicht gefunden.`);

          const result = await tool.handler(input);
          if (result.isError) hadToolError = true;

          return {
            type: "tool_result" as const,
            tool_use_id: id,
            content: result.content,
            is_error: result.isError ?? false,
          };
        } catch (err) {
          hadToolError = true;
          return {
            type: "tool_result" as const,
            tool_use_id: id,
            content: [{
              type: "text" as const,
              text: `Fehler bei der Ausfuehrung des Tools ${name}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            }],
            is_error: true,
          };
        }
      }),
    );

    // Assistant-Block unveraendert zurueckgeben (inkl. thinking-Bloecke), dann
    // ALLE tool_results gesammelt in EINER User-Nachricht.
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: toolResults });
  }

  return { html: "<p>Keine Textantwort erhalten.</p>", toolCalls, hadToolError };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. Authentifizierung. Diese Function laeuft mit dem Service-Role-Key und
    //    umgeht damit RLS - ohne echte User-Pruefung koennte jeder mit dem
    //    oeffentlichen anon-Key saemtliche Mandantendaten lesen und schreiben.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ error: "Nicht angemeldet: Authorization-Header fehlt." }, 401);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return jsonResponse({ error: "Nicht angemeldet oder Sitzung abgelaufen." }, 401);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Ungueltiger JSON-Body." }, 400);
    }

    const { messages, customerId, customerName, mandantId, mandantName } = body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: "Das Feld 'messages' muss ein nicht-leeres Array sein." }, 400);
    }

    const requestContext: ToolContext = {
      customerId: customerId || null,
      customerName: customerName || null,
      mandantId: mandantId || null,
      mandantName: mandantName || null,
      allowWrites: true,
      token,
      userId: authData.user.id,
      registry: createToolRegistry(),
    };

    registerTaskTools(requestContext);
    registerDocumentTools(requestContext);
    registerCustomerTools(requestContext);
    registerFinanceTools(requestContext);
    registerShareTools(requestContext);
    registerMailTools(requestContext);

    const { html, toolCalls, hadToolError } = await callClaudeWithTools(messages, requestContext);

    return jsonResponse({
      response: html,
      tool_calls: toolCalls,
      tool_error: hadToolError,
    });
  } catch (error) {
    console.error("Globaler Edge-Runtime Fehler:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "Interner Serverfehler im AI-Gateway", details: detail }, 500);
  }
});
