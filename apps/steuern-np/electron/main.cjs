/**
 * Steuern nP — Hauptprozess der lokalen Anwendung.
 *
 * Die App läuft ab Laufwerk: Datenbestand und Belege liegen NEBEN der
 * ausführbaren Datei, nicht im Benutzerprofil. Wer den Ordner auf einen
 * anderen Stick kopiert, nimmt alles mit.
 *
 * Ablage:
 *   <App-Ordner>/daten/steuerdaten.json     der gesamte Datenbestand
 *   <App-Ordner>/daten/belege/…             die abgelegten Belegdateien
 *   <App-Ordner>/daten/sicherung/…          automatische Sicherungen
 *
 * Kein Netzwerk. Die Anwendung sendet nichts nach aussen — Steuerdaten
 * unterliegen dem Steuergeheimnis.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");

/**
 * Der Ordner neben der Anwendung. Im gepackten Zustand liegt die .exe in
 * <Ordner>/, die Ressourcen unter <Ordner>/resources — wir wollen den
 * äusseren Ordner, damit der Nutzer die Daten sieht.
 */
function datenWurzel() {
  const basis = app.isPackaged
    ? path.dirname(app.getPath("exe"))
    : path.join(__dirname, "..");
  return path.join(basis, "daten");
}

const DB_DATEI     = () => path.join(datenWurzel(), "steuerdaten.json");
const BELEG_ORDNER = () => path.join(datenWurzel(), "belege");
const SICHERUNG    = () => path.join(datenWurzel(), "sicherung");

async function ordnerSicherstellen() {
  for (const d of [datenWurzel(), BELEG_ORDNER(), SICHERUNG()]) {
    await fsp.mkdir(d, { recursive: true });
  }
}

// ══════════════════════════════════════════════════════════════════════
// Fenster
// ══════════════════════════════════════════════════════════════════════

let fenster = null;

function fensterOeffnen() {
  fenster = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1024, minHeight: 700,
    backgroundColor: "#F5F7F4",
    title: "Steuern nP",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  fenster.setMenuBarVisibility(false);
  fenster.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // Externe Links im Systembrowser, nicht im App-Fenster
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  await ordnerSicherstellen();
  fensterOeffnen();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) fensterOeffnen();
  });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// ══════════════════════════════════════════════════════════════════════
// Datenbestand
// ══════════════════════════════════════════════════════════════════════

ipcMain.handle("db:pfad", () => DB_DATEI());

ipcMain.handle("db:lesen", async () => {
  try {
    const roh = await fsp.readFile(DB_DATEI(), "utf8");
    return JSON.parse(roh);
  } catch (e) {
    if (e.code === "ENOENT") return null;      // erster Start
    // Beschädigte Datei: nicht überschreiben, sondern beiseitelegen.
    const kaputt = `${DB_DATEI()}.beschaedigt-${Date.now()}`;
    try { await fsp.rename(DB_DATEI(), kaputt); } catch { /* egal */ }
    throw new Error(
      `Der Datenbestand liess sich nicht lesen (${e.message}). ` +
      `Die Datei wurde nach ${path.basename(kaputt)} verschoben; ` +
      `eine Sicherung findet sich im Ordner "sicherung".`
    );
  }
});

let schreibKette = Promise.resolve();

ipcMain.handle("db:schreiben", async (_e, daten) => {
  // Schreibvorgänge nacheinander, damit sich zwei Speicherungen nicht
  // gegenseitig überschreiben.
  schreibKette = schreibKette.then(async () => {
    await ordnerSicherstellen();
    const ziel = DB_DATEI();
    const temp = `${ziel}.tmp`;
    const inhalt = JSON.stringify(daten, null, 2);

    // Erst in eine Nebendatei schreiben, dann umbenennen: so bleibt bei
    // einem Absturz mitten im Schreiben der alte Stand erhalten.
    await fsp.writeFile(temp, inhalt, "utf8");
    await fsp.rename(temp, ziel);

    // Tagessicherung — eine je Kalendertag genügt und wächst nicht endlos.
    const tag = new Date().toISOString().slice(0, 10);
    const sicher = path.join(SICHERUNG(), `steuerdaten-${tag}.json`);
    if (!fs.existsSync(sicher)) await fsp.writeFile(sicher, inhalt, "utf8");
  });
  await schreibKette;
  return true;
});

// ══════════════════════════════════════════════════════════════════════
// Belege
// ══════════════════════════════════════════════════════════════════════

ipcMain.handle("beleg:ablegen", async (_e, { mandantId, deklarationId, dateiname, daten }) => {
  const sicher = String(dateiname).replace(/[^\w.\-]+/g, "_").slice(-120);
  const ordner = path.join(BELEG_ORDNER(), String(mandantId), String(deklarationId));
  await fsp.mkdir(ordner, { recursive: true });
  const ziel = path.join(ordner, sicher);
  await fsp.writeFile(ziel, Buffer.from(daten));
  return path.relative(datenWurzel(), ziel);
});

ipcMain.handle("beleg:oeffnen", async (_e, relativerPfad) => {
  const voll = path.join(datenWurzel(), relativerPfad);
  // Nicht aus dem Datenordner ausbrechen lassen
  if (!voll.startsWith(datenWurzel())) throw new Error("Ungültiger Pfad");
  await shell.openPath(voll);
  return true;
});

// ══════════════════════════════════════════════════════════════════════
// Export
// ══════════════════════════════════════════════════════════════════════

ipcMain.handle("datei:speichern", async (_e, dateiname, inhalt) => {
  const { canceled, filePath } = await dialog.showSaveDialog(fenster, {
    title: "Export speichern",
    defaultPath: path.join(datenWurzel(), dateiname),
    filters: [
      { name: "Alle Dateien", extensions: ["*"] },
    ],
  });
  if (canceled || !filePath) return { abgebrochen: true };
  await fsp.writeFile(filePath, inhalt, "utf8");
  return { pfad: filePath };
});

ipcMain.handle("ordner:zeigen", async () => {
  await ordnerSicherstellen();
  await shell.openPath(datenWurzel());
  return datenWurzel();
});
