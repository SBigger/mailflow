import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Dieser Endpunkt macht NUR den Reset (alle Mails löschen + deltaLink zurücksetzen).
// Der eigentliche Sync danach läuft über syncOutlookMailsWorker (seitenweise).
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.microsoft_access_token && !user.microsoft_refresh_token) {
    return Response.json({ error: 'Nicht mit Outlook verbunden' }, { status: 400 });
  }

  const createdBy = user.outlook_email || user.email;
  console.log(`[RESET] Start für: ${createdBy}`);

  // === 1. ALLE MAILITEMS LÖSCHEN (mit skip_outlook_delete Flag) ===
  let deletedTotal = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.MailItem.filter(
      { created_by: createdBy }, 'created_date', 200, 0
    );
    const arr = Array.isArray(batch) ? batch : (batch ? [batch] : []);
    if (arr.length === 0) break;

    // Erst skip_outlook_delete setzen, dann löschen
    await Promise.all(arr.map(m =>
      base44.asServiceRole.entities.MailItem.update(m.id, { skip_outlook_delete: true })
    ));
    await Promise.all(arr.map(m => base44.asServiceRole.entities.MailItem.delete(m.id)));
    deletedTotal += arr.length;
    console.log(`[RESET] ${deletedTotal} Mails gelöscht...`);
    if (deletedTotal >= 10000) break;
  }

  // === 2. DELTA-LINK ZURÜCKSETZEN ===
  await base44.asServiceRole.entities.User.update(user.id, { microsoft_delta_link: null });
  console.log(`[RESET] deltaLink zurückgesetzt. Total gelöscht: ${deletedTotal}`);

  return Response.json({
    success: true,
    deleted: deletedTotal
  });
});