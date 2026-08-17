// ===========================================================================
// Anmeldung im smartis Telefon.
//
// Warum ueberhaupt? Bisher lief der Client mit dem oeffentlichen anon-
// Schluessel und einer von Hand eingetragenen profileId. Das hatte zwei
// Nachteile, die zusammengehoeren:
//
//   1. Sicherheit: ein oeffentlicher Schluessel kann keinen privaten Kanal
//      abonnieren. Solange sich niemand anmeldet, muss der Anruf-Kanal
//      oeffentlich bleiben -- und damit koennte jeder mithoeren (Befund
//      OFF-01 in security/befunde.json).
//
//   2. Rollout: profileId und controlSecret mussten pro Person von Hand in
//      eine config.json geschrieben werden. Mit Anmeldung kommen beide aus
//      dem eigenen Profil -- Installation ohne Handarbeit.
//
// Die Sitzung wird auf der Platte abgelegt, damit man sich nicht bei jedem
// Start neu anmelden muss. Wo Windows es hergibt, verschluesselt mit
// safeStorage (DPAPI, an das Windows-Konto gebunden) -- dieselbe Technik wie
// im Passwortspeicher von LoginPilot. Faellt safeStorage aus, wird bewusst
// NICHT im Klartext gespeichert, sondern gar nicht: dann meldet man sich eben
// wieder an. Ein Klartext-Token auf der Platte waere ein stiller Rueckschritt.
// ===========================================================================
const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");

function createAuth({ supabaseUrl, anonKey, userDataPath, log = () => {} }) {
  const { createClient } = require("@supabase/supabase-js");
  const datei = path.join(userDataPath, "sitzung.dat");

  // Ablage im Format, das supabase-js erwartet (getItem/setItem/removeItem).
  const ablage = {
    getItem() {
      try {
        const roh = fs.readFileSync(datei);
        if (!safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(roh);
      } catch {
        return null;
      }
    },
    setItem(_schluessel, wert) {
      try {
        if (!safeStorage.isEncryptionAvailable()) {
          log("⚠️ Verschluesselung nicht verfuegbar -- Sitzung wird NICHT gespeichert.");
          return;
        }
        fs.writeFileSync(datei, safeStorage.encryptString(wert));
      } catch (e) {
        log("⚠️ Sitzung konnte nicht gespeichert werden:", e.message);
      }
    },
    removeItem() {
      try { fs.unlinkSync(datei); } catch { /* war schon weg */ }
    },
  };

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      storage: ablage,
      storageKey: "smartis-phone",
      persistSession: true,
      autoRefreshToken: true,
      // Kein Browser -- es gibt keine URL, aus der ein Token zu lesen waere.
      detectSessionInUrl: false,
    },
  });

  // Realtime muss das Benutzer-Token kennen, sonst bleibt der private Kanal
  // verschlossen. supabase-js macht das je nach Version selbst -- wir setzen
  // es zusaetzlich explizit, damit es nicht von der Version abhaengt.
  async function realtimeToken(session) {
    try {
      await supabase.realtime.setAuth(session?.access_token ?? null);
    } catch (e) {
      log("setAuth fehlgeschlagen:", e.message);
    }
  }

  supabase.auth.onAuthStateChange((ereignis, session) => {
    log("Anmeldung:", ereignis, session?.user?.email ?? "-");
    realtimeToken(session);
  });

  return {
    supabase,

    async sitzung() {
      const { data } = await supabase.auth.getSession();
      if (data?.session) await realtimeToken(data.session);
      return data?.session ?? null;
    },

    async anmelden(email, passwort) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(email || "").trim(),
        password: String(passwort || ""),
      });
      if (error) return { ok: false, fehler: error.message };
      await realtimeToken(data.session);
      return { ok: true };
    },

    async abmelden() {
      try { await supabase.auth.signOut(); } catch { /* egal */ }
      ablage.removeItem();
      await realtimeToken(null);
    },

    // Alles, was der Client bisher aus der config.json las -- jetzt aus dem
    // eigenen Profil. telefonie_control_secret ist durch RLS ohnehin nur fuer
    // die eigene Zeile lesbar.
    async eigenesProfil() {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, internal_extension, peoplefone_user_id, telefonie_control_secret")
        .eq("id", u.user.id)
        .maybeSingle();
      if (error) { log("Profil nicht lesbar:", error.message); return null; }
      return data ?? null;
    },
  };
}

module.exports = { createAuth };
