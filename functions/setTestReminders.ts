import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all user's mails
    const mails = await base44.entities.MailItem.list('-received_date');
    const userMails = mails.filter(m => m.created_by === user.email);

    if (userMails.length === 0) {
      return Response.json({ error: 'Keine Emails gefunden' }, { status: 400 });
    }

    // Set reminders for first 5 emails
    const now = new Date();
    const reminders = [
      new Date(now.getTime() + 24 * 60 * 60 * 1000), // Tomorrow
      new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // In 2 days
      new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // In 3 days
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // Next week
      now, // Today
    ];

    let updated = 0;
    for (let i = 0; i < Math.min(5, userMails.length); i++) {
      await base44.entities.MailItem.update(userMails[i].id, {
        reminder_date: reminders[i].toISOString()
      });
      updated++;
    }

    return Response.json({
      success: true,
      message: `${updated} Emails mit Reminders versehen`,
      updated: updated
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});