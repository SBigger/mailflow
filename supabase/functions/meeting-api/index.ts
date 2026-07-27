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
import { requireUser, jsonResponse, corsHeaders, serviceClient } from "../_shared/auth.ts";
import { broadcastRealtime } from "../_shared/telefonie.ts";

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
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: opts.identity,
    nbf: now - 10,          // kleine Toleranz gegen Uhr-Abweichungen
    exp: now + ttlSeconds,
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

// Gast-Aktionen laufen OHNE Mitarbeiter-Anmeldung (der Gast hat ja kein
// Konto). Sie sind bewusst eng: Raumdaten nur rudimentaer, Zutritt erst
// nach ausdruecklicher Freigabe durch den Berater.
const GUEST_ACTIONS = new Set(["guest-info", "guest-knock", "guest-status"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "token");

    const url = Deno.env.get("LIVEKIT_URL");
    const apiKey = Deno.env.get("LIVEKIT_API_KEY");
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
    if (!url || !apiKey || !apiSecret) {
      console.error("meeting-api: LIVEKIT_URL/API_KEY/API_SECRET fehlen");
      return jsonResponse({ error: "Videodienst ist nicht eingerichtet." }, 500);
    }

    // ── Gastweg (ohne Anmeldung) ──────────────────────────────────────────
    if (GUEST_ACTIONS.has(action)) {
      return await handleGuest(action, body, { url, apiKey, apiSecret });
    }

    // ── Ab hier nur angemeldete Mitarbeitende ────────────────────────────
    const auth = await requireUser(req);
    if (auth.response) return auth.response;

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

    // ── Besprechung anlegen ───────────────────────────────────────────────
    // Der Raumname entsteht SERVERSEITIG. Vorher erzeugte ihn der Browser --
    // dann könnte jemand einen bereits benutzten Namen "anlegen" und sich so
    // in eine fremde Besprechung einklinken.
    if (action === "create") {
      const room = "artis-" + zufallsName(10);
      const { data, error } = await auth.admin!
        .from("meetings")
        .insert({
          room_name: room,
          title: String(body.title || "Besprechung").slice(0, 200),
          customer_id: body.customerId || null,
          created_by: auth.user!.id,
          starts_at: body.startsAt || null,
          ends_at: body.endsAt || null,
        })
        .select("id, room_name, title, starts_at")
        .single();
      if (error) {
        console.error("meeting-api create:", error.message);
        return jsonResponse({ error: "Besprechung konnte nicht angelegt werden." }, 500);
      }
      return jsonResponse({ meeting: data });
    }

    // ── Besprechung schliessen ────────────────────────────────────────────
    // ⚠️ Sicherheitsrelevant, nicht bloss Aufräumen: Solange eine Besprechung
    // "offen" ist, bleibt ihr Gästelink gültig -- auch Wochen später. Wer den
    // Link einmal hatte (weitergeleitete Termineinladung!), könnte erneut
    // anklopfen. Schliessen macht den Link endgültig unbrauchbar.
    if (action === "close") {
      const room = String(body.room || "").trim();
      if (!ROOM_PATTERN.test(room)) return jsonResponse({ error: "Ungültiger Raumname." }, 400);
      const { error } = await auth.admin!
        .from("meetings")
        .update({ status: "beendet", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("room_name", room);
      if (error) {
        console.error("meeting-api close:", error.message);
        return jsonResponse({ error: "Konnte nicht geschlossen werden." }, 500);
      }
      return jsonResponse({ ok: true });
    }

    // ── Besprechungen auflisten ──────────────────────────────────────────
    // Zwei Verwendungen:
    //   ohne "rooms" -> die laufenden Besprechungen (Überblick)
    //   mit  "rooms" -> der Zustand GENAU dieser Räume. Das braucht die
    //     Übersicht: Ihre Liste "zuletzt benutzt" liegt im Browser und weiss
    //     nichts davon, dass ein Raum inzwischen geschlossen wurde. Ohne
    //     diesen Abgleich verschickt jemand einen längst toten Gästelink und
    //     der Kunde steht vor verschlossener Tür.
    // Wer nicht zurückkommt, ist beendet oder gelöscht -- der Aufrufer sieht
    // das daran, dass sein Raumname in der Antwort fehlt.
    if (action === "list") {
      const rooms = Array.isArray(body.rooms)
        ? (body.rooms as unknown[])
            .filter((r): r is string => typeof r === "string" && ROOM_PATTERN.test(r))
            .slice(0, 50)
        : null;

      let frage = auth.admin!
        .from("meetings")
        .select("id, room_name, title, status, created_at, ended_at");

      if (rooms) {
        if (rooms.length === 0) return jsonResponse({ meetings: [] });
        frage = frage.in("room_name", rooms);
      } else {
        frage = frage.neq("status", "beendet").neq("status", "abgesagt");
      }

      const { data } = await frage
        .order("created_at", { ascending: false })
        .limit(rooms ? 50 : 20);
      return jsonResponse({ meetings: data || [] });
    }

    // ── Wartende auflisten (Nachzügler, die vor dem Beitritt anklopften) ──
    if (action === "waiting") {
      const room = String(body.room || "").trim();
      if (!ROOM_PATTERN.test(room)) return jsonResponse({ error: "Ungültiger Raumname." }, 400);
      const meeting = await findeBesprechung(auth.admin!, room);
      if (!meeting) return jsonResponse({ waiting: [] });
      const { data } = await auth.admin!
        .from("meeting_guests")
        .select("id, display_name, requested_at")
        .eq("meeting_id", meeting.id)
        .is("admitted_at", null)
        .is("rejected_at", null)
        .order("requested_at", { ascending: true });
      return jsonResponse({ waiting: data || [] });
    }

    // ── Zulassen / Abweisen ───────────────────────────────────────────────
    if (action === "admit" || action === "reject") {
      const guestId = String(body.guestId || "");
      if (!guestId) return jsonResponse({ error: "guestId fehlt." }, 400);
      const feld = action === "admit"
        ? { admitted_at: new Date().toISOString(), admitted_by: auth.user!.id }
        : { rejected_at: new Date().toISOString() };
      const { error } = await auth.admin!
        .from("meeting_guests").update(feld).eq("id", guestId);
      if (error) {
        console.error(`meeting-api ${action}:`, error.message);
        return jsonResponse({ error: "Aktion fehlgeschlagen." }, 500);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `Unbekannte Aktion: ${action}` }, 400);
  } catch (e) {
    console.error("meeting-api:", e);
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

// Zufälliger, gut vorlesbarer Raumname (ohne 0/O/1/l/i – die verwechselt man
// am Telefon). 10 Zeichen aus 31 ≈ 49 Bit: nicht erratbar.
function zufallsName(laenge: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(laenge);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function findeBesprechung(admin: ReturnType<typeof serviceClient>, room: string) {
  const { data } = await admin
    .from("meetings")
    .select("id, room_name, title, starts_at, status, lobby_enabled")
    .eq("room_name", room)
    .maybeSingle();
  return data;
}

// ── Gastweg ────────────────────────────────────────────────────────────────
// Bewusst sparsam mit Auskünften: Ein Fremder, der einen Raumnamen errät,
// soll daraus nichts über Mandanten lernen. Darum nur der Titel – kein
// Kundenname, keine Teilnehmerliste, keine Zeiten anderer Besprechungen.
async function handleGuest(
  action: string,
  body: Record<string, unknown>,
  lk: { url: string; apiKey: string; apiSecret: string },
) {
  const admin = serviceClient();

  if (action === "guest-info") {
    const room = String(body.room || "").trim();
    if (!ROOM_PATTERN.test(room)) return jsonResponse({ error: "Ungültiger Link." }, 400);
    const meeting = await findeBesprechung(admin, room);
    if (!meeting || meeting.status === "abgesagt" || meeting.status === "beendet") {
      return jsonResponse({ error: "Diese Besprechung gibt es nicht (mehr)." }, 404);
    }
    return jsonResponse({ title: meeting.title, startsAt: meeting.starts_at, status: meeting.status });
  }

  if (action === "guest-knock") {
    const room = String(body.room || "").trim();
    const name = String(body.name || "").trim().slice(0, 80);
    if (!ROOM_PATTERN.test(room)) return jsonResponse({ error: "Ungültiger Link." }, 400);
    if (name.length < 2) return jsonResponse({ error: "Bitte geben Sie Ihren Namen an." }, 400);

    const meeting = await findeBesprechung(admin, room);
    if (!meeting || meeting.status === "abgesagt" || meeting.status === "beendet") {
      return jsonResponse({ error: "Diese Besprechung gibt es nicht (mehr)." }, 404);
    }

    const { data, error } = await admin
      .from("meeting_guests")
      .insert({ meeting_id: meeting.id, display_name: name })
      .select("id")
      .single();
    if (error) {
      console.error("meeting-api guest-knock:", error.message);
      return jsonResponse({ error: "Anmeldung fehlgeschlagen." }, 500);
    }

    // Den Berater sofort benachrichtigen – ohne das müsste er raten, wann
    // jemand wartet. Enthält bewusst nichts Vertrauliches.
    await broadcastRealtime(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      `meeting-${room}`,
      "guest_knock",
      { guestId: data.id, name },
    );

    return jsonResponse({ guestId: data.id });
  }

  if (action === "guest-status") {
    const guestId = String(body.guestId || "");
    if (!guestId) return jsonResponse({ error: "guestId fehlt." }, 400);

    const { data: gast } = await admin
      .from("meeting_guests")
      .select("id, display_name, admitted_at, rejected_at, meeting_id")
      .eq("id", guestId)
      .maybeSingle();
    if (!gast) return jsonResponse({ state: "unbekannt" }, 404);
    if (gast.rejected_at) return jsonResponse({ state: "abgewiesen" });
    if (!gast.admitted_at) return jsonResponse({ state: "wartet" });

    const { data: meeting } = await admin
      .from("meetings").select("room_name").eq("id", gast.meeting_id).single();
    if (!meeting) return jsonResponse({ state: "unbekannt" }, 404);

    // Zutritt bestätigt → Token ausstellen. Bewusst kurzlebig: Es deckt nur
    // den Verbindungsaufbau ab, LiveKit hält die Sitzung danach selbst.
    // Erneutes Abholen ist erlaubt (sonst sperrt ein Browser-Neuladen aus).
    const token = await signAccessToken(lk.apiKey, lk.apiSecret, {
      identity: `guest:${gast.id}`,
      name: gast.display_name,
      room: meeting.room_name,
      metadata: { guest: true },
    }, 15 * 60);

    await admin.from("meeting_guests")
      .update({ token_issued_at: new Date().toISOString() })
      .eq("id", gast.id).is("token_issued_at", null);

    return jsonResponse({ state: "zugelassen", token, url: lk.url, name: gast.display_name });
  }

  return jsonResponse({ error: `Unbekannte Aktion: ${action}` }, 400);
}
