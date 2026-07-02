import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { registerTaskTools } from "./modules/tasks.ts";
import { registerDocumentTools } from "./modules/documents.ts";
import { registerCustomerTools } from "./modules/customers.ts";
import { registerFinanceTools } from "./modules/finance.ts";
import { registerShareTools } from "./modules/shares.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.33.1";
import { zodToJsonSchema } from "npm:zod-to-json-schema";
import { localToolRegistry } from "./tool.ts";
import {ToolContext} from "./scope.ts";
import {registerMailTools} from "./modules/mails.ts";


async function callClaudeWithMcpTools(
    chatHistory: any[],
    requestContext: ToolContext,
): Promise<string> {

  const _model = "claude-opus-4-8";
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  // 1. Historie von DB-Metadaten bereinigen (nur role und content erlauben)
  const currentMessages = chatHistory.map((msg) => ({
    role: msg.role,
    content: msg.content
  }));

  const toolsArray = Array.from(localToolRegistry.values());
  const claudeTools = toolsArray.map((tool) => {
    const fullSchema = zodToJsonSchema(tool.inputSchema) as any;
    const { $schema, $id, definitions, ...cleanSchema } = fullSchema;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: cleanSchema.properties || {},
        required: cleanSchema.required || [],
      },
    };
  });

  const systemPrompt = "Du bist ein Assistent, der Antworten ausschließlich als rohen, validen HTML-Code formatiert (nutze <p>, <ul>, <li>, <strong>, <table> wo passend). Verwende NIEMALS Markdown-Code-Blöcke (wie ```html ... ```). Gib nur den rohen, renderbaren HTML-Inhalt aus.";

  // Erster API-Call
  const message = await anthropic.messages.create({
    model: _model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: currentMessages,
    tools: claudeTools,
  });

  // 2. Prüfen auf Tool-Nutzung
  if (message.stop_reason === "tool_use") {
    // Finde ALLE Tool-Aufrufe in dieser Nachricht
    const toolUseBlocks = message.content.filter((block) => block.type === "tool_use");

    if (toolUseBlocks.length > 0) {
      let hasErrorSignal = false;

      // Verarbeite alle Tools parallel
      const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => {
            const { name: toolName, input: toolInput, id: toolCallId } = block;

            try {
              const localTool = localToolRegistry.get(toolName);
              if (!localTool) {
                throw new Error(`Tool ${toolName} wurde in der Registry nicht gefunden.`);
              }

              const toolResult = await localTool.handler(toolInput, requestContext);
              if (toolResult.isError) hasErrorSignal = true;

              return {
                type: "tool_result" as const,
                tool_use_id: toolCallId,
                content: toolResult.content,
                is_error: toolResult.isError,
              };

            } catch (error) {
              hasErrorSignal = true;
              return {
                type: "tool_result" as const,
                tool_use_id: toolCallId,
                content: `Fehler bei der Ausführung des Tools ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
              };
            }
          })
      );

      // Sende ALLE Ergebnisse gesammelt in einem einzigen User-Block zurück
      const finalMessage = await anthropic.messages.create({
        model: _model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          ...currentMessages,
          { role: "assistant", content: message.content }, // Der originale Block mit ALLEN tool_use Aufforderungen
          {
            role: "user",
            content: toolResults, // Das Array mit ALLEN tool_results
          },
        ],
        tools: claudeTools,
      });

      // Optionales Error-Handling fürs Frontend
      if (hasErrorSignal) {
        const textBlock = finalMessage.content.find((b) => b.type === "text");
        const claudeResponse = textBlock && "text" in textBlock ? textBlock.text : "";
        return `<p style="color: #dc2626; font-weight: bold;">[Hinweis: Ein oder mehrere Tools liefen in einen Fehler]</p> ${claudeResponse}`;
      }

      const textBlock = finalMessage.content.find((b) => b.type === "text");
      return textBlock && "text" in textBlock ? textBlock.text : "Ergebnis verarbeitet.";
    }
  }

  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text : "Keine Textantwort erhalten.";
}

Deno.serve(async (req) => {

// CORS-Handling für Preflight-Anfragen (unverändert)
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    });
  }

  // 1. Authentifizierung prüfen
  const authHeader = req.headers.get('Authorization')
  const token = authHeader.replace('Bearer ', '')

  try {
    const { messages, customerId, mandantId } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Das Feld 'messages' muss ein Array sein." }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const requestContext: ToolContext = {
      customerId: customerId || null,
      mandantId: mandantId || null,
      allowWrites: true,
      token: token || null
    };

    // Registry vor jedem Request leeren
    localToolRegistry.clear();

    const server = new McpServer({ name: "SupabaseMCP", version: "1.0.0" });

    // Tools registrieren
    registerTaskTools(server, requestContext);
    registerDocumentTools(server, requestContext);
    registerCustomerTools(server, requestContext);
    registerFinanceTools(server, requestContext);
    registerShareTools(server, requestContext);
    registerMailTools(server, requestContext)

    // AI-Aufruf starten
    const aiResponse = await callClaudeWithMcpTools(messages, requestContext);

    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
    });

  } catch (error) {
    // Fehler abfangen und loggen
    console.error("Globaler Edge-Runtime Fehler:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    return new Response(JSON.stringify({
      error: "Interner Serverfehler im AI-Gateway",
      details: errorMessage
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
    });
  }
});