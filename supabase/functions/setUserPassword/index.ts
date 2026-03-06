import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: { user: caller } } = await adminClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    // Verify caller is admin
    const { data: callerProfile } = await adminClient
      .from('profiles').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Nur Admins können Passwörter setzen' }), { status: 403, headers: corsHeaders })
    }

    const { user_id, password } = await req.json()

    if (!user_id || !password) {
      return new Response(JSON.stringify({ error: 'user_id und password erforderlich' }), { status: 400, headers: corsHeaders })
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Passwort muss mindestens 8 Zeichen haben' }), { status: 400, headers: corsHeaders })
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, { password })
    if (error) throw error

    console.log(`[setUserPassword] Passwort gesetzt für user ${user_id} von ${caller.email}`)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('[setUserPassword] Fehler:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
