// Supabase Edge Function (Deno)
// POST /portal-sg-fristeingabe
// Submits a Fristerstreckung to the SG Kantonales Steueramt portal

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PORTAL_URL = "https://egate.ksta.sg.ch:8080/abx-tax/api/fristerstreckung/fristeingabe";

// Umgebungsvariablen in Supabase Edge Functions werden über Deno.env abgerufen
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// CORS Headers für die Antwort
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser } } = await supabase.auth.getUser(token)
    if (!authUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    try {
        // Body auslesen
        const { registernummer, uid, loginType, verlaengerungsDatum, fristId } = await req.json();

        if (!registernummer || !verlaengerungsDatum) {
            return new Response(
                JSON.stringify({ error: "registernummer und verlaengerungsDatum sind erforderlich" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // loginType bestimmen
        const effectiveLoginType = loginType || (uid ? "UID" : "VEREIN");
        const credential = uid || "";

        // Basic Auth via btoa (Deno/Web standard anstelle von Node.js Buffer)
        const basicAuth = btoa(`${credential}:${registernummer}`);

        // SG Portal aufrufen
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
        let portalData: any;
        try {
            portalData = JSON.parse(responseText);
        } catch {
            portalData = { raw: responseText };
        }

        const bewilligt = portalData.entscheid === "BEWILLIGT";

        // Fehlermeldung auslesen
        let bemerkung = portalData.bemerkung ?? portalData.message ?? portalData.meldung
            ?? portalData.fehler ?? portalData.error ?? null;

        if (!bewilligt && !bemerkung) {
            const snippet = String(portalData.raw ?? "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 300);
            if (snippet) {
                bemerkung = `Portal HTTP ${portalRes.status} – ${snippet}`;
            } else if (portalRes.status === 401 || portalRes.status === 403) {
                bemerkung = `Portal HTTP ${portalRes.status} – Login abgelehnt (Registernummer / UID / Login-Typ prüfen)`;
            } else {
                bemerkung = `Portal HTTP ${portalRes.status} (keine Rückmeldung)`;
            }
        }

        // Optional: Supabase Record direkt updaten via Service Key
        if (fristId) {
            const updateData: any = {
                einreichen_notiz: bewilligt
                    ? `Bewilligt bis ${portalData.verlaengerungsDatum ?? verlaengerungsDatum}`
                    : `Abgelehnt: ${portalData.bemerkung ?? "Fehler"}`,
            };
            if (bewilligt) {
                const [y, m, d] = verlaengerungsDatum.split("-");
                updateData.einreichen_datum = `${d}.${m}.${y}`;
            }

            const { error } = await supabase
                .from("fristen")
                .update(updateData)
                .eq("id", fristId);

            if (error) {
                console.error("Fehler beim Updaten der Frist:", error.message);
            }
        }

        // Antwort zurückgeben
        return new Response(
            JSON.stringify({
                bewilligt,
                entscheid: portalData.entscheid ?? null,
                bemerkung,
                portalStatus: portalRes.status,
                companyName: portalData.companyName ?? null,
                verlaengerungsDatum: portalData.verlaengerungsDatum ?? null,
                steuerjahrBegin: portalData.steuerjahrBegin ?? null,
                steuerjahrEnde: portalData.steuerjahrEnde ?? null,
                registerNummer: portalData.registerNummer ?? registernummer,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err: any) {
        console.error("portal-sg-fristeingabe error:", err);
        return new Response(
            JSON.stringify({ error: err.message || String(err) }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});