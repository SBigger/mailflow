import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mail_id } = await req.json();
    if (!mail_id) {
      return Response.json({ error: 'mail_id required' }, { status: 400 });
    }

    // Get mail details
    const createdBy = user.outlook_email || user.email;
    const mail = await base44.entities.MailItem.filter({ 
      id: mail_id,
      created_by: createdBy 
    });

    if (!mail || mail.length === 0) {
      return Response.json({ error: 'Mail not found' }, { status: 404 });
    }

    const mailItem = mail[0];
    const outlookId = mailItem.outlook_id;

    if (!outlookId) {
      // No Outlook ID - just delete locally
      await base44.entities.MailItem.delete(mail_id);
      return Response.json({ success: true, deleted_locally: true });
    }

    // Get access token
    let accessToken = user.microsoft_access_token;
    const tokenExpiry = user.microsoft_token_expiry || 0;

    if (!accessToken || Date.now() > tokenExpiry) {
      const refreshToken = user.microsoft_refresh_token;
      if (!refreshToken) {
        throw new Error('Not connected to Outlook');
      }

      const tokenResponse = await fetch(
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

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(`Token Error: ${errorData.error_description || errorData.error}`);
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;

      await base44.asServiceRole.entities.User.update(user.id, {
        microsoft_access_token: tokens.access_token,
        microsoft_refresh_token: tokens.refresh_token,
        microsoft_token_expiry: Date.now() + (tokens.expires_in * 1000)
      });
    }

    // Try moving email to deleted items in Outlook
    console.log(`[DELETE MAIL] Attempting to move Outlook email ${outlookId} to trash...`);
    
    // First attempt: Use well-known folder "deleteditems"
    let moveResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${outlookId}/move`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          destinationId: 'deleteditems'
        })
      }
    );

    if (moveResponse.ok) {
      console.log(`[DELETE MAIL] Successfully moved to deleteditems folder`);
    } else {
      const errorText = await moveResponse.text();
      console.warn(`[DELETE MAIL] Move to deleteditems failed (${moveResponse.status}): ${errorText}`);
      
      // Fallback: Try to find the deleted items folder by name
      console.log(`[DELETE MAIL] Attempting fallback: fetching folder list...`);
      const foldersResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      if (foldersResponse.ok) {
        const foldersData = await foldersResponse.json();
        const deletedFolder = foldersData.value?.find(f => 
          f.displayName === 'Deleted Items' || 
          f.displayName === 'Gelöschte Elemente' ||
          f.displayName === 'Corbeille' ||
          f.displayName === 'Elementos eliminados'
        );

        if (deletedFolder) {
          console.log(`[DELETE MAIL] Found deleted folder: ${deletedFolder.displayName} (ID: ${deletedFolder.id})`);
          moveResponse = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages/${outlookId}/move`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                destinationId: deletedFolder.id
              })
            }
          );

          if (moveResponse.ok) {
            console.log(`[DELETE MAIL] Successfully moved to ${deletedFolder.displayName}`);
          } else {
            const moveError = await moveResponse.text();
            console.error(`[DELETE MAIL] Move to ${deletedFolder.displayName} failed: ${moveError}`);
            throw new Error(`Failed to move to deleted items: ${moveError}`);
          }
        } else {
          console.warn(`[DELETE MAIL] Deleted items folder not found in folder list`);
          throw new Error('Deleted items folder not found');
        }
      } else {
        console.error(`[DELETE MAIL] Failed to fetch folder list`);
        throw new Error('Failed to fetch Outlook folders');
      }
    }

    // Delete from local database
    console.log(`[DELETE MAIL] Deleting from MailFlow database...`);
    await base44.entities.MailItem.delete(mail_id);
    console.log(`[DELETE MAIL] Successfully completed - email moved to trash and removed from MailFlow`);

    return Response.json({ 
      success: true, 
      deleted_in_outlook: true,
      deleted_locally: true 
    });

  } catch (error) {
    console.error(`[DELETE MAIL FATAL]`, error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});