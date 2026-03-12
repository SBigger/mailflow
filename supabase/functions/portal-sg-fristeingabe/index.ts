import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_URL = "https://egate.ksta.sg.ch:8080/abx-tax/api/fristerstreckung/fristeingabe";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const { registernummer, uid, loginType, verlaengerungsDatum, fristId } = await req.json();

    if (!registernummer || !verlaengerungsDatum) {
      return new Response(
        JSON.stringify({ error: "registernummer und verlaengerungsDatum sind erforderlich" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine login type and credential
    // loginType: "UID" (default with CHE-number), "VEREIN" (association with name)
    const effectiveLoginType = loginType || (uid ? "UID" : "VEREIN");
    const credential = uid || ""; // For VEREIN: uid field holds the name

    // Build Basic Auth: base64(credential:registernummer)
    // Format as used by portal: base64(uid + ":" + registernummer)
    const basicAuth = btoa(`${credential}:${registernummer}`);

    // Call the SG portal API
    const portalResponse = await fetch(PORTAL_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "fristerstreckunglogintype": effectiveLoginType,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ verlaengerungsDatum }),
    });

    const responseText = await portalResponse.text();
    let portalData: Record<string, unknown>;

    try {
      portalData = JSON.parse(responseText);
    } catch {
      portalData = { raw: responseText };
    }

    const bewilligt = portalData.entscheid === "BEWILLIGT";

    // If fristId provided, update Supabase record
    if (fristId) {
      const updateData: Record<string, unknown> = {
        einreichen_notiz: bewilligt
          ? `Bewilligt bis ${portalData.verlaengerungsDatum ?? verlaengerungsDatum}`
          : `Abgelehnt: ${portalData.bemerkung ?? "Unbekannter Fehler"}`,
      };
      if (bewilligt) {
        // Convert YYYY-MM-DD to DD.MM.YYYY for einreichen_datum
        const parts = verlaengerungsDatum.split("-");
        updateData.einreichen_datum = parts.length === 3
          ? `${parts[2]}.${parts[1]}.${parts[0]}`
          : verlaengerungsDatum;
      }

      await supabaseClient
        .from("fristen")
        .update(updateData)
        .eq("id", fristId);
    }

    return new Response(
      JSON.stringify({
        bewilligt,
        entscheid: portalData.entscheid,
        bemerkung: portalData.bemerkung ?? null,
        companyName: portalData.companyName ?? null,
        verlaengerungsDatum: portalData.verlaengerungsDatum ?? null,
        steuerjahrBegin: portalData.steuerjahrBegin ?? null,
        steuerjahrEnde: portalData.steuerjahrEnde ?? null,
        registerNummer: portalData.registerNummer ?? registernummer,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("portal-sg-fristeingabe error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
