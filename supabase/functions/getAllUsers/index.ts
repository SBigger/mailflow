import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller is authenticated
    const { data: { user }, error: authError } = await adminClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Externe Kundenbenutzer duerfen die Mitarbeiterliste nicht sehen.
    const { data: callerProfile } = await adminClient
      .from('profiles').select('role').eq('id', user.id).single()
    if (!callerProfile || callerProfile.role === 'extern') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Mitarbeiterliste (fuer Task-Zuweisung etc.). Bewusst KEIN select('*'):
    // profiles enthaelt Microsoft-/Kalender-Tokens und das Telefonie-Secret —
    // die haben in einer Benutzerliste nichts verloren.
    const { data: profiles, error } = await adminClient
      .from('profiles')
      .select('id, email, full_name, role, is_admin, theme, titel, inviteState, ' +
              'phone, avatar_url, outlook_email, internal_extension, peoplefone_user_id, ' +
              'created_at, updated_at')
      .order('full_name', { ascending: true })

    if (error) throw error

    return new Response(JSON.stringify({ users: profiles }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
