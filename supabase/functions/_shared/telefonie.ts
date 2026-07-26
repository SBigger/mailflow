// ══════════════════════════════════════════════════════════════════════
// Gemeinsame Helfer für die peoplefone-CONNECTOR-Anbindung.
//
// WICHTIG (ehrlicher Hinweis): Die exakten Feldnamen im CONNECTOR-Payload
// (Lookup-Request bei eingehendem Anruf, Workflow-POST bei Anrufende) sind
// HIER NICHT aus der Primärquelle (peoplefone-API-Doku) 1:1 übernommen,
// sondern best-effort aus einer Recherche-Zusammenfassung abgeleitet.
// → Beim ersten echten Testanruf (30-Tage-Test) IMMER zuerst die Logs der
//   Function ansehen (`rawBody` wird geloggt) und pickPhoneNumber()/die
//   Feldnamen unten anpassen, falls peoplefone andere Keys schickt.
// Normalisierung wie in sync-teams-calls/index.ts; der Suffix-Vergleich ist
// seit 2026-07-26 BEWUSST lockerer (6 statt 9 Ziffern, siehe phoneSuffix).
// ══════════════════════════════════════════════════════════════════════

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  if (digits.startsWith("0") && !digits.startsWith("+")) return "+41" + digits.slice(1);
  return digits.startsWith("+") ? digits : "+" + digits;
}

// Letzte 6 Ziffern (Sascha-Entscheid 2026-07-26, vorher 9): 9 Ziffern sind
// bei CH-Nummern faktisch die ganze nationale Nummer -- jede Format-/Praefix-
// Abweichung zwischen peoplefone und CRM liess den Match scheitern ("Format-
// Problem", Karte zeigte nur die Nummer statt den Kundennamen). 6 sind bei
// unserem Kundenstamm eindeutig genug; erster Treffer gewinnt.
// ⚠️ BEWUSST anders als sync-teams-calls (dort weiterhin 9): dessen Suffix
// wird als call_notes_pending.phone_suffix GESPEICHERT und beim Verknuepfen
// exakt verglichen -- die beiden Welten duerfen unabhaengig sein, aber
// innerhalb des Teams-Sync muss Schreiben+Lesen dasselbe Format behalten.
export function phoneSuffix(norm: string | null): string | null {
  if (!norm) return null;
  const d = norm.replace(/\D/g, "");
  return d.length >= 6 ? d.slice(-6) : null;
}

// Versucht, aus einem beliebig geformten CONNECTOR-Payload die Anrufernummer
// zu extrahieren — probiert mehrere plausible Feldnamen durch, da uns die
// exakte Spezifikation nicht vorliegt (siehe Hinweis oben).
export function pickPhoneNumber(body: Record<string, unknown>): string | null {
  const candidates = [
    "number", "phone", "phoneNumber", "caller", "callerNumber",
    "callerId", "from", "fromNumber", "msisdn", "cli", "callingNumber",
  ];
  for (const key of candidates) {
    const v = body?.[key];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && typeof (v as any).number === "string") return (v as any).number;
  }
  return null;
}

export function pickCalleeNumber(body: Record<string, unknown>): string | null {
  const candidates = ["to", "toNumber", "callee", "calleeNumber", "dialedNumber", "destination"];
  for (const key of candidates) {
    const v = body?.[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export type CustomerMatch = { customerId: string; label: string | null; contactName: string | null };

// Baut den Suffix-Index (customers.phone + contact_persons[].phone/phone2)
// und matcht eine Nummer — identische Logik wie sync-teams-calls.
export async function matchCustomerBySuffix(
  supabase: any,
  rawNumber: string | null,
): Promise<CustomerMatch | null> {
  const suf = phoneSuffix(normalizePhone(rawNumber));
  if (!suf) return null;

  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, company_name, vorname, name, phone, contact_persons, aktiv");
  if (error || !customers) return null;

  for (const c of customers as any[]) {
    if (c.phone && phoneSuffix(normalizePhone(c.phone)) === suf) {
      return { customerId: c.id, label: c.company_name || [c.vorname, c.name].filter(Boolean).join(" "), contactName: null };
    }
    const cps = Array.isArray(c.contact_persons) ? c.contact_persons : [];
    for (const cp of cps) {
      if (!cp || typeof cp !== "object") continue;
      const hit = (cp.phone && phoneSuffix(normalizePhone(cp.phone)) === suf)
        || (cp.phone2 && phoneSuffix(normalizePhone(cp.phone2)) === suf);
      if (hit) {
        const contactName = [cp.vorname, cp.name].filter(Boolean).join(" ").trim() || null;
        return { customerId: c.id, label: c.company_name || null, contactName };
      }
    }
  }
  return null;
}

// Sendet ein Realtime-Broadcast-Event OHNE eine WebSocket-Verbindung offen zu
// halten — Supabase's dokumentierter REST-Weg fürs Senden von Broadcasts vom
// Server aus (https://supabase.com/docs/guides/realtime/broadcast).
// ⚠️ Endpoint/Payload-Form vor Go-Live gegen die aktuelle Supabase-Doku prüfen.
export async function broadcastRealtime(
  supabaseUrl: string,
  serviceRoleKey: string,
  topic: string,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; status: number; body?: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: false }] }),
    });
    if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}
