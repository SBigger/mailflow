use std::path::PathBuf;
use std::fs;
use tauri::{Manager, AppHandle, Emitter};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;

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

/// Update prüfen – gibt { available, version, notes } zurück
#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<serde_json::Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "currentVersion": update.current_version,
            "notes": update.body.unwrap_or_default(),
        })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(e.to_string()),
    }
}

/// Update herunterladen und installieren (App startet danach neu)
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Badge-Zähler für Tray-Icon setzen (z.B. ungelesene Tickets)
/// Frontend ruft invoke('set_tray_badge', { count: 3 }) auf
#[tauri::command]
fn set_tray_badge(app: AppHandle, count: u32) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("smartis-tray") {
        let tooltip = if count > 0 {
            format!("Smartis – {} ungelesen", count)
        } else {
            "Smartis – Artis Treuhand".to_string()
        };
        tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;

        // Titel (wird bei Hover/macOS-Menüleiste angezeigt)
        let title = if count > 0 { format!("({})", count) } else { String::new() };
        let _ = tray.set_title(Some(&title));
    }
    Ok(())
}

/// Fenster anzeigen (vom Frontend aufrufbar)
#[tauri::command]
fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| e.to_string())?;
        win.unminimize().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Fenster in Tray minimieren
#[tauri::command]
fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// OAuth-Popup (Microsoft, Power BI, Azure AD) INNERHALB der Tauri-App öffnen.
/// Damit Cookies mit dem Haupt-WebView geteilt werden.
/// Frontend-JS (Init-Script) fängt window.open() für login.microsoftonline.com ab.
#[tauri::command]
fn open_oauth_window(app: AppHandle, url: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let parsed_url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;

    // Eindeutige Fenster-ID, damit mehrere OAuth-Flows parallel gehen
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
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Native Windows Toast-Notification zeigen.
/// Frontend: invoke('notify', { title, body, navigateTo: 'ticket/123' })
/// Wenn navigateTo gesetzt → wird in Rust-State gespeichert, bei Notification-Click
/// kommt das Fenster nach vorne und smartis-navigate wird gefeuert.
#[tauri::command]
fn notify(
    app: AppHandle,
    title: String,
    body: String,
    navigate_to: Option<String>,
) -> Result<(), String> {
    let builder = app.notification()
        .builder()
        .title(&title)
        .body(&body);

    builder.show().map_err(|e| e.to_string())?;

    // Navigation-Ziel merken – der nächste Focus auf die App navigiert dorthin.
    if let Some(target) = navigate_to {
        *PENDING_NAV.lock().unwrap() = Some(target);
    }
    Ok(())
}

// Pending-Navigation: wird bei Notification-Click via Fokus-Event ausgelöst
static PENDING_NAV: std::sync::LazyLock<std::sync::Mutex<Option<String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

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

// ── Navigation-Helper ──────────────────────────────────────────────────────────
// Fenster nach vorne holen und Frontend-Event feuern
fn smartis_navigate(app: &AppHandle, action: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    // React-Listener: listen('smartis-navigate', e => navigate(e.payload))
    let _ = app.emit("smartis-navigate", action.to_string());
}

// ── Windows Jumplist ───────────────────────────────────────────────────────────
// TODO: Jumplist via Windows Shell API einbauen. Erfordert aufwendige Feature-Flag-
// Konfiguration im windows-crate (Win32_UI_Shell_Common etc.) und ist für die
// Power-BI-Integration nicht relevant. Wird später separat nachgeliefert.
fn setup_jumplist() -> Result<(), String> {
    log::info!("Jumplist-Setup übersprungen (kommt später)");
    Ok(())
}

// smartis://kunde/1234 → "kunde/1234"
// smartis://suche/M%C3%BCller → "suche/Müller"
fn parse_smartis_url(url: &str) -> Option<String> {
    let path = url.strip_prefix("smartis://")?;
    let path = path.trim_start_matches('/').trim_end_matches('/');
    if path.is_empty() {
        return Some("home".to_string());
    }
    // URL-Decode (für Umlaute in Suchbegriffen)
    let decoded: String = path.split('/')
        .map(|seg| {
            percent_decode(seg)
        })
        .collect::<Vec<_>>()
        .join("/");
    Some(decoded)
}

// Einfaches URL-Decoding ohne Crate (reicht für unsere Fälle)
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i+1]), hex_val(bytes[i+2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// CLI-Args scannen: Deep-Link oder --action?
fn parse_any_action(args: &[String]) -> Option<String> {
    for arg in args {
        if arg.starts_with("smartis://") {
            if let Some(path) = parse_smartis_url(arg) {
                return Some(path);
            }
        }
        if let Some(stripped) = arg.strip_prefix("--action=") {
            return Some(stripped.to_string());
        }
    }
    None
}

// ── App-Start ──────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-Instance: zweite Smartis-Instanz leitet ihre CLI-Args an die erste weiter
        // (inkl. Jumplist-Tasks UND smartis://... Deep-Links)
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            log::info!("Zweite Instanz mit Args: {:?}", args);
            if let Some(action) = parse_any_action(&args) {
                smartis_navigate(app, &action);
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        // Deep-Link: registriert smartis:// als Windows-Protocol beim Installer
        .plugin(tauri_plugin_deep_link::init())
        // Global-Shortcuts: Ctrl+Shift+S/T/K/D/A
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed { return; }
                    let action = if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyS) {
                        "home"
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyT) {
                        "neues-ticket"
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyK) {
                        "kunden"
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyD) {
                        "dateiablage"
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyA) {
                        "aufgaben"
                    } else {
                        return;
                    };
                    smartis_navigate(app, action);
                })
                .build()
        )
        .setup(|app| {
            // Global-Shortcuts registrieren
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let gsm = app.global_shortcut();
            let shortcuts = [
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS),
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyT),
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyK),
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyD),
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyA),
            ];
            for sc in shortcuts {
                if let Err(e) = gsm.register(sc) {
                    log::warn!("Hotkey nicht registriert: {}", e);
                }
            }

            // Windows Jumplist einrichten (Rechtsklick Taskbar) – aktuell Stub
            if let Err(e) = setup_jumplist() {
                log::warn!("Jumplist-Setup fehlgeschlagen: {}", e);
            }

            // CLI-Args beim Erststart (Jumplist-Task oder Deep-Link via Registry)
            let args: Vec<String> = std::env::args().collect();
            if let Some(action) = parse_any_action(&args) {
                let handle_cli = app.handle().clone();
                let action_owned = action.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    smartis_navigate(&handle_cli, &action_owned);
                });
            }

            // Deep-Link Handler: smartis://... URLs
            let dl_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let url_str = url.as_str();
                    log::info!("Deep-Link empfangen: {}", url_str);
                    if let Some(path) = parse_smartis_url(url_str) {
                        smartis_navigate(&dl_handle, &path);
                    }
                }
            });

            // Notification-Click: bei App-Fokus prüfen, ob eine Pending-Navigation existiert
            let focus_handle = app.handle().clone();
            if let Some(main_win) = app.get_webview_window("main") {
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(true) = event {
                        let pending = PENDING_NAV.lock().unwrap().take();
                        if let Some(nav) = pending {
                            smartis_navigate(&focus_handle, &nav);
                        }
                    }
                });
            }

            // ── System-Tray ───────────────────────────────────────────
            let show_i    = MenuItem::with_id(app, "tray_show",    "Smartis öffnen",  true, None::<&str>)?;
            let hide_i    = MenuItem::with_id(app, "tray_hide",    "In Tray minimieren", true, None::<&str>)?;
            let sep1      = PredefinedMenuItem::separator(app)?;
            let ver_label = format!("Version {}", env!("CARGO_PKG_VERSION"));
            let ver_i     = MenuItem::with_id(app, "tray_version", &ver_label,        false, None::<&str>)?;
            let upd_i     = MenuItem::with_id(app, "tray_update",  "Nach Updates suchen", true, None::<&str>)?;
            let sep2      = PredefinedMenuItem::separator(app)?;
            let quit_i    = MenuItem::with_id(app, "tray_quit",    "Smartis beenden", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &show_i, &hide_i, &sep1, &ver_i, &upd_i, &sep2, &quit_i,
            ])?;

            let _tray = TrayIconBuilder::with_id("smartis-tray")
                .tooltip("Smartis – Artis Treuhand")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "tray_hide" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                    "tray_update" => {
                        let app = app.clone();
                        std::thread::spawn(move || {
                            if let Ok(rt) = tokio::runtime::Runtime::new() {
                                rt.block_on(async {
                                    if let Ok(updater) = app.updater() {
                                        match updater.check().await {
                                            Ok(Some(update)) => {
                                                if let Some(win) = app.get_webview_window("main") {
                                                    let _ = win.show();
                                                    let _ = win.set_focus();
                                                    let js = format!(
                                                        "window.__SMARTIS_UPDATE__={{version:{},notes:{}}};",
                                                        serde_json::to_string(&update.version).unwrap_or_default(),
                                                        serde_json::to_string(&update.body.as_deref().unwrap_or("")).unwrap_or_default()
                                                    );
                                                    let _ = win.eval(&js);
                                                }
                                            }
                                            Ok(None) => log::info!("Keine Updates verfügbar"),
                                            Err(e)  => log::warn!("Update-Check Fehler: {}", e),
                                        }
                                    }
                                });
                            }
                        });
                    }
                    "tray_quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                let visible = win.is_visible().unwrap_or(false);
                                if visible {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            // Eigener Tokio-Runtime-Thread für den Excel-Upload-Server
            std::thread::spawn(move || {
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt.block_on(excel_upload_server(handle)),
                    Err(e) => log::error!("Tokio-Runtime konnte nicht erstellt werden: {}", e),
                }
            });

            // Auto-Updater: 8 Sekunden nach Start einmalig prüfen
            let handle2 = app.handle().clone();
            std::thread::spawn(move || {
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt.block_on(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                        match handle2.updater() {
                            Ok(updater) => {
                                match updater.check().await {
                                    Ok(Some(update)) => {
                                        log::info!("Update verfügbar: {}", update.version);
                                        if let Some(win) = handle2.get_webview_window("main") {
                                            let js = format!(
                                                "window.__SMARTIS_UPDATE__={{version:{},notes:{}}};",
                                                serde_json::to_string(&update.version).unwrap_or_default(),
                                                serde_json::to_string(&update.body.as_deref().unwrap_or("")).unwrap_or_default()
                                            );
                                            let _ = win.eval(&js);
                                        }
                                    }
                                    Ok(None) => log::info!("Smartis ist aktuell"),
                                    Err(e)  => log::warn!("Update-Check fehlgeschlagen: {}", e),
                                }
                            }
                            Err(e) => log::warn!("Updater nicht verfügbar: {}", e),
                        }
                    }),
                    Err(e) => log::error!("Update-Runtime Fehler: {}", e),
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            check_for_updates,
            install_update,
            set_tray_badge,
            show_window,
            hide_window,
            open_oauth_window,
            notify,
        ])
        .on_window_event(|window, event| {
            // X-Button: in Tray minimieren statt beenden
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Smartis");
}
