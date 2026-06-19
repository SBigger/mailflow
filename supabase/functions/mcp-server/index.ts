import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { registerTaskTools } from "./modules/tasks.ts";
import { registerDocumentTools } from "./modules/documents.ts";
import { registerCustomerTools } from "./modules/customers.ts";
import { registerFinanceTools } from "./modules/finance.ts";
import { registerShareTools } from "./modules/shares.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { localToolRegistry } from "./tool.ts"; // Importiert die neue lokale Registry

async function callClaudeWithMcpTools(
    userPrompt: string
): Promise<string> {

  const anthropic = new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  });

  // 1. Alle registrierten Tools aus der LOKALEN Registry abfragen
  const toolsArray = Array.from(localToolRegistry.values());

  // 2. Die MCP-Tools in das Format konvertieren, das die Anthropic-API erwartet
  const claudeTools = toolsArray.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema, // Das ist das vorbereitete ZodObject aus deiner tool.ts
  }));

  // 3. Erster Aufruf an Claude (mit der Frage und den verfügbaren Werkzeugen)
  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
    tools: claudeTools,
  });

  // 4. Prüfen, ob Claude ein Werkzeug aufrufen möchte (z.B. customers_search)
  if (message.stop_reason === "tool_use") {
    // Finde den spezifischen Tool-Aufruf im Content-Array
    const toolUseBlock = message.content.find((block) => block.type === "tool_use");

    if (toolUseBlock) {
      const { name: toolName, input: toolInput, id: toolCallId } = toolUseBlock;

      try {
        // 5. Das Tool direkt aus der lokalen Registry holen
        const localTool = localToolRegistry.get(toolName);
        if (!localTool) {
          throw new Error(`Tool ${toolName} wurde in der lokalen Registry nicht gefunden.`);
        }

        // Führt den Callback aus deiner tool.ts im Speicher aus (inkl. Supabase-Logik & Context)
        const toolResult = await localTool.handler(toolInput);

        // 6. Das Ergebnis zurück an Claude senden, damit er die finale Antwort formuliert
        const finalMessage = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 4096,
          messages: [
            { role: "user", content: userPrompt },
            { role: "assistant", content: message.content }, // Der vorherige Claude-Aufruf inkl. Tool-Wunsch
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolCallId,
                  // Anthropic erwartet hier ein valides Content-Array oder einen String.
                  // Da toolResult.content bereits ein Array im Format [{type: "text", text: "..."}] ist,
                  // übergeben wir dieses hier direkt für eine saubere Strukturierung.
                  content: toolResult.content,
                  is_error: toolResult.isError,
                },
              ],
            },
          ],
          tools: claudeTools, // Falls Claude danach noch ein Tool nutzen will (Chaining)
        });

        // Gib den finalen Text zurück, den React anzeigen soll
        const textBlock = finalMessage.content.find((b) => b.type === "text");
        return textBlock && "text" in textBlock ? textBlock.text : "Ergebnis verarbeitet.";

      } catch (error) {
        return `Fehler bei der Ausführung des Tools ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  // Falls Claude kein Tool brauchte, um die Frage zu beantworten, gib direkt den Text zurück
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

  try {
    const { message, customerId, mandantId } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: "Das Feld 'message' darf nicht leer sein." }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const requestContext = {
      customerId: customerId || null,
      mandantId: mandantId || null,
      allowWrites: true
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

    // AI-Aufruf starten
    const aiResponse = await callClaudeWithMcpTools(message);

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