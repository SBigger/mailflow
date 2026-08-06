/**
 * Winziger lokaler Server — ohne Fremdpakete.
 *
 * Warum ueberhaupt ein Server: Der Browser blockiert bei einem
 * Datei-Aufruf (file://) die Web Worker, die OCR braucht. Ueber
 * http://localhost laeuft alles.
 *
 * Es wird nichts nach aussen gesendet: Der Server lauscht nur auf
 * 127.0.0.1 und liefert ausschliesslich Dateien aus dem Ordner "app".
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.join(HIER, "app");
const PORT = 5180;

const TYPEN = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",   ".json": "application/json; charset=utf-8",
  ".gz": "application/gzip",           ".wasm": "application/wasm",
  ".svg": "image/svg+xml",             ".png": "image/png",
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let ziel = path.join(WURZEL, url === "/" ? "index.html" : url);

  // Nicht aus dem Ordner ausbrechen lassen
  if (!path.resolve(ziel).startsWith(path.resolve(WURZEL))) {
    res.writeHead(403).end("Verboten");
    return;
  }
  if (!fs.existsSync(ziel) || fs.statSync(ziel).isDirectory()) {
    ziel = path.join(WURZEL, "index.html");
  }

  res.writeHead(200, {
    "Content-Type": TYPEN[path.extname(ziel)] || "application/octet-stream",
    // Ohne diese beiden Kopfzeilen verweigert der Browser die WASM-Threads,
    // die Tesseract fuer die OCR nutzt.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  fs.createReadStream(ziel).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Steuern nP laeuft.\n\n  Im Browser oeffnen:  http://localhost:${PORT}\n`);
  console.log("  Zum Beenden dieses Fenster schliessen oder Strg+C druecken.\n");
});
