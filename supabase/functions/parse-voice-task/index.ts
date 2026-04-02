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

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
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

Extrahiere folgende Felder und antworte NUR mit gültigem JSON:

{
  "title": "Format '[Kundenname] – [Tätigkeit]' wenn Kunde erkennbar, max. 60 Zeichen",
  "description": "Zusätzliche Details als '- item\\n- item' oder null",
  "column_id": "Passende Spalten-ID oder null",
  "priority_id": "Prioritäts-ID (dringend/sofort/wichtig → höchste) oder null",
  "due_date": "YYYY-MM-DD (morgen/nächste Woche/etc interpretieren) oder null",
  "assignee_email": "E-Mail der zugewiesenen Person oder null",
  "verantwortlich_email": "E-Mail der verantwortlichen Person (bei 'ich' → null) oder null"
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      throw new Error(`Gemini API error: ${geminiRes.status} ${errorText}`);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result: any = {};
    try {
      result = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : {};
    }

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
