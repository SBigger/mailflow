/**
 * fibu-suggest-buchung
 * ====================
 * KI-gestützte Buchungsvorschläge für Kreditoren-Rechnungen.
 *
 * Lernt aus drei Quellen:
 *  1. Buchungshistorie des Lieferanten (fibu_lieferant_buchungshistorie RPC)
 *  2. Rechnungsinhalt (QR-Daten, extrahierter Text, Lieferantenname)
 *  3. Claude AI — verknüpft alles und schlägt Konto + MWST-Code vor
 *
 * Input (POST JSON):
 *  - mandant_id      UUID
 *  - lieferant_id    UUID  (optional, für Historien-Lookup)
 *  - lieferant_name  string
 *  - kontext_text    string  (Rechnungstext, QR-Mitteilung, Beschreibung)
 *  - konten          [{konto_nr, bezeichnung, konto_typ}]
 *  - mwst_codes      [{code, bezeichnung, satz, typ}]
 *  - waehrung        string (CHF|EUR|...)
 *  - betrag_brutto   number (optional, aus QR)
 *
 * Output:
 *  - vorschlaege: [{konto_nr, konto_bezeichnung, mwst_code, bezeichnung, confidence, begruendung}]
 *  - lieferant_kategorie: string
 *  - quelle: 'ki'|'historie'|'default'
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const ok  = (b: object) => new Response(JSON.stringify(b), { status: 200, headers: { ...cors, 'content-type': 'application/json' } })
const err = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'content-type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Auth: JWT des eingeloggten Users
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return err('Nicht authentifiziert', 401)

  const body = await req.json()
  const {
    mandant_id,
    lieferant_id,
    lieferant_name   = '',
    kontext_text     = '',
    konten           = [],
    mwst_codes       = [],
    waehrung         = 'CHF',
    betrag_brutto    = null,
  } = body

  if (!mandant_id) return err('mandant_id fehlt')

  // ── 1. Buchungshistorie für diesen Lieferanten ───────────────────
  let historyText = ''
  if (lieferant_id) {
    const { data: history } = await supabase.rpc('fibu_lieferant_buchungshistorie', {
      p_mandant_id:   mandant_id,
      p_lieferant_id: lieferant_id,
      p_limit:        8,
    })

    if (history?.length) {
      historyText = `\n\nBuchungshistorie für diesen Lieferanten (${history.length} Einträge):\n`
      for (const h of history) {
        historyText += `  • Konto ${h.konto_nr} ${h.bezeichnung ?? ''} | MWST: ${h.mwst_code} (${h.mwst_satz}%) | Ø CHF ${h.betrag_netto} | ${h.anzahl}× gebucht, zuletzt ${h.zuletzt}\n`
      }

      // ── Schnellpfad: wenn Historien-Confidence hoch genug, kein AI-Call ──
      const topEntry = history[0]
      if (topEntry && topEntry.anzahl >= 3) {
        const matchedKonto = konten.find((k: any) => k.konto_nr === topEntry.konto_nr)
        const matchedMwst  = mwst_codes.find((m: any) => m.code === topEntry.mwst_code)
        const confidence   = Math.min(0.70 + topEntry.anzahl * 0.03, 0.95)
        return ok({
          vorschlaege: [{
            konto_nr:          topEntry.konto_nr,
            konto_bezeichnung: matchedKonto?.bezeichnung ?? topEntry.bezeichnung ?? topEntry.konto_nr,
            mwst_code:         topEntry.mwst_code,
            mwst_satz:         matchedMwst?.satz ?? topEntry.mwst_satz,
            bezeichnung:       '',
            confidence,
            begruendung:       `Basierend auf ${topEntry.anzahl} vorherigen Buchungen für diesen Lieferanten (zuletzt ${topEntry.zuletzt})`,
          }],
          lieferant_kategorie: null,
          quelle: 'historie',
        })
      }
    }
  }

  // ── 2. Claude AI Call ────────────────────────────────────────────
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    // Fallback: Default-Konto zurückgeben wenn kein API Key
    const defaultKonto = konten.find((k: any) => k.konto_nr === '6800') ?? konten[0]
    const defaultMwst  = mwst_codes.find((m: any) => m.code === 'M81') ?? mwst_codes[0]
    return ok({
      vorschlaege: [{
        konto_nr:          defaultKonto?.konto_nr ?? '6800',
        konto_bezeichnung: defaultKonto?.bezeichnung ?? 'Warenaufwand',
        mwst_code:         defaultMwst?.code ?? 'M81',
        mwst_satz:         defaultMwst?.satz ?? 8.1,
        bezeichnung:       '',
        confidence:        0.4,
        begruendung:       'Standardvorschlag (kein ANTHROPIC_API_KEY konfiguriert)',
      }],
      lieferant_kategorie: null,
      quelle: 'default',
    })
  }

  // Aufwandskonten für Prompt aufbereiten (max. 60 Konten)
  const aufwandskonten = konten
    .filter((k: any) => k.konto_typ === 'aufwand')
    .slice(0, 60)
    .map((k: any) => `  ${k.konto_nr}  ${k.bezeichnung}`)
    .join('\n')

  const mwstListe = mwst_codes
    .map((m: any) => `  ${m.code}  ${m.bezeichnung}  (${m.satz}%, Typ: ${m.typ})`)
    .join('\n')

  const systemPrompt = `Du bist ein erfahrener Schweizer Treuhänder und hilfst beim Erfassen von Kreditoren-Rechnungen in einer Finanzbuchhaltung nach Schweizer KMU-Kontenrahmen (OR 2013).

Deine Aufgabe: Schlage das passende Aufwandskonto und den korrekten MWST-Vorsteuer-Code für eine eingehende Rechnung vor.

Schweizer MWST-Regeln:
- M81: Vorsteuer 8.1% — Standardsatz (Lieferungen und Leistungen allgemein)
- M26: Vorsteuer 2.6% — Sondersatz (Beherbergung)
- M38: Vorsteuer 3.8% — Sondersatz (Landwirtschaft, Nahrungsmittel, Zeitungen)
- I81: Vorsteuer 8.1% — Investitionsgüter
- M0: Keine Vorsteuer (steuerbefreit, Ausland, oder Pauschalmethode)

Antworte AUSSCHLIESSLICH als JSON ohne Markdown:
{
  "vorschlaege": [
    {
      "konto_nr": "4-stellige Kontonummer aus der Liste unten",
      "mwst_code": "Code aus der MWST-Liste",
      "bezeichnung": "Kurzer Buchungstext (max. 60 Zeichen)",
      "confidence": 0.0-1.0,
      "begruendung": "Kurzeinschätzung auf Deutsch (max. 100 Zeichen)"
    }
  ],
  "lieferant_kategorie": "z.B. IT-Dienstleistungen, Büromaterial, Miete, Versicherung..."
}

Gib 1-2 Vorschläge zurück. Der erste ist der beste.`

  const userPrompt = `Lieferant: ${lieferant_name}
Währung: ${waehrung}${betrag_brutto ? '\nBruttobetrag: ' + waehrung + ' ' + betrag_brutto : ''}

Rechnungsinhalt / Kontext:
${kontext_text || '(kein Rechnungstext verfügbar)'}
${historyText}
Verfügbare Aufwandskonten:
${aufwandskonten}

Verfügbare MWST-Codes:
${mwstListe}

Welches Konto und welcher MWST-Code passt am besten zu dieser Rechnung?`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',   // Haiku: schnell + günstig für Buchungsvorschläge
        max_tokens: 600,
        temperature: 0.1,
        system:  systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const e = await response.text()
      console.error('Claude API Fehler:', e)
      return err(`Claude API Fehler: ${response.status}`, 500)
    }

    const claude = await response.json()
    const rawText = claude.content?.[0]?.text ?? '{}'

    let parsed: any = {}
    try {
      // JSON-Block extrahieren falls Markdown-Wrapper vorhanden
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch?.[0] ?? rawText)
    } catch {
      console.error('JSON-Parse-Fehler:', rawText)
      return err('Claude-Antwort nicht parsebar', 500)
    }

    const vorschlaege = (parsed.vorschlaege ?? []).map((v: any) => {
      const matchedKonto = konten.find((k: any) => k.konto_nr === v.konto_nr)
      const matchedMwst  = mwst_codes.find((m: any) => m.code === v.mwst_code)
      return {
        konto_nr:          v.konto_nr ?? '',
        konto_bezeichnung: matchedKonto?.bezeichnung ?? v.konto_nr ?? '',
        mwst_code:         v.mwst_code ?? 'M81',
        mwst_satz:         matchedMwst?.satz ?? 8.1,
        bezeichnung:       v.bezeichnung ?? '',
        confidence:        Math.max(0, Math.min(1, v.confidence ?? 0.7)),
        begruendung:       v.begruendung ?? '',
      }
    })

    return ok({
      vorschlaege,
      lieferant_kategorie: parsed.lieferant_kategorie ?? null,
      quelle: 'ki',
    })

  } catch (e: any) {
    clearTimeout(timer)
    if (e.name === 'AbortError') return err('Timeout beim KI-Vorschlag', 504)
    console.error('Unerwarteter Fehler:', e)
    return err(String(e), 500)
  }
})
