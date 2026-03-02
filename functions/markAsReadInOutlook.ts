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

    // Get mail via service role (mail may be created by microsoft_outlook_email, not base44 email)
    const mail = await base44.asServiceRole.entities.MailItem.filter({ id: mail_id });
    if (!mail[0]) {
      return Response.json({ error: 'Mail not found' }, { status: 404 });
    }

    // Verify the mail belongs to the authenticated user (either base44 email or outlook email)
    const mailOwner = mail[0].created_by;
    const userEmails = [user.email, user.microsoft_outlook_email].filter(Boolean);
    if (user.role !== 'admin' && !userEmails.includes(mailOwner)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const outlookId = mail[0].outlook_id;
    if (!outlookId) {
      return Response.json({ error: 'No outlook_id found' }, { status: 400 });
    }

    // Get access token
    let accessToken = user.microsoft_access_token;
    const tokenExpiry = user.microsoft_token_expiry || 0;

    if (!accessToken || Date.now() > tokenExpiry) {
      const refreshToken = user.microsoft_refresh_token;
      if (!refreshToken) {
        throw new Error('Not connected to Outlook');
      }

      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Deno.env.get('MICROSOFT_CLIENT_ID'),
            client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET'),
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite User.Read'
          })
        }
      );

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(`Token Error: ${errorData.error_description || errorData.error}`);
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      await base44.asServiceRole.entities.User.update(user.id, {
        microsoft_access_token: tokens.access_token,
        microsoft_refresh_token: tokens.refresh_token,
        microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
      });
    }

    // Mark as read in Outlook
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${outlookId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          isRead: true
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[MARK READ] Error ${response.status}:`, errorText);
      throw new Error(`Failed to mark as read in Outlook: ${response.status}`);
    }

    // Update local record via service role (mail may be owned by outlook email)
    await base44.asServiceRole.entities.MailItem.update(mail_id, { is_read: true });

    return Response.json({
      success: true,
      message: 'Marked as read in Outlook and MailFlow'
    });
  } catch (error) {
    console.error(`[MARK READ FATAL]`, error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});