import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOP_WORDS = new Set([
  'haben','gibt','welche','zeige','bitte','sind','alle','was','wann','wer',
  'wie','noch','nicht','mehr','kann','über','nach','beim','eine','einen',
  'einem','meine','meinen','meinem','der','die','das','dem','den','und',
  'oder','aber','für','mit','von','zum','zur','ist','hat','bin','auch',
  'schon','nur','mich','mir','bei','des','ich','sie','wir','ihr','ihn',
  'ihm','uns','euch','sich','ein','kein','viel','sehr','bitte','mal',
  'gibt','habe','hatte','wurde','werden','muss','soll','will','darf',
  'kann','doch','auch','then','this','that',
]);

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

    // JWT lokal prüfen (kein extra API-Call): Payload dekodieren und exp prüfen
    const token = authHeader.replace("Bearer ", "");
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("invalid jwt");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.sub && payload.role !== "service_role" && payload.role !== "anon") throw new Error("no sub");
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired");
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { question } = await req.json();
    if (!question?.trim()) {
      return new Response(JSON.stringify({ error: "question is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const q = question.toLowerCase();

    // Extract meaningful keywords
    const keywords = q
      .split(/[\s,.\-!?;:()]+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    if (keywords.length === 0) keywords.push(q.slice(0, 20));

    const buildOrFilter = (fields: string[], kws: string[]) =>
      kws.flatMap(k => fields.map(f => `${f}.ilike.%${k}%`)).join(',');

    // ── Parallel DB queries ───────────────────────────────────
    const [custRes, fristenRes, tasksRes, mailsRes, doksRes] = await Promise.allSettled([
      supabase.from('customers')
        .select('id, company_name, email')
        .or(buildOrFilter(['company_name'], keywords))
        .limit(10),

      supabase.from('fristen')
        .select('id, title, category, kanton, jahr, due_date, status, description, customer_id')
        .or(buildOrFilter(['title', 'category', 'description'], keywords))
        .order('due_date', { ascending: true })
        .limit(8),

      supabase.from('tasks')
        .select('id, title, description, due_date, status, assignee, customer_id')
        .or(buildOrFilter(['title', 'description'], keywords))
        .order('due_date', { ascending: true })
        .limit(8),

      supabase.from('mail_items')
        .select('id, subject, body_preview, received_date, from_address, customer_id')
        .or(buildOrFilter(['subject', 'body_preview', 'from_address'], keywords))
        .order('received_date', { ascending: false })
        .limit(6),

      // Volltext-Suche auf search_vector, Fallback auf ilike
      supabase.from('dokumente')
        .select('id, name, filename, storage_path, customer_id, file_type, content_text')
        .or([
          buildOrFilter(['name', 'filename'], keywords),
          keywords.map(k => `content_text.ilike.%${k}%`).join(','),
        ].join(','))
        .limit(5),
    ]);

    const customers = custRes.status === 'fulfilled' ? (custRes.value.data || []) : [];
    let fristen  = fristenRes.status === 'fulfilled'  ? (fristenRes.value.data || [])  : [];
    let tasks    = tasksRes.status === 'fulfilled'    ? (tasksRes.value.data || [])    : [];
    const mails  = mailsRes.status === 'fulfilled'    ? (mailsRes.value.data || [])    : [];
    const doks   = doksRes.status === 'fulfilled'     ? (doksRes.value.data || [])     : [];

    // If customer found by name → also load their fristen + tasks
    if (customers.length > 0) {
      const cusIds = customers.map((c: any) => c.id);

      const [moreF, moreT] = await Promise.all([
        supabase.from('fristen')
          .select('id, title, category, kanton, jahr, due_date, status, description, customer_id')
          .in('customer_id', cusIds)
          .order('due_date', { ascending: true })
          .limit(10),
        supabase.from('tasks')
          .select('id, title, description, due_date, status, assignee, customer_id')
          .in('customer_id', cusIds)
          .order('due_date', { ascending: true })
          .limit(10),
      ]);

      if (moreF.data) {
        const existing = new Set(fristen.map((f: any) => f.id));
        fristen = [...fristen, ...moreF.data.filter((f: any) => !existing.has(f.id))];
      }
      if (moreT.data) {
        const existing = new Set(tasks.map((t: any) => t.id));
        tasks = [...tasks, ...moreT.data.filter((t: any) => !existing.has(t.id))];
      }
    }

    // Build customer name map
    const allCustIds = new Set([
      ...fristen.map((f: any) => f.customer_id),
      ...tasks.map((t: any) => t.customer_id),
      ...mails.map((m: any) => m.customer_id),
      ...doks.map((d: any) => d.customer_id),
    ].filter(Boolean));

    const custMap: Record<string, string> = {};
    customers.forEach((c: any) => { custMap[c.id] = c.company_name; });

    const uncached = [...allCustIds].filter(id => !custMap[id]);
    if (uncached.length > 0) {
      const { data: extra } = await supabase.from('customers')
        .select('id, company_name')
        .in('id', uncached);
      if (extra) extra.forEach((c: any) => { custMap[c.id] = c.company_name; });
    }

    const cn = (id: string) => custMap[id] || '–';

    // ── Build context for Claude ──────────────────────────────
    let ctx = `Heute: ${today}\nFrage: "${question}"\n\n`;

    if (fristen.length > 0) {
      ctx += `## FRISTEN (${fristen.length} gefunden)\n`;
      fristen.slice(0, 8).forEach((f: any) => {
        ctx += `ID:${f.id} | "${f.title || f.category}" | Kunde: ${cn(f.customer_id)} | Kanton: ${f.kanton} | Jahr: ${f.jahr} | Fällig: ${f.due_date || '–'} | Status: ${f.status}\n`;
        if (f.description) ctx += `  Info: ${f.description.slice(0, 100)}\n`;
      });
      ctx += '\n';
    }

    if (tasks.length > 0) {
      ctx += `## AUFGABEN (${tasks.length} gefunden)\n`;
      tasks.slice(0, 8).forEach((t: any) => {
        ctx += `ID:${t.id} | "${t.title}" | Kunde: ${cn(t.customer_id)} | Fällig: ${t.due_date || '–'} | Status: ${t.status || 'offen'} | Zuständig: ${t.assignee || '–'}\n`;
      });
      ctx += '\n';
    }

    if (mails.length > 0) {
      ctx += `## MAILS (${mails.length} gefunden)\n`;
      mails.slice(0, 6).forEach((m: any) => {
        ctx += `ID:${m.id} | Betreff: "${m.subject}" | Von: ${m.from_address} | Am: ${m.received_date?.split('T')[0] || '–'} | Kunde: ${cn(m.customer_id)}\n`;
        if (m.body_preview) ctx += `  Inhalt: ${m.body_preview.slice(0, 200)}\n`;
      });
      ctx += '\n';
    }

    if (doks.length > 0) {
      ctx += `## DOKUMENTE (${doks.length} gefunden)\n`;
      doks.slice(0, 5).forEach((d: any) => {
        ctx += `ID:${d.id} | "${d.name}" | Kunde: ${cn(d.customer_id)} | Typ: ${d.file_type || d.filename?.split('.').pop() || '–'}\n`;
        if (d.content_text) ctx += `  Inhalt: ${d.content_text.slice(0, 300)}\n`;
      });
      ctx += '\n';
    }

    if (fristen.length === 0 && tasks.length === 0 && mails.length === 0 && doks.length === 0) {
      ctx += `Keine Einträge für die Suche gefunden. Teile dem Benutzer mit, dass du nichts gefunden hast.\n`;
    }

    // ── Claude Haiku ──────────────────────────────────────────
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const userPrompt = `${ctx}

Antworte mit genau diesem JSON-Format (kein Markdown-Codeblock, nur reines JSON):
{
  "answer": "Vollständige Antwort mit Details. ** für fett, - für Listenelemente.",
  "speak_text": "1-2 Sätze zum Vorlesen, kein Markdown.",
  "sources": [
    {"type": "frist|task|mail|dokument", "id": "uuid", "title": "Titel", "subtitle": "Datum/Status", "customer_name": "Kundenname"}
  ]
}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: `Du bist Smartis, der KI-Assistent von Artis Treuhand. Beantworte Fragen auf Deutsch.

Regeln:
- Antworte präzise, informativ und freundlich
- Bei Fristen: nenne Kategorie, Kanton, Jahr, Fälligkeitsdatum und Status
- Bei Aufgaben: nenne Titel, Fälligkeitsdatum und Status
- Bei Mails: nenne Betreff, Absender und Datum
- Bei Dokumenten: nenne Dokumentname und Kunden
- Wenn nichts gefunden: sag es klar
- Antworte NUR mit einem JSON-Objekt, kein Markdown-Codeblock`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errTxt = await claudeRes.text();
      throw new Error(`Claude error ${claudeRes.status}: ${errTxt}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "{}";

    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      // Fallback: try extracting JSON from text
      const match = rawText.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : {
        answer: "Entschuldigung, ich konnte keine Antwort generieren.",
        speak_text: "Keine Antwort erhalten.",
        sources: [],
      };
    }

    if (!result.sources) result.sources = [];
    if (!result.speak_text) result.speak_text = result.answer?.slice(0, 150) || "";

    // Dokument-Quellen mit storage_path anreichern (für direktes Öffnen im Frontend)
    const dokMap: Record<string, string> = {};
    doks.forEach((d: any) => { if (d.storage_path) dokMap[d.id] = d.storage_path; });
    result.sources = result.sources.map((s: any) =>
      s.type === 'dokument' && dokMap[s.id] ? { ...s, storage_path: dokMap[s.id] } : s
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("voice-assistant error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
