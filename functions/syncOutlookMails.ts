import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.microsoft_access_token || !user?.microsoft_outlook_email) {
      return Response.json({ error: 'Outlook nicht verbunden' }, { status: 400 });
    }

    const accessToken = user.microsoft_access_token;
    const syncDays = user.sync_days || 60;
    const outlookEmail = user.microsoft_outlook_email;

    // Bestimme Start-Datum für Sync
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - syncDays);
    const fromDateISO = fromDate.toISOString();

    // Microsoft Graph API: Mails abrufen
    let allMessages = [];
    let nextLink = null;
    let url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=receivedDateTime ge ${fromDateISO}&$orderby=receivedDateTime desc&$top=250&$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,bodyPreview,body,receivedDateTime,hasAttachments,isRead`;

    while (url) {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        return Response.json({ error: `Microsoft API error: ${response.status}`, details: errText }, { status: response.status });
      }

      const data = await response.json();
      allMessages = allMessages.concat(data.value || []);
      url = data['@odata.nextLink'];
    }

    // Extrahiere Kanban-Spalten für Benutzer
    const columns = await base44.entities.KanbanColumn.filter({ created_by: user.email });
    const columnsArray = Array.isArray(columns) ? columns : (columns ? [columns] : []);
    const inboxColumn = columnsArray.find(c => c.name.toLowerCase() === 'posteingang' || c.name.toLowerCase() === 'inbox') || columnsArray[0];

    if (!inboxColumn) {
      return Response.json({ error: 'Keine Kanban-Spalte gefunden' }, { status: 400 });
    }

    // Domain-basierte Tags abrufen
    const domainRules = await base44.entities.DomainTagRule.filter({ created_by: user.email });
    const domainRulesArray = Array.isArray(domainRules) ? domainRules : (domainRules ? [domainRules] : []);

    // Verarbeite Mails und erstelle MailItems
    const mailsToCreate = [];
    for (const msg of allMessages) {
      const senderEmail = msg.from?.emailAddress?.address || '';
      const senderName = msg.from?.emailAddress?.name || senderEmail;

      // Bestimme Tags basierend auf Domain
      const tags = [];
      const senderDomain = senderEmail.split('@')[1];
      if (senderDomain) {
        const rule = domainRulesArray.find(r => r.domain === `@${senderDomain}`);
        if (rule) {
          tags.push(rule.tag);
        }
      }

      mailsToCreate.push({
        subject: msg.subject || '(Kein Betreff)',
        sender_name: senderName,
        sender_email: senderEmail,
        to: msg.toRecipients?.map(r => r.emailAddress?.address).filter(Boolean).join(', ') || '',
        cc: msg.ccRecipients?.map(r => r.emailAddress?.address).filter(Boolean).join(', ') || '',
        bcc: msg.bccRecipients?.map(r => r.emailAddress?.address).filter(Boolean).join(', ') || '',
        body_preview: msg.bodyPreview || '',
        body: msg.body?.content || '',
        received_date: msg.receivedDateTime,
        column_id: inboxColumn.id,
        is_read: msg.isRead || false,
        is_replied: false,
        is_completed: false,
        has_attachments: msg.hasAttachments || false,
        tags: tags,
        outlook_id: msg.id
      });
    }

    // Bulk-Create MailItems
    if (mailsToCreate.length > 0) {
      await base44.entities.MailItem.bulkCreate(mailsToCreate);
    }

    // Speichere Microsoft Delta Link für nächsten Sync
    const deltaResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (deltaResponse.ok) {
      const deltaData = await deltaResponse.json();
      const deltaLink = deltaData['@odata.deltaLink'];
      if (deltaLink) {
        await base44.auth.updateMe({ microsoft_delta_link: deltaLink });
      }
    }

    return Response.json({
      success: true,
      mailsImported: mailsToCreate.length,
      syncedFrom: fromDateISO
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});