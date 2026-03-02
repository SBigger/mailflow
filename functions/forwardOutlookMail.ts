import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mail_id, to_recipients, comment, tag, reminder } = await req.json();

    if (!mail_id || !to_recipients) {
      return Response.json({ error: 'mail_id and to_recipients required' }, { status: 400 });
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
            scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read'
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

    // Get user's email signature
    const userSignature = user.email_signature || '\n\nFreundliche Grüsse\n\nSascha Bigger\ndipl. Treuhandexperte\n\nArtis Treuhand GmbH\nTrischlistrasse 10 | CH-9400 Rorschach\nTel +41 71 511 50 00\nwww.artis-gmbh.ch';
    
    // Format comment with signature
    const fullComment = comment ? (comment + '\n\n' + userSignature) : userSignature;

    // Parse recipients
    const recipients = to_recipients.split(',').map(email => ({
      emailAddress: { address: email.trim() }
    }));

    // Forward message using Graph API - attachments are automatically included
    const forwardPayload = {
      comment: fullComment.replace(/\n/g, '<br>'),
      toRecipients: recipients
    };

    const forwardResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${mail.outlook_id}/forward`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(forwardPayload)
      }
    );

    if (!forwardResponse.ok) {
      const errorText = await forwardResponse.text();
      return Response.json({ 
        error: 'Failed to forward mail', 
        status: forwardResponse.status,
        details: errorText 
      }, { status: 500 });
    }

    // Save forwarded mail to MailItem if tag or reminder is set
    if (tag || reminder) {
      try {
        // Get or create "Gesendet" column
        const createdBy = user.outlook_email || user.email;
        const allColumns = await base44.asServiceRole.entities.KanbanColumn.filter({ 
          name: 'Gesendet',
          created_by: createdBy
        });
        
        let sentColumn = allColumns[0];
        if (!sentColumn) {
          sentColumn = await base44.asServiceRole.entities.KanbanColumn.create({
            name: 'Gesendet',
            order: 999,
            color: '#10b981',
            mailbox: 'personal'
          });
        }

        await base44.entities.MailItem.create({
          subject: mail.subject.startsWith('FW:') ? mail.subject : `FW: ${mail.subject}`,
          sender_name: user.full_name,
          sender_email: user.current_mailbox || user.email,
          to: to_recipients,
          recipient_email: to_recipients.split(',')[0].trim(),
          recipient_name: to_recipients.split(',')[0].trim().split('@')[0],
          body: comment || 'Weitergeleitet',
          body_preview: (comment || 'Weitergeleitet').substring(0, 100),
          received_date: new Date().toISOString(),
          column_id: sentColumn.id,
          mailbox: 'personal',
          is_read: true,
          tags: tag ? [tag] : [],
          reminder_date: reminder ? new Date(reminder).toISOString() : null,
          priority: 'normal',
          has_attachments: mail.has_attachments
        });
      } catch (e) {
        console.warn('Failed to save forwarded mail to mailitem:', e.message);
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});