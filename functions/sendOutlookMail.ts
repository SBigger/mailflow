import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { to, subject, body, tag, reminder } = await req.json();

    if (!to || !subject || !body) {
      return Response.json({ error: 'to, subject and body are required' }, { status: 400 });
    }

    // Get access token
    let accessToken = user.microsoft_access_token;
    const tokenExpiry = user.microsoft_token_expiry || 0;

    // Refresh token if expired
    if (!accessToken || Date.now() > parseInt(tokenExpiry)) {
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
            scope: 'Mail.Send Mail.ReadWrite offline_access'
          })
        }
      );

      const tokens = await tokenResponse.json();
      
      if (!tokens.access_token) {
        return Response.json({ error: 'Token refresh failed', details: tokens }, { status: 401 });
      }
      
      accessToken = tokens.access_token;

      await base44.asServiceRole.entities.User.update(user.id, {
        microsoft_access_token: tokens.access_token,
        microsoft_refresh_token: tokens.refresh_token || user.microsoft_refresh_token,
        microsoft_token_expiry: (Date.now() + (tokens.expires_in * 1000)).toString()
      });
    }

    // Get user's email signature
    const userSignature = user.email_signature || '\n\nFreundliche Grüsse\n\nSascha Bigger\ndipl. Treuhandexperte\n\nArtis Treuhand GmbH\nTrischlistrasse 10 | CH-9400 Rorschach\nTel +41 71 511 50 00\nwww.artis-gmbh.ch';
    
    // Determine content type based on signature format
    const isHtml = userSignature.includes('<');
    const fullContent = isHtml 
      ? body.replace(/\n/g, '<br>') + '<br><br>' + userSignature
      : body + '\n\n' + userSignature;

    // Parse recipients (can be comma-separated)
    const recipients = to.split(',').map(email => ({
      emailAddress: { address: email.trim() }
    }));

    // Send email using Microsoft Graph API
    const messagePayload = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: fullContent.replace(/\n/g, '<br>')
        },
        toRecipients: recipients
      },
      saveToSentItems: true
    };

    const sendResponse = await fetch(
      'https://graph.microsoft.com/v1.0/me/sendMail',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
      }
    );

    const responseText = await sendResponse.text();

    if (!sendResponse.ok) {
      console.error('Send mail failed:', sendResponse.status, responseText);
      return Response.json({ 
        error: 'Failed to send email', 
        status: sendResponse.status,
        details: responseText 
      }, { status: sendResponse.status });
    }

    // Always save sent email to MailItem
    try {
      // Get or create "Gesendet" column
      const allColumns = await base44.asServiceRole.entities.KanbanColumn.filter({ 
        name: 'Gesendet',
        created_by: user.email
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

      const recipientName = to.split('@')[0].replace(/\./g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      await base44.entities.MailItem.create({
        subject: subject,
        sender_name: user.full_name,
        sender_email: user.current_mailbox || user.email,
        to: to,
        recipient_email: to,
        recipient_name: recipientName,
        body: body,
        body_preview: body.substring(0, 100),
        received_date: new Date().toISOString(),
        column_id: sentColumn.id,
        mailbox: 'personal',
        is_read: true,
        tags: tag ? [tag] : [],
        reminder_date: reminder ? new Date(reminder).toISOString() : null,
        priority: 'normal',
        has_attachments: false
      });
    } catch (e) {
      console.warn('Failed to save sent email:', e.message);
    }

    return Response.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});