#!/usr/bin/env node
// Mint a fresh Microsoft Graph access token for the Softeria ms-365-mcp-server.
//
// The Softeria server is delegated-only (no app-only/client-credentials flow),
// so for headless/web sessions it needs a valid user access token via
// MS365_MCP_OAUTH_TOKEN. Access tokens expire after ~1 hour, so we mint one at
// MCP-server launch from a long-lived refresh token using the OAuth2
// refresh_token grant. Prints the access token to stdout (nothing else).
//
// Required environment variables (set these as secrets in the web environment):
//   MS365_MCP_CLIENT_ID      Azure app (public client) application/client ID
//   MS365_MCP_REFRESH_TOKEN  Delegated refresh token obtained once via interactive login
// Optional:
//   MS365_MCP_TENANT_ID      Tenant ID or 'common' (default: 'common')
//   MS365_MCP_CLIENT_SECRET  Only for confidential-client app registrations
//   MS365_MCP_SCOPE          Space-separated scopes (default below)

const clientId = process.env.MS365_MCP_CLIENT_ID;
const refreshToken = process.env.MS365_MCP_REFRESH_TOKEN;
const tenant = process.env.MS365_MCP_TENANT_ID || 'common';
const clientSecret = process.env.MS365_MCP_CLIENT_SECRET;
const scope =
  process.env.MS365_MCP_SCOPE ||
  'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite offline_access';

function die(msg) {
  process.stderr.write(`ms365-token: ${msg}\n`);
  process.exit(1);
}

if (!clientId) die('MS365_MCP_CLIENT_ID is not set');
if (!refreshToken) die('MS365_MCP_REFRESH_TOKEN is not set');

const body = new URLSearchParams({
  client_id: clientId,
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
  scope,
});
if (clientSecret) body.set('client_secret', clientSecret);

const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    die(
      `token endpoint returned ${res.status}: ${
        data.error_description || data.error || JSON.stringify(data)
      }`
    );
  }
  // NOTE: Azure rotates the refresh token on each redemption. The old one stays
  // valid for an overlap window, but if this environment sits idle beyond the
  // refresh-token lifetime the stored MS365_MCP_REFRESH_TOKEN must be renewed.
  process.stdout.write(data.access_token);
} catch (err) {
  die(err && err.message ? err.message : String(err));
}
