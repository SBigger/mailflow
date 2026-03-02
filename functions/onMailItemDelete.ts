import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Wenn Mail gelöscht wird → auch in Outlook löschen

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { event, data } = await req.json();

  if (event.type !== 'delete') {
    return Response.json({ success: true });
  }

  const outlook_id = data?.outlook_id;

  if (!outlook_id) {
    console.log('[onMailItemDelete] Keine outlook_id, nichts zu tun in Outlook');
    return Response.json({ success: true });
  }

  // Wenn skip_outlook_delete gesetzt → nicht in Outlook löschen (z.B. bei Reset-Sync)
  if (data?.skip_outlook_delete) {
    console.log('[onMailItemDelete] skip_outlook_delete=true, überspringe Outlook-Löschung');
    return Response.json({ success: true });
  }

  console.log(`[onMailItemDelete] Lösche in Outlook: ${outlook_id}`);

  // === ACCESS TOKEN ===
  let accessToken = user.microsoft_access_token;
  const tokenExpiry = user.microsoft_token_expiry || 0;

  if (!accessToken || Date.now() > tokenExpiry - 60000) {
    const refreshToken = user.microsoft_refresh_token;
    if (!refreshToken) {
      console.warn('[onMailItemDelete] Kein Outlook verbunden');
      return Response.json({ success: true });
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
          scope: 'offline_access Mail.Read Mail.ReadBasic Mail.ReadWrite User.Read'
        })
      }
    );

    if (!tokenRes.ok) {
      console.warn('[onMailItemDelete] Token refresh fehlgeschlagen');
      return Response.json({ success: true });
    }

    const tokens = await tokenRes.json();
    accessToken = tokens.access_token;
    await base44.asServiceRole.entities.User.update(user.id, {
      microsoft_access_token: tokens.access_token,
      microsoft_refresh_token: tokens.refresh_token || refreshToken,
      microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
    }).catch(e => console.warn(`Token update fehlgeschlagen: ${e.message}`));
  }

  // === LÖSCHE IN OUTLOOK ===
  const deleteRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${outlook_id}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (deleteRes.ok || deleteRes.status === 404) {
    console.log(`[onMailItemDelete] Erfolgreich gelöscht: ${outlook_id}`);
    return Response.json({ success: true });
  } else {
    console.warn(`[onMailItemDelete] Fehler ${deleteRes.status}`);
    return Response.json({ success: true }); // Nicht fehlen lassen, nur warnen
  }
});