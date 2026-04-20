import * as msal from "@azure/msal-browser";

// ── Konfiguration ──────────────────────────────────────────────────────────────
const TENANT_ID  = "cc857d96-3c6e-45ba-afbf-c20d0946d2be"; // Artis Treuhand GmbH
const CLIENT_ID  = "4e6116e1-9b0b-4f91-8c97-041bf8eb6d87"; // Smartis Power BI App
const REDIRECT_URI = window.location.origin;                 // https://smartis.me

const msalConfig = {
  auth: {
    clientId:    CLIENT_ID,
    authority:   `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: REDIRECT_URI,
  },
  cache: {
    cacheLocation:       "localStorage",
    storeAuthStateInCookie: false,
  },
};

const PBI_SCOPES = ["https://analysis.windows.net/powerbi/api/Report.Read.All"];

let _msalInstance = null;

function getMsal() {
  if (!_msalInstance) {
    _msalInstance = new msal.PublicClientApplication(msalConfig);
  }
  return _msalInstance;
}

// Muss einmal beim App-Start aufgerufen werden (verarbeitet Redirect-Response)
export async function initMsal() {
  const instance = getMsal();
  await instance.initialize();
  await instance.handleRedirectPromise();
}

// Gibt Bearer-Token zurück (silent → redirect falls nötig)
export async function getPowerBIToken() {
  const instance = getMsal();
  const accounts  = instance.getAllAccounts();

  if (accounts.length > 0) {
    try {
      const result = await instance.acquireTokenSilent({
        scopes:  PBI_SCOPES,
        account: accounts[0],
      });
      return result.accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError) {
        // Silent fehlgeschlagen → interaktiver Login nötig
        await instance.acquireTokenRedirect({ scopes: PBI_SCOPES });
        return null; // Redirect läuft, kommt zurück
      }
      throw e;
    }
  } else {
    // Kein Account → Login starten
    await instance.acquireTokenRedirect({ scopes: PBI_SCOPES });
    return null;
  }
}

// Ist User bei Microsoft angemeldet?
export function isPowerBIAuthenticated() {
  return getMsal().getAllAccounts().length > 0;
}

// Logout
export function powerBILogout() {
  const instance  = getMsal();
  const accounts  = instance.getAllAccounts();
  if (accounts.length > 0) {
    instance.logoutRedirect({ account: accounts[0] });
  }
}
