import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { ticket_id, message_body } = await req.json();
    if (!ticket_id || !message_body) {
      return new Response(JSON.stringify({ error: "ticket_id and message_body required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load ticket to get recipient email
    const { data: ticket } = await supabaseClient
      .from("support_tickets")
      .select("*")
      .eq("id", ticket_id)
      .single();

    if (!ticket) return new Response(JSON.stringify({ error: "Ticket not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

    // Get Microsoft access token using client credentials
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!;
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

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
      return new Response(JSON.stringify({ error: "Failed to get access token", details: tokenData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const accessToken = tokenData.access_token;
    const fromAddress = "support@artis-gmbh.ch";

    // Format email body as HTML
    const htmlBody = message_body.replace(/\n/g, "<br>");

    // Send email via Microsoft Graph
    const emailPayload = {
      message: {
        subject: `Re: ${ticket.title}`,
        body: {
          contentType: "HTML",
          content: `<p>${htmlBody}</p><br><hr><p style="color:#888;font-size:12px;">Artis Treuhand GmbH | support@artis-gmbh.ch</p>`,
        },
        toRecipients: [{ emailAddress: { address: ticket.from_email, name: ticket.from_name || ticket.from_email } }],
        from: { emailAddress: { address: fromAddress, name: "Artis Treuhand GmbH" } },
        replyTo: [{ emailAddress: { address: fromAddress, name: "Artis Treuhand GmbH" } }],
      },
      saveToSentItems: true,
    };

    const sendResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${fromAddress}/sendMail`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      }
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error("Graph API error:", errorText);
      return new Response(JSON.stringify({ error: "Failed to send email", details: errorText }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Update ticket: mark that an email reply was sent
    await supabaseClient
      .from("support_tickets")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", ticket_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

