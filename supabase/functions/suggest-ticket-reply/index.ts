import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ticket_id } = await req.json();
    if (!ticket_id) {
      return new Response(JSON.stringify({ error: "ticket_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ticket laden
    const { data: ticket, error: ticketError } = await supabaseClient
      .from("support_tickets")
      .select("*")
      .eq("id", ticket_id)
      .single();

    if (ticketError || !ticket) {
      return new Response(JSON.stringify({ error: "Ticket not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bisherige Nachrichten laden
    const { data: messages = [] } = await supabaseClient
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticket_id)
      .order("created_at", { ascending: true });

    // Konversations-History für Claude aufbauen
    const conversationHistory: Array<{ role: string; content: string }> = [];

    // Erste Kundennachricht (aus dem Ticket selbst)
    if (ticket.body) {
      conversationHistory.push({
        role: "user",
        content: `Von: ${ticket.from_name || ticket.from_email}\nBetreff: ${ticket.title}\n\n${ticket.body}`,
      });
    }

    // Weitere Nachrichten
    for (const msg of messages) {
      if (msg.is_ai_suggestion) continue; // KI-Vorschläge nicht in History
      if (msg.sender_type === "customer") {
        conversationHistory.push({ role: "user", content: msg.body });
      } else if (msg.sender_type === "staff") {
        conversationHistory.push({ role: "assistant", content: msg.body });
      }
    }

    // Falls keine History: Dummy-User-Message hinzufügen
    if (conversationHistory.length === 0) {
      conversationHistory.push({
        role: "user",
        content: `Betreff: ${ticket.title}\nVon: ${ticket.from_email}`,
      });
    }

    // Sicherstellen dass letzte Message von "user" ist (Claude erwartet abwechselnde Rollen)
    if (conversationHistory[conversationHistory.length - 1].role === "assistant") {
      conversationHistory.push({
        role: "user",
        content: "[Bitte erstelle eine passende Antwort auf die bisherige Konversation]",
      });
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Claude API aufrufen
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1024,
        system: `Du bist ein hilfreicher Assistent von Artis Treuhand GmbH, einer Schweizer Treuhand- und Steuerberatungsfirma.
Du hilfst Mitarbeitern dabei, professionelle, freundliche und präzise Antworten auf Kundenanfragen zu formulieren.

Wichtige Richtlinien:
- Antworte immer auf Deutsch (Schweizer Hochdeutsch, kein "ß")
- Sei professionell aber freundlich
- Halte die Antwort prägnant und klar
- Beginne NICHT mit "Sehr geehrte/r" – das ergänzt der Mitarbeiter selbst
- Schliesse NICHT mit Unterschrift – das ergänzt der Mitarbeiter selbst
- Beziehe dich direkt auf die Anfrage des Kunden
- Bei Unterlageneingängen: bestätige den Eingang kurz und freundlich`,
        messages: conversationHistory,
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error("Claude API error:", errorText);
      return new Response(JSON.stringify({ error: "Claude API error", details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeResponse.json();
    const suggestion = claudeData.content?.[0]?.text || "";

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in suggest-ticket-reply:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
