// ===========================================================================
// Lokale Uebergabe von Steuerbefehlen an den MicroSIP-Helfer.
//
// Client und Helfer laufen auf demselben PC. Ein Klick auf "Annehmen" musste
// bisher trotzdem zu Supabase reisen, um ein Programm zwei Zentimeter weiter
// zu steuern -- und zwang den Anruf-Kanal, oeffentlich zu bleiben, weil der
// Helfer sich nicht anmelden kann (Befund OFF-01, security/befunde.json).
//
// Named Pipe statt localhost-Port: an einen offenen Port auf 127.0.0.1 kommt
// jede beliebige Webseite heran, denn die Anfrage geht vom Rechner des
// Benutzers aus. An eine Named Pipe kommt kein Browser.
//
// Der Befehl ist derselbe wie ueber die Cloud -- inklusive HMAC-Signatur.
// Der Helfer prueft sie in beiden Faellen; so gibt es nur einen Pruefpfad.
// ===========================================================================
const net = require("net");

const PIPE = "\\\\.\\pipe\\smartis-telefon";
const FRIST_MS = 700; // laenger zu warten hiesse: der Helfer laeuft nicht

// true  = der Helfer hat den Befehl angenommen
// false = kein Helfer da (oder er lehnt ab) -> der Aufrufer nimmt die Cloud
function sendeLokal(befehl) {
  return new Promise((fertig) => {
    let erledigt = false;
    const beenden = (ergebnis) => {
      if (erledigt) return;
      erledigt = true;
      try { sock.destroy(); } catch { /* egal */ }
      fertig(ergebnis);
    };

    const sock = net.createConnection(PIPE);
    const uhr = setTimeout(() => beenden(false), FRIST_MS);

    sock.on("connect", () => sock.write(JSON.stringify(befehl) + "\n"));
    sock.on("data", (d) => {
      clearTimeout(uhr);
      try {
        beenden(JSON.parse(String(d).split("\n")[0])?.ok === true);
      } catch {
        beenden(false);
      }
    });
    // Kein Helfer installiert oder nicht gestartet -- voellig normal.
    sock.on("error", () => { clearTimeout(uhr); beenden(false); });
  });
}

module.exports = { sendeLokal, PIPE };
