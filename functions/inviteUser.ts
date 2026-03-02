import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Nur Admins können Benutzer einladen' }, { status: 403 });
    }

    const { email, role } = await req.json();

    if (!email || !email.trim()) {
      return Response.json({ error: 'E-Mail erforderlich' }, { status: 400 });
    }

    const validRoles = ['admin', 'user', 'task_user'];
    const roleToInvite = validRoles.includes(role) ? role : 'user';
    const platformRole = roleToInvite === 'task_user' ? 'user' : roleToInvite;

    // Einladung via Base44 API
    await base44.users.inviteUser(email.trim(), platformRole);

    // Speichere die Einladung mit der tatsächlichen Rolle in einer Entität
    const invitations = await base44.entities.UserInvitation?.list?.() || [];
    const existing = invitations?.find(inv => inv.email === email.trim());

    if (!existing) {
      try {
        await base44.asServiceRole.entities.UserInvitation?.create?.({
          email: email.trim(),
          role: roleToInvite,
          invited_by: user.email
        });
      } catch (err) {
        // Wenn UserInvitation nicht existiert, ist es ok
      }
    }

    return Response.json({ 
      success: true, 
      message: `Einladung versendet an ${email.trim()}`,
      email: email.trim(),
      role: roleToInvite
    });
  } catch (error) {
    console.error('Invite error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});