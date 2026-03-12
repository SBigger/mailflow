// Vercel Serverless Function
// POST /api/portal-sg-fristeingabe
// Submits a Fristerstreckung to the SG Kantonales Steueramt portal

const PORTAL_URL = "https://egate.ksta.sg.ch:8080/abx-tax/api/fristerstreckung/fristeingabe";

// Env vars (VITE_ prefix works for Vercel build-time vars, plain names for server-side)
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || "https://uawgpxcihixqxqxxbjak.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, apikey");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Optional auth check via Supabase JWT
    const authHeader = req.headers["authorization"];
    if (authHeader && SUPABASE_ANON_KEY) {
      const token = authHeader.replace("Bearer ", "");
      const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      });
      if (!verifyRes.ok) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { registernummer, uid, loginType, verlaengerungsDatum, fristId } = req.body;

    if (!registernummer || !verlaengerungsDatum) {
      return res.status(400).json({
        error: "registernummer und verlaengerungsDatum sind erforderlich",
      });
    }

    // loginType: "UID" (CHE-Nummer), "VEREIN" (Vereinsname ohne UID)
    const effectiveLoginType = loginType || (uid ? "UID" : "VEREIN");
    const credential = uid || "";

    // Basic Auth: base64(credential:registernummer)
    const basicAuth = Buffer.from(`${credential}:${registernummer}`).toString("base64");

    // Call SG portal
    const portalRes = await fetch(PORTAL_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        fristerstreckunglogintype: effectiveLoginType,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ verlaengerungsDatum }),
    });

    const responseText = await portalRes.text();
    let portalData;
    try {
      portalData = JSON.parse(responseText);
    } catch {
      portalData = { raw: responseText };
    }

    const bewilligt = portalData.entscheid === "BEWILLIGT";

    // Optional: update Supabase record directly via service key
    if (fristId && SUPABASE_SERVICE_KEY) {
      const updateData = {
        einreichen_notiz: bewilligt
          ? `Bewilligt bis ${portalData.verlaengerungsDatum ?? verlaengerungsDatum}`
          : `Abgelehnt: ${portalData.bemerkung ?? "Fehler"}`,
      };
      if (bewilligt) {
        const [y, m, d] = verlaengerungsDatum.split("-");
        updateData.einreichen_datum = `${d}.${m}.${y}`;
      }
      await fetch(`${SUPABASE_URL}/rest/v1/fristen?id=eq.${fristId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(updateData),
      });
    }

    return res.status(200).json({
      bewilligt,
      entscheid: portalData.entscheid ?? null,
      bemerkung: portalData.bemerkung ?? null,
      companyName: portalData.companyName ?? null,
      verlaengerungsDatum: portalData.verlaengerungsDatum ?? null,
      steuerjahrBegin: portalData.steuerjahrBegin ?? null,
      steuerjahrEnde: portalData.steuerjahrEnde ?? null,
      registerNummer: portalData.registerNummer ?? registernummer,
    });
  } catch (err) {
    console.error("portal-sg-fristeingabe error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
