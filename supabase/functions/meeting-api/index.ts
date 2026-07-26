// ===========================================================================
// meeting-api -- stellt LiveKit-Zugangstoken fuer Besprechungen aus.
//
// Auth: requireUser aus _shared/auth.ts -- prueft den Supabase-JWT
// SERVERSEITIG (Signatur via auth.getUser, kein blosses Dekodieren) und
// verlangt ein Mitarbeiterprofil. verify_jwt bleibt AN (Default), ABER:
// verify_jwt laesst auch den anon-Key durch -- requireUser ist die eigentliche
// Huerde (gleiche Lehre wie in telefonie-transfer dokumentiert).
//
// PHASE 1 (intern): Nur angemeldete Mitarbeitende, jeder darf jeden Raum
// betreten, dessen Namen er kennt. Das ist bewusst so: alle Beteiligten sind
// authentifiziert, und es gibt noch keine Gastlinks. Mit Phase 2 kommen
// Einladungstoken, Warteraum und eine meetings-Tabelle dazu -- DANN wird hier
// gegen die Datenbank geprueft, statt Raumnamen frei zu akzeptieren.
//
// ⚠️ Das API-Secret verlaesst diese Function nie. Der Client bekommt nur das
// fertig signierte, kurzlebige Token.
//
// Deploy: supabase functions deploy meeting-api --project-ref <ref>
// Secrets: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
// ===========================================================================
import { requireUser, jsonResponse, corsHeaders } from "../_shared/auth.ts";

const TOKEN_TTL_SECONDS = 60 * 60 * 6; // 6 h -- deckt auch lange Sitzungen ab;
                                       // LiveKit erneuert die Verbindung selbst,
                                       // die TTL betrifft nur den Erstzutritt.

// Raumnamen bewusst eng begrenzt: keine Leerzeichen, keine Sonderzeichen --
// so kann ein Raumname nie als Pfad oder in einem Header Unfug anrichten.
const ROOM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// LiveKit erwartet ein HS256-JWT: iss = API-Key, sub = Identitaet,
// video = Berechtigungen (VideoGrant). Es gibt im Repo keine JWT-Bibliothek,
// darum hier von Hand -- crypto.subtle ist in Deno vorhanden.
async function signAccessToken(
  apiKey: string,
  apiSecret: string,
  opts: { identity: string; name: string; room: string; metadata?: Record<string, unknown> },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: opts.identity,
    nbf: now - 10,          // kleine Toleranz gegen Uhr-Abweichungen
    exp: now + TOKEN_TTL_SECONDS,
    name: opts.name,
    ...(opts.metadata ? { metadata: JSON.stringify(opts.metadata) } : {}),
    video: {
      room: opts.room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      // Bildschirmfreigabe ausdruecklich erlaubt -- Sascha-Vorgabe
      // 2026-07-27: auch Kunden muessen ihren Bildschirm teilen koennen.
      // Gilt ab Phase 2 unveraendert fuer Gaeste.
      canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"],
    },
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (auth.response) return auth.response;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "token");

    const url = Deno.env.get("LIVEKIT_URL");
    const apiKey = Deno.env.get("LIVEKIT_API_KEY");
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
    if (!url || !apiKey || !apiSecret) {
      console.error("meeting-api: LIVEKIT_URL/API_KEY/API_SECRET fehlen");
      return jsonResponse({ error: "Videodienst ist nicht eingerichtet." }, 500);
    }

    if (action === "token") {
      const room = String(body.room || "").trim();
      if (!ROOM_PATTERN.test(room)) {
        return jsonResponse({ error: "Ungültiger Raumname." }, 400);
      }

      // Anzeigename aus dem Mitarbeiterprofil holen -- der Client soll ihn
      // nicht selbst bestimmen koennen (sonst kann sich jemand als jemand
      // anderes ausgeben).
      let displayName = auth.user!.email ?? "Mitarbeiter";
      try {
        const { data } = await auth.admin!
          .from("profiles").select("full_name").eq("id", auth.user!.id).single();
        if (data?.full_name) displayName = data.full_name;
      } catch { /* Anzeigename ist nicht kritisch */ }

      const token = await signAccessToken(apiKey, apiSecret, {
        identity: `staff:${auth.user!.id}`,
        name: displayName,
        room,
        metadata: { guest: false, userId: auth.user!.id },
      });

      return jsonResponse({ token, url, identity: `staff:${auth.user!.id}`, name: displayName });
    }

    return jsonResponse({ error: `Unbekannte Aktion: ${action}` }, 400);
  } catch (e) {
    console.error("meeting-api:", e);
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
