// Vercel Serverless Function: Zefix-Detailabruf.
//
// Warum ein Proxy? Die Zefix Public REST API verlangt Basic Auth. Die Zugangsdaten
// duerfen nie ins Frontend – deshalb laeuft der Detailabruf ueber diese Function.
// Erwartet die Env-Variablen ZEFIX_USER und ZEFIX_PASS (Vercel-Projekt mailflow).
//
// WICHTIG: Die Function ist per Default oeffentlich erreichbar. Ohne die
// Token-Pruefung unten waere sie ein offener Proxy auf unsere Zefix-Credentials –
// und genau die Massenabfragen, die wir dem Bundesamt gegenueber ausgeschlossen
// haben. Deshalb: nur mit gueltigem Supabase-Access-Token eines Smartis-Nutzers.
//
// GET /api/zefix?uid=CHE114781315   -> Detaildatensatz
// GET /api/zefix?gemeinden=1        -> Gemeindeliste (BFS-Nummer, Name, Kanton)
const BASE = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1'

// Die Gemeindeliste aendert sich selten. Ueber Instanz-Lebensdauer cachen spart Calls.
let gemeindenCache = null

/** Prueft das mitgeschickte Supabase-Token gegen die Auth-API. */
async function istEingeloggt(req) {
  const token = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return false

  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return false

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  })
  return res.ok
}

export default async function handler(req, res) {
  const user = process.env.ZEFIX_USER
  const pass = process.env.ZEFIX_PASS
  if (!user || !pass) {
    return res.status(503).json({ error: 'ZEFIX_USER / ZEFIX_PASS sind auf Vercel nicht gesetzt.' })
  }

  try {
    if (!(await istEingeloggt(req))) {
      return res.status(401).json({ error: 'Nicht angemeldet.' })
    }
  } catch {
    return res.status(401).json({ error: 'Anmeldung konnte nicht geprüft werden.' })
  }

  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')

  try {
    if (req.query.gemeinden) {
      if (!gemeindenCache) {
        const r = await fetch(`${BASE}/community`, { headers: { Authorization: auth, Accept: 'application/json' } })
        if (!r.ok) throw new Error(`Zefix ${r.status}`)
        gemeindenCache = (await r.json()).map((c) => ({ bfsId: c.bfsId, name: c.name, kanton: c.canton }))
      }
      // private: die Antwort haengt am Token, sie darf nicht im CDN landen.
      res.setHeader('Cache-Control', 'private, max-age=86400')
      return res.status(200).json(gemeindenCache)
    }

    const uid = String(req.query.uid ?? '').replace(/[^A-Za-z0-9]/g, '')
    if (!/^CHE\d{9}$/.test(uid)) return res.status(400).json({ error: 'Ungültige UID' })

    const r = await fetch(`${BASE}/company/uid/${uid}`, { headers: { Authorization: auth, Accept: 'application/json' } })
    if (r.status === 404) return res.status(404).json({ error: 'Nicht gefunden' })
    if (!r.ok) throw new Error(`Zefix ${r.status}`)

    const data = await r.json()
    const c = Array.isArray(data) ? data[0] : data
    if (!c) return res.status(404).json({ error: 'Nicht gefunden' })

    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.status(200).json({
      name: c.name,
      uid: c.uid,
      ehraid: c.ehraid,
      rechtsform: c.legalForm?.shortName?.de ?? null,
      rechtsform_lang: c.legalForm?.name?.de ?? null,
      sitz: c.legalSeat,
      kanton: c.canton,
      adresse: c.address ?? null,
      kapital: c.capitalNominal ? { betrag: Number(c.capitalNominal), waehrung: c.capitalCurrency } : null,
      status: c.status,
      zweck: c.purpose ?? null,
      // Der Grund, warum es diese Function gibt: nur der Detailabruf kennt die Revisionsstelle.
      revisionsstellen: (c.auditCompanies ?? []).map((a) => ({ name: a.name, sitz: a.legalSeat, uid: a.uid })),
      auszug_url: c.cantonalExcerptWeb ?? null,
    })
  } catch (e) {
    return res.status(502).json({ error: String(e?.message ?? e) })
  }
}
