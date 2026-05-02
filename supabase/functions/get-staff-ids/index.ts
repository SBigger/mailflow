import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Temporary function - delete after use
Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data } = await adminClient
    .from('profiles')
    .select('id, full_name, email')
    .order('full_name')

  return new Response(JSON.stringify(data), { headers: cors })
})
