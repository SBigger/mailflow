// ============================================================================
// fibuInviteUser — Kundenzugang zu einem Fibu-Mandanten einladen
//
// Legt (falls noetig) einen Smartis-Benutzer mit der Rolle 'extern' an und gibt
// ihm Zugriff auf GENAU den uebergebenen Fibu-Mandanten. Mehrfach aufrufbar:
// derselbe Kunde kann so mehrere Mandanten sehen.
//
// Aufrufen darf das:
//   * wer im betreffenden Mandanten die Fibu-Rolle 'admin' hat, oder
//   * ein Smartis-Administrator.
//
// Ein 'extern'-Benutzer sieht ausserhalb der Fibu nichts — dafuer sorgt
// is_staff() in der Migration 20260820120000_externe_kunden_zugriff.sql.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const FIBU_ROLLEN = ['admin', 'buchhalter', 'readonly']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Nicht angemeldet.' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user } } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Nicht angemeldet.' }, 401)

    const { email, mandant_id, fibu_role = 'buchhalter' } = await req.json()

    if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return json({ error: 'Bitte eine gueltige E-Mail-Adresse angeben.' }, 400)
    }
    if (!mandant_id) return json({ error: 'Mandant fehlt.' }, 400)
    if (!FIBU_ROLLEN.includes(fibu_role)) return json({ error: `Ungueltige Rolle: ${fibu_role}` }, 400)

    const mail = email.trim().toLowerCase()

    // ── Berechtigung des Aufrufers ──────────────────────────────────────────
    const [{ data: callerProfile }, { data: callerAccess }] = await Promise.all([
      admin.from('profiles').select('role').eq('id', user.id).single(),
      admin.from('fibu_user_mandant_access')
        .select('role').eq('user_id', user.id).eq('mandant_id', mandant_id).maybeSingle(),
    ])

    const istMandantAdmin  = callerAccess?.role === 'admin'
    const istSmartisAdmin  = callerProfile?.role === 'admin'
    if (!istMandantAdmin && !istSmartisAdmin) {
      return json({ error: 'Nur Administratoren dieses Mandanten koennen Benutzer einladen.' }, 403)
    }

    // Mandant muss existieren (und liefert den Namen fuer die Rueckmeldung)
    const { data: mandant } = await admin
      .from('fibu_mandanten').select('id, name').eq('id', mandant_id).single()
    if (!mandant) return json({ error: 'Mandant nicht gefunden.' }, 404)

    // ── Benutzer anlegen oder bestehenden verwenden ─────────────────────────
    const { data: vorhanden } = await admin
      .from('profiles').select('id, role').eq('email', mail).maybeSingle()

    let userId  = vorhanden?.id as string | undefined
    let neu     = false

    if (!userId) {
      const appUrl = Deno.env.get('APP_URL') ?? 'https://smartis.me'
      const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(mail, {
        redirectTo: `${appUrl}/set-password`,
      })
      if (inviteError) throw new Error(inviteError.message)

      userId = invite.user.id
      neu    = true

      // Rolle 'extern' setzen — das Profil selbst legt der Trigger auf
      // auth.users an. Nur ueber service_role moeglich (profiles_guard_role_change).
      const { error: profileError } = await admin.from('profiles').upsert({
        id:          userId,
        email:       mail,
        role:        'extern',
        inviteState: 1,
        full_name:   mail.split('@')[0],
      }, { onConflict: 'id' })
      if (profileError) throw new Error(profileError.message)
    }

    // ── Zugriff auf den Mandanten setzen ────────────────────────────────────
    const { error: accessError } = await admin
      .from('fibu_user_mandant_access')
      .upsert({ user_id: userId, mandant_id, role: fibu_role }, { onConflict: 'user_id,mandant_id' })
    if (accessError) throw new Error(accessError.message)

    return json({
      success:      true,
      user_id:      userId,
      neu_angelegt: neu,
      rolle:        vorhanden?.role ?? 'extern',
      mandant:      mandant.name,
      hinweis: neu
        ? `Einladung an ${mail} versendet. Zugriff auf «${mandant.name}» ist eingerichtet.`
        : `${mail} hat neu Zugriff auf «${mandant.name}».`,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
