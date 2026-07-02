import threading
import time
import os
import wave
import io
import sys
import math
import ctypes
import re
import winreg
import webbrowser
import secrets
import json
import base64
import asyncio
import http.server
import urllib.parse
import logging
import pyperclip
import pyautogui
import sounddevice as sd
import numpy as np
from pynput import keyboard
from faster_whisper import WhisperModel
import pystray
from PIL import Image, ImageDraw
import tkinter as tk

# ══════════════════════════════════════════════════════════════
#  PyInstaller --windowed Fix: stdout/stderr sind None
#  → jede print()/traceback-Ausgabe killt den Prozess sofort
# ══════════════════════════════════════════════════════════════
if getattr(sys, 'frozen', False):
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')

# ══════════════════════════════════════════════════════════════
#  Single-Instance-Lock (Windows Named Mutex)
#  → verhindert dass zwei VoxDrop gleichzeitig den Hotkey klauen
# ══════════════════════════════════════════════════════════════
try:
    _kernel32 = ctypes.windll.kernel32
    _MUTEX = _kernel32.CreateMutexW(None, False, "Local\\VoxDrop_Artis_SingleInstance_v15")
    if _kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        # Bereits eine Instanz aktiv → still beenden (Tray-Icon ist sichtbar)
        os._exit(0)
except Exception:
    pass  # Bei Fehler im Lock-Mechanismus trotzdem starten

# ══════════════════════════════════════════════════════════════
#  KONFIGURATION aus config.txt laden
# ══════════════════════════════════════════════════════════════

# PyInstaller-kompatibel: config in LOCALAPPDATA wenn EXE in Program Files (nicht schreibbar)
if getattr(sys, 'frozen', False):
    _exe_dir = os.path.dirname(sys.executable)
    try:
        _t = os.path.join(_exe_dir, '.vd_write_test')
        open(_t, 'w').close()
        os.remove(_t)
        BASE_DIR = _exe_dir
    except OSError:
        BASE_DIR = os.path.join(os.environ.get('LOCALAPPDATA', _exe_dir), 'VoxDrop')
        os.makedirs(BASE_DIR, exist_ok=True)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

EXE_PATH = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(sys.argv[0])

CONFIG_FILE  = os.path.join(BASE_DIR, "config.txt")
PROMPTS_FILE = os.path.join(BASE_DIR, "prompts.json")
APP_NAME     = "VoxDrop by Artis"
VERSION      = "1.7.1"
SAMPLE_RATE  = 16000
LANGUAGE     = "de"

# Default-Modus = Deepgram Stream (beste Qualität DE, $200 Free Credit)
_DEFAULT_MODUS  = "stream-deepgram"
_DEFAULT_MODELL = "small"

# ── API-Keys (eigene Keys in config.txt eintragen) ──
_DEFAULT_DEEPGRAM_KEY   = ""  # deepgram.com – $200 Gratis-Guthaben
_DEFAULT_ELEVENLABS_KEY = ""  # elevenlabs.io – Scribe v2 Realtime

# Migration alter MODUS-Werte → neue Bezeichner
_MODUS_MIGRATE = {
    "stream":      "stream-deepgram",
    "premium":     "stream-deepgram",   # Premium entfernt → fallback auf bestes Stream
    "gemini-live": "stream-deepgram",   # Gemini Live entfernt → fallback
}

exe_name = os.path.basename(EXE_PATH)
prefix = "dummy"
match = re.match(r"^([a-zA-Z0-9\-]+)_voxdrop", exe_name, re.IGNORECASE)

if match:
    prefix = match.group(1)

_SMARTIS_BASE = f"https://{prefix}.sm-artis.ch"
_SUPABASE_URL = f"https://api-{prefix}.sm-artis.ch"
_SUPABASE_ANON_KEY = ""

def load_remote_config():
    """Lädt den Anon Key dynamisch aus der config.json von _SMARTIS_BASE."""
    global _SUPABASE_ANON_KEY
    config_url = f"{_SMARTIS_BASE}/config.json"

    try:
        log.info(f"Lade Remote-Konfiguration von {config_url}...")
        with urllib.request.urlopen(config_url, timeout=10) as resp:
            config_data = json.loads(resp.read().decode("utf-8"))

            # Key aus dem JSON holen (Erwartetes Format: {"key1": "dein-key"})
            if "key1" in config_data:
                _SUPABASE_ANON_KEY = config_data["key1"]
                log.info("Remote Anon Key erfolgreich geladen.")
            else:
                log.error("Feld 'key1' wurde in config.json nicht gefunden!")

    except Exception as e:
        log.error(f"Fehler beim Laden der Remote-Konfiguration: {e}")
        # Optionale Sicherheitsvorkehrung / Fallback-Key setzen falls nötig

def ensure_config():
    """Erstellt config.txt beim ersten Start falls nicht vorhanden."""
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            f.write("# VoxDrop Konfiguration\n")
            f.write("# Modus: 'stream-deepgram' (empfohlen, beste DE-Qualitaet),\n")
            f.write("#        'stream-scribe' (ElevenLabs, ~150ms), 'lokal' (offline)\n")
            f.write(f"MODUS={_DEFAULT_MODUS}\n")
            f.write("# Lokales Modell: tiny / base / small / medium / large-v3\n")
            f.write(f"MODELL={_DEFAULT_MODELL}\n")
            f.write("# Deepgram API-Key (deepgram.com – $200 Gratis-Guthaben)\n")
            f.write("DEEPGRAM_API_KEY=\n")
            f.write("# ElevenLabs API-Key (elevenlabs.io – Scribe v2 Realtime)\n")
            f.write("ELEVENLABS_API_KEY=\n")

ensure_config()

def load_config():
    cfg = {
        "DEEPGRAM_API_KEY":   _DEFAULT_DEEPGRAM_KEY,
        "ELEVENLABS_API_KEY": _DEFAULT_ELEVENLABS_KEY,
        "MODUS":              _DEFAULT_MODUS,
        "MODELL":             _DEFAULT_MODELL,
    }
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    if v:
                        cfg[k] = v
    except FileNotFoundError:
        pass
    # Migration alter Modi
    cfg["MODUS"] = _MODUS_MIGRATE.get(cfg["MODUS"], cfg["MODUS"])
    if cfg["MODUS"] not in ("stream-deepgram", "stream-scribe", "lokal"):
        cfg["MODUS"] = _DEFAULT_MODUS
    return cfg

def load_prompts():
    try:
        with open(PROMPTS_FILE, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return []

def save_prompts(prompts):
    with open(PROMPTS_FILE, "w", encoding="utf-8") as f:
        json.dump(prompts, f, ensure_ascii=False, indent=2)

def save_config(cfg):
    """Speichert Config – behält Kommentarzeilen, ergänzt fehlende Keys am Ende."""
    existing_keys = set()
    lines = []
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    k = stripped.split("=", 1)[0].strip()
                    if k in cfg:
                        lines.append(f"{k}={cfg[k]}\n")
                        existing_keys.add(k)
                        continue
                lines.append(line)
    except FileNotFoundError:
        pass
    # Fehlende Keys am Ende ergänzen
    for k, v in cfg.items():
        if k not in existing_keys:
            lines.append(f"{k}={v}\n")
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)

cfg                   = load_config()
MODUS                 = cfg["MODUS"]
MODEL_SIZE            = cfg["MODELL"]
DEEPGRAM_API_KEY      = cfg.get("DEEPGRAM_API_KEY", "")
ELEVENLABS_API_KEY    = cfg.get("ELEVENLABS_API_KEY", "")

# ── Logging ──────────────────────────────────────────────────
LOG_FILE = os.path.join(BASE_DIR, "voxdrop.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
log = logging.getLogger("voxdrop")
log.info("VoxDrop %s gestartet – Modus: %s | Modell: %s", VERSION, MODUS, MODEL_SIZE)

# Lokales Modell – wird im Hintergrund geladen damit Tray sofort erscheint
local_model       = None
_model_ready      = threading.Event()
_model_load_lock  = threading.Lock()

def _load_model():
    global local_model
    with _model_load_lock:
        log.info("Lade lokales Modell '%s'...", MODEL_SIZE)
        try:
            local_model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
            _seg, _ = local_model.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1)
            list(_seg)
            _model_ready.set()
            log.info("Lokales Modell bereit.")
        except Exception as e:
            log.error("Modell-Load Fehler: %s", e)

threading.Thread(target=_load_model, daemon=True).start()

recording        = False
audio_frames     = []
recording_lock   = threading.Lock()
tray_icon_ref    = [None]
overlay_ref      = [None]
prompt_panel_ref = [None]
volume_level     = [0.0]

# ── App-Sprachbefehle (open <name>) ──────────────────────────
_APP_COMMANDS = {
    "excel":     "excel",
    "word":      "winword",
    "outlook":   "outlook",
    "teams":     "teams",
    "powerpoint":"powerpnt",
    "chrome":    "chrome",
    "edge":      "msedge",
    "notepad":   "notepad",
    "explorer":  "explorer",
    "onenote":   "onenote",
}

# ── Live Stream State (gemeinsam für Deepgram + Scribe) ───────
_stream_active     = False
_stream_lock       = threading.Lock()
_stream_phrases    = 0
_stream_paste_lock = threading.Lock()

# ── Smartis LLM (Frag Smartis – Ctrl+Shift+Q) ────────────────
_ask_recording     = False
_ask_audio_frames  = []
_ask_lock          = threading.Lock()
_shift_held        = False
_ctrl_held         = False
_q_held            = False


# ══════════════════════════════════════════════════════════════
#  OVERLAY-FENSTER
# ══════════════════════════════════════════════════════════════

class WaveOverlay:
    BAR_COUNT = 12
    WIDTH     = 230
    HEIGHT    = 68
    BAR_W     = 8
    GAP       = 7
    BG        = "#111827"
    ACCENT    = "#3B82F6"

    def __init__(self):
        self._ready   = threading.Event()
        self._running = False
        self._phase   = 0.0
        self.root     = None

    def launch(self):
        threading.Thread(target=self._build_and_run, daemon=True).start()
        self._ready.wait()

    def _build_and_run(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.93)
        self.root.configure(bg=self.BG)
        self.root.withdraw()

        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x  = (sw - self.WIDTH) // 2
        y  = sh - self.HEIGHT - 70
        self.root.geometry(f"{self.WIDTH}x{self.HEIGHT}+{x}+{y}")

        self.label = tk.Label(
            self.root, text="● Aufnahme läuft...",
            fg=self.ACCENT, bg=self.BG,
            font=("Segoe UI", 9, "bold")
        )
        self.label.place(x=10, y=4)

        self.canvas = tk.Canvas(
            self.root, width=self.WIDTH, height=self.HEIGHT - 22,
            bg=self.BG, highlightthickness=0
        )
        self.canvas.place(x=0, y=22)

        self.bars = []
        total   = self.BAR_COUNT * self.BAR_W + (self.BAR_COUNT - 1) * self.GAP
        start_x = (self.WIDTH - total) // 2
        mid     = (self.HEIGHT - 22) // 2
        for i in range(self.BAR_COUNT):
            x0  = start_x + i * (self.BAR_W + self.GAP)
            bar = self.canvas.create_rectangle(
                x0, mid, x0 + self.BAR_W, mid,
                fill=self.ACCENT, outline=""
            )
            self.bars.append((bar, x0))

        self.root.update()
        hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
        style = ctypes.windll.user32.GetWindowLongW(hwnd, -20)
        ctypes.windll.user32.SetWindowLongW(
            hwnd, -20,
            style | 0x00080000 | 0x00000020 | 0x08000000 | 0x00000080
        )

        self._ready.set()
        self.root.mainloop()

    def show(self, error=False, stream=False, label=None):
        if self.root:
            self._stream_mode = stream
            self._custom_label = label
            self.root.after(0, lambda: self._show(error))

    def _show(self, error=False):
        stream = getattr(self, '_stream_mode', False)
        custom = getattr(self, '_custom_label', None)
        if error:
            self.label.config(text="⚠ API-Fehler – lokal übernimmt", fg="#EF4444")
            self.ACCENT = "#EF4444"
        elif custom:
            self.label.config(text=custom, fg="#A78BFA")
            self.ACCENT = "#A78BFA"
        elif stream:
            self.label.config(text="🔴 Live Stream – läuft...", fg="#EF4444")
            self.ACCENT = "#EF4444"
        else:
            self.label.config(text="● Aufnahme läuft...", fg="#3B82F6")
            self.ACCENT = "#3B82F6"
        self._update_bar_colors()
        self.root.deiconify()
        self._running = True
        self._animate()

    def _update_bar_colors(self):
        for bar, _ in self.bars:
            self.canvas.itemconfig(bar, fill=self.ACCENT)

    def hide(self):
        if self.root:
            self.root.after(0, self._hide)

    def _hide(self):
        self._running = False
        self.label.config(text="⏳ Verarbeite...", fg="#F59E0B")
        self.root.after(1200, self.root.withdraw)

    def _animate(self):
        if not self._running:
            return
        self._phase += 0.28
        vol = min(volume_level[0] * 8, 1.0)
        mid = (self.HEIGHT - 22) // 2
        for idx, (bar, x0) in enumerate(self.bars):
            wave_h = math.sin(self._phase + idx * 0.6) * 0.5 + 0.5
            h = int(3 + wave_h * (18 + vol * 18))
            self.canvas.coords(bar, x0, mid - h, x0 + self.BAR_W, mid + h)
        self.root.after(40, self._animate)


# ══════════════════════════════════════════════════════════════
#  PROMPT-PANEL
# ══════════════════════════════════════════════════════════════

class PromptPanel:
    WIDTH  = 300
    BG     = "#111827"
    HDR_BG = "#1E293B"
    ACCENT = "#3B82F6"
    BTN_BG = "#1E293B"
    BTN_HV = "#2D3F5A"
    FG     = "#F1F5F9"
    FG2    = "#94A3B8"

    def __init__(self):
        self._ready   = threading.Event()
        self._visible = False
        self.win      = None
        self._frame   = None
        self._lbl_hdr = None

    def attach(self, tk_root):
        tk_root.after(0, lambda: self._build(tk_root))
        self._ready.wait()

    def _build(self, root):
        self.win = tk.Toplevel(root)
        self.win.overrideredirect(True)
        self.win.attributes("-topmost", True)
        self.win.attributes("-alpha", 0.97)
        self.win.configure(bg=self.BG)
        self.win.withdraw()

        hdr = tk.Frame(self.win, bg=self.HDR_BG)
        hdr.pack(fill="x")
        self._lbl_hdr = tk.Label(hdr, text="📋 Prompt-Vorlagen", fg=self.ACCENT,
                                 bg=self.HDR_BG, font=("Segoe UI", 10, "bold"),
                                 padx=12, pady=10)
        self._lbl_hdr.pack(side="left")
        tk.Button(hdr, text="✕", command=self._hide, bg=self.HDR_BG, fg=self.FG2,
                  font=("Segoe UI", 11), relief="flat", padx=10, pady=6,
                  cursor="hand2", activebackground="#334155",
                  activeforeground=self.FG).pack(side="right")

        self._canvas = tk.Canvas(self.win, bg=self.BG, highlightthickness=0)
        self._scroll = tk.Scrollbar(self.win, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=self._scroll.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        self._scroll.pack(side="right", fill="y")

        self._frame = tk.Frame(self._canvas, bg=self.BG)
        self._frame_id = self._canvas.create_window((0, 0), window=self._frame, anchor="nw")
        self._frame.bind("<Configure>", lambda e: self._canvas.configure(
            scrollregion=self._canvas.bbox("all")))
        self._canvas.bind("<Configure>", lambda e: self._canvas.itemconfig(
            self._frame_id, width=e.width))
        self.win.bind("<MouseWheel>", lambda e: self._canvas.yview_scroll(
            -1 if e.delta > 0 else 1, "units"))

        ftr = tk.Frame(self.win, bg=self.HDR_BG)
        ftr.pack(fill="x", side="bottom")
        tk.Button(ftr, text="⚙ Vorlagen verwalten", command=open_settings_browser,
                  bg=self.HDR_BG, fg=self.FG2, font=("Segoe UI", 8), relief="flat",
                  padx=12, pady=6, cursor="hand2",
                  activebackground="#334155", activeforeground=self.FG).pack()

        self._ready.set()

    def _refresh_prompts(self):
        if not self._frame:
            return
        for w in self._frame.winfo_children():
            w.destroy()
        prompts = load_prompts()
        if not prompts:
            tk.Label(self._frame, text="Keine Vorlagen vorhanden.\nIn Einstellungen hinzufügen.",
                     fg="#64748B", bg=self.BG, font=("Segoe UI", 9),
                     justify="center", pady=20).pack()
            return
        for prompt in prompts:
            btn = tk.Button(
                self._frame,
                text=prompt.get("name", ""),
                command=lambda t=prompt.get("text", ""): self._copy_prompt(t),
                bg=self.BTN_BG, fg=self.FG,
                font=("Segoe UI", 9),
                relief="flat", anchor="w",
                padx=12, pady=9,
                cursor="hand2",
                wraplength=self.WIDTH - 32,
            )
            btn.pack(fill="x", padx=6, pady=2)
            btn.bind("<Enter>", lambda e, b=btn: b.config(bg=self.BTN_HV))
            btn.bind("<Leave>", lambda e, b=btn: b.config(bg=self.BTN_BG))

    def _copy_prompt(self, text):
        pyperclip.copy(text)
        if self._lbl_hdr:
            self._lbl_hdr.config(text="✓ Kopiert!", fg="#22C55E")
            self.win.after(1400, lambda: self._lbl_hdr.config(
                text="📋 Prompt-Vorlagen", fg=self.ACCENT))

    def show(self):
        if self.win:
            self.win.after(0, self._show)

    def _show(self):
        self._refresh_prompts()
        prompts = load_prompts()
        count   = max(1, len(prompts))
        panel_h = min(80 + count * 52, self.win.winfo_screenheight() - 200)
        sw = self.win.winfo_screenwidth()
        self.win.geometry(f"{self.WIDTH}x{panel_h}+{sw - self.WIDTH - 16}+100")
        self.win.deiconify()
        self.win.lift()
        self._visible = True

    def hide(self):
        if self.win:
            self.win.after(0, self._hide)

    def _hide(self):
        self.win.withdraw()
        self._visible = False

    def toggle(self):
        if self.win:
            self.win.after(0, self._toggle)

    def _toggle(self):
        if self._visible:
            self._hide()
        else:
            self._show()


def _toggle_prompt_panel():
    if prompt_panel_ref[0]:
        prompt_panel_ref[0].toggle()


# ══════════════════════════════════════════════════════════════
#  FORMATIERUNG – Sprachbefehle → Sonderzeichen / Umbrüche
# ══════════════════════════════════════════════════════════════

def format_text(text):
    text = text.replace('ß', 'ss')

    # Zeilenumbrüche – tolerant ggü. Deepgram smart_format
    # (Punkte/Kommas zwischen oder nach den Wörtern, Gross/Klein, Trennzeichen)
    NL  = re.compile(r'\bneue?[\s,.\-]+(?:zeile|line|linien?)[\s.,!?;:]*',
                     re.IGNORECASE)
    ZUB = re.compile(r'\bzeilenumbruch[\s.,!?;:]*', re.IGNORECASE)
    ABS = re.compile(r'\babsatz[\s.,!?;:]*',       re.IGNORECASE)
    text = NL.sub('\n', text)
    text = ZUB.sub('\n', text)
    text = ABS.sub('\n\n', text)
    # Mehrfache Linebreaks normalisieren
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Klammern
    text = re.sub(r'\b[Kk]lammer\s+auf\b',                          '(',  text)
    text = re.sub(r'\b[Kk]lammer\s+(?:zu|geschlossen|schliessen)\b',')',  text)
    text = re.sub(r'\b[Ee]ckige\s+[Kk]lammer\s+auf\b',              '[',  text)
    text = re.sub(r'\b[Ee]ckige\s+[Kk]lammer\s+(?:zu|geschlossen|schliessen)\b', ']', text)
    text = re.sub(r'[.,;]\s*\(',  ' (', text)
    text = re.sub(r'[,\.]\s*\)',  ')',  text)

    # Aufzählungszeichen
    text = re.sub(r'\b[Aa]ufzählungszeichen\b\s*', '• ', text)
    text = re.sub(r'\b[Ss]piegelstrich\b\s*',       '- ', text)
    text = re.sub(r'\b[Ss]trich\s+vorne\b\s*',      '- ', text)

    ordinals = [
        ('erstens',   '1.'), ('zweitens', '2.'), ('drittens',  '3.'),
        ('viertens',  '4.'), ('fünftens', '5.'), ('sechstens', '6.'),
        ('siebtens',  '7.'), ('achtens',  '8.'), ('neuntens',  '9.'),
        ('zehntens', '10.'),
    ]
    for word, num in ordinals:
        text = re.sub(rf'\b{word}\b\s*', f'\n{num} ', text, flags=re.IGNORECASE)
    text = text.lstrip('\n')

    text = re.sub(r'(\b\d+\.)\s*,\s*', r'\1 ', text)

    if len(re.findall(r'\b\d+\.\s', text)) >= 2:
        text = re.sub(r'(?<=\w)\s+(\d+\.\s)', r'\n\1', text)

    m = re.match(r'^(\d+)\.\s', text)
    if m and int(m.group(1)) >= 2:
        text = '\n' + text

    return text


# ══════════════════════════════════════════════════════════════
#  PASTE-HELFER
# ══════════════════════════════════════════════════════════════

def _paste_text(text: str):
    """Text via Clipboard + Ctrl+V einfuegen."""
    with _stream_paste_lock:
        parts = text.split('\n')
        for i, part in enumerate(parts):
            if i > 0:
                pyautogui.press('enter')
                time.sleep(0.02)
            part = part.strip()
            if part:
                pyperclip.copy(part + " ")
                time.sleep(0.02)
                pyautogui.hotkey("ctrl", "v")


# ══════════════════════════════════════════════════════════════
#  DEEPGRAM LIVE STREAM (Nova-3, beste DE-Qualität)
# ══════════════════════════════════════════════════════════════

def _deepgram_stream_worker():
    if not DEEPGRAM_API_KEY:
        log.error("Kein Deepgram API Key")
        print("⚠ Kein Deepgram API Key! Bitte in Einstellungen eintragen (deepgram.com)")
        if overlay_ref[0]:
            overlay_ref[0].show(error=True)
        return

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_deepgram_stream_async())
    except Exception as e:
        log.error("Deepgram-Stream Exception: %s", e)
        print(f"⚠ Deepgram-Stream Fehler: {e}")
    finally:
        loop.close()
        volume_level[0] = 0.0
        log.info("Deepgram-Stream beendet. Phrasen: %d", _stream_phrases)


async def _deepgram_stream_async():
    global _stream_phrases

    params = urllib.parse.urlencode({
        "model":           "nova-3",
        "language":        "de",
        "encoding":        "linear16",
        "sample_rate":     str(SAMPLE_RATE),
        "interim_results": "false",
        "smart_format":    "true",
        "endpointing":     "500",
        "vad_events":      "true",
    })
    url = f"wss://api.deepgram.com/v1/listen?{params}"

    try:
        import websockets as ws_lib
    except ImportError:
        log.error("websockets nicht verfügbar")
        print("⚠ websockets nicht installiert")
        return

    loop = asyncio.get_event_loop()
    audio_queue: asyncio.Queue = asyncio.Queue()
    CHUNK_SAMPLES = int(SAMPLE_RATE * 0.1)

    def audio_callback(indata, frames, time_info, status):
        volume_level[0] = float(np.sqrt(np.mean(indata ** 2)))
        pcm = (indata.flatten() * 32767).astype(np.int16).tobytes()
        loop.call_soon_threadsafe(audio_queue.put_nowait, pcm)

    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

    try:
        async with ws_lib.connect(url, additional_headers=headers, ping_interval=20) as ws:
            log.info("Deepgram WebSocket verbunden (nova-3)")
            print("🔴 Deepgram verbunden (nova-3) – spreche jetzt...")

            async def _sender():
                while _stream_active:
                    try:
                        chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.2)
                        await ws.send(chunk)
                    except asyncio.TimeoutError:
                        continue
                    except Exception:
                        break
                try:
                    await ws.send(json.dumps({"type": "CloseStream"}))
                except Exception:
                    pass

            async def _receiver():
                global _stream_phrases  # FIX v1.5.0: nested-scope global declaration
                async for message in ws:
                    try:
                        data = json.loads(message)
                        if data.get("type") != "Results":
                            continue
                        if not data.get("is_final"):
                            continue
                        alts = data.get("channel", {}).get("alternatives", [])
                        if not alts:
                            continue
                        transcript = alts[0].get("transcript", "").strip()
                        transcript = re.sub(r'^[.!?,;:\s]+', '', transcript).strip()
                        if not transcript:
                            continue
                        transcript = format_text(transcript)
                        if transcript.strip():
                            _stream_phrases += 1
                            await loop.run_in_executor(None, _paste_text, transcript)
                            log.info("[deepgram] #%d: %s", _stream_phrases, transcript[:80])
                            print(f"\u2713 [deepgram #{_stream_phrases}] {transcript[:80]}")
                    except Exception as e:
                        log.error("Deepgram receive: %s", e)

            with sd.InputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                blocksize=CHUNK_SAMPLES, callback=audio_callback
            ):
                await asyncio.gather(_sender(), _receiver())

    except Exception as e:
        log.error("Deepgram WebSocket Fehler: %s", e)
        print(f"⚠ Deepgram Verbindungsfehler: {e}")


# ══════════════════════════════════════════════════════════════
#  ELEVENLABS SCRIBE V2 REALTIME (~150ms, sehr saubere Interpunktion)
# ══════════════════════════════════════════════════════════════

async def _scribe_stream_async():
    global _stream_phrases

    if not ELEVENLABS_API_KEY:
        log.error("Kein ElevenLabs API Key")
        print("⚠ Kein ElevenLabs API Key! Bitte in Einstellungen eintragen")
        if overlay_ref[0]:
            overlay_ref[0].show(error=True)
        return

    params = urllib.parse.urlencode({
        "model_id":               "scribe_v2_realtime",
        "language_code":          "deu",
        "audio_format":           "pcm_16000",
        "commit_strategy":        "vad",
        "vad_silence_threshold_secs": "0.5",
    })
    url = f"wss://api.elevenlabs.io/v1/speech-to-text/realtime?{params}"

    try:
        import websockets as ws_lib
    except ImportError:
        log.error("websockets nicht verfügbar")
        return

    loop = asyncio.get_event_loop()
    audio_queue: asyncio.Queue = asyncio.Queue()
    CHUNK_SAMPLES = int(SAMPLE_RATE * 0.1)

    def audio_callback(indata, frames, time_info, status):
        volume_level[0] = float(np.sqrt(np.mean(indata ** 2)))
        pcm = (indata.flatten() * 32767).astype(np.int16).tobytes()
        loop.call_soon_threadsafe(audio_queue.put_nowait, pcm)

    headers = {"xi-api-key": ELEVENLABS_API_KEY}

    try:
        async with ws_lib.connect(url, additional_headers=headers, ping_interval=20) as ws:
            log.info("ElevenLabs Scribe v2 verbunden")
            print("🟢 ElevenLabs Scribe v2 verbunden – spreche jetzt...")

            async def _sender():
                while _stream_active:
                    try:
                        chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.2)
                        msg = {
                            "message_type": "input_audio_chunk",
                            "audio_base_64": base64.b64encode(chunk).decode(),
                        }
                        await ws.send(json.dumps(msg))
                    except asyncio.TimeoutError:
                        continue
                    except Exception:
                        break
                # Letzten Buffer committen
                try:
                    await ws.send(json.dumps({
                        "message_type": "input_audio_chunk",
                        "audio_base_64": "",
                        "commit": True,
                    }))
                except Exception:
                    pass

            async def _receiver():
                global _stream_phrases  # FIX: nested-scope
                async for message in ws:
                    try:
                        data = json.loads(message)
                        msg_type = data.get("message_type") or data.get("type")
                        if msg_type != "committed_transcript":
                            continue
                        transcript = (data.get("text") or
                                      data.get("transcript") or "").strip()
                        transcript = re.sub(r'^[.!?,;:\s]+', '', transcript).strip()
                        if not transcript:
                            continue
                        transcript = format_text(transcript)
                        if transcript.strip():
                            _stream_phrases += 1
                            await loop.run_in_executor(None, _paste_text, transcript)
                            log.info("[scribe] #%d: %s", _stream_phrases, transcript[:80])
                            print(f"\u2713 [scribe #{_stream_phrases}] {transcript[:80]}")
                    except Exception as e:
                        log.error("Scribe receive: %s", e)

            with sd.InputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                blocksize=CHUNK_SAMPLES, callback=audio_callback
            ):
                await asyncio.gather(_sender(), _receiver())

    except Exception as e:
        log.error("ElevenLabs WebSocket Fehler: %s", e)
        print(f"⚠ ElevenLabs Verbindungsfehler: {e}")


def _scribe_stream_worker():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_scribe_stream_async())
    except Exception as e:
        log.error("Scribe-Stream Exception: %s", e)
    finally:
        loop.close()
        volume_level[0] = 0.0
        log.info("Scribe-Stream beendet. Phrasen: %d", _stream_phrases)


# ══════════════════════════════════════════════════════════════
#  STREAM CONTROL
# ══════════════════════════════════════════════════════════════

def _start_stream():
    global _stream_active, _stream_phrases
    with _stream_lock:
        if _stream_active:
            return
        _stream_active = True
        _stream_phrases = 0
    print(f"🔴 Live-Stream gestartet ({MODUS}) – Ctrl+Q zum Stoppen")
    if overlay_ref[0]:
        overlay_ref[0].show(stream=True)
    if MODUS == "stream-scribe":
        threading.Thread(target=_scribe_stream_worker, daemon=True).start()
    else:
        threading.Thread(target=_deepgram_stream_worker, daemon=True).start()


def _stop_stream():
    global _stream_active
    with _stream_lock:
        _stream_active = False
    if overlay_ref[0]:
        overlay_ref[0].hide()
    print(f"⏹ Stream gestoppt – {_stream_phrases} Phrasen transkribiert")


# ══════════════════════════════════════════════════════════════
#  LOKALE TRANSKRIPTION
# ══════════════════════════════════════════════════════════════

def transcribe_local(audio_data):
    if len(audio_data) / SAMPLE_RATE < 0.4:
        return "", None
    if local_model is None:
        return "", "Modell nicht geladen"
    segments, _ = local_model.transcribe(
        audio_data,
        language=LANGUAGE,
        initial_prompt=(
            "Schweizer Hochdeutsch. Artis Treuhand. "
            "Steuererklärung, Jahresrechnung, Buchhaltung, MWST, Quellensteuer, Lohnausweis. "
            "ss statt ß."
        ),
        beam_size=2,
        vad_filter=False,  # FIX v1.5.3: silero_vad_v6.onnx fehlt im PyInstaller-Bundle
        word_timestamps=False,
        condition_on_previous_text=False,
        temperature=0.0,
        compression_ratio_threshold=2.4,
        no_speech_threshold=0.6,
    )
    parts = []
    for seg in segments:
        t = seg.text.strip()
        if t:
            parts.append(t)
    return " ".join(parts).strip(), None


# ══════════════════════════════════════════════════════════════
#  FRAG SMARTIS – LLM-Abfrage über Kunden (Ctrl+Shift+Q)
# ══════════════════════════════════════════════════════════════

def _ask_record_audio():
    global _ask_audio_frames
    _ask_audio_frames = []

    def callback(indata, frames, time_info, status):
        if _ask_recording:
            _ask_audio_frames.append(indata.copy())
            volume_level[0] = float(np.sqrt(np.mean(indata ** 2)))

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1,
                        dtype='float32', callback=callback):
        while _ask_recording:
            time.sleep(0.05)
    volume_level[0] = 0.0


def _start_ask():
    global _ask_recording
    with _ask_lock:
        if _ask_recording:
            return
        _ask_recording = True
    print("🧠 Frag Smartis – Aufnahme... (Ctrl+Shift+Q zum Stoppen)")
    if overlay_ref[0]:
        overlay_ref[0].show(label="🧠 Frag Smartis...")
    threading.Thread(target=_ask_record_audio, daemon=True).start()


def _stop_ask():
    global _ask_recording
    with _ask_lock:
        _ask_recording = False
    if overlay_ref[0]:
        overlay_ref[0].hide()
    print("🧠 Verarbeite Frage...")
    threading.Thread(target=_ask_process, daemon=True).start()


def _transcribe_buffer_oneshot(audio_data):
    """Einmal-Transkription für Frag-Smartis. Lokal (zuverlässig, offline-fähig)."""
    if not _model_ready.wait(timeout=30):
        return "", "Modell nicht bereit"
    return transcribe_local(audio_data)


def _ask_process():
    if not _ask_audio_frames:
        print("⚠ Keine Aufnahme")
        return

    audio_data = np.concatenate(_ask_audio_frames, axis=0).flatten()
    if len(audio_data) / SAMPLE_RATE < 0.4:
        print("⚠ Aufnahme zu kurz")
        return

    try:
        question, err = _transcribe_buffer_oneshot(audio_data)
        if err or not question or not question.strip():
            print(f"⚠ Keine Frage erkannt ({err or 'leer'})")
            return
        question = question.strip()
        log.info("[ask] Frage (roh): %s", question)
        print(f"🧠 Erkannt: {question}")
    except Exception as e:
        log.error("[ask] Transkription: %s", e)
        print(f"⚠ Transkription-Fehler: {e}")
        return

    print("🧠 Korrektur-Dialog wird geöffnet...")
    question = _show_question_edit_dialog(question)
    if not question:
        print("🧠 Abgebrochen")
        return
    question = question.strip()
    log.info("[ask] Frage (bestätigt): %s", question)
    print(f"🧠 Sende Frage: {question}")

    try:
        import urllib.request
        payload = json.dumps({"question": question}).encode()
        req = urllib.request.Request(
            f"{_SUPABASE_URL}/functions/v1/voice-assistant",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_SUPABASE_ANON_KEY}",
                "apikey": _SUPABASE_ANON_KEY,
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())

        answer  = result.get("answer", "Keine Antwort erhalten.")
        sources = result.get("sources", [])
        data    = result.get("data", {}) or {}

        log.info("[ask] Antwort: %s", answer[:80])
        print(f"🧠 Antwort: {answer[:100]}...")
        _show_answer_popup(question, answer, sources, data)
    except Exception as e:
        log.error("[ask] API-Fehler: %s", e)
        print(f"⚠ Smartis-Fehler: {e}")
        _show_answer_popup(question, f"Fehler: {e}", [], {})


def _show_question_edit_dialog(initial_text: str):
    result_holder = [None]
    done = threading.Event()

    def _build():
        BG, CARD = "#0f172a", "#1e293b"
        ACC, FG, FG2 = "#8B5CF6", "#F1F5F9", "#94A3B8"

        win = tk.Toplevel()
        win.title("Frage prüfen – Smartis")
        win.configure(bg=BG)
        win.resizable(True, True)
        win.minsize(500, 260)

        hdr = tk.Frame(win, bg="#2d1b69", height=48)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="🧠 Frage prüfen & korrigieren",
                 font=("Segoe UI", 11, "bold"),
                 bg="#2d1b69", fg="white").pack(side="left", padx=14, pady=10)

        hint = tk.Frame(win, bg=BG)
        hint.pack(fill="x", padx=14, pady=(10, 4))
        tk.Label(hint, text="Erkannte Frage (bitte Namen/Begriffe prüfen und ggf. korrigieren):",
                 font=("Segoe UI", 9), bg=BG, fg=FG2).pack(anchor="w")

        txt_frame = tk.Frame(win, bg=CARD, highlightbackground="#4C1D95",
                             highlightthickness=1)
        txt_frame.pack(fill="x", padx=14, pady=(2, 10))

        entry = tk.Text(txt_frame, height=3, wrap="word",
                        bg=CARD, fg=FG, insertbackground=FG,
                        selectbackground=ACC,
                        font=("Segoe UI", 11), relief="flat",
                        padx=10, pady=8)
        entry.pack(fill="x")
        entry.insert("1.0", initial_text)
        entry.focus_set()
        entry.mark_set("insert", "end")
        entry.see("end")

        btn_frm = tk.Frame(win, bg=BG)
        # side="bottom" damit Buttons IMMER unten sichtbar sind, egal wie gross die Frage
        btn_frm.pack(side="bottom", fill="x", padx=14, pady=(0, 14))

        def on_send(event=None):
            text = entry.get("1.0", "end").strip()
            result_holder[0] = text if text else initial_text
            win.destroy()
            done.set()

        def on_cancel(event=None):
            result_holder[0] = None
            win.destroy()
            done.set()

        tk.Button(btn_frm, text="Absenden ↵", command=on_send,
                  bg=ACC, fg="white", font=("Segoe UI", 10, "bold"),
                  relief="flat", padx=18, pady=6, cursor="hand2",
                  activebackground="#7C3AED", activeforeground="white").pack(side="left")
        tk.Button(btn_frm, text="Abbrechen", command=on_cancel,
                  bg="#334155", fg=FG2, font=("Segoe UI", 10),
                  relief="flat", padx=14, pady=6, cursor="hand2",
                  activebackground="#475569", activeforeground=FG).pack(side="left", padx=(8, 0))

        win.bind("<Return>", on_send)
        win.bind("<Escape>", on_cancel)
        win.protocol("WM_DELETE_WINDOW", on_cancel)

        win.update_idletasks()
        sw = win.winfo_screenwidth()
        sh = win.winfo_screenheight()
        win.geometry(f"560x280+{(sw-560)//2}+{(sh-280)//2}")

    if overlay_ref[0] and overlay_ref[0].root:
        overlay_ref[0].root.after(0, _build)
    else:
        return None

    done.wait(timeout=120)
    return result_holder[0]


# ══════════════════════════════════════════════════════════════
#  KUNDEN-PICKER (Ctrl+W) – alles der letzten Monate
# ══════════════════════════════════════════════════════════════

_customer_cache = {"items": [], "ts": 0.0}

def _load_customers():
    """Lädt Kundenliste via Edge Function (umgeht RLS), gecached 5 Minuten."""
    if _customer_cache["items"] and (time.time() - _customer_cache["ts"]) < 300:
        return _customer_cache["items"]
    try:
        import urllib.request
        payload = json.dumps({"get_customers": True}).encode()
        req = urllib.request.Request(
            f"{_SUPABASE_URL}/functions/v1/voice-assistant",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "apikey": _SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {_SUPABASE_ANON_KEY}",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
        data = body.get("customers", [])
        _customer_cache["items"] = data
        _customer_cache["ts"] = time.time()
        log.info("Kunden geladen: %d", len(data))
        return data
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = "(kein body)"
        log.error("Kunden laden: HTTP %s @ %s | URL=%s | RESPONSE=%s",
                  e.code, e.reason, e.url, err_body[:500])
        return []
    except Exception as e:
        log.error("Kunden laden: %s", e)
        return []


def _open_customer_picker():
    """Öffnet Kunden-Auswahl-Dialog. Bei Auswahl → Quadranten-Popup."""
    customers = _load_customers()
    if not customers:
        log.error("Keine Kunden geladen")
        return

    def _build():
        BG       = "#f2f5f2"
        CARD     = "#ffffff"
        CARD_HDR = "#e6ede6"
        BORDER   = "#bfcfbf"
        ACC      = "#7a9b7f"
        ACC_DARK = "#5a7b5f"
        FG       = "#1a3a1a"
        FG2      = "#6b826b"
        HOVER    = "#eaf0ea"

        win = tk.Toplevel()
        win.title("Kunde wählen – Smartis")
        win.configure(bg=BG)
        win.resizable(True, True)
        win.minsize(480, 500)

        hdr = tk.Frame(win, bg=ACC, height=46)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="👥 Kunde wählen", font=("Segoe UI", 12, "bold"),
                 bg=ACC, fg="white").pack(side="left", padx=14, pady=10)
        tk.Button(hdr, text="✕", command=win.destroy, bg=ACC, fg="white",
                  font=("Segoe UI", 12), relief="flat", padx=10,
                  cursor="hand2", activebackground=ACC_DARK,
                  activeforeground="white").pack(side="right", padx=8)

        opt_frm = tk.Frame(win, bg=BG)
        opt_frm.pack(fill="x", padx=12, pady=(10, 4))
        tk.Label(opt_frm, text="Zeige Aktionen der letzten",
                 font=("Segoe UI", 9), bg=BG, fg=FG2).pack(side="left")
        months_var = tk.StringVar(value="6")
        months_box = tk.Spinbox(opt_frm, from_=1, to=60, width=4, textvariable=months_var,
                                font=("Segoe UI", 9), bg=CARD, fg=FG, relief="flat",
                                highlightbackground=BORDER, highlightthickness=1)
        months_box.pack(side="left", padx=6)
        tk.Label(opt_frm, text="Monate", font=("Segoe UI", 9),
                 bg=BG, fg=FG2).pack(side="left")

        srch_frm = tk.Frame(win, bg=BG)
        srch_frm.pack(fill="x", padx=12, pady=(8, 4))
        tk.Label(srch_frm, text="🔍 Suche:", font=("Segoe UI", 9, "bold"),
                 bg=BG, fg=FG).pack(side="left")
        search_var = tk.StringVar()
        search_entry = tk.Entry(srch_frm, textvariable=search_var,
                                font=("Segoe UI", 11), bg=CARD, fg=FG,
                                relief="flat", highlightbackground=BORDER,
                                highlightcolor=ACC, highlightthickness=1,
                                insertbackground=FG)
        search_entry.pack(side="left", fill="x", expand=True, padx=(8, 0), ipady=4)

        def _force_focus():
            try:
                # Windows: Fenster-Handle holen und via ctypes nach vorne zwingen
                hwnd = ctypes.windll.user32.GetParent(win.winfo_id()) or win.winfo_id()
                ctypes.windll.user32.ShowWindow(hwnd, 9)          # SW_RESTORE
                ctypes.windll.user32.SetForegroundWindow(hwnd)
            except Exception:
                pass
            win.lift()
            win.focus_force()
            search_entry.focus_set()

        win.after(150, _force_focus)

        list_frm = tk.Frame(win, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        list_frm.pack(fill="both", expand=True, padx=12, pady=(8, 6))

        canvas = tk.Canvas(list_frm, bg=CARD, highlightthickness=0)
        sb = tk.Scrollbar(list_frm, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=CARD)
        inner.bind("<Configure>",
                   lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw", tags="inner")
        canvas.configure(yscrollcommand=sb.set)
        canvas.bind("<Configure>",
                    lambda e: canvas.itemconfig("inner", width=e.width))
        canvas.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        def _on_mousewheel(e):
            canvas.yview_scroll(int(-1 * (e.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", _on_mousewheel)

        def cleanup_mousewheel():
            try: canvas.unbind_all("<MouseWheel>")
            except Exception: pass

        def select_customer(cust):
            try: months = int(months_var.get())
            except Exception: months = 6
            cleanup_mousewheel()
            win.destroy()
            threading.Thread(
                target=_load_customer_actions,
                args=(cust["id"], cust["company_name"], months),
                daemon=True
            ).start()

        # Pfeil-Navigation: sichtbare Einträge + aktueller Index
        _visible = []   # liste von (customer_dict, row_frame, [children])
        _sel_idx = [-1]  # aktuell markierter Index

        def _set_sel(idx):
            """Hebt Eintrag idx grün hervor, alle anderen zurücksetzen."""
            for i, (_, row, children) in enumerate(_visible):
                bg = HOVER if i == idx else CARD
                row.config(bg=bg)
                for ch in children:
                    try: ch.config(bg=bg)
                    except Exception: pass
            _sel_idx[0] = idx
            # In Canvas scrollen damit Eintrag sichtbar
            if 0 <= idx < len(_visible):
                _, row, _ = _visible[idx]
                try:
                    canvas.update_idletasks()
                    y1 = row.winfo_y()
                    y2 = y1 + row.winfo_height()
                    total = inner.winfo_height()
                    if total > 0:
                        canvas.yview_moveto(max(0.0, (y1 - 20) / total))
                except Exception:
                    pass

        def render(filter_text=""):
            _visible.clear()
            _sel_idx[0] = -1
            for w in inner.winfo_children():
                w.destroy()
            ft = (filter_text or "").lower().strip()
            shown = 0
            for c in customers:
                name = c.get("company_name") or ""
                if ft and ft not in name.lower():
                    continue
                shown += 1
                if shown > 200:
                    break
                row = tk.Frame(inner, bg=CARD, cursor="hand2")
                row.pack(fill="x", padx=2, pady=1)
                lbl = tk.Label(row, text=f"  👤  {name}",
                               font=("Segoe UI", 10), bg=CARD, fg=FG,
                               anchor="w", padx=8, pady=6)
                lbl.pack(side="left", fill="x", expand=True)
                arrow = tk.Label(row, text="→", font=("Segoe UI", 11, "bold"),
                                 bg=CARD, fg=ACC, padx=10)
                arrow.pack(side="right")
                idx = len(_visible)
                _visible.append((c, row, [lbl, arrow]))
                for w in (row, lbl, arrow):
                    w.bind("<Button-1>", lambda e, cust=c: select_customer(cust))
                    w.bind("<Enter>", lambda e, r=row, ch=[lbl, arrow]: (
                        r.config(bg=HOVER), [x.config(bg=HOVER) for x in ch]))
                    w.bind("<Leave>", lambda e, r=row, ch=[lbl, arrow]: (
                        r.config(bg=CARD), [x.config(bg=CARD) for x in ch]))

        def on_search(*_):
            render(search_var.get())

        def on_arrow_down(e):
            if not _visible: return
            _set_sel(min(_sel_idx[0] + 1, len(_visible) - 1))

        def on_arrow_up(e):
            if not _visible: return
            _set_sel(max(_sel_idx[0] - 1, 0))

        def on_enter(e):
            # Wenn ein Eintrag per Pfeil markiert → diesen wählen
            if 0 <= _sel_idx[0] < len(_visible):
                select_customer(_visible[_sel_idx[0]][0])
                return
            # Sonst erste Übereinstimmung
            if _visible:
                select_customer(_visible[0][0])

        search_var.trace_add("write", on_search)
        search_entry.bind("<Return>", on_enter)
        search_entry.bind("<Down>", on_arrow_down)
        search_entry.bind("<Up>", on_arrow_up)
        win.bind("<Escape>", lambda e: (cleanup_mousewheel(), win.destroy()))
        win.protocol("WM_DELETE_WINDOW", lambda: (cleanup_mousewheel(), win.destroy()))

        render()

        win.update_idletasks()
        sw = win.winfo_screenwidth()
        sh = win.winfo_screenheight()
        win.geometry(f"560x600+{(sw-560)//2}+{(sh-600)//2}")

    if overlay_ref[0] and overlay_ref[0].root:
        overlay_ref[0].root.after(0, _build)


def _load_customer_actions(customer_id, customer_name, since_months):
    """Lädt alle Aktionen eines Kunden via voice-assistant + zeigt Quadranten-Popup."""
    try:
        import urllib.request
        payload = json.dumps({
            "customer_id": customer_id,
            "since_months": since_months,
        }).encode()
        req = urllib.request.Request(
            f"{_SUPABASE_URL}/functions/v1/voice-assistant",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_SUPABASE_ANON_KEY}",
                "apikey": _SUPABASE_ANON_KEY,
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        answer  = result.get("answer", "")
        sources = result.get("sources", []) or []
        data    = result.get("data", {}) or {}
        log.info("[customer] %s: data-keys=%s", customer_name, list(data.keys()))
        question = f"Aktionen von {customer_name} (letzte {since_months} Monate)"
        _show_answer_popup(question, answer, sources, data)
    except Exception as e:
        log.error("[customer] Fehler: %s", e)
        _show_answer_popup(
            f"Kunde: {customer_name}",
            f"Fehler beim Laden: {e}",
            [], {}
        )


def _show_answer_popup(question, answer, sources, data=None):
    """Antwort-Fenster im Artis-Grün-Theme mit Quadranten-Layout.

    Layout:
      ┌────────────┬────────────┐
      │ Aufgaben   │ Dokumente  │
      ├────────────┼────────────┤
      │ Kontakte   │ Fristen    │
      ├────────────┼────────────┤
      │ Aktienbuch │ Fahrzeuge  │
      ├────────────┼────────────┤
      │ Telefonate │ Mails      │
      ├────────────┴────────────┤
      │ Quellen (klickbar)      │
      └─────────────────────────┘
    """
    data = data or {}

    def _build():
        # ── Artis-Grün-Theme ────────────────────────────────────
        BG       = "#f2f5f2"   # Page-Background
        CARD     = "#ffffff"   # Card-Background
        CARD_HDR = "#e6ede6"   # Card-Header
        BORDER   = "#bfcfbf"
        ACC      = "#7a9b7f"   # Artis-Grün
        ACC_DARK = "#5a7b5f"
        FG       = "#1a3a1a"
        FG2      = "#6b826b"
        HOVER    = "#eaf0ea"

        win = tk.Toplevel()
        win.title("Smartis – Antwort")
        win.configure(bg=BG)
        win.resizable(True, True)

        # ── Header ──────────────────────────────────────────────
        hdr = tk.Frame(win, bg=ACC, height=52)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="🧠 Smartis", font=("Segoe UI", 13, "bold"),
                 bg=ACC, fg="white").pack(side="left", padx=16, pady=10)
        tk.Button(hdr, text="✕", command=win.destroy, bg=ACC, fg="white",
                  font=("Segoe UI", 12), relief="flat", padx=10,
                  cursor="hand2", activebackground=ACC_DARK,
                  activeforeground="white").pack(side="right", padx=8)

        # ── Frage + Kurzantwort (oberer Bereich) ────────────────
        top = tk.Frame(win, bg=BG)
        top.pack(fill="x", padx=12, pady=(10, 6))
        tk.Label(top, text=f"Frage:  {question}",
                 font=("Segoe UI", 9, "italic"),
                 bg=BG, fg=ACC_DARK, wraplength=900, justify="left",
                 anchor="w").pack(anchor="w")

        # Kurz-Zusammenfassung (erste paar Zeilen der answer)
        if answer:
            short = answer.split("\n\n")[0][:300]
            tk.Label(top, text=short, font=("Segoe UI", 9),
                     bg=BG, fg=FG, wraplength=900, justify="left",
                     anchor="w").pack(anchor="w", pady=(4, 0))

        # ── Quadranten-Grid ─────────────────────────────────────
        grid = tk.Frame(win, bg=BG)
        grid.pack(fill="both", expand=True, padx=12, pady=4)
        grid.columnconfigure(0, weight=1, uniform="col")
        grid.columnconfigure(1, weight=1, uniform="col")
        for r in range(4):
            grid.rowconfigure(r, weight=1, uniform="row")

        _PAGES = {"dokument":"Dokumente","frist":"Fristen","task":"TaskBoard",
                  "mail":"MailKanban","call":"TelefonDashboard",
                  "aktie":"Aktienbuch","fahrzeug":"Fahrzeugliste",
                  "kunde":"Kunden"}

        def _src_url(s_type, s_id):
            page = _PAGES.get(s_type, "Dokumente")
            if s_type == "mail" and s_id:
                return f"{_SMARTIS_BASE}/{page}?mail={s_id}"
            if s_id:
                return f"{_SMARTIS_BASE}/{page}?open={s_id}"
            return f"{_SMARTIS_BASE}/{page}"

        def make_card(parent, row, col, title, icon, items, formatter, src_type):
            """Karte mit klickbaren Items."""
            card = tk.Frame(parent, bg=CARD, highlightbackground=BORDER,
                            highlightthickness=1)
            card.grid(row=row, column=col, sticky="nsew", padx=4, pady=4)

            # Card-Header
            chdr = tk.Frame(card, bg=CARD_HDR, height=28)
            chdr.pack(fill="x")
            chdr.pack_propagate(False)
            count_txt = f"  ({len(items)})" if items else ""
            tk.Label(chdr, text=f"{icon}  {title}{count_txt}",
                     font=("Segoe UI", 9, "bold"),
                     bg=CARD_HDR, fg=FG).pack(side="left", padx=10, pady=4)

            body = tk.Frame(card, bg=CARD)
            body.pack(fill="both", expand=True, padx=2, pady=2)

            if not items:
                tk.Label(body, text="—", font=("Segoe UI", 9),
                         bg=CARD, fg=FG2).pack(pady=10)
                return

            # Scrollbarer Inhalt für viele Einträge
            canvas = tk.Canvas(body, bg=CARD, highlightthickness=0)
            sb = tk.Scrollbar(body, orient="vertical", command=canvas.yview)
            inner = tk.Frame(canvas, bg=CARD)
            inner.bind("<Configure>",
                       lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
            canvas.create_window((0, 0), window=inner, anchor="nw")
            canvas.configure(yscrollcommand=sb.set)
            canvas.pack(side="left", fill="both", expand=True)
            sb.pack(side="right", fill="y")

            for it in items[:12]:
                txt = formatter(it)
                s_id = it.get("id", "")
                url = _src_url(src_type, s_id)
                row_frm = tk.Frame(inner, bg=CARD, cursor="hand2")
                row_frm.pack(fill="x", padx=2, pady=1)
                lbl = tk.Label(row_frm, text=txt, font=("Segoe UI", 8),
                               bg=CARD, fg=FG, anchor="w",
                               wraplength=400, justify="left",
                               padx=6, pady=2)
                lbl.pack(side="left", fill="x", expand=True)
                for w in (row_frm, lbl):
                    w.bind("<Button-1>", lambda e, u=url: webbrowser.open(u))
                    w.bind("<Enter>", lambda e, r=row_frm: r.config(bg=HOVER) or
                           [c.config(bg=HOVER) for c in r.winfo_children()])
                    w.bind("<Leave>", lambda e, r=row_frm: r.config(bg=CARD) or
                           [c.config(bg=CARD) for c in r.winfo_children()])

        # Sind alle Daten von einem einzigen Kunden? → Kundennamen nicht wiederholen
        _custs = data.get("customers") or []
        _single = len(_custs) == 1

        # Formatter
        def f_task(t):
            st = "✅" if t.get("status") == "done" else "🔲"
            d = t.get("due_date","").split("T")[0] if t.get("due_date") else ""
            d = ".".join(d.split("-")[::-1]) if d else "–"
            if _single:
                return f"{st} {t.get('title','–')}  ·  {d}"
            cust = t.get("customer_name") or "–"
            return f"{st} {t.get('title','–')}  ·  {cust}  ·  {d}"

        def f_dok(d):
            if _single:
                return f"📄 {d.get('name','–')}"
            cust = d.get("customer_name") or "–"
            return f"📄 {d.get('name','–')}  ·  {cust}"

        def f_kunde(c):
            return f"👤 {c.get('company_name','–')}"

        def f_frist(f):
            st = "✅" if f.get("status")=="erledigt" else "📤" if f.get("status")=="eingereicht" else "🔴"
            d = f.get("due_date","").split("T")[0] if f.get("due_date") else ""
            d = ".".join(d.split("-")[::-1]) if d else "–"
            if _single:
                return f"{st} {f.get('title') or f.get('category','–')}  ·  {d}"
            cust = f.get("customer_name") or "–"
            return f"{st} {f.get('title') or f.get('category','–')}  ·  {cust}  ·  {d}"

        def f_aktie(a):
            d = a.get("kaufdatum","").split("T")[0] if a.get("kaufdatum") else ""
            d = ".".join(d.split("-")[::-1]) if d else "–"
            if _single:
                return f"📜 {a.get('aktionaer_name','–')}  ·  {a.get('transaktionstyp','–')} {d}"
            cust = a.get("customer_name") or "–"
            return f"📜 {a.get('aktionaer_name','–')}  ·  {cust}  ·  {a.get('transaktionstyp','–')} {d}"

        def f_fahrzeug(fz):
            mm = f"{fz.get('marke','')} {fz.get('modell','')}".strip() or "–"
            if _single:
                return f"🚗 {fz.get('kennzeichen','–')}  ·  {mm}"
            cust = fz.get("customer_name") or "–"
            return f"🚗 {fz.get('kennzeichen','–')}  ·  {mm}  ·  {cust}"

        def f_call(c):
            partner = (c.get("caller_name") or c.get("caller_number")
                       if c.get("direction")=="in"
                       else c.get("callee_name") or c.get("callee_number")) or "–"
            arrow = "⬅" if c.get("direction")=="in" else "➡"
            cust = c.get("customer_name") or "–"
            t = c.get("start_time","")
            ts = ""
            if t:
                try:
                    ts = t.split("T")[0]
                    ts = ".".join(ts.split("-")[::-1])
                except Exception:
                    ts = t
            base = f"{arrow} {partner}  ·  {cust}  ·  {ts}"
            notes = (c.get("notes") or "").strip()
            if notes:
                base += f"\n   📝 {notes[:140]}"
            return base

        def f_mail(m):
            d = m.get("received_date","").split("T")[0] if m.get("received_date") else ""
            d = ".".join(d.split("-")[::-1]) if d else "–"
            return f"📧 {m.get('subject','–')}  ·  {m.get('from_address','')}  ·  {d}"

        # Quadranten füllen (User-Layout):
        # Row 0: Aufgaben | Dokumente
        # Row 1: Kontakte | Fristen
        # Row 2: Aktienbuch | Fahrzeuge
        # Row 3: Telefonate | Mails
        make_card(grid, 0, 0, "Aufgaben",   "✅", data.get("tasks", []),     f_task,     "task")
        make_card(grid, 0, 1, "Dokumente",  "📄", data.get("doks", []),      f_dok,      "dokument")
        make_card(grid, 1, 0, "Kontakte",   "👤", data.get("customers", []), f_kunde,    "kunde")
        make_card(grid, 1, 1, "Fristen",    "📅", data.get("fristen", []),   f_frist,    "frist")
        make_card(grid, 2, 0, "Aktienbuch", "📜", data.get("aktien", []),    f_aktie,    "aktie")
        make_card(grid, 2, 1, "Fahrzeuge",  "🚗", data.get("fahrzeuge", []), f_fahrzeug, "fahrzeug")
        make_card(grid, 3, 0, "Telefonate", "☎", data.get("calls", []),     f_call,     "call")
        make_card(grid, 3, 1, "Mails",      "📧", data.get("mails", []),     f_mail,     "mail")

        # ── Quellen-Leiste (volle Breite) ───────────────────────
        if sources:
            src_frm = tk.Frame(win, bg=CARD_HDR, highlightbackground=BORDER,
                               highlightthickness=1)
            src_frm.pack(fill="x", padx=12, pady=(6, 4))
            tk.Label(src_frm,
                     text=f"📎 {len(sources)} Top-Quelle(n) – klicken zum Öffnen",
                     font=("Segoe UI", 8, "bold"),
                     bg=CARD_HDR, fg=ACC_DARK).pack(anchor="w", padx=10, pady=(4, 2))

            row_box = tk.Frame(src_frm, bg=CARD_HDR)
            row_box.pack(fill="x", padx=8, pady=(0, 6))

            for src in sources[:10]:
                s_type = src.get("type", "?")
                s_id   = src.get("id", "")
                s_title= src.get("title", "–")[:35]
                s_cust = src.get("customer_name", "")
                url    = _src_url(s_type, s_id)
                icon   = {"frist":"📅","task":"✅","mail":"📧","dokument":"📄",
                          "call":"☎","aktie":"📜","fahrzeug":"🚗"}.get(s_type, "📋")
                txt    = f"{icon} {s_title}"
                if s_cust: txt += f" · {s_cust[:18]}"

                btn = tk.Label(row_box, text=txt, bg="white", fg=ACC_DARK,
                               font=("Segoe UI", 8), padx=8, pady=3,
                               cursor="hand2",
                               highlightbackground=BORDER, highlightthickness=1)
                btn.pack(side="left", padx=2, pady=2)
                btn.bind("<Button-1>", lambda e, u=url: webbrowser.open(u))
                btn.bind("<Enter>", lambda e, b=btn: b.config(bg=HOVER))
                btn.bind("<Leave>", lambda e, b=btn: b.config(bg="white"))

        # ── Footer-Buttons ──────────────────────────────────────
        btn_frm = tk.Frame(win, bg=BG)
        btn_frm.pack(side="bottom", fill="x", padx=12, pady=(6, 12))

        def copy_answer():
            pyperclip.copy(answer)
            copy_btn.config(text="✓ Kopiert!")
            win.after(1500, lambda: copy_btn.config(text="📋 Kopieren"))

        copy_btn = tk.Button(btn_frm, text="📋 Kopieren",
                             font=("Segoe UI", 9), bg=CARD_HDR, fg=FG,
                             relief="flat", padx=14, pady=6, cursor="hand2",
                             activebackground=HOVER, command=copy_answer)
        copy_btn.pack(side="left", padx=(0, 8))

        def paste_answer():
            pyperclip.copy(answer)
            time.sleep(0.02)
            win.destroy()
            time.sleep(0.1)
            pyautogui.hotkey("ctrl", "v")

        tk.Button(btn_frm, text="📝 Einfügen & Schliessen",
                  font=("Segoe UI", 9, "bold"), bg=ACC, fg="white",
                  relief="flat", padx=14, pady=6, cursor="hand2",
                  activebackground=ACC_DARK,
                  command=lambda: threading.Thread(target=paste_answer, daemon=True).start()
                  ).pack(side="left", padx=(0, 8))

        tk.Button(btn_frm, text="Schliessen",
                  font=("Segoe UI", 9), bg=CARD_HDR, fg=FG,
                  relief="flat", padx=14, pady=6, cursor="hand2",
                  activebackground=HOVER, command=win.destroy
                  ).pack(side="right")

        # ── Fenster zentrieren & gross machen ───────────────────
        win.update_idletasks()
        sw = win.winfo_screenwidth()
        sh = win.winfo_screenheight()
        w  = min(1100, max(900, sw - 200))
        h  = min(800, max(680, sh - 150))
        win.geometry(f"{w}x{h}+{(sw-w)//2}+{(sh-h)//2}")
        win.bind("<Escape>", lambda e: win.destroy())
        win.focus_force()

    if overlay_ref[0] and overlay_ref[0].root:
        overlay_ref[0].root.after(0, _build)


# ══════════════════════════════════════════════════════════════
#  LOKAL-MODUS: Push-to-talk Aufnahme + Transkription
# ══════════════════════════════════════════════════════════════

def record_audio():
    global audio_frames
    audio_frames = []

    def callback(indata, frames, time_info, status):
        if recording:
            audio_frames.append(indata.copy())
            volume_level[0] = float(np.sqrt(np.mean(indata ** 2)))

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1,
                        dtype='float32', callback=callback):
        while recording:
            time.sleep(0.05)
    volume_level[0] = 0.0


def transcribe_and_insert():
    if overlay_ref[0]:
        overlay_ref[0].hide()
    if not audio_frames:
        return

    if not _model_ready.wait(timeout=60):
        log.error("Modell nicht bereit nach 60s – abgebrochen")
        return

    audio_data = np.concatenate(audio_frames, axis=0).flatten()
    t = time.time()

    try:
        log.info("[lokal] Transkription")
        text, _ = transcribe_local(audio_data)

        if text:
            text_cmd = text.strip().lower()
            if re.match(r'^open\s+prompts?$', text_cmd):
                _toggle_prompt_panel()
                print("✓ Prompt-Panel geöffnet")
                return
            m = re.match(r'^open\s+(\w+)$', text_cmd)
            if m:
                app_key = m.group(1)
                if app_key in _APP_COMMANDS:
                    try:
                        os.startfile(_APP_COMMANDS[app_key])
                        print(f"✓ {app_key} geöffnet")
                    except Exception as e:
                        print(f"⚠ Kann {app_key} nicht öffnen: {e}")
                    return
            text = format_text(text)
            pyperclip.copy(text)
            time.sleep(0.02)
            pyautogui.hotkey('ctrl', 'v')
            print(f"✓ [{time.time()-t:.1f}s] [lokal]  {text}")
        else:
            print("⚠  Kein Text erkannt")
    except Exception as e:
        print(f"⚠ Fehler: {e}")


def _start_recording():
    global recording
    with recording_lock:
        recording = True
    print("● Aufnahme... (Ctrl+Q zum Stoppen)")
    if overlay_ref[0]:
        overlay_ref[0].show()
    threading.Thread(target=record_audio, daemon=True).start()


def _stop_recording():
    global recording
    with recording_lock:
        recording = False
    print("◼ Verarbeite...")
    threading.Thread(target=transcribe_and_insert, daemon=True).start()


# ══════════════════════════════════════════════════════════════
#  HOTKEY  (Strg + Q  /  Strg + Shift + Q)
# ══════════════════════════════════════════════════════════════

_w_held = False

def on_press(key):
    global _ctrl_held, _q_held, _shift_held, _w_held

    if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
        _ctrl_held = True
        return

    if key in (keyboard.Key.shift, keyboard.Key.shift_l, keyboard.Key.shift_r):
        _shift_held = True
        return

    try:
        is_q = key.char in ('q', '\x11')
    except AttributeError:
        is_q = False
    # W-Taste: VK-Code 87 ist modifier-unabhängig (char kann None sein bei Ctrl+Shift+W)
    is_w = getattr(key, 'vk', None) == 87

    # DEBUG: immer loggen wenn Ctrl gedrückt (damit wir sehen was pynput sendet)
    if _ctrl_held:
        log.info("DEBUG key: repr=%r char=%r vk=%r is_w=%r ctrl=%r shift=%r",
                 key, getattr(key,'char',None), getattr(key,'vk',None), is_w, _ctrl_held, _shift_held)

    if is_w and not _w_held and _ctrl_held and _shift_held:
        _w_held = True
        # Ctrl+W → Kunden-Picker (zeige alles der letzten Monate)
        threading.Thread(target=_open_customer_picker, daemon=True).start()
        return

    if is_q and not _q_held:
        _q_held = True
        if _ctrl_held and _shift_held:
            if not _ask_recording:
                _start_ask()
            else:
                _stop_ask()
        elif _ctrl_held:
            if MODUS in ("stream-deepgram", "stream-scribe"):
                if not _stream_active:
                    _start_stream()
                else:
                    _stop_stream()
            else:
                if not recording:
                    _start_recording()
                else:
                    _stop_recording()


def on_release(key):
    global _ctrl_held, _q_held, _shift_held, _w_held

    if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
        _ctrl_held = False
    if key in (keyboard.Key.shift, keyboard.Key.shift_l, keyboard.Key.shift_r):
        _shift_held = False
    try:
        if key.char in ('q', '\x11'):
            _q_held = False
        if getattr(key, 'vk', None) == 87:
            _w_held = False
    except AttributeError:
        pass


# ══════════════════════════════════════════════════════════════
#  TRAY-ICON
# ══════════════════════════════════════════════════════════════

_MODUS_LABELS = {
    "stream-deepgram": "🔴 DEEPGRAM",
    "stream-scribe":   "🟢 SCRIBE v2",
    "lokal":           "💻 LOKAL",
}
_MODUS_ICONS = {
    "stream-deepgram": "🔴Deepgram",
    "stream-scribe":   "🟢Scribe",
    "lokal":           "💻Lokal",
}

def _set_modus(neuer_modus):
    global MODUS
    MODUS = neuer_modus
    cfg2 = load_config()
    cfg2["MODUS"] = neuer_modus
    save_config(cfg2)
    print(f"Modus: {_MODUS_LABELS.get(neuer_modus, neuer_modus)}")
    _update_tray_title()

def _update_tray_title():
    if tray_icon_ref[0]:
        modus_str = _MODUS_ICONS.get(MODUS, MODUS)
        tray_icon_ref[0].title = f"{APP_NAME}  [{modus_str} | {MODEL_SIZE}]"

# ── Autostart (Windows Registry) ──
_REG_RUN = r"Software\Microsoft\Windows\CurrentVersion\Run"

def autostart_enabled():
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN, 0, winreg.KEY_READ)
        winreg.QueryValueEx(key, "VoxDrop")
        winreg.CloseKey(key)
        return True
    except (FileNotFoundError, OSError):
        return False

def set_autostart(enable):
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN, 0, winreg.KEY_SET_VALUE)
        if enable:
            winreg.SetValueEx(key, "VoxDrop", 0, winreg.REG_SZ, f'"{EXE_PATH}"')
        else:
            try:
                winreg.DeleteValue(key, "VoxDrop")
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except OSError as e:
        print(f"⚠ Autostart-Fehler: {e}")

def toggle_autostart(icon, item):
    set_autostart(not autostart_enabled())

def switch_modus(modus):
    def handler(icon, item):
        _set_modus(modus)
    return handler

def load_model_local(size):
    global local_model, MODEL_SIZE
    MODEL_SIZE = size
    print(f"Lade lokales Modell '{size}'...")
    try:
        local_model = WhisperModel(size, device="cpu", compute_type="int8")
        cfg2 = load_config()
        cfg2["MODELL"] = size
        save_config(cfg2)
        print(f"Modell '{size}' bereit ✓")
    except Exception as e:
        log.error("Modell-Wechsel fehlgeschlagen: %s", e)
        print(f"⚠ Modell-Wechsel fehlgeschlagen: {e}")
    _update_tray_title()

def switch_model(size):
    def handler(icon, item):
        threading.Thread(target=load_model_local, args=(size,), daemon=True).start()
    return handler

def _make_mic_icon(size=64):
    s = size
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx  = s // 2
    for i in range(s//2, -1, -1):
        t = i / (s // 2)
        d.ellipse([cx-i, cx-i, cx+i, cx+i],
                  fill=(int(10+t*20), int(15+t*30), int(90+t*60), 255))
    mw = int(s * 0.175)
    d.rounded_rectangle([cx-mw, int(s*.14), cx+mw, int(s*.52)],
                        radius=mw, fill=(255,255,255,255))
    aw = int(s * 0.26); lw = max(2, s//22)
    d.arc([cx-aw, int(s*.35), cx+aw, int(s*.66)],
          start=0, end=180, fill=(255,255,255,255), width=lw)
    sw = max(2, s//26)
    sy1, sy2 = int(s*.63), int(s*.76)
    d.rectangle([cx-sw, sy1, cx+sw, sy2], fill=(255,255,255,255))
    d.rectangle([cx-int(s*.18), sy2, cx+int(s*.18), sy2+max(2,s//22)],
                fill=(255,255,255,255))
    lw2 = max(1, s//28)
    for r_frac, alpha in [(0.33, 210), (0.46, 140), (0.60, 70)]:
        wr = int(s * r_frac)
        wt, wb = int(s*.26), int(s*.60)
        d.arc([cx-wr*2, wt, cx,     wb], start=130, end=230,
              fill=(255,255,255,alpha), width=lw2)
        d.arc([cx,      wt, cx+wr*2, wb], start=310, end=50,
              fill=(255,255,255,alpha), width=lw2)
    return img


def create_tray_icon():
    img = _make_mic_icon(64)

    def show_hilfe(icon, item):
        def _build():
            win = tk.Toplevel()
            win.title("VoxDrop – Sprachbefehle")
            win.configure(bg="#111827")
            win.resizable(False, False)
            win.attributes("-topmost", True)

            BG, HDR, ACC, FG, FG2 = "#111827", "#1E293B", "#3B82F6", "#F1F5F9", "#94A3B8"
            MONO, SANS = ("Consolas", 9), ("Segoe UI", 9)

            tk.Label(win, text="VoxDrop  –  Sprachbefehle", bg=BG,
                     fg=ACC, font=("Segoe UI", 12, "bold"), pady=12).pack(fill="x")

            sections = [
                ("⌨  Hotkeys", [
                    ("1× Strg+Q",           "Diktat starten"),
                    ("2× Strg+Q",           "Diktat stoppen & einfügen"),
                    ("1× Strg+Shift+Q",     "Frag Smartis starten"),
                    ("2× Strg+Shift+Q",     "Frage absenden → Antwort-Popup"),
                    ("Strg+Shift+W",        "Kunde wählen → Aktionen letzte Monate"),
                ]),
                ("↵  Zeilenumbrüche", [
                    ("neue Zeile",          "→  ↵"),
                    ("Zeilenumbruch",       "→  ↵"),
                    ("Absatz",              "→  ↵↵"),
                ]),
                ("(  Klammern", [
                    ("Klammer auf/zu",      "→  (  )"),
                    ("eckige Klammer auf/zu","→  [  ]"),
                ]),
                ("•  Aufzählungen", [
                    ("Aufzählungszeichen",  "→  •"),
                    ("Spiegelstrich",       "→  -"),
                    ("Strich vorne",        "→  -"),
                ]),
                ("1.  Nummerierte Listen", [
                    ("erstens / zweitens …","→  1.  /  2.  …"),
                    ("1. Text 2. Text",     "→  Zeilenumbruch automatisch"),
                ]),
            ]

            for title, rows in sections:
                hdr = tk.Frame(win, bg=HDR)
                hdr.pack(fill="x", padx=12, pady=(8, 0))
                tk.Label(hdr, text=title, bg=HDR, fg=ACC,
                         font=("Segoe UI", 9, "bold"), padx=8, pady=4).pack(anchor="w")
                frm = tk.Frame(win, bg=BG)
                frm.pack(fill="x", padx=12, pady=(0, 2))
                for cmd, desc in rows:
                    row = tk.Frame(frm, bg=BG)
                    row.pack(fill="x", pady=1)
                    tk.Label(row, text=cmd,  bg=BG, fg=FG,  font=MONO,
                             width=26, anchor="w", padx=8).pack(side="left")
                    tk.Label(row, text=desc, bg=BG, fg=FG2, font=SANS,
                             anchor="w").pack(side="left")

            tk.Button(win, text="Schliessen", command=win.destroy,
                      bg=ACC, fg="white", font=("Segoe UI", 9, "bold"),
                      relief="flat", padx=16, pady=6, cursor="hand2",
                      activebackground="#2563EB", activeforeground="white"
                      ).pack(pady=14)

            win.update_idletasks()
            sw = win.winfo_screenwidth()
            sh = win.winfo_screenheight()
            w  = win.winfo_width()
            h  = win.winfo_height()
            win.geometry(f"+{(sw-w)//2}+{(sh-h)//2}")

        if overlay_ref[0] and overlay_ref[0].root:
            overlay_ref[0].root.after(0, _build)

    def quit_app(icon, item):
        try:
            icon.stop()
        finally:
            os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem(f"ℹ VoxDrop v{VERSION}", None, enabled=False),
        pystray.MenuItem(APP_NAME, None, enabled=False),
        pystray.MenuItem("Strg+Q = Diktat | Strg+Shift+Q = Frag Smartis | Strg+Shift+W = Kunde", None, enabled=False),
        pystray.Menu.SEPARATOR,

        pystray.MenuItem("🔴 Deepgram Nova-3  (beste DE-Qualität)", switch_modus("stream-deepgram"),
                         checked=lambda item: MODUS == "stream-deepgram"),
        pystray.MenuItem("🟢 ElevenLabs Scribe v2  (~150ms, top Interpunktion)", switch_modus("stream-scribe"),
                         checked=lambda item: MODUS == "stream-scribe"),
        pystray.MenuItem("💻 Lokal  (kein Internet)", switch_modus("lokal"),
                         checked=lambda item: MODUS == "lokal"),
        pystray.Menu.SEPARATOR,

        pystray.MenuItem("Lokales Modell", pystray.Menu(
            pystray.MenuItem("tiny      1-2 Sek.   75 MB",  switch_model("tiny"),    checked=lambda item: MODEL_SIZE == "tiny"),
            pystray.MenuItem("base      2-3 Sek.  145 MB",  switch_model("base"),    checked=lambda item: MODEL_SIZE == "base"),
            pystray.MenuItem("small     3-5 Sek.  460 MB  [Standard]", switch_model("small"),   checked=lambda item: MODEL_SIZE == "small"),
            pystray.MenuItem("medium    7-10 Sek.  1.5 GB", switch_model("medium"),  checked=lambda item: MODEL_SIZE == "medium"),
            pystray.MenuItem("large-v3  15-20 Sek. 3.0 GB", switch_model("large-v3"), checked=lambda item: MODEL_SIZE == "large-v3"),
        )),
        pystray.Menu.SEPARATOR,

        pystray.MenuItem("📋 Prompt-Vorlagen", lambda icon, item: _toggle_prompt_panel()),
        pystray.MenuItem("⚙️  Einstellungen", lambda icon, item: open_settings_browser()),
        pystray.MenuItem("📋 Log öffnen", lambda icon, item: os.startfile(LOG_FILE) if os.path.exists(LOG_FILE) else None),
        pystray.MenuItem("📖 Sprachbefehle / Hilfe", show_hilfe),
        pystray.MenuItem("🚀 Autostart beim Windows-Start", toggle_autostart,
                         checked=lambda item: autostart_enabled()),
        pystray.Menu.SEPARATOR,

        pystray.MenuItem("Beenden", quit_app),
    )

    modus_str = _MODUS_ICONS.get(MODUS, MODUS)
    icon = pystray.Icon("VoxDrop", img, f"{APP_NAME}  [{modus_str} | {MODEL_SIZE}]", menu)
    tray_icon_ref[0] = icon
    return icon


# ══════════════════════════════════════════════════════════════
#  EINSTELLUNGEN – Lokaler Webserver (unsichtbar, 127.0.0.1)
# ══════════════════════════════════════════════════════════════

_SERVER_PORT  = 7799
_SERVER_TOKEN = secrets.token_urlsafe(24)

_SETTINGS_HTML = r"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VoxDrop – Einstellungen</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:32px 16px}
.wrap{max-width:680px;margin:0 auto}
header{display:flex;align-items:center;gap:14px;margin-bottom:36px}
.logo{width:44px;height:44px;border-radius:12px;background:#0f2850;display:flex;align-items:center;justify-content:center}
.logo svg{width:26px;height:26px;fill:#fff}
h1{font-size:1.5rem;font-weight:700;color:#f1f5f9}
h1 span{font-size:.85rem;font-weight:400;color:#64748b;margin-left:8px}
.card{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:24px;margin-bottom:20px}
.card h2{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:18px}
.field{margin-bottom:16px}
.field label{display:block;font-size:.85rem;font-weight:500;color:#94a3b8;margin-bottom:6px}
.input-wrap{position:relative;display:flex;gap:8px}
.input-wrap input{flex:1;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 14px;color:#f1f5f9;font-size:.9rem;font-family:monospace;outline:none;transition:border-color .2s}
.input-wrap input:focus{border-color:#3b82f6}
button{border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.85}
.btn-reveal{background:#1e3a5f;color:#93c5fd;padding:10px 14px;white-space:nowrap}
.btn-test{background:#1e3a5f;color:#93c5fd;padding:10px 16px}
.mode-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.mode-card{background:#0f172a;border:2px solid #334155;border-radius:10px;padding:14px;cursor:pointer;transition:border-color .2s}
.mode-card:hover{border-color:#475569}
.mode-card.active{border-color:#3b82f6;background:#0f2850}
.mode-card input{display:none}
.mode-card .title{font-size:.9rem;font-weight:600;color:#f1f5f9;margin-bottom:4px}
.mode-card .desc{font-size:.75rem;color:#64748b;line-height:1.4}
.mode-card .badge{display:inline-block;font-size:.7rem;padding:2px 8px;border-radius:20px;margin-bottom:6px;font-weight:600}
.badge-deepgram{background:#2d1515;color:#f87171}
.badge-scribe{background:#15301f;color:#4ade80}
.badge-local{background:#1e1e2e;color:#a78bfa}
.autostart-row{display:flex;align-items:center;justify-content:space-between}
.autostart-row span{font-size:.9rem;color:#cbd5e1}
.toggle{position:relative;width:44px;height:24px;cursor:pointer}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:#334155;border-radius:24px;transition:.3s}
.slider:before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.3s}
.toggle input:checked+.slider{background:#3b82f6}
.toggle input:checked+.slider:before{transform:translateX(20px)}
.footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
.btn-save{background:#3b82f6;color:#fff;padding:12px 32px;font-size:.95rem;border-radius:10px}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:12px 28px;border-radius:10px;font-weight:600;font-size:.9rem;opacity:0;transition:opacity .3s;pointer-events:none}
.toast.show{opacity:1}
.toast.err{background:#ef4444}
.status{font-size:.78rem;min-height:18px;margin-top:4px}
.status.ok{color:#22c55e}.status.err{color:#ef4444}.status.info{color:#60a5fa}
.prompt-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.prompt-item{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px}
.prompt-item-content{flex:1;min-width:0}
.prompt-item-name{font-size:.88rem;font-weight:600;color:#f1f5f9;margin-bottom:3px}
.prompt-item-text{font-size:.78rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.prompt-actions{display:flex;gap:6px;flex-shrink:0}
.btn-icon{background:#1e3a5f;color:#93c5fd;border:none;border-radius:6px;padding:5px 9px;font-size:.8rem;cursor:pointer}
.btn-icon:hover{opacity:.8}
.btn-icon.del{background:#3b1c1c;color:#f87171}
.prompt-form{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:16px;margin-top:4px}
.prompt-form h3{font-size:.8rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.prompt-form input,.prompt-form textarea{width:100%;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#f1f5f9;font-size:.88rem;outline:none;transition:border-color .2s;font-family:inherit}
.prompt-form input:focus,.prompt-form textarea:focus{border-color:#3b82f6}
.prompt-form textarea{resize:vertical;min-height:90px;margin-top:8px}
.prompt-form-actions{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}
.btn-cancel{background:#334155;color:#94a3b8;padding:8px 18px}
.btn-add{background:#3b82f6;color:#fff;padding:8px 18px}
.info-box{background:#1e2a3e;border:1px solid #334155;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:.82rem;color:#93c5fd;line-height:1.5}
.info-box.green{background:#15301f;border-color:#2d6a4f;color:#86efac}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">
      <svg viewBox="0 0 64 64"><circle cx="32" cy="26" r="18" fill="#34d374"/><polygon points="22,38 42,38 32,54" fill="#34d374"/><rect x="27" y="18" width="3" height="16" rx="1.5" fill="#0a140e"/><rect x="22" y="21" width="3" height="10" rx="1.5" fill="#0a140e"/><rect x="32" y="19" width="3" height="14" rx="1.5" fill="#0a140e"/><rect x="37" y="21" width="3" height="10" rx="1.5" fill="#0a140e"/><rect x="42" y="23" width="3" height="6" rx="1.5" fill="#0a140e"/><rect x="17" y="23" width="3" height="6" rx="1.5" fill="#0a140e"/></svg>
    </div>
    <div><h1>VoxDrop <span>Einstellungen v__VERSION__</span></h1></div>
  </header>

  <!-- API Keys -->
  <div class="card">
    <h2>API Keys</h2>
    <div class="field">
      <label>Deepgram API Key <span style="color:#64748b">(für Live Stream – $200 Gratis-Guthaben)</span></label>
      <div class="info-box">
        🔴 <strong>Deepgram Nova-3</strong> – beste DE-Qualität (Sept 2025), Echtzeit Wort für Wort.<br>
        <span style="color:#64748b">Key auf <a href="https://deepgram.com" target="_blank" style="color:#60a5fa">deepgram.com</a> → Console → API Keys.</span>
      </div>
      <div class="input-wrap">
        <input type="password" id="deepgram_key" placeholder="dg_..." autocomplete="off">
        <button class="btn-reveal" onclick="toggleReveal('deepgram_key',this)">Anzeigen</button>
        <button class="btn-test" onclick="testKey('deepgram')">Testen</button>
      </div>
      <div class="status" id="deepgram_status"></div>
    </div>
    <div class="field">
      <label>ElevenLabs API Key <span style="color:#64748b">(für Scribe v2 Realtime)</span></label>
      <div class="info-box green">
        🟢 <strong>ElevenLabs Scribe v2</strong> – ~150ms Latenz, top Interpunktion.<br>
        <span style="color:#64748b">Key auf <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" style="color:#4ade80">elevenlabs.io</a> → Settings → API Keys.</span>
      </div>
      <div class="input-wrap">
        <input type="password" id="elevenlabs_key" placeholder="sk_..." autocomplete="off">
        <button class="btn-reveal" onclick="toggleReveal('elevenlabs_key',this)">Anzeigen</button>
        <button class="btn-test" onclick="testKey('elevenlabs')">Testen</button>
      </div>
      <div class="status" id="elevenlabs_status"></div>
    </div>
  </div>

  <!-- Modus -->
  <div class="card">
    <h2>Transkriptions-Engine</h2>
    <div class="mode-grid">
      <label class="mode-card" id="mode_stream-deepgram">
        <input type="radio" name="modus" value="stream-deepgram">
        <div class="badge badge-deepgram">🔴 EMPFOHLEN</div>
        <div class="title">Deepgram Nova-3</div>
        <div class="desc">Beste DE-Qualität<br>Echtzeit, Wort für Wort</div>
      </label>
      <label class="mode-card" id="mode_stream-scribe">
        <input type="radio" name="modus" value="stream-scribe">
        <div class="badge badge-scribe">🟢 SCHNELL</div>
        <div class="title">ElevenLabs Scribe v2</div>
        <div class="desc">~150ms Latenz<br>Top Interpunktion</div>
      </label>
      <label class="mode-card" id="mode_lokal">
        <input type="radio" name="modus" value="lokal">
        <div class="badge badge-local">💻 OFFLINE</div>
        <div class="title">Lokal</div>
        <div class="desc">Kein Internet nötig<br>Push-to-talk</div>
      </label>
    </div>
  </div>

  <!-- System -->
  <div class="card">
    <h2>System</h2>
    <div class="autostart-row">
      <span>Automatisch mit Windows starten</span>
      <label class="toggle">
        <input type="checkbox" id="autostart">
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <!-- Prompt-Vorlagen -->
  <div class="card">
    <h2>Prompt-Vorlagen <span style="font-weight:400;text-transform:none;font-size:.75rem;color:#475569">– Sprachbefehl: «Öffne Prompt»</span></h2>
    <div class="prompt-list" id="prompt_list"></div>
    <button class="btn-save" style="background:#1e3a5f;color:#93c5fd;padding:9px 20px;font-size:.85rem" onclick="showAddForm()">+ Vorlage hinzufügen</button>
    <div class="prompt-form" id="prompt_form" style="display:none;margin-top:12px">
      <h3 id="form_title">Neue Vorlage</h3>
      <input type="text" id="prompt_name" placeholder="Name (z.B. «E-Mail Antwort»)" maxlength="60">
      <textarea id="prompt_text" placeholder="Prompt-Text..."></textarea>
      <div class="prompt-form-actions">
        <button class="btn-icon btn-cancel" onclick="cancelForm()">Abbrechen</button>
        <button class="btn-add" onclick="savePromptForm()">Speichern</button>
      </div>
    </div>
  </div>

  <div class="footer">
    <span style="font-size:.8rem;color:#475569">VoxDrop by Artis Treuhand GmbH</span>
    <button class="btn-save" onclick="save()">Speichern</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const TOKEN = '{{TOKEN}}';

async function load() {
  const r = await fetch('/api/config?token='+TOKEN);
  const d = await r.json();
  document.getElementById('deepgram_key').value   = d.DEEPGRAM_API_KEY || '';
  document.getElementById('elevenlabs_key').value = d.ELEVENLABS_API_KEY || '';
  document.getElementById('autostart').checked    = d.AUTOSTART === 'true';
  const modus = d.MODUS || 'stream-deepgram';
  document.querySelectorAll('.mode-card').forEach(c => {
    const radio = c.querySelector('input');
    const active = radio.value === modus;
    radio.checked = active;
    c.classList.toggle('active', active);
  });
  document.querySelectorAll('input[name=modus]').forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('.mode-card').forEach(c =>
        c.classList.toggle('active', c.querySelector('input').checked));
    });
  });
}

function toggleReveal(id, btn) {
  const el = document.getElementById(id);
  const hidden = el.type === 'password';
  el.type = hidden ? 'text' : 'password';
  btn.textContent = hidden ? 'Verbergen' : 'Anzeigen';
}

async function testKey(which) {
  const statusEl = document.getElementById(which+'_status');
  const key = document.getElementById(which+'_key').value.trim();
  if (!key) { setStatus(statusEl,'Kein Key eingegeben','err'); return; }
  setStatus(statusEl,'Verbindung wird getestet...','info');
  const r = await fetch('/api/test?token='+TOKEN, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({which, key})
  });
  const d = await r.json();
  setStatus(statusEl, d.message, d.ok ? 'ok' : 'err');
}

function setStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = 'status ' + cls;
}

async function save() {
  const data = {
    DEEPGRAM_API_KEY:   document.getElementById('deepgram_key').value.trim(),
    ELEVENLABS_API_KEY: document.getElementById('elevenlabs_key').value.trim(),
    MODUS:     document.querySelector('input[name=modus]:checked')?.value || 'stream-deepgram',
    AUTOSTART: document.getElementById('autostart').checked  ? 'true' : 'false',
  };
  const r = await fetch('/api/save?token='+TOKEN, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const d = await r.json();
  showToast(d.ok ? '✓ Gespeichert' : '✗ Fehler: ' + d.message, !d.ok);
}

function showToast(msg, err=false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '') + ' show';
  setTimeout(() => t.className = 'toast', 2800);
}

let _prompts = [];
let _editIdx = -1;

async function loadPrompts() {
  const r = await fetch('/api/prompts?token='+TOKEN);
  _prompts = await r.json();
  renderPrompts();
}

function renderPrompts() {
  const list = document.getElementById('prompt_list');
  if (_prompts.length === 0) {
    list.innerHTML = '<div style="font-size:.82rem;color:#475569;padding:4px 0">Noch keine Vorlagen. Füge deine erste Vorlage hinzu.</div>';
    return;
  }
  list.innerHTML = _prompts.map((p, i) => `
    <div class="prompt-item">
      <div class="prompt-item-content">
        <div class="prompt-item-name">${escHtml(p.name)}</div>
        <div class="prompt-item-text">${escHtml(p.text)}</div>
      </div>
      <div class="prompt-actions">
        <button class="btn-icon" onclick="editPrompt(${i})" title="Bearbeiten">✏</button>
        <button class="btn-icon del" onclick="deletePrompt(${i})" title="Löschen">✕</button>
      </div>
    </div>`).join('');
}

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showAddForm() {
  _editIdx = -1;
  document.getElementById('form_title').textContent = 'Neue Vorlage';
  document.getElementById('prompt_name').value = '';
  document.getElementById('prompt_text').value = '';
  document.getElementById('prompt_form').style.display = 'block';
  document.getElementById('prompt_name').focus();
}

function editPrompt(idx) {
  _editIdx = idx;
  const p = _prompts[idx];
  document.getElementById('form_title').textContent = 'Vorlage bearbeiten';
  document.getElementById('prompt_name').value = p.name;
  document.getElementById('prompt_text').value = p.text;
  document.getElementById('prompt_form').style.display = 'block';
  document.getElementById('prompt_name').focus();
}

function cancelForm() {
  document.getElementById('prompt_form').style.display = 'none';
}

async function savePromptForm() {
  const name = document.getElementById('prompt_name').value.trim();
  const text = document.getElementById('prompt_text').value.trim();
  if (!name || !text) { showToast('Name und Text sind erforderlich', true); return; }
  if (_editIdx >= 0) {
    _prompts[_editIdx] = {name, text};
  } else {
    _prompts.push({name, text});
  }
  await persistPrompts();
  cancelForm();
}

async function deletePrompt(idx) {
  if (!confirm(`Vorlage "${_prompts[idx].name}" löschen?`)) return;
  _prompts.splice(idx, 1);
  await persistPrompts();
}

async function persistPrompts() {
  const r = await fetch('/api/prompts/save?token='+TOKEN, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(_prompts)
  });
  const d = await r.json();
  if (d.ok) {
    renderPrompts();
    showToast('✓ Vorlagen gespeichert');
  } else {
    showToast('✗ Fehler beim Speichern', true);
  }
}

load();
loadPrompts();
</script>
</body>
</html>"""


class _SettingsHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _check_token(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return q.get('token', [''])[0] == _SERVER_TOKEN

    def _json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if not self._check_token():
            self.send_error(403); return

        if path == '/api/config':
            cfg = load_config()
            cfg['AUTOSTART'] = 'true' if autostart_enabled() else 'false'
            self._json(cfg); return

        if path == '/api/prompts':
            self._json(load_prompts()); return

        html = _SETTINGS_HTML.replace('{{TOKEN}}', _SERVER_TOKEN).replace('__VERSION__', VERSION)
        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global MODUS, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY
        if not self._check_token():
            self.send_error(403); return
        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length))
        path   = urllib.parse.urlparse(self.path).path

        if path == '/api/test':
            which = body.get('which')
            key   = body.get('key', '')
            try:
                if which == 'deepgram':
                    import urllib.request
                    req = urllib.request.Request(
                        "https://api.deepgram.com/v1/projects",
                        headers={"Authorization": f"Token {key}"}
                    )
                    with urllib.request.urlopen(req, timeout=10) as r:
                        data = json.loads(r.read())
                        if data.get("projects") is not None:
                            self._json({'ok': True, 'message': '✓ Deepgram Key gültig'}); return
                        else:
                            self._json({'ok': False, 'message': 'Key ungültig'}); return
                elif which == 'elevenlabs':
                    import urllib.request
                    req = urllib.request.Request(
                        "https://api.elevenlabs.io/v1/user",
                        headers={"xi-api-key": key}
                    )
                    with urllib.request.urlopen(req, timeout=10) as r:
                        data = json.loads(r.read())
                        if data.get("subscription") or data.get("xi_api_key"):
                            self._json({'ok': True, 'message': '✓ ElevenLabs Key gültig'}); return
                        else:
                            self._json({'ok': True, 'message': '✓ ElevenLabs Key OK'}); return
            except Exception as e:
                self._json({'ok': False, 'message': str(e)[:120]}); return
            self._json({'ok': False, 'message': 'Unbekannter Dienst'}); return

        if path == '/api/prompts/save':
            prompts = body if isinstance(body, list) else []
            save_prompts(prompts)
            if prompt_panel_ref[0] and prompt_panel_ref[0]._visible:
                prompt_panel_ref[0].win.after(0, prompt_panel_ref[0]._refresh_prompts)
            self._json({'ok': True}); return

        if path == '/api/save':
            cfg = load_config()
            cfg['DEEPGRAM_API_KEY']   = body.get('DEEPGRAM_API_KEY', cfg.get('DEEPGRAM_API_KEY', ''))
            cfg['ELEVENLABS_API_KEY'] = body.get('ELEVENLABS_API_KEY', cfg.get('ELEVENLABS_API_KEY', ''))
            cfg['MODUS']              = body.get('MODUS', cfg.get('MODUS', _DEFAULT_MODUS))
            save_config(cfg)
            # Live-Reload ohne Neustart
            MODUS              = cfg['MODUS']
            DEEPGRAM_API_KEY   = cfg.get('DEEPGRAM_API_KEY', '')
            ELEVENLABS_API_KEY = cfg.get('ELEVENLABS_API_KEY', '')
            _update_tray_title()
            autostart_should = body.get('AUTOSTART') == 'true'
            if autostart_should != autostart_enabled():
                set_autostart(autostart_should)
            self._json({'ok': True}); return

        self.send_error(404)


class _ThreadingHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

def _start_settings_server():
    try:
        srv = _ThreadingHTTPServer(('127.0.0.1', _SERVER_PORT), _SettingsHandler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    except OSError:
        pass


def open_settings_browser():
    webbrowser.open(f'http://127.0.0.1:{_SERVER_PORT}/?token={_SERVER_TOKEN}')


# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    _start_settings_server()

    overlay = WaveOverlay()
    overlay.launch()
    overlay_ref[0] = overlay

    prompt_panel = PromptPanel()
    prompt_panel.attach(overlay.root)
    prompt_panel_ref[0] = prompt_panel

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.start()

    # Keys sind eingebettet (Artis-Firmen-Keys) → Settings-Auto-Open nicht nötig

    icon = create_tray_icon()
    icon.run()
