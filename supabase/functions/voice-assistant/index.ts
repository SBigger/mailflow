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

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function fmt(date?: string | null) {
  if (!date) return '–';
  return date.split('T')[0].split('-').reverse().join('.');
}

function buildOrFilter(fields: string[], kws: string[]) {
  return kws.flatMap(k => fields.map(f => `${f}.ilike.%${k}%`)).join(',');
}

// ── Antwort ohne KI direkt aus DB-Resultaten bauen ───────────────────────────

function buildAnswer(
  question: string,
  fristen: any[], tasks: any[], mails: any[], doks: any[],
  custMap: Record<string, string>
): string {
  const cn = (id: string) => custMap[id] || '–';
  const total = fristen.length + tasks.length + mails.length + doks.length;

  if (total === 0) {
    return `Keine Einträge gefunden für: **"${question}"**\n\nBitte prüfe die Schreibweise oder versuche es mit anderen Suchbegriffen.`;
  }

  let out = `Suchergebnisse für **"${question}"** – ${total} Treffer:\n\n`;

  if (fristen.length > 0) {
    out += `## Fristen (${fristen.length})\n`;
    for (const f of fristen.slice(0, 8)) {
      const status = f.status === 'erledigt' ? '✅' : f.status === 'eingereicht' ? '📤' : '🔴';
      out += `- ${status} **${f.title || f.category}** | ${cn(f.customer_id)} | Kanton: ${f.kanton || '–'} | Jahr: ${f.jahr || '–'} | Fällig: ${fmt(f.due_date)}\n`;
      if (f.description) out += `  _${f.description.slice(0, 100)}_\n`;
    }
    out += '\n';
  }

  if (tasks.length > 0) {
    out += `## Aufgaben (${tasks.length})\n`;
    for (const t of tasks.slice(0, 8)) {
      const status = t.status === 'done' ? '✅' : '🔲';
      out += `- ${status} **${t.title}** | ${cn(t.customer_id)} | Fällig: ${fmt(t.due_date)} | ${t.assignee || '–'}\n`;
      if (t.description) out += `  _${t.description.slice(0, 100)}_\n`;
    }
    out += '\n';
  }

  if (mails.length > 0) {
    out += `## Mails (${mails.length})\n`;
    for (const m of mails.slice(0, 6)) {
      out += `- 📧 **${m.subject}** | Von: ${m.from_address} | ${fmt(m.received_date)} | ${cn(m.customer_id)}\n`;
      if (m.body_preview) out += `  _${m.body_preview.slice(0, 120)}_\n`;
    }
    out += '\n';
  }

  if (doks.length > 0) {
    out += `## Dokumente (${doks.length})\n`;
    for (const d of doks.slice(0, 6)) {
      const ext = d.file_type || d.filename?.split('.').pop()?.toUpperCase() || '–';
      out += `- 📄 **${d.name}** | ${cn(d.customer_id)} | ${ext}\n`;
      if (d.content_snippet) out += `  _...${d.content_snippet}..._\n`;
    }
    out += '\n';
  }

  return out.trim();
}

function buildSpeakText(fristen: any[], tasks: any[], mails: any[], doks: any[]): string {
  const parts: string[] = [];
  if (fristen.length > 0) parts.push(`${fristen.length} Frist${fristen.length > 1 ? 'en' : ''}`);
  if (tasks.length > 0)   parts.push(`${tasks.length} Aufgabe${tasks.length > 1 ? 'n' : ''}`);
  if (mails.length > 0)   parts.push(`${mails.length} Mail${mails.length > 1 ? 's' : ''}`);
  if (doks.length > 0)    parts.push(`${doks.length} Dokument${doks.length > 1 ? 'e' : ''}`);
  if (parts.length === 0) return 'Keine Einträge gefunden.';
  return `Ich habe ${parts.join(', ')} gefunden.`;
}

function buildSources(
  fristen: any[], tasks: any[], mails: any[], doks: any[],
  custMap: Record<string, string>
): any[] {
  const cn = (id: string) => custMap[id] || '–';
  const sources: any[] = [];

  for (const f of fristen.slice(0, 4)) {
    sources.push({ type: 'frist', id: f.id, title: f.title || f.category || 'Frist',
      subtitle: `${fmt(f.due_date)} | ${f.status || '–'}`, customer_name: cn(f.customer_id) });
  }
  for (const t of tasks.slice(0, 4)) {
    sources.push({ type: 'task', id: t.id, title: t.title,
      subtitle: `${fmt(t.due_date)} | ${t.status || 'offen'}`, customer_name: cn(t.customer_id) });
  }
  for (const m of mails.slice(0, 3)) {
    sources.push({ type: 'mail', id: m.id, title: m.subject,
      subtitle: fmt(m.received_date), customer_name: cn(m.customer_id) });
  }
  for (const d of doks.slice(0, 3)) {
    const src: any = { type: 'dokument', id: d.id, title: d.name,
      subtitle: d.file_type || d.filename?.split('.').pop() || '–', customer_name: cn(d.customer_id) };
    if (d.storage_path) src.storage_path = d.storage_path;
    sources.push(src);
  }
  return sources;
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

        // GIN-Volltext-Suche (inkl. PDF-Inhalt via search_vector)
        supabase.rpc('search_dokumente', {
          p_query: keywords.join(' '), p_customer_id: null, p_limit: 8,
        }),

        // Parallel: direkte content_text ilike-Suche (findet auch nicht-GIN-indexierte Docs)
        supabase.from('dokumente')
          .select('id, name, filename, storage_path, customer_id, file_type, content_text')
          .or(keywords.map((k: string) => `content_text.ilike.%${k}%`).join(','))
          .limit(6),
      ]);

    const customers = custRes.status === 'fulfilled' ? (custRes.value.data || []) : [];
    let fristen     = fristenRes.status === 'fulfilled' ? (fristenRes.value.data || []) : [];
    let tasks       = tasksRes.status === 'fulfilled'   ? (tasksRes.value.data || [])   : [];
    const mails     = mailsRes.status === 'fulfilled'   ? (mailsRes.value.data || [])   : [];

    // Dokumente: RPC + content_text zusammenführen, deduplizieren
    const rpcDoks     = rpcRes.status === 'fulfilled'     ? (rpcRes.value.data || [])     : [];
    const contentDoks = contentRes.status === 'fulfilled' ? (contentRes.value.data || []) : [];
    const seenIds = new Set(rpcDoks.map((d: any) => d.id));
    // content_text-Treffer: Snippet für Anzeige vorbereiten
    const extraDoks = contentDoks
      .filter((d: any) => !seenIds.has(d.id))
      .map((d: any) => {
        let snippet = '';
        if (d.content_text) {
          for (const kw of keywords) {
            const idx = d.content_text.toLowerCase().indexOf(kw);
            if (idx >= 0) {
              snippet = d.content_text.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ');
              break;
            }
          }
        }
        return { ...d, content_snippet: snippet };
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

    // Kunden-Namens-Map aufbauen
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

    // ── Antwort direkt aus DB-Resultaten bauen (kein Claude-API-Call) ─────────
    const answer     = buildAnswer(question, fristen, tasks, mails, doks, custMap);
    const speak_text = buildSpeakText(fristen, tasks, mails, doks);
    const sources    = buildSources(fristen, tasks, mails, doks, custMap);

    return new Response(JSON.stringify({ answer, speak_text, sources, today }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("voice-assistant error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
