import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const {
      frist_id,
      customer_name,
      kanton,
      sp_jahr,
      gewuenschte_frist,
      ablehnungsgrund,
      screenshot_base64,
      user_email,
    } = await req.json();

    if (!frist_id || !user_email || !ablehnungsgrund) {
      return new Response(JSON.stringify({ error: "frist_id, user_email und ablehnungsgrund sind erforderlich" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Screenshot + Notiz auf der Frist speichern (KEIN einreichen_datum!) ──
    const updateData: Record<string, string> = {
      einreichen_notiz: `ABGELEHNT: ${ablehnungsgrund}`,
    };
    if (screenshot_base64) {
      updateData.einreichen_screenshot = screenshot_base64;
    }

    const { error: updateError } = await supabase
      .from("fristen")
      .update(updateData)
      .eq("id", frist_id);

    if (updateError) {
      console.error("Frist-Update Fehler:", updateError);
    }

    // ── 2. Email via Microsoft Graph senden ──
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
    const fromAddress = "support@artis-gmbh.ch";

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
      }
    );

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      console.error("Token-Fehler:", tokenData);
      return new Response(JSON.stringify({ error: "Microsoft Token fehlgeschlagen", frist_updated: !updateError }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Email-Inhalt aufbauen ──
    const screenshotHtml = screenshot_base64
      ? `<br><img src="${screenshot_base64}" style="max-width:600px;border:1px solid #ddd;border-radius:4px;" alt="Portal-Screenshot"/>`
      : "";

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:600px;">
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px 20px;border-radius:4px;margin-bottom:20px;">
          <strong style="color:#dc2626;font-size:15px;">⚠️ Fristverlängerung abgelehnt</strong>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;width:40%">Kunde</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${customer_name || "–"}</td></tr>
          <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;">Kanton / SP-Jahr</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${kanton || "–"} / ${sp_jahr || "–"}</td></tr>
          <tr><td style="padding:6px 12px;background:#f9fafb;font-weight:600;">Gewünschte Frist</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${gewuenschte_frist || "–"}</td></tr>
          <tr><td style="padding:6px 12px;background:#fef2f2;font-weight:600;color:#dc2626;">Ablehnungsgrund</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#dc2626;">${ablehnungsgrund}</td></tr>
        </table>

        <p style="font-size:13px;color:#6b7280;">
          Der Screenshot wurde zur Dokumentation auf der Frist gespeichert.<br>
          Die Frist ist <strong>nicht</strong> als eingereicht markiert worden.
        </p>

        ${screenshotHtml}

        <hr style="margin:24px 0;border-color:#e5e7eb;">
        <p style="color:#9ca3af;font-size:11px;">Artis MailFlow – Automatische Benachrichtigung | support@artis-gmbh.ch</p>
      </div>
    `;

    const emailPayload = {
      message: {
        subject: `⚠️ Fristverlängerung abgelehnt – ${customer_name || "Unbekannt"} (${kanton} SP ${sp_jahr})`,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: [{ emailAddress: { address: user_email } }],
        from: { emailAddress: { address: fromAddress, name: "Artis MailFlow" } },
        replyTo: [{ emailAddress: { address: fromAddress, name: "Artis MailFlow" } }],
      },
      saveToSentItems: true,
    };

    const sendResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${fromAddress}/sendMail`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      }
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error("Graph API Fehler:", errorText);
      return new Response(JSON.stringify({ error: "Email-Versand fehlgeschlagen", details: errorText, frist_updated: !updateError }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      frist_updated: !updateError,
      email_sent_to: user_email,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Fehler:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
