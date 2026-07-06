/**
 * fibu-imap-sync
 * ==============
 * Liest ungelesene E-Mails mit PDF-Anhängen aus einem IMAP-Postfach
 * und erstellt Einträge in fibu_rechnung_inbox.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ImapFlow } from 'https://esm.sh/imapflow@1.0.155'
import { simpleParser } from 'https://esm.sh/mailparser@3.6.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const isCronCall = req.headers.get('X-Cron-Secret') === Deno.env.get('CRON_SECRET')
  if (!isCronCall) {
    try {
      const authHeader = req.headers.get('Authorization')!
      const token = authHeader.replace('Bearer ', '')
      const { data: { user: authUser } } = await supabase.auth.getUser(token)
      if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    } catch {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
  }

  const syncResults = []

  try {
    // 1. Aktive Mandanten mit IMAP-Config laden
    const { data: mandanten, error: dbError } = await supabase
        .from('fibu_mandanten')
        .select('*')
        .eq('imap_aktiv', true)

    if (dbError) throw dbError
    if (!mandanten || mandanten.length === 0) {
      console.log("Keine aktiven Mandanten für IMAP-Sync.");
      return new Response(JSON.stringify({ ok: true, message: 'Keine aktiven Mandanten für IMAP-Sync.' }), {
        status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' }
      })
    }

    // 2. Schleife über alle aktiven Mandanten
    for (const mandant of mandanten) {
      const mandantLog = { mandant: mandant.name, processed_mails: 0, errors: [] as string[] }

      const host = mandant.imap_host
      const port = Number(mandant.imap_port)
      const mailboxName = mandant.imap_mailbox

      const client = new ImapFlow({
        host, port,
        secure: mandant.imap_ssl != false,
        auth: { user: mandant.imap_user, pass: mandant.imap_password },
        tls: { rejectUnauthorized: false },
        logger: true,          // <-- WICHTIG: IMAP-Protokoll sichtbar machen
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 120000  // <-- großzügig, damit der Download nicht abgeschnitten wird
      })

      client.on('error', (e) => console.error('IMAP ERROR EVENT:', e?.message, e))
      client.on('close', () => console.error('IMAP CONNECTION CLOSED EVENT'))

      try {
        await client.connect();

        const lock = await client.getMailboxLock(mailboxName)

        try {
          // Suche nach ungelesenen Mails
          const searchResults = await client.search({ seen: false }, { uid: true })
          for (const uid of searchResults) {
            // Prüfen, ob Kombination aus mandant_id, mailbox und imap_uid bereits existiert (dein Unique Index)
            const { data: existing } = await supabase
                .from('fibu_rechnung_inbox')
                .select('id')
                .eq('mandant_id', mandant.id)
                .eq('imap_mailbox', mailboxName)
                .eq('imap_uid', uid)
                .maybeSingle()

            if (existing) {
              // Sicherheitsnetz: Falls bereits verarbeitet, als gelesen markieren und überspringen
              await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true })
              continue
            }
            console.log("lese Mail!! uid: ", uid.toString())
            // 1. Fetch aufrufen (wichtig: imapflow benötigt oft den Nummern-Typ für die UID, wenn {uid: true} übergeben wird)
            const [message] = await client.fetchOne(uid.toString(), {
              bodyStructure: true,
              source: true
            });

            if (!message) {
              console.log("Keine E-Mail gefunden.");
              return;
            }

            console.log("E-Mail gefunden.");

            const attachments = message.envelop.attachments || []

            // Filtere PDF-Anhänge heraus
            const pdfAttachments = attachments.filter(att =>
                att.contentType === 'application/pdf' ||
                att.filename?.toLowerCase().endsWith('.pdf')
            )

            if (pdfAttachments.length > 0) {
              // Absender-Infos sauber trennen
              const fromAddress = parsed.from?.value?.[0]
              const senderEmail = fromAddress?.address || null
              const senderName = fromAddress?.name || null

              for (const pdf of pdfAttachments) {
                const uuid = crypto.randomUUID()
                const cleanFilename = pdf.filename ? pdf.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'unnamed.pdf'
                const storagePath = `${mandant.id}/${uuid}_${cleanFilename}`

                // Upload in den Bucket 'fibu-inbox'
                const { error: uploadError } = await supabase.storage
                    .from('fibu-inbox')
                    .upload(storagePath, pdf.content, {
                      contentType: 'application/pdf',
                      upsert: false
                    })

                if (uploadError) {
                  mandantLog.errors.push(`Upload Fehler für ${cleanFilename}: ${uploadError.message}`)
                  continue
                }

                // Eintrag exakt passend zu deinem Tabellenschema einfügen
                const { error: insertError } = await supabase
                    .from('fibu_rechnung_inbox')
                    .insert({
                      mandant_id: mandant.id,
                      sender_email: senderEmail,
                      sender_name: senderName,
                      betreff: parsed.subject || '',
                      email_body: parsed.text || parsed.html || '',
                      received_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                      pdf_path: storagePath,
                      pdf_name: cleanFilename,
                      status: 'pending', // Greift auch per Default, hier explizit
                      source: 'imap',
                      imap_uid: uid, // bigint in Postgres akzeptiert Number/String aus JS
                      imap_mailbox: mailboxName,
                      imap_message_id: parsed.messageId || null
                    })

                if (insertError) {
                  mandantLog.errors.push(`DB Insert Fehler: ${insertError.message}`)
                }
              }

              mandantLog.processed_mails++
            }

            // Mail final als gelesen markieren
            await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true })
          }
        } finally {
          lock.release()
        }

        await client.logout()
      } catch (err: any) {
        console.error(`Fehler bei Mandant ${mandant.name}:`, err)
        mandantLog.errors.push(err.message || 'Unbekannter IMAP-Fehler')
        try { await client.logout() } catch (_) {}
      }

      syncResults.push(mandantLog)
    }

    return new Response(JSON.stringify({
      ok: true,
      message: 'IMAP-Sync abgeschlossen',
      results: syncResults
    }), {
      status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' }
    })

  } catch (globalError: any) {
    console.error('Kritischer Sync Fehler:', globalError)
    return new Response(JSON.stringify({ ok: false, error: globalError.message }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' }
    })
  }
})