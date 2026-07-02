/**
 * fibu-inbox-webhook
 * ==================
 * Empfängt eingehende E-Mails mit Rechnungsanhängen von einem E-Mail-Service
 * (Mailgun, Postmark oder Resend Inbound) und speichert PDFs in Supabase Storage.
 *
 * Unterstützte Formate:
 *   - Mailgun Inbound: multipart/form-data
 *   - Postmark Inbound: application/json
 *   - Resend Inbound: application/json (ähnlich Postmark)
 *
 * E-Mail-Routing:
 *   Jeder Mandant hat einen eigenen inbox_code (8 Zeichen).
 *   Die E-Mail-Adresse lautet: rechnungen+{inbox_code}@smartis.me
 *   Oder: {inbox_code}@rechnungen.smartis.me (je nach DNS-Setup)
 *
 * Deployment:
 *   npx supabase functions deploy fibu-inbox-webhook --no-verify-jwt
 *
 * Webhook-URL für Email-Service:
 *   https://uawgpxcihixqxqxxbjak.supabase.co/functions/v1/fibu-inbox-webhook
 *
 * Authentifizierung des Webhooks:
 *   Header: X-Webhook-Secret: {FIBU_INBOX_WEBHOOK_SECRET}
 *   (im Email-Service als HTTP-Header konfigurieren)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

// Erlaubte Anhang-Typen
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Webhook-Secret prüfen (verhindert Spam-Injektionen)
  const webhookSecret = Deno.env.get('FIBU_INBOX_WEBHOOK_SECRET')
  if (webhookSecret) {
    const provided = req.headers.get('X-Webhook-Secret') ?? req.headers.get('X-Mailgun-Signature-V1') ?? ''
    if (provided !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized webhook' }), {
        status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' }
      })
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const contentType = req.headers.get('content-type') ?? ''
    let email: ParsedEmail

    if (contentType.includes('multipart/form-data')) {
      // Mailgun Inbound Format
      email = await parseMailgunWebhook(req)
    } else if (contentType.includes('application/json')) {
      // Postmark / Resend Format
      email = await parseJsonWebhook(req)
    } else {
      return new Response(JSON.stringify({ error: 'Unbekanntes Format' }), {
        status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' }
      })
    }

    if (!email.inboxCode) {
      return new Response(JSON.stringify({ error: 'Kein inbox_code in Empfänger-Adresse', recipient: email.recipient }), {
        status: 422, headers: { ...corsHeaders, 'content-type': 'application/json' }
      })
    }

    // Mandant via inbox_code suchen
    const { data: mandant, error: mErr } = await supabase
      .from('fibu_mandanten')
      .select('id, inbox_code')
      .eq('inbox_code', email.inboxCode)
      .eq('aktiv', true)
      .maybeSingle()

    if (mErr || !mandant) {
      console.error('Mandant nicht gefunden für inbox_code:', email.inboxCode)
      // Trotzdem 200 zurückgeben damit Email-Service nicht retried
      return new Response(JSON.stringify({ ok: false, reason: 'Kein Mandant für diesen Inbox-Code' }), {
        status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' }
      })
    }

    const results = []

    // Jeden PDF-Anhang verarbeiten
    for (const attachment of email.attachments) {
      if (!ALLOWED_TYPES.includes(attachment.contentType)) {
        console.log('Überspringe Anhang (falscher Typ):', attachment.filename, attachment.contentType)
        continue
      }
      if (attachment.data.byteLength > MAX_SIZE) {
        console.log('Überspringe Anhang (zu gross):', attachment.filename)
        continue
      }

      // In Supabase Storage hochladen: fibu-inbox/{mandant_id}/{uuid}_{filename}
      const uuid = crypto.randomUUID()
      const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${mandant.id}/${uuid}_${safeName}`

      const { error: uploadErr } = await supabase.storage
        .from('fibu-inbox')
        .upload(storagePath, attachment.data, {
          contentType: attachment.contentType,
          upsert: false,
        })

      if (uploadErr) {
        console.error('Upload-Fehler:', uploadErr)
        continue
      }

      // Inbox-Eintrag via SECURITY DEFINER Funktion anlegen
      const { data: inboxId, error: insertErr } = await supabase.rpc('fibu_inbox_insert', {
        p_inbox_code:  email.inboxCode,
        p_sender:      email.senderEmail,
        p_sender_name: email.senderName,
        p_betreff:     email.subject,
        p_body:        email.bodyText?.slice(0, 2000) ?? '',
        p_pdf_path:    storagePath,
        p_pdf_name:    attachment.filename,
      })

      if (insertErr) {
        console.error('DB-Insert-Fehler:', insertErr)
        continue
      }

      results.push({ inboxId, file: attachment.filename })
      console.log(`✅ Inbox-Eintrag erstellt: ${inboxId} für ${attachment.filename}`)
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' }
    })

  } catch (err) {
    console.error('Webhook-Fehler:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' }
    })
  }
})

// ── Typen ────────────────────────────────────────────────────────────────────

interface ParsedEmail {
  senderEmail: string
  senderName:  string
  subject:     string
  bodyText:    string
  recipient:   string
  inboxCode:   string | null
  attachments: { filename: string; contentType: string; data: ArrayBuffer }[]
}

// ── Inbox-Code aus Empfänger-Adresse extrahieren ─────────────────────────────
// Format: rechnungen+{code}@smartis.me  oder  {code}@rechnungen.smartis.me
function extractInboxCode(recipient: string): string | null {
  // rechnungen+abc123@smartis.me → abc123
  const plus = recipient.match(/\+([a-z0-9]{6,12})@/i)
  if (plus) return plus[1].toLowerCase()
  // abc123@rechnungen.smartis.me → abc123
  const subdomain = recipient.match(/^([a-z0-9]{6,12})@/i)
  if (subdomain) return subdomain[1].toLowerCase()
  return null
}

// ── Mailgun Inbound (multipart/form-data) ────────────────────────────────────
async function parseMailgunWebhook(req: Request): Promise<ParsedEmail> {
  const formData = await req.formData()

  const sender    = formData.get('sender')?.toString() ?? ''
  const from      = formData.get('From')?.toString() ?? formData.get('from')?.toString() ?? ''
  const subject   = formData.get('subject')?.toString() ?? formData.get('Subject')?.toString() ?? '(kein Betreff)'
  const bodyText  = formData.get('body-plain')?.toString() ?? ''
  const recipient = formData.get('recipient')?.toString() ?? formData.get('To')?.toString() ?? ''

  // Sender parsen: "Muster AG <muster@example.com>"
  const senderEmail = sender || from.match(/<(.+?)>/)?.[1] || from
  const senderName  = from.match(/^([^<]+)</)?.[1]?.trim() ?? senderEmail

  const attachments: ParsedEmail['attachments'] = []
  const attachmentCount = parseInt(formData.get('attachment-count')?.toString() ?? '0', 10)

  for (let i = 1; i <= Math.max(attachmentCount, 5); i++) {
    const file = formData.get(`attachment-${i}`) as File | null
    if (!file) break
    const data = await file.arrayBuffer()
    attachments.push({
      filename: file.name || `anhang-${i}.pdf`,
      contentType: file.type || 'application/octet-stream',
      data,
    })
  }

  return {
    senderEmail, senderName, subject, bodyText, recipient,
    inboxCode: extractInboxCode(recipient),
    attachments,
  }
}

// ── Postmark / Resend Inbound (JSON) ─────────────────────────────────────────
async function parseJsonWebhook(req: Request): Promise<ParsedEmail> {
  const body = await req.json()

  // Postmark: { From, Subject, TextBody, To, Attachments: [{Name, Content, ContentType}] }
  // Resend:   ähnliche Struktur
  const senderEmail = body.From ?? body.from ?? ''
  const senderName  = body.FromName ?? body.fromName ?? senderEmail
  const subject     = body.Subject ?? body.subject ?? '(kein Betreff)'
  const bodyText    = body.TextBody ?? body.text ?? ''
  const recipient   = body.To ?? body.to ?? body.OriginalRecipient ?? ''

  const attachments: ParsedEmail['attachments'] = []
  const rawAttachments = body.Attachments ?? body.attachments ?? []

  for (const att of rawAttachments) {
    // Postmark: Base64-encoded Content
    const content = att.Content ?? att.content ?? ''
    const decoded = Uint8Array.from(atob(content), c => c.charCodeAt(0))
    attachments.push({
      filename:    att.Name ?? att.filename ?? 'anhang.pdf',
      contentType: att.ContentType ?? att.contentType ?? 'application/pdf',
      data:        decoded.buffer,
    })
  }

  return {
    senderEmail, senderName, subject, bodyText, recipient,
    inboxCode: extractInboxCode(recipient),
    attachments,
  }
}
