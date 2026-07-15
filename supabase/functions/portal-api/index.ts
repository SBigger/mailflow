import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ══════════════════════════════════════════════════════════════════════════
//  portal-api — Backend des Kundenportals (read-only Dokumentenzugang)
//
//  Portal-Nutzer sind KEINE Supabase-Auth-User. Der gesamte Zugriff läuft hier
//  über service_role, jede Aktion prüft Mandanten-Zugehörigkeit explizit.
//  Modelliert nach `share-link` (IDOR-Scope-Schutz, Signed-URL intern→public).
//
//  Aktionen (JSON-Body { action, ... }, öffentlich mit anon-apikey):
//   - request-link { email }            → Magic-Link per Mail (kein User-Enum)
//   - verify       { token }            → Session-Token + Nutzerinfo
//   - list         { session }          → alle Dokumente des Mandanten + Tags
//   - download     { session, doc_id }  → kurzlebige Signed URL (nach Prüfung)
//   - me           { session }          → Nutzerinfo
// ══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
};

const MAGIC_TTL_MIN = 15;          // Magic-Link 15 Min gültig
const SESSION_TTL_DAYS = 7;        // Session 7 Tage gültig
const SIGNED_TTL_SEC = 3600;       // Download-Link 1 h gültig

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Magic-Link-Mail via Microsoft Graph (gleiches Muster wie notify-frist-…) ──
async function sendMagicLinkMail(to: string, vorname: string, link: string) {
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const fromAddress = "support@artis-gmbh.ch";
  if (!tenantId || !clientId || !clientSecret) {
    console.error("portal-api: Microsoft-Env fehlt, Mail nicht gesendet");
    return false;
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials", client_id: clientId,
      client_secret: clientSecret, scope: "https://graph.microsoft.com/.default",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) { console.error("portal-api: Graph-Token fehlgeschlagen", tokenData); return false; }

  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#132420;">
      <div style="padding:8px 0 20px;font-size:20px;font-weight:600;color:#0e756a;">Smartis · Kundenportal</div>
      <p style="font-size:15px;">Guten Tag${vorname ? " " + esc(vorname) : ""},</p>
      <p style="font-size:15px;line-height:1.6;">
        klicken Sie auf den Button, um sich sicher in Ihr Dokumentenportal einzuloggen.
        Der Link ist ${MAGIC_TTL_MIN} Minuten gültig und nur einmal verwendbar.
      </p>
      <p style="margin:28px 0;">
        <a href="${esc(link)}" style="background:#0e756a;color:#ffffff;text-decoration:none;
          padding:13px 24px;border-radius:9px;font-size:15px;font-weight:600;display:inline-block;">
          Jetzt anmelden
        </a>
      </p>
      <p style="font-size:12.5px;color:#5c6c67;line-height:1.5;">
        Falls der Button nicht funktioniert, kopieren Sie diese Adresse in den Browser:<br>
        <span style="color:#0a544c;word-break:break-all;">${esc(link)}</span>
      </p>
      <hr style="margin:24px 0;border:0;border-top:1px solid #e1e6e4;">
      <p style="color:#9ca3af;font-size:11px;">
        Sie erhalten diese E-Mail, weil für diese Adresse ein Portal-Zugang bei ${Deno.env.get("COMPANY_NAME")} besteht.
        Haben Sie den Login nicht angefordert, ignorieren Sie diese Nachricht.
      </p>
    </div>`;

  const payload = {
    message: {
      subject: "Ihr Anmeldelink · Smartis Kundenportal",
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: [{ emailAddress: { address: to } }],
      from: { emailAddress: { address: fromAddress, name: "Smartis Kundenportal" } },
      replyTo: [{ emailAddress: { address: fromAddress, name: Deno.env.get("COMPANY_NAME") } }],
    },
    saveToSentItems: true,
  };
  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${fromAddress}/sendMail`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!sendRes.ok) { console.error("portal-api: Mailversand fehlgeschlagen", await sendRes.text()); return false; }
  return true;
}

// ── Session validieren → aktiver portal_user oder null ──────────────────────
async function resolveSession(supabase: any, sessionToken: string | null) {
  if (!sessionToken) return null;
  const hash = await sha256Hex(sessionToken);
  const { data: sess } = await supabase
    .from("portal_sessions").select("*").eq("token_hash", hash).single();
  if (!sess || new Date(sess.expires_at) < new Date()) return null;
  const { data: pu } = await supabase
    .from("portal_users").select("*").eq("id", sess.portal_user_id).single();
  if (!pu || !pu.is_active) return null;
  await supabase.from("portal_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", sess.id);
  return pu;
}

// Mitarbeiter-JWT serverseitig prüfen (inline statt _shared/auth.ts, damit der
// Dashboard-Deploy ohne zusätzliche Dateien auskommt). service_role-Client
// kann fremde User-JWTs via auth.getUser verifizieren.
async function requireStaff(req: Request, supabase: any) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, error: "Unauthorized" };
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { ok: false as const, status: 401, error: "Unauthorized" };
  const { data: profile } = await supabase
    .from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (!profile) return { ok: false as const, status: 403, error: "Kein Mitarbeiterprofil" };
  return { ok: true as const, user };
}

async function audit(supabase: any, pu: any, action: string, doc_id: string | null, detail: string | null, ip: string) {
  try {
    await supabase.from("portal_audit").insert({
      portal_user_id: pu?.id ?? null, email: pu?.email ?? null, action, doc_id, detail, ip,
    });
  } catch { /* Audit darf nie blockieren */ }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const body = await req.json();
    const action = body.action ;
    const sessionToken = body.session;

    // ── request-link: Magic-Link anfordern (kein User-Enumeration) ────────────
    if (action === "request-link") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json({ error: "E-Mail erforderlich" }, 400);

      const { data: pu } = await supabase
        .from("portal_users").select("*")
        .eq("email", email).eq("is_active", true).maybeSingle();

      if (pu) {
        const token = randomToken();
        const expires = new Date(Date.now() + MAGIC_TTL_MIN * 60_000).toISOString();
        await supabase.from("portal_magic_tokens").insert({
          portal_user_id: pu.id, token_hash: await sha256Hex(token), expires_at: expires,
        });
        const base = `${body.appUrl}/portal`;
        const link = `${base}?token=${token}`;
        await sendMagicLinkMail(pu.email, pu.vorname, link);
        await audit(supabase, pu, "login-request", null, null, ip);
      }
      // Immer gleiche Antwort → keine Rückschlüsse, ob die Adresse existiert
      return json({ ok: true });
    }

    // ── verify: Magic-Token einlösen → Session ────────────────────────────────
    if (action === "verify") {
      const token = String(body.token || "").trim();
      if (!token) return json({ error: "Token erforderlich" }, 400);
      const hash = await sha256Hex(token);

      const { data: mt } = await supabase
        .from("portal_magic_tokens").select("*").eq("token_hash", hash).maybeSingle();
      if (!mt || mt.used_at || new Date(mt.expires_at) < new Date()) {
        return json({ error: "Dieser Anmeldelink ist ungültig oder abgelaufen." }, 401);
      }

      const { data: pu } = await supabase
        .from("portal_users").select("*").eq("id", mt.portal_user_id).single();
      if (!pu || !pu.is_active) return json({ error: "Zugang nicht aktiv." }, 403);

      await supabase.from("portal_magic_tokens").update({ used_at: new Date().toISOString() }).eq("id", mt.id);

      const session = randomToken();
      const sExpires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
      await supabase.from("portal_sessions").insert({
        portal_user_id: pu.id, token_hash: await sha256Hex(session), expires_at: sExpires,
      });
      await supabase.from("portal_users").update({ last_login_at: new Date().toISOString() }).eq("id", pu.id);
      await audit(supabase, pu, "login", null, null, ip);

      const { data: cust } = await supabase
        .from("customers").select("company_name").eq("id", pu.customer_id).single();

      return json({
        session,
        expires_at: sExpires,
        user: { vorname: pu.vorname, nachname: pu.nachname, email: pu.email, customer_name: cust?.company_name || "" },
      });
    }

    // ── me: Nutzerinfo (Session prüfen) ───────────────────────────────────────
    if (action === "me") {
      const pu = await resolveSession(supabase, sessionToken);
      if (!pu) return json({ error: "Nicht angemeldet." }, 401);
      const { data: cust } = await supabase
        .from("customers").select("company_name").eq("id", pu.customer_id).single();
      return json({ user: { vorname: pu.vorname, nachname: pu.nachname, email: pu.email, customer_name: cust?.company_name || "" } });
    }

    // ── list: alle Dokumente des Mandanten (read-only) ────────────────────────
    if (action === "list") {
      const pu = await resolveSession(supabase, sessionToken);
      if (!pu) return json({ error: "Nicht angemeldet." }, 401);

      const { data: docs } = await supabase
        .from("dokumente")
        .select("id, name, filename, category, year, file_size, file_type, tag_ids, created_at, updated_at")
        .eq("customer_id", pu.customer_id)
        .is("deleted_at", null)
        .order("year", { ascending: false })
        .order("name", { ascending: true });

      // Tag-Namen für die im Bestand vorkommenden tag_ids nachladen
      const tagIds = [...new Set((docs || []).flatMap((d: any) => d.tag_ids || []))];
      const tags: Record<string, string> = {};
      if (tagIds.length) {
        const { data: tagRows } = await supabase
          .from("dok_tags").select("id, name").in("id", tagIds);
        for (const t of tagRows || []) tags[t.id] = t.name;
      }

      const { data: cust } = await supabase
        .from("customers").select("company_name").eq("id", pu.customer_id).single();

      await audit(supabase, pu, "list", null, `${(docs || []).length} docs`, ip);
      return json({
        customer_name: cust?.company_name || "",
        user: { vorname: pu.vorname, nachname: pu.nachname, email: pu.email },
        docs: docs || [],
        tags,
      });
    }

    // ── download: Signed URL nach Eigentums-Prüfung ───────────────────────────
    if (action === "download") {
      const pu = await resolveSession(supabase, sessionToken);
      if (!pu) return json({ error: "Nicht angemeldet." }, 401);
      const doc_id = String(body.doc_id || "");
      if (!doc_id) return json({ error: "doc_id fehlt" }, 400);

      const { data: doc } = await supabase
        .from("dokumente")
        .select("storage_path, filename, name, customer_id, deleted_at")
        .eq("id", doc_id).single();

      // IDOR-Schutz: Dokument MUSS zum Mandanten des Nutzers gehören und aktiv sein
      if (!doc || doc.customer_id !== pu.customer_id || doc.deleted_at) {
        return json({ error: "Dieses Dokument gehört nicht zu Ihrem Zugang." }, 403);
      }
      if (!doc.storage_path) return json({ error: "Datei nicht verfügbar." }, 404);

      // mode 'view' → inline im Browser anzeigen; sonst als Download erzwingen
      const viewMode = body.mode === "view";
      const storageKey = doc.storage_path.replace(/^dokumente\//, "");
      const { data: signed, error } = await supabase.storage
        .from("dokumente")
        .createSignedUrl(storageKey, SIGNED_TTL_SEC, viewMode ? {} : { download: doc.filename || doc.name });
      if (error || !signed?.signedUrl) return json({ error: "Download-Link konnte nicht erstellt werden." }, 500);

      const internalUrl = Deno.env.get("SUPABASE_URL")!;
      const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL") || internalUrl;
      const finalUrl = signed.signedUrl.replace(internalUrl, publicUrl).replace("http:", "https:");

      await audit(supabase, pu, viewMode ? "view" : "download", doc_id, doc.filename || doc.name, ip);
      return json({ url: finalUrl });
    }

    // ── upload: Datei in den Posteingang des eigenen Mandanten ────────────────
    if (action === "upload") {
      const pu = await resolveSession(supabase, sessionToken);
      if (!pu) return json({ error: "Nicht angemeldet." }, 401);
      const dataB64 = String(body.data || "");
      if (!dataB64) return json({ error: "Keine Datei erhalten." }, 400);
      if (dataB64.length > 11_500_000) return json({ error: "Datei zu gross (max. 8 MB)." }, 413);

      const rawName = String(body.filename || "datei").split(/[\\/]/).pop() || "datei";
      const safe = rawName
        .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
        .replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "datei";

      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0)); }
      catch { return json({ error: "Datei konnte nicht gelesen werden." }, 400); }

      // Ziel: posteingang/<customer_id>/<zeitstempel>_<name> → erscheint im Posteingang beim Kunden
      const path = `${pu.customer_id}/${Date.now()}_${safe}`;
      const { error } = await supabase.storage
        .from("posteingang")
        .upload(path, bytes, { contentType: body.content_type || "application/octet-stream", upsert: false });
      if (error) return json({ error: "Upload fehlgeschlagen: " + error.message }, 500);

      await audit(supabase, pu, "upload", null, safe, ip);
      return json({ ok: true });
    }

    // ── Chat (Chartis) ────────────────────────────────────────────────────────
    // Genau EIN Faden pro Kunde: chartis_threads UNIQUE (module, record_id)
    // mit module='unternehmen', record_id=customer_id.
    // SICHERHEIT: dem Kunden werden AUSSCHLIESSLICH 'email_in' + 'email_out'
    // ausgeliefert. Interne Notizen (kind='intern') verlassen das Haus nie.
    if (action === "chat-list") {
      const pu = await resolveSession(supabase, sessionToken);
      if (!pu) return json({ error: "Nicht angemeldet." }, 401);

      const { data: thread } = await supabase.from("chartis_threads")
        .select("id").eq("module", "unternehmen").eq("record_id", pu.customer_id).maybeSingle();
      if (!thread) return json({ messages: [] });

      const { data: msgs } = await supabase.from("chartis_messages")
        .select("id, kind, body_text, body_html, created_at")
        .eq("thread_id", thread.id)
        .in("kind", ["email_in", "email_out"])
        .order("created_at", { ascending: true });

      return json({ messages: msgs || [] });
    }

    if (action === "chat-send") {
      const pu = await resolveSession(supabase, sessionToken);
      if (!pu) return json({ error: "Nicht angemeldet." }, 401);
      const text = String(body.text || "").trim();
      if (!text) return json({ error: "Die Nachricht ist leer." }, 400);
      if (text.length > 5000) return json({ error: "Die Nachricht ist zu lang (max. 5000 Zeichen)." }, 413);

      // Faden holen oder anlegen
      let { data: thread } = await supabase.from("chartis_threads")
        .select("id, mandant_id").eq("module", "unternehmen").eq("record_id", pu.customer_id).maybeSingle();
      if (!thread) {
        const { data: cust } = await supabase.from("customers")
          .select("company_name").eq("id", pu.customer_id).single();
        const { data: created, error: tErr } = await supabase.from("chartis_threads")
          .insert({
            module: "unternehmen", record_id: pu.customer_id, thread_type: "objekt",
            subject: cust?.company_name || "Kundenportal", ext_contact_email: pu.email,
          })
          .select("id, mandant_id").single();
        if (tErr || !created) return json({ error: "Gespräch konnte nicht gestartet werden." }, 500);
        thread = created;
      }

      // Portal-Nutzer als Externen im Faden führen (idempotent, ohne onConflict-Annahme)
      const { data: ext } = await supabase.from("chartis_thread_externals")
        .select("thread_id").eq("thread_id", thread.id).eq("email", pu.email).maybeSingle();
      if (!ext) {
        await supabase.from("chartis_thread_externals").insert({
          thread_id: thread.id, email: pu.email,
          name: `${pu.vorname} ${pu.nachname}`.trim() || null,
        });
      }

      // Kundennachricht = eingehende Nachricht, genau wie eine Mail vom Kunden
      const { error } = await supabase.from("chartis_messages").insert({
        thread_id: thread.id, mandant_id: thread.mandant_id, kind: "email_in",
        body_text: text, from_addr: pu.email, created_by: null,
      });
      if (error) return json({ error: "Nachricht konnte nicht gesendet werden." }, 500);

      await supabase.from("chartis_threads")
        .update({ status: "aktiv", updated_at: new Date().toISOString() }).eq("id", thread.id);
      await audit(supabase, pu, "chat-send", null, text.slice(0, 80), ip);
      return json({ ok: true });
    }

    // ── create-link: Anmeldelink erzeugen (NUR eingeloggte Mitarbeiter) ───────
    // Für Weitergabe von Hand (Teams, persönlich) statt/zusätzlich zur Mail.
    // 7 Tage gültig, einmal verwendbar.
    if (action === "create-link") {
      const staff = await requireStaff(req, supabase);
      if (!staff.ok) return json({ error: staff.error }, staff.status);

      const portalUserId = String(body.portal_user_id || "");
      if (!portalUserId) return json({ error: "portal_user_id fehlt" }, 400);
      const { data: pu } = await supabase.from("portal_users")
        .select("*").eq("id", portalUserId).single();
      if (!pu) return json({ error: "Portal-Zugang nicht gefunden." }, 404);
      if (!pu.is_active) return json({ error: "Dieser Zugang ist gesperrt." }, 400);

      const token = randomToken();
      const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
      await supabase.from("portal_magic_tokens").insert({
        portal_user_id: pu.id, token_hash: await sha256Hex(token), expires_at: expires,
      });
      const base = `${body.appUrl}/portal`;
      await audit(supabase, pu, "link-created", null, staff.user?.email || null, ip);
      return json({ link: `${base}?token=${token}`, expires_at: expires });
    }

    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (err: any) {
    console.error("portal-api error:", err);
    return json({ error: err.message }, 500);
  }
});
