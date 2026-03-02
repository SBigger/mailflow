import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = req.headers.get('Authorization')!.replace('Bearer ', '')
  const { data: { user: authUser } } = await supabase.auth.getUser(token)
  if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

  console.log(`[RESET] Start für: ${authUser.email}`)
  let deletedTotal = 0
  
  while (true) {
    const { data: batch } = await supabase.from('mail_items')
      .select('id').eq('created_by', authUser.id).limit(50)
    if (!batch || batch.length === 0) break
    
    const ids = batch.map((m: any) => m.id)
    await supabase.from('mail_items').update({ skip_outlook_delete: true }).in('id', ids)
    await supabase.from('mail_items').delete().in('id', ids)
    deletedTotal += batch.length
    console.log(`[RESET] ${deletedTotal} Mails gelöscht`)
    await new Promise(r => setTimeout(r, 200))
  }

  await supabase.from('profiles').update({ microsoft_delta_link: '' }).eq('id', authUser.id)
  console.log(`[RESET] Fertig. Total gelöscht: ${deletedTotal}`)
  
  return new Response(JSON.stringify({ success: true, deleted: deletedTotal }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
