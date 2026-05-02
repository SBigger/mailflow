import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

// Staff UUID map – hardcoded from profiles
const NAME_TO_ID: Record<string, string> = {
  'reto':   '193a7fb6-3ef1-4b67-906d-e20b40c57a7e',
  'maura':  '4928d9b5-ab36-4382-bec3-136edbef7314',
  'romy':   'ff220f11-7804-4667-b17d-243c6066ae8c',
  'sascha': 'ebac33f8-7fc7-40ca-97ca-2112788265e7',
}

function firstName(full: string | null): string | null {
  if (!full) return null
  return full.trim().split(/\s+/)[0].toLowerCase()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Payload: array of { name, mandatsleiter, sachbearbeiter }
  const assignments: { name: string; mandatsleiter: string; sachbearbeiter: string }[] = await req.json()

  // Load all customers
  const { data: customers, error: ce } = await db
    .from('customers')
    .select('id, company_name, mandatsleiter_id, sachbearbeiter_id')
    .limit(5000)
  if (ce) return new Response(JSON.stringify({ error: ce.message }), { status: 500, headers: cors })

  const crm: Record<string, any> = {}
  for (const c of customers ?? []) {
    const key = (c.company_name ?? '').trim().toLowerCase()
    if (key) crm[key] = c
  }

  const results = { updated: 0, no_match: 0, skipped: 0, errors: [] as string[] }

  for (const row of assignments) {
    const key = (row.name ?? '').trim().toLowerCase()
    const c = crm[key]
    if (!c) { results.no_match++; continue }

    const mlFn = firstName(row.mandatsleiter)
    const sbFn = firstName(row.sachbearbeiter)
    const mlId = mlFn && NAME_TO_ID[mlFn] ? NAME_TO_ID[mlFn] : null
    const sbId = sbFn && NAME_TO_ID[sbFn] ? NAME_TO_ID[sbFn] : null

    const patch: Record<string, string> = {}
    if (mlId && c.mandatsleiter_id !== mlId) patch.mandatsleiter_id = mlId
    if (sbId && c.sachbearbeiter_id !== sbId) patch.sachbearbeiter_id = sbId

    if (Object.keys(patch).length === 0) { results.skipped++; continue }

    const { error } = await db.from('customers').update(patch).eq('id', c.id)
    if (error) { results.errors.push(`${row.name}: ${error.message}`); continue }
    results.updated++
  }

  return new Response(JSON.stringify(results), { headers: cors })
})
