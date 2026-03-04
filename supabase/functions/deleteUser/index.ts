import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
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

    // Verify caller is admin
    const { data: { user } } = await adminClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: callerProfile } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const { userId, transferToId } = body

    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Cannot delete yourself
    if (userId === user.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete yourself' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Optional: Transfer tasks to another user
    if (transferToId) {
      const { data: targetProfile } = await adminClient.from('profiles').select('email').eq('id', transferToId).single()
      if (targetProfile) {
        const { data: deletedProfile } = await adminClient.from('profiles').select('email').eq('id', userId).single()
        if (deletedProfile) {
          // Transfer tasks assigned to the deleted user
          await adminClient.from('tasks')
            .update({ assignee: targetProfile.email })
            .eq('assignee', deletedProfile.email)
        }
      }
    }

    // Delete user from auth (this cascades to profiles via DB trigger)
    const { error } = await adminClient.auth.admin.deleteUser(userId)
    if (error) throw error

    // Also delete profile directly (in case cascade doesn't work)
    await adminClient.from('profiles').delete().eq('id', userId)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
