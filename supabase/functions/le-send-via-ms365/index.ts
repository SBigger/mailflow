// Leistungserfassung · Mail-Versand via Microsoft Graph (sendMail)
// =================================================================
// Diese Function teilt sich KEINEN Code mit der bestehenden MS365-Integration
// (`sync-outlook-mails`). Das Token-Refresh-Pattern wurde lediglich kopiert,
// nicht referenziert. Die produktive sync-Function bleibt unangetastet.
//
// Endpoint:  POST /functions/v1/le-send-via-ms365
//   body: {
//     to: string,                  // Empfänger-Mail
//     subject: string,             // Betreff
//     html: string,                // HTML-Body
//     attachmentUrl?: string,      // optionaler Download-Link (Supabase-Storage public URL o.Ä.)
//     attachmentFilename?: string  // Dateiname für den Anhang (z.B. "Mahnung-MA-2026-001.pdf")
//   }
//   response: { success: true } | { error: string }
//
// Auth: Bearer Token vom Frontend (eingeloggter User). Der User muss in der
// `profiles`-Tabelle Microsoft-Tokens hinterlegt haben.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface SendBody {
  to?: string
  subject?: string
  html?: string
  attachmentUrl?: string
  attachmentFilename?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Base64-Encoding für ArrayBuffer (Deno-kompatibel, ohne externe Lib).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[])
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- Auth-Check (Bearer Token → user) ---------------------------------
  let userId: string | null = null
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabase.auth.getUser(token)
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401)
    userId = authUser.id
  } catch (_e) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // --- Body parsen ------------------------------------------------------
  let body: SendBody
  try {
    body = await req.json()
  } catch (_e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }
  const { to, subject, html, attachmentUrl, attachmentFilename } = body
  if (!to || !subject || !html) {
    return jsonResponse({ error: 'Missing required fields: to, subject, html' }, 400)
  }

  // --- Profil + Tokens holen --------------------------------------------
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, microsoft_refresh_token, microsoft_access_token, microsoft_token_expiry')
    .eq('id', userId!)
    .maybeSingle()

  if (profErr) return jsonResponse({ error: `Profil-Fehler: ${profErr.message}` }, 500)
  if (!profile) return jsonResponse({ error: 'Profil nicht gefunden' }, 404)
  if (!profile.microsoft_refresh_token) {
    return jsonResponse({ error: 'Microsoft-Account nicht verbunden' }, 400)
  }

  // --- Token-Refresh (Pattern aus sync-outlook-mails kopiert, separat) --
  let accessToken = profile.microsoft_access_token as string | null
  const tokenExpiry = (profile.microsoft_token_expiry as number) || 0

  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = profile.microsoft_refresh_token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: Deno.env.get('MICROSOFT_CLIENT_ID')!,
          client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read Files.ReadWrite.All Sites.ReadWrite.All',
        }),
      },
    )
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}))
      return jsonResponse({ error: `Token-Refresh fehlgeschlagen: ${err.error_description ?? tokenRes.status}` }, 401)
    }
    const tokens = await tokenRes.json()
    accessToken = tokens.access_token
    await supabase.from('profiles').update({
      microsoft_access_token: tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token || refreshToken,
      microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000),
    }).eq('id', profile.id)
  }

  if (!accessToken) {
    return jsonResponse({ error: 'Kein Access-Token verfügbar' }, 500)
  }

  // --- Optional: Attachment laden + Base64 ------------------------------
  const attachments: Array<Record<string, unknown>> = []
  if (attachmentUrl) {
    try {
      const fileRes = await fetch(attachmentUrl)
      if (!fileRes.ok) {
        return jsonResponse({ error: `Anhang konnte nicht geladen werden (HTTP ${fileRes.status})` }, 502)
      }
      const buf = await fileRes.arrayBuffer()
      const base64 = arrayBufferToBase64(buf)
      const ct = fileRes.headers.get('content-type') || 'application/pdf'
      attachments.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachmentFilename || 'attachment.pdf',
        contentType: ct,
        contentBytes: base64,
      })
    } catch (e: any) {
      return jsonResponse({ error: `Anhang-Fehler: ${e?.message ?? e}` }, 502)
    }
  }

  // --- Microsoft Graph: sendMail ---------------------------------------
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  }
  if (attachments.length > 0) message.attachments = attachments

  const sendRes = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  })

  if (!sendRes.ok) {
    const errText = await sendRes.text().catch(() => '')
    let detail = errText
    try {
      const j = JSON.parse(errText)
      detail = j?.error?.message || errText
    } catch (_) { /* ignore */ }
    return jsonResponse({ error: `Graph sendMail Fehler ${sendRes.status}: ${detail}` }, 502)
  }

  return jsonResponse({ success: true })
})
