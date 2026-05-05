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
  'kann','doch','auch','then','this','that','letzte','letzten','aktion',
  'aktionen','kunde','kunden',
]);

function fmt(date?: string | null) {
  if (!date) return '–';
  return date.split('T')[0].split('-').reverse().join('.');
}

function fmtDateTime(date?: string | null) {
  if (!date) return '–';
  const d = new Date(date);
  if (isNaN(d.getTime())) return fmt(date);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function fmtDuration(sec?: number | null) {
  if (!sec) return '–';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function buildOrFilter(fields: string[], kws: string[]) {
  return kws.flatMap(k => fields.map(f => `${f}.ilike.%${k}%`)).join(',');
}

// Direkt-Formatter als Fallback falls Claude nicht antwortet
function buildDirectAnswer(
  question: string,
  fristen: any[], tasks: any[], mails: any[], doks: any[], calls: any[], aktien: any[],
  custMap: Record<string, string>
): { answer: string; speak_text: string; sources: any[] } {
  const cn = (id: string) => custMap[id] || '–';
  const total = fristen.length + tasks.length + mails.length + doks.length + calls.length + aktien.length;

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
  if (calls.length > 0) {
    answer += `## Telefonate (${calls.length})\n`;
    for (const c of calls.slice(0, 8)) {
      const dir = c.direction === 'in' ? '⬅' : c.direction === 'out' ? '➡' : '☎';
      const partner = c.direction === 'in' ? (c.caller_name || c.caller_number) : (c.callee_name || c.callee_number);
      answer += `- ${dir} **${partner || '–'}** | ${cn(c.customer_id)} | ${fmtDateTime(c.start_time)} | ${fmtDuration(c.duration_seconds)}\n`;
      if (c.notes) answer += `  _${c.notes.slice(0, 120)}_\n`;
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
    answer += '\n';
  }
  if (aktien.length > 0) {
    answer += `## Aktienbuch (${aktien.length})\n`;
    for (const a of aktien.slice(0, 6)) {
      answer += `- 📜 **${a.aktionaer_name}** | ${cn(a.customer_id)} | ${a.transaktionstyp || '–'} | ${fmt(a.kaufdatum)}\n`;
    }
  }

  const parts: string[] = [];
  if (fristen.length) parts.push(`${fristen.length} Frist${fristen.length > 1 ? 'en' : ''}`);
  if (tasks.length)   parts.push(`${tasks.length} Aufgabe${tasks.length > 1 ? 'n' : ''}`);
  if (calls.length)   parts.push(`${calls.length} Telefonat${calls.length > 1 ? 'e' : ''}`);
  if (mails.length)   parts.push(`${mails.length} Mail${mails.length > 1 ? 's' : ''}`);
  if (doks.length)    parts.push(`${doks.length} Dokument${doks.length > 1 ? 'e' : ''}`);
  if (aktien.length)  parts.push(`${aktien.length} Aktienbuch-Eintrag${aktien.length > 1 ? 'e' : ''}`);

  const sources: any[] = [];
  for (const f of fristen.slice(0, 3))
    sources.push({ type: 'frist', id: f.id, title: f.title || f.category, subtitle: `${fmt(f.due_date)} | ${f.status}`, customer_name: cn(f.customer_id) });
  for (const t of tasks.slice(0, 3))
    sources.push({ type: 'task', id: t.id, title: t.title, subtitle: `${fmt(t.due_date)} | ${t.status || 'offen'}`, customer_name: cn(t.customer_id) });
  for (const c of calls.slice(0, 3)) {
    const partner = c.direction === 'in' ? (c.caller_name || c.caller_number) : (c.callee_name || c.callee_number);
    sources.push({ type: 'call', id: c.id, title: partner || 'Anruf', subtitle: `${fmtDateTime(c.start_time)} | ${fmtDuration(c.duration_seconds)}`, customer_name: cn(c.customer_id) });
  }
  for (const m of mails.slice(0, 2))
    sources.push({ type: 'mail', id: m.id, title: m.subject, subtitle: fmt(m.received_date), customer_name: cn(m.customer_id) });
  for (const d of doks.slice(0, 3)) {
    const s: any = { type: 'dokument', id: d.id, title: d.name, subtitle: d.file_type || '–', customer_name: cn(d.customer_id) };
    if (d.storage_path) s.storage_path = d.storage_path;
    sources.push(s);
  }
  for (const a of aktien.slice(0, 2))
    sources.push({ type: 'aktie', id: a.id, title: a.aktionaer_name, subtitle: `${a.transaktionstyp || '–'} | ${fmt(a.kaufdatum)}`, customer_name: cn(a.customer_id) });

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

    const body = await req.json();

    // ── get_customers-Modus: gibt alle Kunden zurück (umgeht RLS) ───────────
    if (body.get_customers) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, company_name')
        .order('company_name')
        .limit(2000);
      return new Response(JSON.stringify({ customers: customers || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const question: string = body.question || "";
    const directCustomerId: string | null = body.customer_id || null;
    const sinceMonths: number = Math.min(Math.max(Number(body.since_months) || 6, 1), 60);

    if (!directCustomerId && !question?.trim()) {
      return new Response(JSON.stringify({ error: "question or customer_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];
    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - sinceMonths);
    const sinceIso = sinceDate.toISOString();

    const q = (question || "").toLowerCase();
    const keywords = q
      .split(/[\s,.\-!?;:()]+/)
      .filter((w: string) => w.length >= 3 && !STOP_WORDS.has(w));
    if (keywords.length === 0) keywords.push(q.slice(0, 20));

    // ── Direkt-Modus: ein Kunde, alles der letzten N Monate ────────────────
    if (directCustomerId) {
      const cusIds = [directCustomerId];
      const [custRes2, fF, tT, mM, cC, aA, dD, fzFz] = await Promise.all([
        supabase.from('customers').select('id, company_name, email').eq('id', directCustomerId).limit(1),
        supabase.from('fristen')
          .select('id, title, category, kanton, jahr, due_date, status, description, customer_id')
          .in('customer_id', cusIds).gte('due_date', sinceDate.toISOString().split('T')[0])
          .order('due_date', { ascending: true }).limit(50),
        supabase.from('tasks')
          .select('id, title, description, due_date, status, assignee, customer_id, created_at')
          .in('customer_id', cusIds).gte('created_at', sinceIso)
          .order('due_date', { ascending: true }).limit(50),
        supabase.from('mail_items')
          .select('id, subject, body_preview, received_date, from_address, customer_id')
          .in('customer_id', cusIds).gte('received_date', sinceIso)
          .order('received_date', { ascending: false }).limit(30),
        supabase.from('call_records')
          .select('id, direction, caller_name, callee_name, caller_number, callee_number, start_time, duration_seconds, notes, customer_id')
          .in('customer_id', cusIds).gte('start_time', sinceIso)
          .order('start_time', { ascending: false }).limit(50),
        supabase.from('aktienbuch')
          .select('id, aktionaer_name, aktionaer_adresse, wirtschaftlich_berechtigter, transaktionstyp, kaufdatum, datum_vr_entscheid, customer_id')
          .in('customer_id', cusIds).order('kaufdatum', { ascending: false }).limit(30),
        supabase.from('dokumente')
          .select('id, name, filename, storage_path, customer_id, file_type, created_at')
          .in('customer_id', cusIds).gte('created_at', sinceIso)
          .order('created_at', { ascending: false }).limit(30),
        supabase.from('fahrzeuge')
          .select('id, kennzeichen, marke, modell, fahrzeugart, fahrer_name, customer_id')
          .in('customer_id', cusIds).limit(30),
      ]);

      const customers = custRes2.data || [];
      const cName = customers[0]?.company_name || 'Kunde';
      const custMap: Record<string, string> = {};
      customers.forEach((c: any) => { custMap[c.id] = c.company_name; });
      const cn = (id: string) => custMap[id] || '–';

      const enrichedData = {
        customers,
        fristen:   (fF.data || []).map((f: any) => ({ ...f, customer_name: cn(f.customer_id) })),
        tasks:     (tT.data || []).map((t: any) => ({ ...t, customer_name: cn(t.customer_id) })),
        mails:     (mM.data || []).map((m: any) => ({ ...m, customer_name: cn(m.customer_id) })),
        calls:     (cC.data || []).map((c: any) => ({ ...c, customer_name: cn(c.customer_id) })),
        aktien:    (aA.data || []).map((a: any) => ({ ...a, customer_name: cn(a.customer_id) })),
        doks:      (dD.data || []).map((d: any) => ({ ...d, customer_name: cn(d.customer_id) })),
        fahrzeuge: (fzFz.data || []).map((f: any) => ({ ...f, customer_name: cn(f.customer_id) })),
      };

      const total =
        enrichedData.fristen.length + enrichedData.tasks.length + enrichedData.mails.length +
        enrichedData.calls.length + enrichedData.aktien.length + enrichedData.doks.length +
        enrichedData.fahrzeuge.length;

      const speak = `${cName}: ${total} Einträge in den letzten ${sinceMonths} Monaten.`;
      const answer = `**${cName}** – Aktivitäten der letzten ${sinceMonths} Monate (${total} Einträge)`;

      return new Response(JSON.stringify({
        answer, speak_text: speak, sources: [], today,
        data: enrichedData,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parallele DB-Suche ────────────────────────────────────────────────────
    const [custRes, fristenRes, tasksRes, mailsRes, rpcRes, contentRes, callsRes, aktienRes, fahrzeugRes] =
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

        supabase.rpc('search_dokumente', {
          p_query: keywords.join(' '), p_customer_id: null, p_limit: 8,
        }),

        supabase.from('dokumente')
          .select('id, name, filename, storage_path, customer_id, file_type, content_text')
          .or(keywords.map((k: string) => `content_text.ilike.%${k}%`).join(','))
          .limit(6),

        // NEU: Telefonate
        supabase.from('call_records')
          .select('id, direction, caller_name, callee_name, caller_number, callee_number, start_time, duration_seconds, notes, customer_id')
          .or(buildOrFilter(['caller_name', 'callee_name', 'caller_number', 'callee_number', 'notes'], keywords))
          .order('start_time', { ascending: false })
          .limit(8),

        // NEU: Aktienbuch
        supabase.from('aktienbuch')
          .select('id, aktionaer_name, aktionaer_adresse, wirtschaftlich_berechtigter, transaktionstyp, kaufdatum, datum_vr_entscheid, customer_id')
          .or(buildOrFilter(['aktionaer_name', 'wirtschaftlich_berechtigter', 'transaktionstyp'], keywords))
          .order('kaufdatum', { ascending: false })
          .limit(8),

        // NEU: Fahrzeuge
        supabase.from('fahrzeuge')
          .select('id, kennzeichen, marke, modell, fahrzeugart, fahrer_name, customer_id')
          .or(buildOrFilter(['kennzeichen', 'marke', 'modell', 'fahrer_name'], keywords))
          .limit(8),
      ]);

    const customers = custRes.status === 'fulfilled' ? (custRes.value.data || []) : [];
    let fristen     = fristenRes.status === 'fulfilled' ? (fristenRes.value.data || []) : [];
    let tasks       = tasksRes.status === 'fulfilled'   ? (tasksRes.value.data || [])   : [];
    let mails       = mailsRes.status === 'fulfilled'   ? (mailsRes.value.data || [])   : [];
    let calls       = callsRes.status === 'fulfilled'   ? (callsRes.value.data || [])   : [];
    let aktien      = aktienRes.status === 'fulfilled'  ? (aktienRes.value.data || [])  : [];
    let fahrzeuge   = fahrzeugRes.status === 'fulfilled' ? (fahrzeugRes.value.data || []) : [];

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
    let doks = [...rpcDoks, ...extraDoks];

    // Wenn Kunde gefunden → ALLE seine Aktivitäten laden
    // ("zeige mir die letzten Aktionen von Kunde XY")
    if (customers.length > 0) {
      const cusIds = customers.map((c: any) => c.id);
      const [moreF, moreT, moreM, moreC, moreA, moreD, moreFz] = await Promise.all([
        supabase.from('fristen')
          .select('id, title, category, kanton, jahr, due_date, status, description, customer_id')
          .in('customer_id', cusIds).order('due_date', { ascending: true }).limit(15),
        supabase.from('tasks')
          .select('id, title, description, due_date, status, assignee, customer_id')
          .in('customer_id', cusIds).order('due_date', { ascending: true }).limit(15),
        supabase.from('mail_items')
          .select('id, subject, body_preview, received_date, from_address, customer_id')
          .in('customer_id', cusIds).order('received_date', { ascending: false }).limit(10),
        supabase.from('call_records')
          .select('id, direction, caller_name, callee_name, caller_number, callee_number, start_time, duration_seconds, notes, customer_id')
          .in('customer_id', cusIds).order('start_time', { ascending: false }).limit(10),
        supabase.from('aktienbuch')
          .select('id, aktionaer_name, aktionaer_adresse, wirtschaftlich_berechtigter, transaktionstyp, kaufdatum, datum_vr_entscheid, customer_id')
          .in('customer_id', cusIds).order('kaufdatum', { ascending: false }).limit(10),
        supabase.from('dokumente')
          .select('id, name, filename, storage_path, customer_id, file_type')
          .in('customer_id', cusIds).order('created_at', { ascending: false }).limit(10),
        supabase.from('fahrzeuge')
          .select('id, kennzeichen, marke, modell, fahrzeugart, fahrer_name, customer_id')
          .in('customer_id', cusIds).limit(10),
      ]);
      const merge = (orig: any[], extra: any[] | null) => {
        if (!extra) return orig;
        const ex = new Set(orig.map((x: any) => x.id));
        return [...orig, ...extra.filter((x: any) => !ex.has(x.id))];
      };
      fristen   = merge(fristen,   moreF.data);
      tasks     = merge(tasks,     moreT.data);
      mails     = merge(mails,     moreM.data);
      calls     = merge(calls,     moreC.data);
      aktien    = merge(aktien,    moreA.data);
      doks      = merge(doks,      moreD.data);
      fahrzeuge = merge(fahrzeuge, moreFz.data);
    }

    // Kunden-Namens-Map
    const allCustIds = new Set([
      ...fristen.map((f: any) => f.customer_id),
      ...tasks.map((t: any) => t.customer_id),
      ...mails.map((m: any) => m.customer_id),
      ...doks.map((d: any) => d.customer_id),
      ...calls.map((c: any) => c.customer_id),
      ...aktien.map((a: any) => a.customer_id),
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

    if (customers.length > 0) {
      ctx += `## ERKANNTE KUNDEN (${customers.length})\n`;
      customers.slice(0, 5).forEach((c: any) => {
        ctx += `- ${c.company_name} (ID: ${c.id})\n`;
      });
      ctx += '\n';
    }
    if (fristen.length > 0) {
      ctx += `## FRISTEN (${fristen.length})\n`;
      fristen.slice(0, 10).forEach((f: any) => {
        ctx += `ID:${f.id} | "${f.title || f.category}" | Kunde: ${cn(f.customer_id)} | Kanton: ${f.kanton || '–'} | Jahr: ${f.jahr || '–'} | Fällig: ${fmt(f.due_date)} | Status: ${f.status}\n`;
        if (f.description) ctx += `  Info: ${f.description.slice(0, 150)}\n`;
      });
      ctx += '\n';
    }
    if (tasks.length > 0) {
      ctx += `## AUFGABEN (${tasks.length})\n`;
      tasks.slice(0, 10).forEach((t: any) => {
        ctx += `ID:${t.id} | "${t.title}" | Kunde: ${cn(t.customer_id)} | Fällig: ${fmt(t.due_date)} | Status: ${t.status || 'offen'} | Zuständig: ${t.assignee || '–'}\n`;
        if (t.description) ctx += `  Info: ${t.description.slice(0, 150)}\n`;
      });
      ctx += '\n';
    }
    if (calls.length > 0) {
      ctx += `## TELEFONATE (${calls.length})\n`;
      calls.slice(0, 10).forEach((c: any) => {
        const dir = c.direction === 'in' ? 'eingehend' : c.direction === 'out' ? 'ausgehend' : '–';
        const partner = c.direction === 'in' ? (c.caller_name || c.caller_number) : (c.callee_name || c.callee_number);
        ctx += `ID:${c.id} | ${dir} | Partner: ${partner || '–'} | Kunde: ${cn(c.customer_id)} | Am: ${fmtDateTime(c.start_time)} | Dauer: ${fmtDuration(c.duration_seconds)}\n`;
        if (c.notes) ctx += `  Notiz: ${c.notes.slice(0, 200)}\n`;
      });
      ctx += '\n';
    }
    if (mails.length > 0) {
      ctx += `## MAILS (${mails.length})\n`;
      mails.slice(0, 8).forEach((m: any) => {
        ctx += `ID:${m.id} | "${m.subject}" | Von: ${m.from_address} | Am: ${fmt(m.received_date)} | Kunde: ${cn(m.customer_id)}\n`;
        if (m.body_preview) ctx += `  Inhalt: ${m.body_preview.slice(0, 250)}\n`;
      });
      ctx += '\n';
    }
    if (doks.length > 0) {
      ctx += `## DOKUMENTE (${doks.length})\n`;
      doks.slice(0, 8).forEach((d: any) => {
        ctx += `ID:${d.id} | "${d.name}" | Kunde: ${cn(d.customer_id)} | Typ: ${d.file_type || d.filename?.split('.').pop() || '–'}\n`;
        const snippet = (d as any).content_snippet || (d.content_text ? d.content_text.slice(0, 300) : '');
        if (snippet) ctx += `  Inhalt-Auszug: "${snippet}"\n`;
      });
      ctx += '\n';
    }
    if (aktien.length > 0) {
      ctx += `## AKTIENBUCH (${aktien.length})\n`;
      aktien.slice(0, 8).forEach((a: any) => {
        ctx += `ID:${a.id} | Aktionär: "${a.aktionaer_name}" | Kunde: ${cn(a.customer_id)} | Typ: ${a.transaktionstyp || '–'} | Kauf: ${fmt(a.kaufdatum)} | VR: ${fmt(a.datum_vr_entscheid)}\n`;
        if (a.wirtschaftlich_berechtigter) ctx += `  Wirtschaftl. Berechtigter: ${a.wirtschaftlich_berechtigter}\n`;
      });
      ctx += '\n';
    }
    if (fristen.length === 0 && tasks.length === 0 && mails.length === 0 && doks.length === 0 && calls.length === 0 && aktien.length === 0) {
      ctx += `Keine Einträge gefunden. Teile dem Benutzer mit, dass nichts gefunden wurde.\n`;
    }

    // ── Claude Haiku 4.5 ──────────────────────────────────────────────────────
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    // Strukturierte Daten für Quadranten-Layout in VoxDrop
    const enrichedData = {
      customers,
      fristen: fristen.map((f: any) => ({ ...f, customer_name: cn(f.customer_id) })),
      tasks:   tasks.map((t: any)   => ({ ...t, customer_name: cn(t.customer_id) })),
      mails:   mails.map((m: any)   => ({ ...m, customer_name: cn(m.customer_id) })),
      doks:    doks.map((d: any)    => ({ ...d, customer_name: cn(d.customer_id) })),
      calls:   calls.map((c: any)   => ({ ...c, customer_name: cn(c.customer_id) })),
      aktien:  aktien.map((a: any)  => ({ ...a, customer_name: cn(a.customer_id) })),
      fahrzeuge: fahrzeuge.map((f: any) => ({ ...f, customer_name: cn(f.customer_id) })),
    };

    if (!anthropicKey) {
      const fallback = buildDirectAnswer(question, fristen, tasks, mails, doks, calls, aktien, custMap);
      return new Response(JSON.stringify({ ...fallback, today, data: enrichedData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `${ctx}
Antworte mit genau diesem JSON-Format (kein Markdown-Codeblock, nur reines JSON):
{
  "answer": "Vollständige Antwort auf Deutsch. Benutze ** für fett, - für Listen. Hebe das Wichtigste hervor.",
  "speak_text": "1-2 Sätze zum Vorlesen, kein Markdown, auf das Wesentliche fokussiert.",
  "sources": [
    {"type": "frist|task|mail|dokument|call|aktie", "id": "uuid", "title": "Titel", "subtitle": "Datum/Status", "customer_name": "Kundenname"}
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
        max_tokens: 2500,
        system: `Du bist Smartis, der KI-Assistent von Artis Treuhand GmbH.
Beantworte Fragen auf Schweizer Hochdeutsch (ss statt ß).

Datentypen die du kennst:
- FRISTEN: Steuerfristen mit Kategorie, Kanton, Jahr, Fälligkeit, Status
- AUFGABEN (Tasks): Tickets mit Titel, Fälligkeit, Zuständigem
- TELEFONATE: ein-/ausgehende Anrufe mit Partner, Datum, Dauer, Notiz
- MAILS: empfangene/gesendete Mails mit Betreff, Absender, Datum
- DOKUMENTE: PDFs/Word/etc mit Volltext-Inhalt
- AKTIENBUCH: Aktionäre einer Firma mit Transaktionstyp, Kaufdatum, VR-Entscheid

Regeln:
- Bei Fragen wie "letzte Aktionen von Kunde XY" → fasse alle Datentypen für diesen Kunden chronologisch zusammen, neueste zuerst
- Antworte präzise, informativ und freundlich
- Erkenne Zusammenhänge zwischen den Datentypen
- Wenn mehrere Einträge: gruppiere nach Typ und hebe das Dringlichste hervor
- Wenn nichts gefunden: sage es klar und schlage alternative Suchbegriffe vor
- Antworte NUR mit einem JSON-Objekt, kein Markdown-Codeblock`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      console.error("Claude error:", claudeRes.status, await claudeRes.text());
      const fallback = buildDirectAnswer(question, fristen, tasks, mails, doks, calls, aktien, custMap);
      return new Response(JSON.stringify({ ...fallback, today, data: enrichedData }), {
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

    if (!result?.answer) {
      const fallback = buildDirectAnswer(question, fristen, tasks, mails, doks, calls, aktien, custMap);
      return new Response(JSON.stringify({ ...fallback, today, data: enrichedData }), {
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

    return new Response(JSON.stringify({ ...result, today, data: enrichedData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("voice-assistant error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
