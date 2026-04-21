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

/// URL im externen Standard-Browser öffnen (für Power BI etc., wo WebView2
/// wegen Tracking Prevention Probleme macht).
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// WebView2 Tracking Prevention auf NONE setzen.
/// Ohne das blockt WebView2 ~56 Storage-Zugriffe und Power BI crasht mit
/// "Cannot read properties of undefined (reading 'plugins')".
/// Wird explizit vom Frontend (Auswertungen-Seite) gerufen, weil der setup()-
/// bzw. on_page_load-Ansatz stumm fehlschlug. Return = Statusstring.
#[tauri::command]
fn disable_tracking_prevention(webview_window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
        webview_window.with_webview(move |webview| {
            use windows::core::Interface;
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_13,
                ICoreWebView2Profile3,
                COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
            };
            let result: Result<String, String> = (|| unsafe {
                let controller = webview.controller();
                let core = controller.CoreWebView2()
                    .map_err(|e| format!("CoreWebView2 nicht verfügbar: {:?}", e))?;
                let core13: ICoreWebView2_13 = core.cast()
                    .map_err(|e| format!("ICoreWebView2_13 nicht verfügbar: {:?}", e))?;
                let profile = core13.Profile()
                    .map_err(|e| format!("Profile nicht verfügbar: {:?}", e))?;
                let profile3: ICoreWebView2Profile3 = profile.cast()
                    .map_err(|e| format!("ICoreWebView2Profile3 nicht verfügbar: {:?}", e))?;
                profile3.SetPreferredTrackingPreventionLevel(
                    COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE
                ).map_err(|e| format!("SetPreferredTrackingPreventionLevel fehlgeschlagen: {:?}", e))?;
                Ok("Tracking Prevention = NONE".to_string())
            })();
            let _ = tx.send(result);
        }).map_err(|e| format!("with_webview(): {:?}", e))?;

        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| format!("recv_timeout: {:?}", e))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = webview_window;
        Ok("skip (non-windows)".to_string())
    }
}

/// OAuth-Popup (Microsoft, Power BI, Azure AD) INNERHALB der Tauri-App öffnen.
/// Damit Cookies mit dem Haupt-WebView geteilt werden.
/// Frontend-JS (in main.jsx) fängt window.open() für login.microsoftonline.com ab.
#[tauri::command]
fn open_oauth_window(app: AppHandle, url: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let parsed_url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let label = format!("oauth-{}", ts);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title("Anmeldung")
        .inner_size(520.0, 720.0)
        .resizable(true)
        .center()
        .focused(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Externe URL (z.B. Power BI Embed) in einem EIGENEN Tauri-Fenster als Top-Level-Frame
/// öffnen. Dadurch ist `window.__TAURI_INTERNALS__` verfügbar und Tauri's Plugin-Init
/// crasht nicht mehr (anders als beim cross-origin iframe im Haupt-WebView).
/// Cookies werden mit dem Haupt-WebView geteilt (gleiches WebView2-Profil).
#[tauri::command]
fn open_embedded_window(
    app: AppHandle,
    url: String,
    title: String,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let parsed_url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let label = format!("embed-{}", ts);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title(title)
        .inner_size(width.unwrap_or(1400.0), height.unwrap_or(900.0))
        .resizable(true)
        .center()
        .focused(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Excel-Upload-Server (localhost:7788) ───────────────────────────────────────

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

// Polyfill für cross-origin iframes (z.B. Power BI).
// Tauri injiziert Plugin-Init-Scripts wie
// `Object.defineProperty(window.__TAURI_INTERNALS__.plugins, 'path', {...})`
// in jeden Frame. Im cross-origin iframe ist __TAURI_INTERNALS__ nicht
// gesetzt → Crash → Blank-Screen. Wir legen das Objekt defensiv vor,
// damit defineProperty() findet was es braucht.
const IFRAME_POLYFILL: &str = r#"
;(function(){
  try {
    if (typeof window.__TAURI_INTERNALS__ === 'undefined') {
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: { plugins: {}, metadata: { currentWebview: {}, currentWindow: {} } },
        writable: true, configurable: true,
      });
    } else if (!window.__TAURI_INTERNALS__.plugins) {
      window.__TAURI_INTERNALS__.plugins = {};
    }
  } catch(e) {}
})();
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::{WebviewUrl, WebviewWindowBuilder};

            let url = tauri::Url::parse("https://smartis.me").map_err(|e| e.to_string())?;
            WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::External(url))
                .title("Smartis by Artis Treuhand")
                .inner_size(1400.0, 900.0)
                .min_inner_size(1024.0, 700.0)
                .resizable(true)
                .center()
                .focused(true)
                .disable_drag_drop_handler()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
                .additional_browser_args("--disable-features=TrackingProtection3pcd,TrackingProtectionSettingsPageLaunch,PrivacySandboxSettings4,PartitionedCookies,ThirdPartyStoragePartitioning,BlockThirdPartyCookies,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure,msEdgeTrackingProtection,PrivacySandboxAdsAPIs,FedCm --enable-features=SharedArrayBuffer")
                .initialization_script(IFRAME_POLYFILL)
                .build()
                .map_err(|e| e.to_string())?;

            let handle = app.handle().clone();
            // Eigener Tokio-Runtime-Thread für den Excel-Upload-Server,
            // da Tauri's setup() Callback keine aktive Tokio-Runtime hat.
            std::thread::spawn(move || {
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt.block_on(excel_upload_server(handle)),
                    Err(e) => log::error!("Tokio-Runtime konnte nicht erstellt werden: {}", e),
                }
            });

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
            open_oauth_window,
            open_embedded_window,
            open_external_url,
            disable_tracking_prevention,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Smartis");
}
