// ── Handelsregister-Recherche: drei Quellen, klare Arbeitsteilung ──────────────
//
//  LINDAS  – Zefix als Knowledge Graph des Bundes (SPARQL). ~790'000 Firmen mit
//            Name, Rechtsform, Adresse und Zweck-Volltext. Kein Login, CORS offen.
//            Kann breit suchen, kennt aber weder Revisionsstelle noch Kapital.
//  Zefix   – REST, Basic Auth. Kennt pro Firma alles, aber nur vorwärts (UID → Firma).
//            Läuft über /api/zefix, damit die Credentials nie ins Frontend kommen.
//  SHAB    – Volltextsuche über alle HR-Publikationen. Die einzige Quelle mit einer
//            RÜCKWÄRTSSUCHE («welche Firmen haben Revisor X?»). Antwortet 403, sobald
//            ein Origin-Header mitkommt → immer über den /shab-Proxy.
//
// Was keine der drei Quellen hat: einen NOGA-Branchencode. Branchensuche ist deshalb
// eine Textsuche im Zweck — jede Trefferzahl ist eine Untergrenze.

const LINDAS = 'https://lindas.admin.ch/query'
const GRAPH = 'https://lindas.admin.ch/foj/zefix'
const SHAB = '/shab/api/v1/publications'

// eCH-0097-Codes, wie LINDAS sie in schema:additionalType führt.
export const RECHTSFORMEN = {
  '0106': 'Aktiengesellschaft',
  '0107': 'GmbH',
  '0101': 'Einzelunternehmen',
  '0108': 'Genossenschaft',
  '0109': 'Verein',
  '0110': 'Stiftung',
  '0103': 'Kollektivgesellschaft',
  '0104': 'Kommanditgesellschaft',
  '0151': 'Zweigniederlassung',
}

export const formatUid = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length === 9 ? `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}` : (raw ?? '')
}

// LINDAS liefert streetAddress mehrzeilig und schreibt bei fehlender c/o-Zeile
// wörtlich "null" hinein. Ohne diese Bereinigung landet das in den CRM-Adressen.
const cleanStreet = (s = '') =>
  s.split('\n').map((z) => z.trim()).filter((z) => z && z !== 'null').join(', ')

const sparqlString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function buildQuery({ zweck, name, bfsId, kanton, form, limit = 200 }) {
  const filters = []
  if (bfsId) filters.push(`?org <https://schema.ld.admin.ch/municipality> <https://ld.admin.ch/municipality/${Number(bfsId)}> .`)
  if (form) filters.push(`?org schema:additionalType <https://ld.admin.ch/ech/97/legalforms/${String(form).replace(/\D/g, '')}> .`)
  if (kanton) filters.push(`FILTER(?kanton = ${sparqlString(kanton.toUpperCase())})`)
  if (name) filters.push(`FILTER(CONTAINS(LCASE(?name), ${sparqlString(name.toLowerCase())}))`)
  if (zweck) filters.push(`FILTER(CONTAINS(LCASE(?zweck), ${sparqlString(zweck.toLowerCase())}))`)

  // Bei Zweck-Suche muss ?zweck gebunden sein, sonst darf er fehlen.
  const zweckPattern = zweck ? '?org schema:description ?zweck .' : 'OPTIONAL { ?org schema:description ?zweck }'

  return `
PREFIX schema: <http://schema.org/>
SELECT ?uid ?name ?formUri ?strasse ?plz ?ort ?kanton ?zweck WHERE {
  GRAPH <${GRAPH}> {
    ?org a schema:Organization ;
         schema:legalName ?name ;
         schema:additionalType ?formUri ;
         schema:address ?adr .
    ?adr schema:addressLocality ?ort ;
         schema:addressRegion ?kanton .
    OPTIONAL { ?adr schema:streetAddress ?strasse }
    OPTIONAL { ?adr schema:postalCode ?plz }
    OPTIONAL { ?org schema:identifier ?idNode . ?idNode schema:name "CompanyUID" ; schema:value ?uid }
    ${zweckPattern}
    ${filters.join('\n    ')}
  }
}
LIMIT ${Math.min(Number(limit) || 200, 1000)}`
}

/** Breite Firmensuche über LINDAS. Direkt aus dem Browser – CORS ist offen. */
export async function sucheFirmen(params) {
  const res = await fetch(`${LINDAS}?query=${encodeURIComponent(buildQuery(params))}`, {
    headers: { Accept: 'application/sparql-results+json' },
  })
  if (!res.ok) throw new Error(`LINDAS antwortet ${res.status}`)
  const json = await res.json()
  return json.results.bindings.map((b) => {
    const code = b.formUri?.value.split('/').pop() ?? ''
    return {
      uid: b.uid?.value ?? '',
      name: b.name?.value ?? '',
      rechtsform: RECHTSFORMEN[code] ?? code,
      strasse: cleanStreet(b.strasse?.value ?? ''),
      plz: b.plz?.value ?? '',
      ort: b.ort?.value ?? '',
      kanton: b.kanton?.value ?? '',
      zweck: b.zweck?.value ?? '',
    }
  })
}

/** Detaildatensatz inkl. Revisionsstelle und Kapital – über die Serverless Function. */
export async function firmenDetail(uid) {
  const res = await fetch(`/api/zefix?uid=${encodeURIComponent(String(uid).replace(/[^A-Za-z0-9]/g, ''))}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `Zefix antwortet ${res.status}`)
  return json
}

export async function gemeindeliste() {
  const res = await fetch('/api/zefix?gemeinden=1')
  if (!res.ok) return []
  return res.json()
}

// ── SHAB: Rückwärtssuche nach Revisionsmandaten ───────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? unescapeXml(m[1].trim()) : null
}
const blocks = (xml, name) => xml.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) ?? []
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function mapLimit(items, limit, fn, onProgress) {
  const out = []
  let i = 0
  let done = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++
        try {
          const r = await fn(items[idx])
          if (r) out.push(r)
        } catch {
          /* Einzelausfälle überspringen – ein fehlendes XML kippt nicht den Lauf */
        }
        onProgress?.(++done, items.length)
      }
    }),
  )
  return out
}

async function alleShabPublikationen(begriff, onProgress) {
  const out = []
  for (let page = 0; ; page++) {
    const url = `${SHAB}?keyword=${encodeURIComponent(begriff)}&rubrics=HR&publicationStates=PUBLISHED&pageRequest.page=${page}&pageRequest.size=100`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`SHAB antwortet ${res.status}`)
    const json = await res.json()
    out.push(...json.content)
    onProgress?.(out.length, json.total)
    if (out.length >= json.total || !json.content.length) break
  }
  return out
}

/** Liest aus einer Publikation Firma + eingetragene Revisionsstelle. */
async function lesePublikation(pub, re) {
  const res = await fetch(`${SHAB}/${pub.meta.id}/xml`)
  if (!res.ok) return null
  const xml = await res.text()

  // commonsNew = Stand NACH der Mutation; Fallback für ältere Publikationsformate.
  const stand = blocks(xml, 'commonsNew')[0] ?? blocks(xml, 'commons')[0] ?? xml
  const firmaBlock = blocks(stand, 'company')[0] ?? ''
  const firma = tag(firmaBlock, 'name')

  const ziffern = (tag(firmaBlock, 'uid') ?? '').replace(/\D/g, '')
  const uid = ziffern.length === 9 ? `CHE${ziffern}` : ''

  const revBlock = blocks(stand, 'revision')[0]
  if (!firma || !revBlock) return null

  const revisoren = blocks(revBlock, 'revisionCompany').map((b) => tag(b, 'name')).filter(Boolean)
  if (!revisoren.some((n) => re.test(n))) return null

  return { firma, uid, revisoren, datum: pub.meta.publicationDate?.slice(0, 10) ?? '' }
}

/**
 * Alle Firmen, die `revisor` als Revisionsstelle haben oder hatten.
 * `onProgress({phase, done, total})` meldet den Fortschritt der drei Etappen.
 */
export async function revisionsmandate(revisor, { onProgress, pruefen = true, signal } = {}) {
  const re = new RegExp(escapeRegex(revisor), 'i')
  const abbruch = () => { if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError') }

  onProgress?.({ phase: 'SHAB-Volltextsuche', done: 0, total: 0 })
  const pubs = await alleShabPublikationen(revisor, (done, total) =>
    onProgress?.({ phase: 'SHAB-Volltextsuche', done, total }),
  )
  abbruch()

  const treffer = await mapLimit(pubs, 6, (p) => lesePublikation(p, re), (done, total) =>
    onProgress?.({ phase: 'Publikationen auswerten', done, total }),
  )
  abbruch()

  // Pro Firma nur die jüngste Publikation behalten.
  const firmen = new Map()
  for (const t of treffer) {
    const key = t.uid || t.firma
    if (!firmen.has(key) || firmen.get(key).datum < t.datum) firmen.set(key, t)
  }

  const liste = [...firmen.values()]
  const rows = await mapLimit(liste, 4, async (f) => {
    let status = 'nicht geprüft'
    let adresse = ''
    if (pruefen && f.uid) {
      try {
        const c = await firmenDetail(f.uid)
        const a = c.adresse ?? {}
        adresse = [[a.street, a.houseNumber].filter(Boolean).join(' '), [a.swissZipCode, a.city].filter(Boolean).join(' ')]
          .filter(Boolean).join(', ')
        const aktuell = c.revisionsstellen.map((r) => r.name)
        status = aktuell.some((n) => re.test(n))
          ? 'aktiv'
          : aktuell.length
            ? `gewechselt zu ${aktuell.join(', ')}`
            : 'keine Revisionsstelle mehr'
      } catch {
        status = 'Zefix-Abruf fehlgeschlagen'
      }
    }
    return { firma: f.firma, uid: f.uid, uidFormatiert: f.uid ? formatUid(f.uid) : '', adresse, letztePublikation: f.datum, status }
  }, (done, total) => onProgress?.({ phase: 'Zefix-Bestätigung', done, total }))

  rows.sort((a, b) => a.firma.localeCompare(b.firma, 'de-CH'))
  return { revisor, publikationen: pubs.length, rows }
}
