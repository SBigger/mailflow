import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mail_id } = await req.json();

    if (!mail_id) {
      return Response.json({ error: 'mail_id required' }, { status: 400 });
    }

    // Get mail to find outlook_id
    const mail = await base44.entities.MailItem.get(mail_id);
    
    if (!mail.outlook_id) {
      return Response.json({ error: 'No outlook_id found' }, { status: 400 });
    }

    // Get access token
    let accessToken = user.microsoft_access_token;
    const tokenExpiry = user.microsoft_token_expiry;

    // Refresh token if expired
    if (!accessToken || Date.now() > tokenExpiry) {
      const refreshToken = user.microsoft_refresh_token;
      if (!refreshToken) {
        return Response.json({ error: 'Not connected to Outlook' }, { status: 400 });
      }

      const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
      const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
      const tenantId = Deno.env.get('MICROSOFT_TENANT_ID');

      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'Mail.Read Mail.ReadBasic offline_access'
          })
        }
      );

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      await base44.asServiceRole.entities.User.update(user.id, {
        microsoft_access_token: tokens.access_token,
        microsoft_refresh_token: tokens.refresh_token,
        microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
      });
    }

    // Get message with attachments
    const messageResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${mail.outlook_id}?$select=hasAttachments,id`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (!messageResponse.ok) {
      const error = await messageResponse.text();
      return Response.json({ error: `Failed to get message: ${error}` }, { status: 500 });
    }

    const message = await messageResponse.json();

    if (!message.hasAttachments) {
      return Response.json({ attachments: [] });
    }

    // Get attachments
    const attachmentsResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${mail.outlook_id}/attachments`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (!attachmentsResponse.ok) {
      const error = await attachmentsResponse.text();
      return Response.json({ error: `Failed to get attachments: ${error}` }, { status: 500 });
    }

    const attachmentsData = await attachmentsResponse.json();
    const attachments = attachmentsData.value.filter(att => att['@odata.type'] === '#microsoft.graph.fileAttachment').map(att => ({
      id: att.id,
      name: att.name,
      contentBytes: att.contentBytes,
      contentType: att.contentType
    }));

    return Response.json({ attachments });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});