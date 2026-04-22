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

function fmt(date?: string | null) {
  if (!date) return '–';
  return date.split('T')[0].split('-').reverse().join('.');
}

function buildOrFilter(fields: string[], kws: string[]) {
  return kws.flatMap(k => fields.map(f => `${f}.ilike.%${k}%`)).join(',');
}

// Direkt-Formatter als Fallback falls Claude nicht antwortet
function buildDirectAnswer(
  question: string,
  fristen: any[], tasks: any[], mails: any[], doks: any[],
  custMap: Record<string, string>
): { answer: string; speak_text: string; sources: any[] } {
  const cn = (id: string) => custMap[id] || '–';
  const total = fristen.length + tasks.length + mails.length + doks.length;

  if (total === 0) {
    return {
      answer: `Keine Einträge gefunden für: **"${question}"**\n\nBitte prüfe die Schreibweise oder versuche andere Begriffe.`,
      speak_text: 'Keine Einträge gefunden.',
      sources: [],
    };
  }

  let answer = '';
  if (fristen.length > 0) {
    answer += `## Fristen (${fristen.length})\n`;
    for (const f of fristen.slice(0, 8)) {
      const st = f.status === 'erledigt' ? '✅' : f.status === 'eingereicht' ? '📤' : '🔴';
      answer += `- ${st} **${f.title || f.category}** | ${cn(f.customer_id)} | ${f.kanton || '–'} | ${f.jahr || '–'} | Fällig: ${fmt(f.due_date)}\n`;
    }
    answer += '\n';
  }
  if (tasks.length > 0) {
    answer += `## Aufgaben (${tasks.length})\n`;
    for (const t of tasks.slice(0, 8)) {
      answer += `- ${t.status === 'done' ? '✅' : '🔲'} **${t.title}** | ${cn(t.customer_id)} | ${fmt(t.due_date)}\n`;
    }
    answer += '\n';
  }
  if (mails.length > 0) {
    answer += `## Mails (${mails.length})\n`;
    for (const m of mails.slice(0, 6)) {
      answer += `- 📧 **${m.subject}** | ${m.from_address} | ${fmt(m.received_date)}\n`;
    }
    answer += '\n';
  }
  if (doks.length > 0) {
    answer += `## Dokumente (${doks.length})\n`;
    for (const d of doks.slice(0, 6)) {
      answer += `- 📄 **${d.name}** | ${cn(d.customer_id)}\n`;
      if (d.content_snippet) answer += `  _...${d.content_snippet}..._\n`;
    }
  }

  const parts: string[] = [];
  if (fristen.length) parts.push(`${fristen.length} Frist${fristen.length > 1 ? 'en' : ''}`);
  if (tasks.length)   parts.push(`${tasks.length} Aufgabe${tasks.length > 1 ? 'n' : ''}`);
  if (mails.length)   parts.push(`${mails.length} Mail${mails.length > 1 ? 's' : ''}`);
  if (doks.length)    parts.push(`${doks.length} Dokument${doks.length > 1 ? 'e' : ''}`);

  const sources: any[] = [];
  for (const f of fristen.slice(0, 3))
    sources.push({ type: 'frist', id: f.id, title: f.title || f.category, subtitle: `${fmt(f.due_date)} | ${f.status}`, customer_name: cn(f.customer_id) });
  for (const t of tasks.slice(0, 3))
    sources.push({ type: 'task', id: t.id, title: t.title, subtitle: `${fmt(t.due_date)} | ${t.status || 'offen'}`, customer_name: cn(t.customer_id) });
  for (const m of mails.slice(0, 2))
    sources.push({ type: 'mail', id: m.id, title: m.subject, subtitle: fmt(m.received_date), customer_name: cn(m.customer_id) });
  for (const d of doks.slice(0, 3)) {
    const s: any = { type: 'dokument', id: d.id, title: d.name, subtitle: d.file_type || '–', customer_name: cn(d.customer_id) };
    if (d.storage_path) s.storage_path = d.storage_path;
    sources.push(s);
  }

  return { answer: answer.trim(), speak_text: `Ich habe ${parts.join(', ')} gefunden.`, sources };
}

// ── Haupt-Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // JWT prüfen
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

    const keywords = q
      .split(/[\s,.\-!?;:()]+/)
      .filter((w: string) => w.length >= 3 && !STOP_WORDS.has(w));
    if (keywords.length === 0) keywords.push(q.slice(0, 20));

    // ── Parallele DB-Suche ────────────────────────────────────────────────────
    const [custRes, fristenRes, tasksRes, mailsRes, rpcRes, contentRes] =
      await Promise.allSettled([
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

        // GIN-Volltext-Suche inkl. PDF-Inhalt
        supabase.rpc('search_dokumente', {
          p_query: keywords.join(' '), p_customer_id: null, p_limit: 8,
        }),

        // Parallel: content_text ilike für alle indizierten Dokumente
        supabase.from('dokumente')
          .select('id, name, filename, storage_path, customer_id, file_type, content_text')
          .or(keywords.map((k: string) => `content_text.ilike.%${k}%`).join(','))
          .limit(6),
      ]);

    const customers = custRes.status === 'fulfilled' ? (custRes.value.data || []) : [];
    let fristen     = fristenRes.status === 'fulfilled' ? (fristenRes.value.data || []) : [];
    let tasks       = tasksRes.status === 'fulfilled'   ? (tasksRes.value.data || [])   : [];
    const mails     = mailsRes.status === 'fulfilled'   ? (mailsRes.value.data || [])   : [];

    // Dokumente: GIN-RPC + content_text zusammenführen, deduplizieren
    const rpcDoks     = rpcRes.status === 'fulfilled'     ? (rpcRes.value.data || [])     : [];
    const contentDoks = contentRes.status === 'fulfilled' ? (contentRes.value.data || []) : [];
    const seenIds = new Set(rpcDoks.map((d: any) => d.id));
    const extraDoks = contentDoks
      .filter((d: any) => !seenIds.has(d.id))
      .map((d: any) => {
        let content_snippet = '';
        if (d.content_text) {
          for (const kw of keywords) {
            const idx = d.content_text.toLowerCase().indexOf(kw);
            if (idx >= 0) {
              content_snippet = d.content_text.slice(Math.max(0, idx - 40), idx + 100).replace(/\s+/g, ' ');
              break;
            }
          }
        }
        return { ...d, content_snippet };
      });
    const doks = [...rpcDoks, ...extraDoks];

    // Wenn Kunde gefunden → auch seine Fristen + Tasks laden
    if (customers.length > 0) {
      const cusIds = customers.map((c: any) => c.id);
      const [moreF, moreT] = await Promise.all([
        supabase.from('fristen')
          .select('id, title, category, kanton, jahr, due_date, status, description, customer_id')
          .in('customer_id', cusIds).order('due_date', { ascending: true }).limit(10),
        supabase.from('tasks')
          .select('id, title, description, due_date, status, assignee, customer_id')
          .in('customer_id', cusIds).order('due_date', { ascending: true }).limit(10),
      ]);
      if (moreF.data) {
        const ex = new Set(fristen.map((f: any) => f.id));
        fristen = [...fristen, ...moreF.data.filter((f: any) => !ex.has(f.id))];
      }
      if (moreT.data) {
        const ex = new Set(tasks.map((t: any) => t.id));
        tasks = [...tasks, ...moreT.data.filter((t: any) => !ex.has(t.id))];
      }
    }

    // Kunden-Namens-Map
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
        .select('id, company_name').in('id', uncached);
      if (extra) extra.forEach((c: any) => { custMap[c.id] = c.company_name; });
    }

    const cn = (id: string) => custMap[id] || '–';

    // ── Kontext für Claude aufbauen ───────────────────────────────────────────
    let ctx = `Heute: ${today}\nFrage: "${question}"\n\n`;

    if (fristen.length > 0) {
      ctx += `## FRISTEN (${fristen.length})\n`;
      fristen.slice(0, 8).forEach((f: any) => {
        ctx += `ID:${f.id} | "${f.title || f.category}" | Kunde: ${cn(f.customer_id)} | Kanton: ${f.kanton || '–'} | Jahr: ${f.jahr || '–'} | Fällig: ${fmt(f.due_date)} | Status: ${f.status}\n`;
        if (f.description) ctx += `  Info: ${f.description.slice(0, 150)}\n`;
      });
      ctx += '\n';
    }
    if (tasks.length > 0) {
      ctx += `## AUFGABEN (${tasks.length})\n`;
      tasks.slice(0, 8).forEach((t: any) => {
        ctx += `ID:${t.id} | "${t.title}" | Kunde: ${cn(t.customer_id)} | Fällig: ${fmt(t.due_date)} | Status: ${t.status || 'offen'} | Zuständig: ${t.assignee || '–'}\n`;
        if (t.description) ctx += `  Info: ${t.description.slice(0, 150)}\n`;
      });
      ctx += '\n';
    }
    if (mails.length > 0) {
      ctx += `## MAILS (${mails.length})\n`;
      mails.slice(0, 6).forEach((m: any) => {
        ctx += `ID:${m.id} | "${m.subject}" | Von: ${m.from_address} | Am: ${fmt(m.received_date)} | Kunde: ${cn(m.customer_id)}\n`;
        if (m.body_preview) ctx += `  Inhalt: ${m.body_preview.slice(0, 250)}\n`;
      });
      ctx += '\n';
    }
    if (doks.length > 0) {
      ctx += `## DOKUMENTE (${doks.length})\n`;
      doks.slice(0, 6).forEach((d: any) => {
        ctx += `ID:${d.id} | "${d.name}" | Kunde: ${cn(d.customer_id)} | Typ: ${d.file_type || d.filename?.split('.').pop() || '–'}\n`;
        // Textauszug aus PDF/Word-Inhalt mitgeben
        const snippet = (d as any).content_snippet || (d.content_text ? d.content_text.slice(0, 300) : '');
        if (snippet) ctx += `  Inhalt-Auszug: "${snippet}"\n`;
      });
      ctx += '\n';
    }
    if (fristen.length === 0 && tasks.length === 0 && mails.length === 0 && doks.length === 0) {
      ctx += `Keine Einträge gefunden. Teile dem Benutzer mit, dass nichts gefunden wurde.\n`;
    }

    // ── Claude Haiku 4.5 – beste Qualität für Deutsch & Kontextverständnis ───
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicKey) {
      // Fallback: direkte Formatierung ohne LLM
      const fallback = buildDirectAnswer(question, fristen, tasks, mails, doks, custMap);
      return new Response(JSON.stringify({ ...fallback, today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `${ctx}
Antworte mit genau diesem JSON-Format (kein Markdown-Codeblock, nur reines JSON):
{
  "answer": "Vollständige Antwort auf Deutsch. Benutze ** für fett, - für Listen. Hebe das Wichtigste hervor.",
  "speak_text": "1-2 Sätze zum Vorlesen, kein Markdown, auf das Wesentliche fokussiert.",
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
        max_tokens: 2000,
        system: `Du bist Smartis, der KI-Assistent von Artis Treuhand GmbH.
Beantworte Fragen auf Schweizer Hochdeutsch (ss statt ß).

Regeln:
- Antworte präzise, informativ und freundlich
- Erkenne Zusammenhänge zwischen Fristen, Aufgaben, Mails und Dokumenten
- Bei Fristen: nenne Kategorie, Kanton, Jahr, Fälligkeitsdatum und Status
- Bei Aufgaben: nenne Titel, Fälligkeitsdatum und Zuständigen
- Bei Mails: nenne Betreff, Absender und Datum
- Bei Dokumenten: nenne Name, Kunde und relevante Textauszüge
- Wenn mehrere Einträge: fasse zusammen und hebe das Dringlichste hervor
- Wenn nichts gefunden: sage es klar und schlage alternative Suchbegriffe vor
- Antworte NUR mit einem JSON-Objekt, kein Markdown-Codeblock`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      // Claude nicht verfügbar → Direkt-Formatter als Fallback
      console.error("Claude error:", claudeRes.status, await claudeRes.text());
      const fallback = buildDirectAnswer(question, fristen, tasks, mails, doks, custMap);
      return new Response(JSON.stringify({ ...fallback, today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "{}";

    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : null;
    }

    // Falls Claude kein valides JSON liefert → Fallback
    if (!result?.answer) {
      const fallback = buildDirectAnswer(question, fristen, tasks, mails, doks, custMap);
      return new Response(JSON.stringify({ ...fallback, today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!result.sources) result.sources = [];
    if (!result.speak_text) result.speak_text = result.answer?.slice(0, 150) || "";

    // storage_path für Dokument-Quellen anreichern
    const dokMap: Record<string, string> = {};
    doks.forEach((d: any) => { if (d.storage_path) dokMap[d.id] = d.storage_path; });
    result.sources = result.sources.map((s: any) =>
      s.type === 'dokument' && dokMap[s.id] ? { ...s, storage_path: dokMap[s.id] } : s
    );

    return new Response(JSON.stringify({ ...result, today }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("voice-assistant error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
