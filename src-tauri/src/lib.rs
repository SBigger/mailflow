use std::path::PathBuf;
use std::fs;
use tauri::{Manager, AppHandle};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// ── Datenstrukturen ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadFile {
    pub url: String,
    pub filename: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DownloadFolderResult {
    pub success: bool,
    pub path: String,
    pub files_downloaded: usize,
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CacheEntry {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

// ── Offline-Datenbank ──────────────────────────────────────────────────────────

fn get_db_path(app: &AppHandle) -> PathBuf {
    let data_dir = app.path().app_data_dir()
        .unwrap_or_else(|_| dirs::data_dir().unwrap().join("Smartis"));
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("smartis_offline.db")
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = get_db_path(app);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            action TEXT NOT NULL,
            payload TEXT NOT NULL,
            synced INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
    ").map_err(|e| e.to_string())?;

    Ok(conn)
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

/// Ordner mit mehreren Dateien herunterladen und lokal speichern
#[tauri::command]
async fn download_folder(
    folder_name: String,
    files: Vec<DownloadFile>,
    destination: Option<String>,
) -> Result<DownloadFolderResult, String> {
    let base_dir = if let Some(dest) = destination {
        PathBuf::from(dest)
    } else {
        dirs::download_dir()
            .or_else(|| dirs::desktop_dir())
            .unwrap_or_else(|| PathBuf::from("C:\\Users\\Public\\Downloads"))
    };

    let folder_path = base_dir.join(&folder_name);
    fs::create_dir_all(&folder_path).map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    let mut downloaded = 0;
    let mut errors = Vec::new();

    for file in &files {
        let file_path = folder_path.join(&file.filename);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).ok();
        }

        match client.get(&file.url).send().await {
            Ok(response) => {
                match response.bytes().await {
                    Ok(bytes) => {
                        if let Err(e) = fs::write(&file_path, &bytes) {
                            errors.push(format!("{}: {}", file.filename, e));
                        } else {
                            downloaded += 1;
                        }
                    }
                    Err(e) => errors.push(format!("{}: {}", file.filename, e)),
                }
            }
            Err(e) => errors.push(format!("{}: {}", file.filename, e)),
        }
    }

    Ok(DownloadFolderResult {
        success: errors.is_empty(),
        path: folder_path.to_string_lossy().to_string(),
        files_downloaded: downloaded,
        errors,
    })
}

/// Ordner im Explorer öffnen
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Download-Verzeichnis ermitteln
#[tauri::command]
fn get_download_dir() -> String {
    dirs::download_dir()
        .or_else(|| dirs::desktop_dir())
        .unwrap_or_else(|| PathBuf::from("C:\\Users\\Public\\Downloads"))
        .to_string_lossy()
        .to_string()
}

/// Daten in lokale SQLite-DB cachen
#[tauri::command]
fn cache_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
        [&key, &value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Daten aus lokalem Cache lesen
#[tauri::command]
fn cache_get(app: AppHandle, key: String) -> Result<Option<CacheEntry>, String> {
    let conn = open_db(&app)?;
    let result = conn.query_row(
        "SELECT key, value, updated_at FROM cache WHERE key = ?1",
        [&key],
        |row| Ok(CacheEntry {
            key: row.get(0)?,
            value: row.get(1)?,
            updated_at: row.get(2)?,
        }),
    );

    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Cache leeren (beim Logout)
#[tauri::command]
fn cache_clear(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM cache", []).map_err(|e| e.to_string())?;
    Ok(())
}

/// App-Version
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── Excel-Upload-Server (localhost:7788) ───────────────────────────────────────
//
// Excel VBA schickt POST {"filepath":"C:\\...\\file.xlsx"}
// Rust liest die Datei, kodiert sie als Base64 und injiziert sie per
// window.__SMARTIS_EXCEL_UPLOAD__ in den Tauri-Webview.
// React pollt diese Variable und öffnet den Upload-Dialog automatisch.

async fn excel_upload_server(app: AppHandle) {
    let listener = match TcpListener::bind("127.0.0.1:7788").await {
        Ok(l) => l,
        Err(e) => { log::warn!("Port 7788 nicht verfügbar: {}", e); return; }
    };
    log::info!("Excel-Upload-Server bereit auf Port 7788");

    loop {
        let (mut socket, _) = match listener.accept().await {
            Ok(s) => s,
            Err(_) => continue,
        };
        let app = app.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 32768];
            let n = socket.read(&mut buf).await.unwrap_or(0);
            if n == 0 { return; }

            let req = String::from_utf8_lossy(&buf[..n]).to_string();

            let body_str = if req.starts_with("OPTIONS") {
                "{\"ok\":true}".to_string()
            } else if let Some(pos) = req.find("\r\n\r\n") {
                let body = req[pos + 4..].trim_end_matches('\0');
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
                    if let Some(filepath) = json["filepath"].as_str() {
                        match std::fs::read(filepath) {
                            Ok(bytes) => {
                                let b64 = BASE64.encode(&bytes);
                                let filename = std::path::Path::new(filepath)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("upload.xlsx")
                                    .to_string();

                                if let Some(win) = app.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                    // Datei als globale JS-Variable in Webview injizieren
                                    let js = format!(
                                        "window.__SMARTIS_EXCEL_UPLOAD__={{filename:{},data:{}}};",
                                        serde_json::to_string(&filename).unwrap_or_default(),
                                        serde_json::to_string(&b64).unwrap_or_default()
                                    );
                                    let _ = win.eval(&js);
                                }
                                "{\"ok\":true}".to_string()
                            },
                            Err(e) => format!("{{\"error\":\"{}\"}}", e),
                        }
                    } else { "{\"error\":\"filepath fehlt\"}".to_string() }
                } else { "{\"error\":\"JSON ungültig\"}".to_string() }
            } else { "{\"ok\":true}".to_string() };

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Access-Control-Allow-Methods: POST, OPTIONS\r\n\
                 Access-Control-Allow-Headers: Content-Type\r\n\
                 Content-Length: {}\r\n\r\n{}",
                body_str.len(), body_str
            );
            let _ = socket.write_all(resp.as_bytes()).await;
        });
    }
}

// ── App-Start ──────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tokio::spawn(excel_upload_server(handle));
            Ok(())
        })
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            download_folder,
            open_folder,
            get_download_dir,
            cache_set,
            cache_get,
            cache_clear,
            get_version,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Smartis");
}
