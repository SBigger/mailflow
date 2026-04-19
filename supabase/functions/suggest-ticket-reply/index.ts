import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ok = (body: object) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return ok({ suggestion: null, error: "Kein Auth-Header – bitte neu einloggen" });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return ok({ suggestion: null, error: "Authentifizierung fehlgeschlagen: " + (authError?.message || "kein User") });
    }

    const { ticket_id } = await req.json();
    if (!ticket_id) {
      return ok({ suggestion: null, error: "ticket_id fehlt" });
    }

    // Ticket laden
    const { data: ticket, error: ticketError } = await supabaseClient
      .from("support_tickets")
      .select("*")
      .eq("id", ticket_id)
      .single();

    if (ticketError || !ticket) {
      return ok({ suggestion: null, error: "Ticket nicht gefunden: " + (ticketError?.message || ticket_id) });
    }

    // Bisherige Nachrichten laden
    const { data: messages = [] } = await supabaseClient
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticket_id)
      .order("created_at", { ascending: true });

    // Wissensdatenbank laden
    const { data: knowledgeEntries = [] } = await supabaseClient
      .from("knowledge_base")
      .select("title, content, category")
      .eq("is_active", true)
      .order("category", { ascending: true });

    // KB-Kontext aufbauen
    let kbContext = "";
    if (knowledgeEntries.length > 0) {
      kbContext = "\n\n## Interne Wissensdatenbank\nNutze folgende Informationen wenn relevant:\n\n";
      for (const kb of knowledgeEntries) {
        kbContext += `### ${kb.category}: ${kb.title}\n${kb.content}\n\n`;
      }
    }

    const systemPrompt = `Du bist ein hilfreicher Assistent von Artis Treuhand GmbH, einer Schweizer Treuhand- und Steuerberatungsfirma.
Du hilfst Mitarbeitern dabei, professionelle, freundliche und präzise Antworten auf Kundenanfragen zu formulieren.

Wichtige Richtlinien:
- Antworte immer auf Deutsch (Schweizer Hochdeutsch, kein "ß")
- Sei professionell aber freundlich
- Halte die Antwort prägnant und klar
- Beginne NICHT mit "Sehr geehrte/r" – das ergänzt der Mitarbeiter selbst
- Schliesse NICHT mit Unterschrift – das ergänzt der Mitarbeiter selbst
- Beziehe dich direkt auf die Anfrage des Kunden
- Bei Unterlageneingängen: bestätige den Eingang kurz und freundlich
- Nutze die interne Wissensdatenbank wenn vorhanden${kbContext}`;

    // Konversations-History aufbauen
    const userMessages: Array<{ role: string; content: string }> = [];

    if (ticket.body) {
      userMessages.push({
        role: "user",
        content: `Von: ${ticket.from_name || ticket.from_email}\nBetreff: ${ticket.title}\n\n${ticket.body}`,
      });
    }

    for (const msg of messages) {
      if (msg.is_ai_suggestion) continue;
      if (msg.sender_type === "customer") {
        userMessages.push({ role: "user", content: msg.body });
      } else if (msg.sender_type === "staff") {
        userMessages.push({ role: "assistant", content: msg.body });
      }
    }

    if (userMessages.length === 0) {
      userMessages.push({
        role: "user",
        content: `Betreff: ${ticket.title}\nVon: ${ticket.from_email}`,
      });
    }

    // Sicherstellen dass letzte Message von "user" ist
    if (userMessages[userMessages.length - 1].role === "assistant") {
      userMessages.push({
        role: "user",
        content: "[Bitte erstelle eine passende Antwort auf die bisherige Konversation]",
      });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return ok({ suggestion: null, error: "ANTHROPIC_API_KEY nicht konfiguriert" });
    }

    // Model mit Fallback-Kette: zuerst Haiku 4.5 (Alias), bei Fehler → Sonnet 4.5 (Alias) → 3.5 Haiku
    const modelCandidates = [
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
      "claude-3-5-haiku-latest",
    ];

    let suggestion = "";
    let lastError = "";

    for (const model of modelCandidates) {
      console.log(`[suggest-ticket-reply] Versuche Model: ${model}`);
      try {
        const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: userMessages,
          }),
        });

        const responseText = await anthropicRes.text();
        if (!anthropicRes.ok) {
          lastError = `HTTP ${anthropicRes.status} (${model}): ${responseText.substring(0, 200)}`;
          console.error(`[suggest-ticket-reply] Anthropic Fehler mit ${model}:`, responseText.substring(0, 300));
          // 404/400 = Model-Problem → nächster Kandidat. 401/429/500 → abbrechen.
          if (anthropicRes.status === 404 || anthropicRes.status === 400) continue;
          return ok({ suggestion: null, error: `Claude API Fehler: ${lastError}` });
        }

        const anthropicData = JSON.parse(responseText);
        suggestion = anthropicData.content?.[0]?.text || "";
        if (suggestion) {
          console.log(`[suggest-ticket-reply] OK mit ${model} – ${suggestion.length} Zeichen`);
          return ok({ suggestion, model_used: model });
        }
        lastError = `Leere Antwort von ${model}`;
      } catch (e: any) {
        lastError = `Exception (${model}): ${e?.message || String(e)}`;
        console.error(`[suggest-ticket-reply] Exception mit ${model}:`, e);
      }
    }

    return ok({
      suggestion: null,
      error: `Kein Modell funktionierte. Letzter Fehler: ${lastError}`,
    });

  } catch (error: any) {
    console.error("Unerwarteter Fehler in suggest-ticket-reply:", error);
    return ok({ suggestion: null, error: "Unerwarteter Fehler: " + (error?.message || String(error)) });
  }
});
