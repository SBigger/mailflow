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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Correct Supabase pattern: anon key + user token as global header
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { transcript, columns, priorities, users, customers } = await req.json();
    if (!transcript) {
      return new Response(JSON.stringify({ error: "transcript is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const columnList = (columns || []).map((c: any) => `"${c.name}" (id: ${c.id})`).join(", ");
    const priorityList = (priorities || []).map((p: any) => `"${p.name}" level=${p.level} (id: ${p.id})`).join(", ");
    const userList = (users || []).map((u: any) => `${u.full_name || u.email} -> ${u.email}`).join("\n");
    const customerList = (customers || []).map((c: any) => c.company_name).join(", ");

    const prompt = `Du analysierst einen frei gesprochenen Task-Text eines Schweizer Treuhänders und extrahierst strukturierte Felder.

Gesprochener Text: "${transcript}"
Heute: ${today}

Verfügbare Spalten: ${columnList || "—"}
Verfügbare Prioritäten: ${priorityList || "—"}

Bekannte Mitarbeiter (Name -> E-Mail):
${userList || "—"}

Bekannte Kunden: ${customerList || "—"}

Extrahiere folgende Felder:

TITEL: Format "[Kundenname] – [Tätigkeit]" wenn Kunde erkennbar. Z.B. "Müller AG – Steuerklärung prüfen". Sonst nur Tätigkeit. Max. 60 Zeichen.

BESCHREIBUNG: Zusätzliche Details, mehrere Punkte als "- item\n- item". Null wenn keine.

SPALTE: Passende Spalten-ID. Z.B. "Intern", "In Arbeit", "Warten". Null wenn unklar.

PRIORITÄT: Aus Liste. "dringend/sofort/wichtig" → höchste Priorität. Null wenn nicht erwähnt.

DATUM: Interpretiere: "morgen", "nächste Woche", "bis Freitag", "Ende Monat", "Ende Jahr". Format YYYY-MM-DD. Null wenn nicht erwähnt.

ZUGEWIESEN (assignee_email): Person der die Arbeit zugewiesen wird. Suche ähnlichen Namen in der Mitarbeiterliste (auch bei Spitznamen oder Teilen des Namens). Null wenn nicht erkennbar.

VERANTWORTLICH (verantwortlich_email): Person die für den Task verantwortlich ist (oft die sprechende Person oder "ich"). Falls "ich" oder kein Name → null (wird automatisch auf aktuellen Benutzer gesetzt). Sonst: suche in Mitarbeiterliste.

Antworte NUR mit gültigem JSON, ohne Kommentare.`;

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
        tools: [{
          name: "extract_task",
          description: "Extrahiere Task-Felder aus dem gesprochenen Text",
          input_schema: {
            type: "object",
            properties: {
              title:                { type: "string" },
              description:          { type: ["string", "null"] },
              column_id:            { type: ["string", "null"] },
              priority_id:          { type: ["string", "null"] },
              due_date:             { type: ["string", "null"] },
              assignee_email:       { type: ["string", "null"] },
              verantwortlich_email: { type: ["string", "null"] },
            },
            required: ["title"],
          },
        }],
        tool_choice: { type: "tool", name: "extract_task" },
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error: ${claudeResponse.status} ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const toolUse = claudeData.content?.find((c: any) => c.type === "tool_use");
    const result = toolUse?.input || {};

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("parse-voice-task error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
