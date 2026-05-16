/**
 * fibu-wechselkurse-import
 * ========================
 * Importiert die offiziellen Fremdwährungskurse der ESTV/BAZG
 * (Eidg. Steuerverwaltung / Bundesamt für Zoll und Grenzsicherheit)
 * in die Tabelle fibu_wechselkurse.
 *
 * Quelle (für automatische Einbindung in Buchhaltungssoftware):
 *   Monatsmittelkurse: https://www.backend-rates.bazg.admin.ch/api/xmlavgmonth
 *   Tageskurse:        https://www.backend-rates.bazg.admin.ch/api/xmldaily
 *
 * Aufruf (vom Frontend, authentifiziert):
 *   supabase.functions.invoke('fibu-wechselkurse-import', { body: { typ: 'beide' } })
 *   typ: 'monat' | 'tag' | 'beide'  (Default: 'beide')
 *
 * Deployment:
 *   npx supabase functions deploy fibu-wechselkurse-import
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ENDPOINTS: Record<string, string> = {
  monat: 'https://www.backend-rates.bazg.admin.ch/api/xmlavgmonth',
  tag:   'https://www.backend-rates.bazg.admin.ch/api/xmldaily',
}

/** Parst das BAZG-XML in normalisierte Kurs-Zeilen. */
function parseRates(xml: string, typ: 'monat' | 'tag') {
  // Datum: <monat>YYYY-MM</monat> oder <datum>YYYY-MM-DD</datum> / <tag>...</tag>
  const dm = xml.match(/<(?:monat|datum|tag)>\s*([0-9-]+)\s*<\/(?:monat|datum|tag)>/)
  let datum = dm ? dm[1].trim() : ''
  if (/^\d{4}-\d{2}$/.test(datum)) datum += '-01'        // Monatswert → 1. des Monats
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    // Fallback: heutiges Datum
    datum = new Date().toISOString().slice(0, 10)
  }

  const rows: any[] = []
  const deviseRe = /<devise\s+code="([^"]+)">([\s\S]*?)<\/devise>/g
  let m: RegExpExecArray | null
  while ((m = deviseRe.exec(xml)) !== null) {
    const block = m[2]
    const wm = block.match(/<waehrung>\s*(\d+)\s*([A-Za-z]{3})\s*<\/waehrung>/)
    const km = block.match(/<kurs>\s*([\d.]+)\s*<\/kurs>/)
    if (!wm || !km) continue
    const einheit = parseInt(wm[1], 10) || 1
    const code    = wm[2].toUpperCase()
    const kursRaw = parseFloat(km[1])
    if (!isFinite(kursRaw) || kursRaw <= 0) continue
    const land = (block.match(/<land_de>([^<]*)<\/land_de>/)?.[1] ?? '').trim()
    rows.push({
      typ,
      datum,
      waehrung: code,
      einheit,
      kurs:     kursRaw / einheit,
      kurs_raw: kursRaw,
      land:     land || null,
      quelle:   'BAZG/ESTV',
      imported_at: new Date().toISOString(),
    })
  }
  return { datum, rows }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    let typ = 'beide'
    try {
      const body = await req.json()
      if (body?.typ) typ = String(body.typ)
    } catch { /* kein Body → Default */ }

    const modi = typ === 'beide' ? ['monat', 'tag'] : [typ]
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const ergebnis: any[] = []
    for (const modus of modi) {
      const url = ENDPOINTS[modus]
      if (!url) continue
      try {
        const res = await fetch(url, { headers: { 'Accept': 'application/xml' } })
        if (!res.ok) { ergebnis.push({ typ: modus, fehler: `HTTP ${res.status}` }); continue }
        const xml = await res.text()
        const { datum, rows } = parseRates(xml, modus as 'monat' | 'tag')
        if (rows.length === 0) { ergebnis.push({ typ: modus, fehler: 'Keine Kurse im XML' }); continue }

        const { error } = await supabase
          .from('fibu_wechselkurse')
          .upsert(rows, { onConflict: 'typ,datum,waehrung' })
        if (error) { ergebnis.push({ typ: modus, fehler: error.message }); continue }

        ergebnis.push({ typ: modus, datum, anzahl: rows.length })
      } catch (e) {
        ergebnis.push({ typ: modus, fehler: String(e?.message ?? e) })
      }
    }

    return new Response(JSON.stringify({ ok: true, ergebnis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, fehler: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
