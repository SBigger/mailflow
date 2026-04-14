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

    // Wissensdatenbank laden (aktive Einträge)
    const { data: knowledgeEntries = [] } = await supabaseClient
      .from("knowledge_base")
      .select("title, content, category")
      .eq("is_active", true)
      .order("category", { ascending: true });

    // KB-Kontext für System-Prompt aufbauen
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

    // Konversations-History für Gemini aufbauen (user/model alternierend)
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    // Erste Kundennachricht (aus dem Ticket selbst)
    if (ticket.body) {
      contents.push({
        role: "user",
        parts: [{ text: `Von: ${ticket.from_name || ticket.from_email}\nBetreff: ${ticket.title}\n\n${ticket.body}` }],
      });
    }

    // Weitere Nachrichten
    for (const msg of messages) {
      if (msg.is_ai_suggestion) continue; // KI-Vorschläge nicht in History
      if (msg.sender_type === "customer") {
        contents.push({ role: "user", parts: [{ text: msg.body }] });
      } else if (msg.sender_type === "staff") {
        contents.push({ role: "model", parts: [{ text: msg.body }] });
      }
    }

    // Falls keine History: Dummy-User-Message hinzufügen
    if (contents.length === 0) {
      contents.push({
        role: "user",
        parts: [{ text: `Betreff: ${ticket.title}\nVon: ${ticket.from_email}` }],
      });
    }

    // Sicherstellen dass letzte Message von "user" ist
    if (contents[contents.length - 1].role === "model") {
      contents.push({
        role: "user",
        parts: [{ text: "[Bitte erstelle eine passende Antwort auf die bisherige Konversation]" }],
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ suggestion: null, error: "GEMINI_API_KEY not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modelle in Reihenfolge: aktuell → fallback
    const modelCandidates = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ];

    let suggestion = "";
    let lastError = "";
    for (const model of modelCandidates) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents,
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024,
              },
            }),
          }
        );

        if (!geminiRes.ok) {
          const errorText = await geminiRes.text();
          console.error(`Gemini API error [${model}]:`, errorText);
          lastError = `${model}: HTTP ${geminiRes.status} – ${errorText.substring(0, 300)}`;
          continue; // nächstes Modell versuchen
        }

        const geminiData = await geminiRes.json();
        suggestion = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (suggestion) {
          console.log(`Gemini OK mit ${model}`);
          break;
        }
        lastError = `${model}: leere Antwort`;
      } catch (e: any) {
        lastError = `${model}: ${e?.message || "network error"}`;
        console.error(`Gemini fetch error [${model}]:`, e);
      }
    }

    if (!suggestion) {
      return new Response(JSON.stringify({ suggestion: null, error: lastError || "Gemini API fehlgeschlagen" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Error in suggest-ticket-reply:", error);
    return new Response(JSON.stringify({ suggestion: null, error: error?.message || String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
