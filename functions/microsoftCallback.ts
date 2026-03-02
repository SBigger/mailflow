import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // user ID

    if (!code) {
      return new Response('Authorization failed', { status: 400 });
    }

    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
    const tenantId = Deno.env.get('MICROSOFT_TENANT_ID');
    const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI');

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite User.Read'
        })
      }
    );

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      return Response.json({ error: tokens.error_description }, { status: 400 });
    }

    // Get Microsoft user profile to store the Outlook email
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();

    await base44.asServiceRole.entities.User.update(state, {
      microsoft_access_token: tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token,
      microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000),
      microsoft_outlook_email: profile.userPrincipalName || profile.mail
    });

    const host = req.headers.get('host');
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const appOrigin = `${protocol}://${host}`;
    
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${appOrigin}/MailKanban?outlook_connected=true`
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});