import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mail_id, reply_text, tag, reminder } = await req.json();

    if (!mail_id || !reply_text) {
      return Response.json({ error: 'mail_id and reply_text required' }, { status: 400 });
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

    // Get original message to get recipient info
    const originalMsgResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${mail.outlook_id}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (!originalMsgResponse.ok) {
      const error = await originalMsgResponse.text();
      return Response.json({ error: `Failed to get original message: ${error}` }, { status: 500 });
    }

    const originalMsg = await originalMsgResponse.json();

    // Get user's email signature
    const userSignature = user.email_signature || '\n\nFreundliche Grüsse\n\nSascha Bigger\ndipl. Treuhandexperte\n\nArtis Treuhand GmbH\nTrischlistrasse 10 | CH-9400 Rorschach\nTel +41 71 511 50 00\nwww.artis-gmbh.ch';
    
    // Format exactly like sendOutlookMail
    const fullContent = reply_text + '\n\n' + userSignature;

    // Format recipient exactly like sendOutlookMail
    const recipients = [{
      emailAddress: { address: originalMsg.from.emailAddress.address }
    }];

    // Message payload exactly like sendOutlookMail
    const messagePayload = {
      message: {
        subject: originalMsg.subject.startsWith('RE:') ? originalMsg.subject : `RE: ${originalMsg.subject}`,
        body: {
          contentType: 'HTML',
          content: fullContent.replace(/\n/g, '<br>')
        },
        toRecipients: recipients
      },
      saveToSentItems: true
    };

    const sendMailResponse = await fetch(
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

    if (!sendMailResponse.ok) {
      const errorText = await sendMailResponse.text();
      return Response.json({ 
        error: 'Failed to send reply', 
        status: sendMailResponse.status,
        details: errorText 
      }, { status: 500 });
    }

    // Mark as replied in Outlook using Extended Property
    // PR_LAST_VERB_EXECUTED (0x1081) with value 102 = replied
    const markRepliedResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${mail.outlook_id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          singleValueExtendedProperties: [{
            id: 'Integer 0x1081',
            value: '102'
          }]
        })
      }
    );

    if (!markRepliedResponse.ok) {
      console.error('[REPLY] Failed to mark as replied in Outlook:', await markRepliedResponse.text());
    }

    // Mark as replied in local DB
    await base44.entities.MailItem.update(mail_id, { is_replied: true });

    // Save reply to MailItem if tag or reminder is set
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

        const recipientName = originalMsg.from.emailAddress.name || originalMsg.from.emailAddress.address.split('@')[0];
        
        await base44.entities.MailItem.create({
          subject: originalMsg.subject.startsWith('RE:') ? originalMsg.subject : `RE: ${originalMsg.subject}`,
          sender_name: user.full_name,
          sender_email: user.current_mailbox || user.email,
          to: originalMsg.from.emailAddress.address,
          recipient_email: originalMsg.from.emailAddress.address,
          recipient_name: recipientName,
          body: reply_text,
          body_preview: reply_text.substring(0, 100),
          received_date: new Date().toISOString(),
          column_id: sentColumn.id,
          mailbox: 'personal',
          is_read: true,
          is_replied: true,
          tags: tag ? [tag] : [],
          reminder_date: reminder ? new Date(reminder).toISOString() : null,
          priority: 'normal',
          has_attachments: false
        });
      } catch (e) {
        console.warn('Failed to save reply to mailitem:', e.message);
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});