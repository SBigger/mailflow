// Excel-Upload-Server (Port 7788)
// Portiert aus src-tauri/src/lib.rs:excel_upload_server.
// Externe Tools POSTen { filepath } → wir lesen die Datei, base64-kodieren sie,
// und schieben sie via window.__SMARTIS_EXCEL_UPLOAD__ ins Hauptfenster.

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

function startExcelServer(getMainWindow) {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const json = JSON.parse(body);
        const filepath = json && json.filepath;
        if (!filepath) {
          res.writeHead(200);
          return res.end(JSON.stringify({ error: 'filepath fehlt' }));
        }
        const buf = await fs.readFile(filepath);
        const b64 = buf.toString('base64');
        const filename = path.basename(filepath) || 'upload.xlsx';

        const win = getMainWindow && getMainWindow();
        if (win && !win.isDestroyed()) {
          try {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
            const js = `window.__SMARTIS_EXCEL_UPLOAD__=${JSON.stringify({ filename, data: b64 })};`;
            win.webContents.executeJavaScript(js).catch(() => {});
          } catch {}
        }

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200);
        res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
      }
    });
  });

  server.on('error', (e) => {
    console.warn('[Smartis] Excel-Upload-Server Port 7788 nicht verfügbar:', e.message);
  });

  server.listen(7788, '127.0.0.1', () => {
    console.info('[Smartis] Excel-Upload-Server bereit auf Port 7788');
  });
}

module.exports = { startExcelServer };
