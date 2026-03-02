import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Nur Admins können Benutzer löschen' }, { status: 403 });
    }

    const { userId, transferToId } = await req.json();

    if (!userId) {
      return Response.json({ error: 'Benutzer-ID erforderlich' }, { status: 400 });
    }

    // Benutzer zu löschenden abrufen
    const userToDelete = await base44.entities.User.get(userId);
    if (!userToDelete) {
      return Response.json({ error: 'Benutzer nicht gefunden' }, { status: 404 });
    }

    // Tasks übertragen falls transferToId vorhanden, sonst löschen
    const tasks = await base44.entities.Task.filter({ assignee: userToDelete.email });
    const tasksArray = Array.isArray(tasks) ? tasks : (tasks ? [tasks] : []);
    if (transferToId) {
      for (const task of tasksArray) {
        await base44.entities.Task.update(task.id, { assignee: transferToId });
      }
    } else {
      for (const task of tasksArray) {
        await base44.asServiceRole.entities.Task.delete(task.id);
      }
    }

    // Kunden: mandatsleiter_id übertragen falls transferToId vorhanden, sonst leeren
    const mandantKunden = await base44.entities.Customer.filter({ mandatsleiter_id: userId });
    const mandantArray = Array.isArray(mandantKunden) ? mandantKunden : (mandantKunden ? [mandantKunden] : []);
    for (const k of mandantArray) {
      await base44.entities.Customer.update(k.id, { mandatsleiter_id: transferToId || null });
    }

    // Kunden: sachbearbeiter_id übertragen falls transferToId vorhanden, sonst leeren
    const sachKunden = await base44.entities.Customer.filter({ sachbearbeiter_id: userId });
    const sachArray = Array.isArray(sachKunden) ? sachKunden : (sachKunden ? [sachKunden] : []);
    for (const k of sachArray) {
      await base44.entities.Customer.update(k.id, { sachbearbeiter_id: transferToId || null });
    }

    // MailItems dieses Nutzers löschen
    const mails = await base44.entities.MailItem.filter({ created_by: userToDelete.email });
    const mailsArray = Array.isArray(mails) ? mails : (mails ? [mails] : []);
    for (const mail of mailsArray) {
      await base44.asServiceRole.entities.MailItem.delete(mail.id);
    }

    // SyncState dieses Nutzers löschen
    const syncStates = await base44.entities.SyncState.filter({ user_email: userToDelete.email });
    const syncArray = Array.isArray(syncStates) ? syncStates : (syncStates ? [syncStates] : []);
    for (const sync of syncArray) {
      await base44.asServiceRole.entities.SyncState.delete(sync.id);
    }

    // Benutzer im Service-Role löschen (Admin-Funktion)
    await base44.asServiceRole.entities.User.delete(userId);

    return Response.json({ success: true, message: `Benutzer ${userToDelete.email} gelöscht` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});