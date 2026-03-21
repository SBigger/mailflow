// Supabase Edge Function: skribble-proxy
// Proxy für Skribble eSignatur API (https://api.skribble.com/v1/)
// Benötigt: SKRIBBLE_USERNAME, SKRIBBLE_API_KEY als Supabase Secrets
// Webhook-URL in Skribble konfigurieren:
//   https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/skribble-proxy

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SKRIBBLE_BASE = "https://api.skribble.com/v1";

function skribbleAuth(): string {
  const user = Deno.env.get("SKRIBBLE_USERNAME") || "";
  const key  = Deno.env.get("SKRIBBLE_API_KEY")  || "";
  return "Basic " + btoa(`${user}:${key}`);
}

async function skribbleFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${SKRIBBLE_BASE}${path}`, {
    ...opts,
    headers: {
      "Authorization": skribbleAuth(),
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

function userClient(req: Request) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } }
  );
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(msg: string, status = 500) {
  console.error("[skribble-proxy] Error:", msg);
  return jsonResponse({ error: msg }, status);
}

// ── Action: create ────────────────────────────────────────────────────────────
async function actionCreate(body: Record<string, unknown>, req: Request) {
  const { document_url, document_name, signers, message, expires_at, signature_type, customer_id } = body as {
    document_url: string;
    document_name: string;
    signers: Array<{ name: string; email: string; mobile?: string }>;
    message?: string;
    expires_at?: string;
    signature_type?: string;
    customer_id?: string;
  };

  if (!document_url) return errorResponse("document_url required", 400);
  if (!signers || signers.length === 0) return errorResponse("signers required", 400);

  try {
    // 1. PDF von Supabase Storage herunterladen
    const pdfRes = await fetch(document_url);
    if (!pdfRes.ok) throw new Error(`Dokument nicht abrufbar: ${pdfRes.status}`);
    const pdfBuffer = await pdfRes.arrayBuffer();
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

    // 2. PDF zu Skribble hochladen
    const uploadRes = await skribbleFetch("/documents", {
      method: "POST",
      body: JSON.stringify({
        content:  base64Pdf,
        filename: document_name || "Dokument.pdf",
      }),
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Skribble Upload fehlgeschlagen: ${err}`);
    }
    const uploadData = await uploadRes.json();
    const skribble_document_id: string = uploadData.id;

    // 3. Signaturanfrage erstellen
    const signatories = signers.map(s => ({
      email:    s.email,
      language: "de",
      ...(s.mobile ? { mobile: s.mobile } : {}),
    }));

    const requestPayload: Record<string, unknown> = {
      title:          document_name || "Dokument",
      document_id:    skribble_document_id,
      signatories,
      signature_type: signature_type || "AES",
    };
    if (message)    requestPayload.message = message;
    if (expires_at) requestPayload.expiration_date = expires_at;

    const reqRes = await skribbleFetch("/signature-requests", {
      method: "POST",
      body: JSON.stringify(requestPayload),
    });
    if (!reqRes.ok) {
      const err = await reqRes.text();
      throw new Error(`Skribble Request fehlgeschlagen: ${err}`);
    }
    const reqData = await reqRes.json();
    const skribble_request_id: string = reqData.id;
    const signing_url: string = reqData.redirect_url || reqData.signing_url || "";

    // 4. In signaturen-Tabelle speichern (aktueller User)
    const db = userClient(req);
    const { data: { user } } = await db.auth.getUser();

    const { data: inserted, error: dbErr } = await serviceClient()
      .from("signaturen")
      .insert({
        created_by:          user?.id,
        customer_id:         customer_id || null,
        document_name:       document_name || "Dokument",
        document_url:        document_url,
        skribble_request_id,
        skribble_document_id,
        signing_url,
        skribble_status:     "open",
        signers:             signers.map(s => ({ name: s.name, email: s.email, signed_at: null })),
        message:             message || "",
        signature_type:      signature_type || "AES",
        expires_at:          expires_at || null,
      })
      .select()
      .single();

    if (dbErr) throw new Error("DB Insert fehlgeschlagen: " + dbErr.message);

    return jsonResponse({ success: true, id: inserted.id, skribble_request_id, signing_url });

  } catch (e: unknown) {
    return errorResponse((e as Error).message);
  }
}

// ── Action: status ────────────────────────────────────────────────────────────
async function actionStatus(body: Record<string, unknown>) {
  const { request_id, id } = body as { request_id: string; id: string };
  if (!request_id) return errorResponse("request_id required", 400);

  try {
    const res = await skribbleFetch(`/signature-requests/${request_id}`);
    if (!res.ok) throw new Error(`Skribble Status: ${res.status}`);
    const data = await res.json();

    const statusMap: Record<string, string> = {
      OPEN:      "open",
      SIGNED:    "signed",
      DECLINED:  "declined",
      WITHDRAWN: "withdrawn",
      EXPIRED:   "expired",
    };
    const skribble_status = statusMap[data.status_overall] || "open";

    // Unterzeichner-Status aktualisieren
    const signerUpdates = (data.signatories || []).map((s: Record<string, unknown>) => ({
      email:       s.email,
      name:        s.email,
      signed_at:   s.status_code === "SIGNED" ? s.signed_at : null,
      declined_at: s.status_code === "DECLINED" ? s.signed_at : null,
    }));

    const updatePayload: Record<string, unknown> = { skribble_status };
    if (signerUpdates.length > 0) updatePayload.signers = signerUpdates;
    if (skribble_status === "signed") updatePayload.signed_at = new Date().toISOString();

    await serviceClient().from("signaturen").update(updatePayload).eq("id", id);

    return jsonResponse({ success: true, skribble_status, raw: data });
  } catch (e: unknown) {
    return errorResponse((e as Error).message);
  }
}

// ── Action: download ──────────────────────────────────────────────────────────
async function actionDownload(body: Record<string, unknown>) {
  const { request_id, id } = body as { request_id: string; id: string };
  if (!request_id) return errorResponse("request_id required", 400);

  try {
    // Skribble document_id aus DB lesen
    const { data: sig } = await serviceClient()
      .from("signaturen")
      .select("skribble_document_id, document_name")
      .eq("id", id)
      .single();

    if (!sig?.skribble_document_id) return errorResponse("Document ID nicht gefunden", 404);

    // Download-URL ermitteln
    const res = await skribbleFetch(`/documents/${sig.skribble_document_id}`);
    if (!res.ok) throw new Error(`Skribble Document: ${res.status}`);
    const docData = await res.json();

    const download_url = docData.download_url || docData.content_url || "";
    return jsonResponse({ success: true, download_url, filename: sig.document_name });
  } catch (e: unknown) {
    return errorResponse((e as Error).message);
  }
}

// ── Action: cancel ────────────────────────────────────────────────────────────
async function actionCancel(body: Record<string, unknown>) {
  const { request_id, id } = body as { request_id: string; id: string };
  if (!request_id) return errorResponse("request_id required", 400);

  try {
    const res = await skribbleFetch(`/signature-requests/${request_id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Skribble Cancel: ${res.status}`);

    await serviceClient()
      .from("signaturen")
      .update({ skribble_status: "withdrawn" })
      .eq("id", id);

    return jsonResponse({ success: true });
  } catch (e: unknown) {
    return errorResponse((e as Error).message);
  }
}

// ── Action: store-in-dokumente ────────────────────────────────────────────────
async function actionStoreInDokumente(body: Record<string, unknown>) {
  const { request_id, id, customer_id } = body as {
    request_id: string; id: string; customer_id?: string;
  };
  if (!request_id || !id) return errorResponse("request_id and id required", 400);

  try {
    const db = serviceClient();

    // Signatur-Record laden
    const { data: sig } = await db.from("signaturen").select("*").eq("id", id).single();
    if (!sig) return errorResponse("Signatur nicht gefunden", 404);
    if (!sig.skribble_document_id) return errorResponse("Kein Skribble-Dokument verknüpft", 400);

    // PDF-Inhalt von Skribble laden
    const contentRes = await skribbleFetch(`/documents/${sig.skribble_document_id}/content`);
    if (!contentRes.ok) throw new Error(`Skribble Content: ${contentRes.status}`);
    const pdfBytes = await contentRes.arrayBuffer();

    // In Supabase Storage ablegen
    const year = new Date().getFullYear();
    const safeName = (sig.document_name || "Dokument").replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = customer_id
      ? `signing-completed/${customer_id}/${year}/${Date.now()}_signiert_${safeName}`
      : `signing-completed/allgemein/${year}/${Date.now()}_signiert_${safeName}`;

    const { error: upErr } = await db.storage.from("dokumente").upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr) throw new Error("Storage Upload: " + upErr.message);

    const { data: { publicUrl } } = db.storage.from("dokumente").getPublicUrl(storagePath);

    // Dokument-Record in dokumente-Tabelle anlegen
    const { data: dokument } = await db.from("dokumente").insert({
      customer_id:  customer_id || null,
      filename:     `Signiert_${sig.document_name || "Dokument"}`,
      storage_path: storagePath,
      category:     "Verträge",
      year:         year.toString(),
      tags:         ["Signiert", "Elektronische Signatur"],
      notizen:      `Digital signiert via Skribble (${sig.signature_type || "AES"})`,
    }).select().single();

    // signaturen-Record aktualisieren
    await db.from("signaturen").update({
      signed_stored:     true,
      signed_dokument_url: publicUrl,
      signed_dokument_id:  dokument?.id || null,
    }).eq("id", id);

    return jsonResponse({ success: true, publicUrl, dokument_id: dokument?.id });
  } catch (e: unknown) {
    return errorResponse((e as Error).message);
  }
}

// ── Webhook Handler ───────────────────────────────────────────────────────────
async function handleWebhook(req: Request) {
  try {
    const payload = await req.json();
    console.log("[skribble-proxy] Webhook received:", JSON.stringify(payload));

    const requestId = payload.id || payload.signature_request_id;
    if (!requestId) return new Response("OK", { status: 200 });

    const statusMap: Record<string, string> = {
      OPEN:      "open",
      SIGNED:    "signed",
      DECLINED:  "declined",
      WITHDRAWN: "withdrawn",
      EXPIRED:   "expired",
    };
    const newStatus = statusMap[payload.status_overall] || null;
    if (!newStatus) return new Response("OK", { status: 200 });

    const db = serviceClient();
    const updatePayload: Record<string, unknown> = { skribble_status: newStatus };
    if (newStatus === "signed") updatePayload.signed_at = new Date().toISOString();

    await db.from("signaturen")
      .update(updatePayload)
      .eq("skribble_request_id", requestId);

    return new Response("OK", { status: 200 });
  } catch (e: unknown) {
    console.error("[skribble-proxy] Webhook error:", (e as Error).message);
    return new Response("Error", { status: 500 });
  }
}

// ── Main Handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Webhook-Endpunkt (kein Auth nötig)
  if (url.pathname.endsWith("/webhook")) {
    return handleWebhook(req);
  }

  // Alle anderen Aktionen: Auth erforderlich
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const action = body.action as string;
  console.log("[skribble-proxy] Action:", action);

  switch (action) {
    case "create":
      return actionCreate(body, req);
    case "status":
      return actionStatus(body);
    case "download":
      return actionDownload(body);
    case "cancel":
      return actionCancel(body);
    case "store-in-dokumente":
      return actionStoreInDokumente(body);
    default:
      return errorResponse(`Unknown action: ${action}`, 400);
  }
});
