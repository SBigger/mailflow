import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const usersArr = Array.isArray(users) ? users : (users ? [users] : []);

    const results = [];
    for (const u of usersArr) {
      await base44.asServiceRole.entities.User.update(u.id, {
        microsoft_delta_link: null,
        microsoft_next_link: null,
        initial_sync_completed: false,
        sync_status: '',
        sync_progress: null
      });
      results.push(u.email);
      console.log(`[ADMIN RESET] Delta links cleared for: ${u.email}`);
    }

    return Response.json({ success: true, reset_users: results });
  } catch (error) {
    console.error('[ADMIN RESET ERROR]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});