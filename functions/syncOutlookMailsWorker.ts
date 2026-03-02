import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`[SYNC] Start für: ${user.email}`);

  // === TOKEN REFRESH ===
  let accessToken = user.microsoft_access_token;
  const tokenExpiry = user.microsoft_token_expiry || 0;

  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = user.microsoft_refresh_token;
    if (!refreshToken) {
      return Response.json({ error: 'Nicht mit Outlook verbunden' }, { status: 400 });
    }

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${Deno.env.get('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: Deno.env.get('MICROSOFT_CLIENT_ID'),
          client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET'),
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite Mail.Send User.Read'
        })
      }
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      return Response.json({ error: `Token Error: ${err.error_description || err.error}` }, { status: 400 });
    }

    const tokens = await tokenRes.json();
    accessToken = tokens.access_token;
    await base44.asServiceRole.entities.User.update(user.id, {
      microsoft_access_token: tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token || refreshToken,
      microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
    });
    console.log(`[SYNC] Token erneuert`);
  }

  // === INITIAL vs DELTA ===
  const deltaLink = user.microsoft_delta_link;
  const isDelta = !!(deltaLink && deltaLink.trim() !== '');

  let currentUrl;
  let isInitial = false;

  if (isDelta) {
    console.log(`[SYNC] DELTA - verwende deltaLink`);
    currentUrl = deltaLink;
  } else {
    const syncDays = user.sync_days || 60;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - syncDays);
    const fromDateISO = fromDate.toISOString();
    isInitial = true;
    console.log(`[SYNC] INITIAL - letzte ${syncDays} Tage`);
    currentUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,subject,from,sender,hasAttachments,isRead,importance,bodyPreview&$filter=receivedDateTime+ge+${fromDateISO}&$top=999`;
  }

  // === DEDUPLICATION (nur beim ersten Sync) ===
  const createdBy = user.email;
  const existingOutlookIds = new Map();
  if (isInitial) {
    console.log(`[SYNC] Lade bestehende outlook_ids für ${createdBy}...`);
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.MailItem.filter(
        { created_by: createdBy }, 'created_date', 500, skip
      );
      const arr = Array.isArray(batch) ? batch : (batch ? [batch] : []);
      for (const m of arr) {
        if (m.outlook_id) existingOutlookIds.set(m.outlook_id, m.id);
      }
      if (arr.length < 500) break;
      skip += 500;
    }
    console.log(`[SYNC] ${existingOutlookIds.size} bestehende Mails geladen`);
  }

  // === KANBAN SPALTE ===
  const [domainRulesRaw, allColumns] = await Promise.all([
    base44.asServiceRole.entities.DomainTagRule.filter({ created_by: createdBy }),
    base44.asServiceRole.entities.KanbanColumn.filter({ created_by: createdBy })
  ]);

  const domainRules = Array.isArray(domainRulesRaw) ? domainRulesRaw : (domainRulesRaw ? [domainRulesRaw] : []);
  const columnsArr = Array.isArray(allColumns) ? allColumns : (allColumns ? [allColumns] : []);

  let outlookColumn = columnsArr.find(col => col.name === 'Outlook');
  if (!outlookColumn) {
    outlookColumn = await base44.entities.KanbanColumn.create({
      name: 'Outlook', order: 0, color: '#0078d4', mailbox: 'personal'
    });
    console.log(`[SYNC] Outlook-Spalte erstellt: ${outlookColumn.id}`);
  }

  // === EINEN BATCH HOLEN ===
  const response = await fetch(currentUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[SYNC] MS Graph Error ${response.status}: ${errText}`);
    return Response.json({ error: `MS Graph Error ${response.status}: ${errText}` }, { status: 500 });
  }

  const data = await response.json();
  const messages = data.value || [];
  const nextLink = data['@odata.nextLink'] || null;
  const newDeltaLink = data['@odata.deltaLink'] || null;

  console.log(`[SYNC] Batch: ${messages.length} Nachrichten, nextLink=${!!nextLink}, deltaLink=${!!newDeltaLink}`);

  // === BATCH VERARBEITEN ===
  const toInsert = [];
  const toUpdate = [];
  const toDeleteOutlookIds = [];

  for (const msg of messages) {
    if (msg['@odata.removed']) {
      toDeleteOutlookIds.push(msg.id);
      continue;
    }

    const outlookId = msg.id;

    // Sender ermitteln
    let senderName = 'Unbekannt';
    let senderEmail = '';
    if (msg.from?.emailAddress) {
      senderName = msg.from.emailAddress.name || msg.from.emailAddress.address || 'Unbekannt';
      senderEmail = (msg.from.emailAddress.address || '').toLowerCase();
    } else if (msg.sender?.emailAddress) {
      senderName = msg.sender.emailAddress.name || msg.sender.emailAddress.address || 'Unbekannt';
      senderEmail = (msg.sender.emailAddress.address || '').toLowerCase();
    }

    const subject = (msg.subject || '').trim() || '(Kein Betreff)';

    // Domain-Tags
    const autoTags = [];
    if (senderEmail) {
      for (const rule of domainRules) {
        const domain = rule.domain.toLowerCase().replace(/^@/, '');
        if (senderEmail.endsWith('@' + domain) || senderEmail.includes('@' + domain)) {
          if (!autoTags.includes(rule.tag)) autoTags.push(rule.tag);
        }
      }
    }

    const mailData = {
      outlook_id: outlookId,
      subject,
      sender_name: senderName,
      sender_email: senderEmail,
      received_date: msg.receivedDateTime || new Date().toISOString(),
      is_read: msg.isRead || false,
      has_attachments: msg.hasAttachments || false,
      body_preview: msg.bodyPreview || '',
      mailbox: 'personal',
      priority: msg.importance === 'high' ? 'high' : msg.importance === 'low' ? 'low' : 'normal',
      tags: autoTags,
    };

    if (existingOutlookIds.has(outlookId)) {
      // Delta: Update (aber column_id NICHT überschreiben!)
      if (isDelta) {
        const existingId = existingOutlookIds.get(outlookId);
        toUpdate.push({ id: existingId, data: { is_read: msg.isRead || false, subject, body_preview: msg.bodyPreview || '' } });
      }
      // Initial: Duplikat überspringen
    } else {
      // Neu einfügen
      toInsert.push({ ...mailData, column_id: outlookColumn.id });
      existingOutlookIds.set(outlookId, true);
    }
  }

  // === DB OPERATIONEN ===
  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  const ops = [];

  if (toInsert.length > 0) {
    ops.push(
      base44.entities.MailItem.bulkCreate(toInsert).then(() => {
        inserted = toInsert.length;
        console.log(`[SYNC] ${inserted} Mails eingefügt als user: ${user.email}`);
      })
    );
  }

  if (toUpdate.length > 0) {
    ops.push(
      Promise.all(toUpdate.map(u => base44.entities.MailItem.update(u.id, u.data))).then(() => {
        updated = toUpdate.length;
        console.log(`[SYNC] ${updated} Mails aktualisiert`);
      })
    );
  }

  if (toDeleteOutlookIds.length > 0) {
    for (const outlookId of toDeleteOutlookIds) {
      if (existingOutlookIds.has(outlookId)) {
        const existingId = existingOutlookIds.get(outlookId);
        if (existingId && existingId !== true) {
          ops.push(base44.entities.MailItem.delete(existingId).then(() => { deleted++; }));
        }
      }
    }
  }

  await Promise.all(ops);

  // === DELTA/NEXT LINK SPEICHERN ===
  const hasMore = !!nextLink;

  if (newDeltaLink) {
    // Finaler deltaLink → für künftige Delta-Syncs speichern
    await base44.asServiceRole.entities.User.update(user.id, {
      microsoft_delta_link: newDeltaLink
    });
    console.log(`[SYNC] deltaLink gespeichert`);
  } else if (nextLink) {
    // Noch weitere Seiten → nextLink als "deltaLink" speichern damit nächster Aufruf dort weitermacht
    await base44.asServiceRole.entities.User.update(user.id, {
      microsoft_delta_link: nextLink
    });
    console.log(`[SYNC] nextLink gespeichert (hasMore=true)`);
  }

  console.log(`[SYNC] Fertig: ${inserted} neu, ${updated} aktualisiert, ${deleted} gelöscht, hasMore=${hasMore}`);

  return Response.json({
    success: true,
    inserted,
    updated,
    deleted,
    hasMore,
    isDelta,
    syncedCount: messages.length
  });
});