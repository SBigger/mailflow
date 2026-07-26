// ═══════════════════════════════════════════════════════════════════════
// Telefonie-Simulator -- spielt echte peoplefone-Ereignisfolgen nach
//
// Warum: peoplefone liefert Ereignisse mehrfach, verspaetet, unsortiert und
// pro Anruf teils unter ZWEI callIds (Rufgruppen-Beine). Jeder dieser Faelle
// hat uns am 2026-07-26 einen sichtbaren Fehler beschert. Statt auf den
// naechsten echten Anruf zu warten, laesst sich hier jede Folge auf Knopfdruck
// nachstellen -- gegen die laufende Karte (apps/telefonie-tray) und das
// Web-Panel gleichzeitig, da beide denselben Kanal hoeren.
//
// Aufruf:
//   node scripts/telefonie-sim.mjs                 # Liste aller Szenarien
//   node scripts/telefonie-sim.mjs rapid-ringing   # ein Szenario
//   node scripts/telefonie-sim.mjs alle            # alle nacheinander
//
// Erwartetes Verhalten steht bei jedem Szenario -- beim Durchlauf danebenlegen
// und die Karte beobachten (automatisch pruefen laesst es sich nicht, die
// Wirkung ist ein Fenster auf dem Bildschirm).
// ═══════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://uawgpxcihixqxqxxbjak.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ch = supabase.channel("telefonie-calls", { config: { broadcast: { self: true } } });

const KUNDE = { id: null, company_name: "Simulations-Kunde AG" };
const DOSSIER = {
  pendenzen: [
    { id: "p1", title: "MWST-Abrechnung Q2 einreichen", due_date: "2026-07-20" },
    { id: "p2", title: "Jahresabschluss besprechen", due_date: "2026-08-15" },
  ],
  docs: [
    { id: "d1", name: "Bilanz 2025.pdf", updated_at: "2026-07-24" },
    { id: "d2", name: "Steuererklaerung 2025.pdf", updated_at: "2026-07-18" },
  ],
};

async function send(call) {
  await ch.send({ type: "broadcast", event: "incoming_call", payload: { targetUserId: null, call } });
  console.log("   →", call.id, call.status, call.dir || "in");
}

const SZENARIEN = {
  "rapid-ringing": {
    beschreibung: "6 Klingel-Ereignisse im 100ms-Takt (schneller als die Karte laden kann)",
    erwartet: "EINE Karte, kein Flackern, keine Listener-Warnung im Protokoll",
    async run() {
      const c = { id: "sim-rapid", peerNumber: "041 111 11 11", peerName: "Schnellfeuer", customer: KUNDE, dossier: DOSSIER };
      for (let i = 0; i < 6; i++) { await send({ ...c, status: "ringing" }); await sleep(100); }
      await sleep(2000);
      await send({ ...c, status: "answered" });
      await sleep(1500);
      await send({ ...c, status: "ended" });
    },
  },

  "late-ended": {
    beschreibung: "Anruf endet, Karte blendet aus, danach 4 verspaetete 'beendet'-Wiederholungen",
    erwartet: "Karte bleibt nach dem Ausblenden WEG (kein erneutes Aufpoppen)",
    async run() {
      const c = { id: "sim-late", peerNumber: "041 222 22 22", peerName: "Nachzuegler", customer: KUNDE };
      await send({ ...c, status: "ringing" });
      await sleep(1500);
      await send({ ...c, status: "ended" });
      await sleep(6000);
      for (let i = 0; i < 4; i++) { await send({ ...c, status: "ended" }); await sleep(1200); }
    },
  },

  "zwei-beine": {
    beschreibung: "EIN Anruf unter ZWEI callIds (Rufgruppen-Bein + Leitungs-Bein)",
    erwartet: "Karte baut sich NICHT neu auf; das Ende des zweiten Beins beendet das Gespraech nicht",
    async run() {
      const nr = "041 333 33 33";
      const a = { id: "sim-bein-A", peerNumber: nr, peerName: "Zwei Beine", customer: KUNDE, dossier: DOSSIER };
      const b = { id: "sim-bein-B", peerNumber: nr, peerName: "Zwei Beine", customer: KUNDE };
      await send({ ...a, status: "ringing" });
      await sleep(1200);
      await send({ ...a, status: "answered" });
      await sleep(800);
      await send({ ...b, status: "ended" }); // Bein B stirbt beim Abnehmen -- darf nichts tun
      await sleep(8000);
      await send({ ...a, status: "ended" });
    },
  },

  "rueckwaerts": {
    beschreibung: "Verspaetetes 'klingelt' NACH 'angenommen'",
    erwartet: "Karte bleibt auf 'Im Gespraech' (kein Ruecksprung, kein Annehmen-Knopf)",
    async run() {
      const c = { id: "sim-rueck", peerNumber: "041 444 44 44", peerName: "Rueckwaerts", customer: KUNDE };
      await send({ ...c, status: "ringing" });
      await sleep(1200);
      await send({ ...c, status: "answered" });
      await sleep(800);
      await send({ ...c, status: "ringing" });
      await sleep(8000);
      await send({ ...c, status: "ended" });
    },
  },

  "zwei-anrufe": {
    beschreibung: "Anruf 1 endet, Sekunden spaeter klingelt Anruf 2 (andere Nummer)",
    erwartet: "Karte wechselt sichtbar auf Anruf 2 (bleibt nicht auf 'beendet' haengen)",
    async run() {
      const a = { id: "sim-a", peerNumber: "041 555 55 55", peerName: "Erster", customer: KUNDE };
      const b = { id: "sim-b", peerNumber: "041 666 66 66", peerName: "Zweiter", customer: KUNDE, dossier: DOSSIER };
      await send({ ...a, status: "ringing" });
      await sleep(1500);
      await send({ ...a, status: "ended" });
      await sleep(1500); // absichtlich INNERHALB der Nachlade-Sperre
      await send({ ...b, status: "ringing" });
      await sleep(6000);
      await send({ ...b, status: "ended" });
    },
  },

  "ausgehend": {
    beschreibung: "Ausgehender Anruf (dir: out)",
    erwartet: "KEINE Karte -- selbst gewaehlt braucht keinen Screen-Pop",
    async run() {
      const c = { id: "sim-out", dir: "out", peerNumber: "041 777 77 77", peerName: "Ausgehend", customer: KUNDE };
      await send({ ...c, status: "ringing" });
      await sleep(2000);
      await send({ ...c, status: "answered" });
      await sleep(4000);
      await send({ ...c, status: "ended" });
    },
  },

  "unbekannt": {
    beschreibung: "Anrufer ohne Kundenzuordnung",
    erwartet: "Karte zeigt nur die Nummer, keinen Dossier-Bereich",
    async run() {
      const c = { id: "sim-unbekannt", peerNumber: "+41 44 123 45 67" };
      await send({ ...c, status: "ringing" });
      await sleep(6000);
      await send({ ...c, status: "ended" });
    },
  },
};

const wunsch = process.argv[2];

ch.subscribe(async (status) => {
  if (status !== "SUBSCRIBED") return;

  if (!wunsch) {
    console.log("\nSzenarien:\n");
    for (const [name, s] of Object.entries(SZENARIEN)) {
      console.log(`  ${name.padEnd(14)} ${s.beschreibung}`);
      console.log(`  ${" ".repeat(14)} erwartet: ${s.erwartet}\n`);
    }
    console.log("Aufruf: node scripts/telefonie-sim.mjs <name> | alle\n");
    process.exit(0);
  }

  const liste = wunsch === "alle" ? Object.keys(SZENARIEN) : [wunsch];
  for (const name of liste) {
    const s = SZENARIEN[name];
    if (!s) { console.error("Unbekanntes Szenario:", name); process.exit(1); }
    console.log(`\n▶ ${name} — ${s.beschreibung}`);
    console.log(`  erwartet: ${s.erwartet}`);
    await s.run();
    if (liste.length > 1) await sleep(6000); // Karte auslaufen lassen
  }
  console.log("\nfertig\n");
  process.exit(0);
});
