import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { user_id, full_name } = await req.json();

    if (!user_id || full_name === undefined) {
      return Response.json({ error: 'user_id and full_name required' }, { status: 400 });
    }

    await base44.asServiceRole.entities.User.update(user_id, { full_name });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
