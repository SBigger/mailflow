import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    const tenantId = Deno.env.get('MICROSOFT_TENANT_ID');
    const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI');

    const scopes = [
      'offline_access',
      'Mail.Read',
      'Mail.ReadBasic',
      'Mail.ReadWrite',
      'User.Read'
    ].join(' ');

    const authUrl =
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
      `client_id=${clientId}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${user.id}`;

    return Response.json({ authUrl });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});