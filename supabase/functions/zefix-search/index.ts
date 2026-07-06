import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ZEFIX_BASE = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1'

function zefixAuth(): string {
  const user = Deno.env.get('ZEFIX_USER')
  const pass = Deno.env.get('ZEFIX_PASS')
  if (!user || !pass) throw new Error('ZEFIX_USER / ZEFIX_PASS nicht konfiguriert')
  return 'Basic ' + btoa(`${user}:${pass}`)
}

function formatUid(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length === 9) {
    return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`
  }
  return raw
}

function compactUid(raw: string): string {
  return raw.replace(/[.\-\s]/g, '').toUpperCase()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const ok = (body: object) => new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
  const err = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const { query, mode } = await req.json()
    if (!query || query.trim().length < 3) return err('Mindestens 3 Zeichen erforderlich')

    const auth = zefixAuth()
    let results: any[] = []

    const isUid = /^CHE[.\-\s]?\d/i.test(query.trim())

    if (isUid || mode === 'uid') {
      const uid = compactUid(query.trim())
      const res = await fetch(`${ZEFIX_BASE}/company/uid/${uid}`, {
        headers: { 'Authorization': auth, 'Accept': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        results = Array.isArray(data) ? data : [data]
      }
    } else {
      const searchName = query.trim().length >= 3 ? query.trim() + '*' : query.trim()
      const res = await fetch(`${ZEFIX_BASE}/company/search`, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: searchName, activeOnly: true }),
      })
      if (res.ok) {
        const data = await res.json()
        results = Array.isArray(data) ? data : []
      }
    }

    const mapped = results.slice(0, 20).map((c: any) => ({
      name: c.name,
      uid: c.uid ? formatUid(c.uid) : null,
      uid_raw: c.uid || null,
      ehraid: c.ehraid,
      sitz: c.legalSeat || c.address?.city || null,
      plz: c.address?.swissZipCode || null,
      strasse: c.address ? [c.address.street, c.address.houseNumber].filter(Boolean).join(' ') : null,
      kanton: c.canton || null,
      rechtsform: c.legalForm?.shortName?.de || c.legalForm?.name?.de || null,
      status: c.status,
      zweck: c.purpose || null,
    }))

    return ok({ results: mapped })
  } catch (e) {
    return err(String(e?.message ?? e), 500)
  }
})
