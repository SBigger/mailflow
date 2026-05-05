/**
 * fibu-imap-sync
 * ==============
 * Liest ungelesene E-Mails mit PDF-Anhängen aus einem IMAP-Postfach
 * und erstellt Einträge in fibu_rechnung_inbox.
 *
 * Ausführung via Supabase Cron (alle 5–15 Minuten):
 *   SELECT cron.schedule('fibu-imap-sync', '*/10 * * * *',
 *     $$SELECT net.http_post('https://<project>.supabase.co/functions/v1/fibu-imap-sync',
 *       headers := '{"X-Cron-Secret": "<secret>"}'::jsonb)$$);
 *
 * Konfiguration pro Mandant (fibu_mandanten):
 *   imap_host      = 'imap.gmail.com' | 'outlook.office365.com' | 'mail.artis-gmbh.ch'
 *   imap_port      = 993 (SSL) oder 143 (STARTTLS)
 *   imap_user      = 'rechnungen@artis-gmbh.ch'
 *   imap_password  = '...' (App-Passwort, nicht das normale Passwort!)
 *   imap_mailbox   = 'INBOX' (oder 'Rechnungen', 'Invoices', ...)
 *   imap_aktiv     = true
 *
 * Gmail: Konto → Sicherheit → 2FA aktivieren → App-Passwörter erstellen
 * Outlook/M365: Konto → Sicherheit → App-Passwörter (oder Entra-App-Registrierung für OAuth)
 * Eigener Server: normales Passwort oder Zertifikat
 *
 * Deployment (wenn bereit):
 *   npx supabase functions deploy fibu-imap-sync
 *
 * STATUS: Skeleton — bereit zur Implementierung wenn IMAP gewünscht.
 *         Aktuell als Platzhalter deployed (gibt nur 200 OK zurück).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Auth: nur Cron-Calls oder Service-Role
  const cronSecret = Deno.env.get('CRON_SECRET')
  const provided = req.headers.get('X-Cron-Secret')
  const authHeader = req.headers.get('Authorization') ?? ''
  const isServiceCall = authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '__')

  if (cronSecret && provided !== cronSecret && !isServiceCall) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // TODO: IMAP-Implementierung
  // Deno hat nativen TCP-Zugang (Deno.connect), damit lässt sich IMAP
  // ohne externe Library implementieren. Alternativ: imap-client via esm.sh.
  //
  // Pseudocode für den fertigen Sync:
  //
  // 1. Aktive Mandanten mit IMAP-Config laden:
  //    SELECT id, imap_host, imap_port, imap_user, imap_password, imap_mailbox
  //    FROM fibu_mandanten WHERE imap_aktiv = true
  //
  // 2. Für jeden Mandanten:
  //    a. IMAP-Verbindung aufbauen (TLS, Port 993)
  //    b. LOGIN user password
  //    c. SELECT INBOX
  //    d. SEARCH UNSEEN (oder SEARCH SINCE <last_sync_date>)
  //    e. Für jede Mail-UID:
  //       - Prüfen ob bereits in fibu_rechnung_inbox (via imap_uid UNIQUE INDEX)
  //       - FETCH <uid> BODY[] → RFC822 Message parsen
  //       - Anhänge extrahieren (Content-Disposition: attachment, Content-Type: application/pdf)
  //       - Upload zu Supabase Storage: fibu-inbox/{mandant_id}/{uuid}_{filename}
  //       - INSERT INTO fibu_rechnung_inbox (source='imap', imap_uid, imap_mailbox, ...)
  //    f. LOGOUT
  //
  // 3. Bei Fehler: Console.error, weitermachen mit nächstem Mandanten

  // Placeholder-Response
  const { data: mandanten } = await supabase
    .from('fibu_mandanten')
    .select('id, name, imap_host, imap_aktiv')
    .eq('imap_aktiv', true)

  const aktiveCount = mandanten?.length ?? 0

  return new Response(JSON.stringify({
    ok: true,
    message: `IMAP-Sync bereit — ${aktiveCount} Mandant(en) mit aktivem IMAP konfiguriert`,
    status: 'skeleton — Implementierung ausstehend',
    aktive_mandanten: mandanten?.map(m => ({ id: m.id, name: m.name, host: m.imap_host })) ?? [],
  }), {
    status: 200,
    headers: { ...corsHeaders, 'content-type': 'application/json' }
  })
})
