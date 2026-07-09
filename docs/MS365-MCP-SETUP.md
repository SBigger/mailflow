# Microsoft 365 MCP (Softeria) – Senden/Weiterleiten aus der Web-Umgebung

Ziel: Claude Code **on the web** (kurzlebiger Cloud-Container) soll Outlook-Mails
nicht nur lesen, sondern auch **senden/weiterleiten** können.

## Warum es Extra-Aufwand braucht

- Der von claude.ai bereitgestellte **„Microsoft 365"-Directory-Connector ist read-only**
  (nur Suche/Lesen: `outlook_email_search`, `read_resource`, Kalender, Teams, SharePoint).
- Der lokal installierte **Softeria `@softeria/ms-365-mcp-server`** kann senden, wird aber in
  der Web-Umgebung **nicht** automatisch mitgezogen (`claude mcp list` ist dort leer).
- Softeria ist **delegated only** – es gibt **keinen** App-only/Client-Secret-Daemon-Flow.
  Für headless bleibt nur „Bring Your Own Token" (`MS365_MCP_OAUTH_TOKEN`), und Access-Tokens
  leben nur ~1 Stunde.

Lösung in diesem Repo: `.mcp.json` startet den Softeria-Server über einen Wrapper, der beim
Start via `scripts/ms365-token.mjs` aus einem gespeicherten **Refresh-Token** ein frisches
Access-Token zieht.

## Einmalige Einrichtung

### 1. Azure App-Registrierung (Public Client)
1. Azure Portal → *App registrations* → *New registration*.
2. *Supported account types*: passend zu eurem Tenant.
3. *Authentication* → *Add a platform* → **Mobile and desktop applications** →
   Redirect-URI `http://localhost` aktivieren; *Allow public client flows* = **Yes**.
4. *API permissions* → *Microsoft Graph* → **Delegated**: `Mail.Send`, `Mail.ReadWrite`,
   `offline_access` (und nach Bedarf `Mail.Read`, `User.Read`). Admin-Consent erteilen.
5. *Application (client) ID* und *Directory (tenant) ID* notieren.

### 2. Einmalig ein Refresh-Token erzeugen
Interaktiv einloggen (z. B. lokal), damit ein delegiertes Refresh-Token entsteht, z. B.:
```bash
MS365_MCP_CLIENT_ID=<client-id> npx -y @softeria/ms-365-mcp-server --login
```
Das dabei entstehende **Refresh-Token** sichern (aus dem MSAL-Cache / Login-Ergebnis).

### 3. Secrets in der Web-Umgebung hinterlegen
In den Environment-Settings (siehe https://code.claude.com/docs/en/claude-code-on-the-web):
- `MS365_MCP_CLIENT_ID`     – Application (client) ID
- `MS365_MCP_TENANT_ID`     – Tenant-ID (oder `common`)
- `MS365_MCP_REFRESH_TOKEN` – das Refresh-Token aus Schritt 2
- optional `MS365_MCP_CLIENT_SECRET` – nur bei Confidential-Client-App

## Wie es zur Laufzeit funktioniert
- `.mcp.json` → Server `ms365` wird beim Session-Start geladen.
- Der Wrapper ruft `node scripts/ms365-token.mjs` auf → holt ein frisches Access-Token
  (OAuth2 `refresh_token`-Grant gegen `login.microsoftonline.com`).
- Das Token wird als `MS365_MCP_OAUTH_TOKEN` gesetzt, dann startet der Softeria-Server.

Danach stehen u. a. diese Tools bereit:
`forward-mail-message`, `send-mail-message`, `send-mail-message-reply`,
`send-mail-message-reply-all`.

## Bekannte Einschränkung
Azure **rotiert** das Refresh-Token bei jeder Einlösung. Der Wrapper speichert das neue Token
nicht zurück (Container ist ephemer). Bei regelmäßiger Nutzung funktioniert das dank Overlap-
Fenster; liegt die Umgebung sehr lange still, muss `MS365_MCP_REFRESH_TOKEN` neu erzeugt werden.
