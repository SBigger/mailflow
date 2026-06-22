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


async function callClaudeWithMcpTools(
    chatHistory: { role: "user" | "assistant"; content: string; [key: string]: any }[],
    requestContext: { customerId: string | null; mandantId: string | null; allowWrites: boolean } // <-- NEU: Kontext als Parameter
): Promise<string> {

  const _model = "claude-opus-4-8";

  const anthropic = new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  });

  const cleanedHistory = chatHistory.map((msg) => ({
    role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
    content: msg.content,
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

  const message = await anthropic.messages.create({
    model: _model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: cleanedHistory,
    tools: claudeTools,
  });

  if (message.stop_reason === "tool_use") {
    const toolUseBlock = message.content.find((block) => block.type === "tool_use");

    if (toolUseBlock) {
      const { name: toolName, input: toolInput, id: toolCallId } = toolUseBlock;

      try {
        const localTool = localToolRegistry.get(toolName);
        if (!localTool) {
          throw new Error(`Tool ${toolName} wurde in der lokalen Registry nicht gefunden.`);
        }

        // HIER WAR DER FEHLER: Kontext muss zwingend mitgegeben werden!
        const toolResult = await localTool.handler(toolInput, requestContext);

        const finalMessage = await anthropic.messages.create({
          model: _model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            ...cleanedHistory,
            { role: "assistant", content: message.content },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolCallId,
                  content: toolResult.content,
                  is_error: toolResult.isError,
                },
              ],
            },
          ],
          tools: claudeTools,
        });

        const textBlock = finalMessage.content.find((b) => b.type === "text");
        return textBlock && "text" in textBlock ? textBlock.text : "Ergebnis verarbeitet.";

      } catch (error) {
        return `<p style="color: #dc2626; font-weight: bold;">Fehler bei der Ausführung des Tools ${toolName}: ${error instanceof Error ? error.message : String(error)}</p>`;
      }
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