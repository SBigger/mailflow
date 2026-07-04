import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// Wir importieren ImapFlow direkt aus dem npm-Repository
import { ImapFlow } from "npm:imapflow";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // CORS Preflight-Requests abfangen
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const body = await req.json();

        const host = body.imap_host;
        let port = parseInt(body.imap_port || "993");
        const email = body.imap_user;
        const password = body.imap_password;

        if (!host || !email || !password) {
            return new Response(
                JSON.stringify({ success: false, error: "Fehlende Pflichtangaben." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const client = new ImapFlow({
            host: host,
            port: port,
            secure: body.imap_ssl != false,
            auth: {
                user: email,
                pass: password
            },
            tls: {
                rejectUnauthorized: false
            },
            logger: false,
            connectionTimeout: 15000,
            greetingTimeout: 15000
        });

        await client.connect();
        await client.logout();

        return new Response(
            JSON.stringify({ success: true, message: "Verbindung erfolgreich hergestellt!" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err: any) {
        console.log("error: ", JSON.stringify(err));
        return new Response(
            JSON.stringify({ success: false, error: `Verbindung fehlgeschlagen: ${err.message || err}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
})