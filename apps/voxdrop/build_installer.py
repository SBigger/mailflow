"""
VoxDrop Installer Builder – erstellt eigenständige Setup-EXE ohne Inno Setup.
"""
import base64, os, sys, zlib, subprocess
from pathlib import Path

APP_NAME    = "VoxDrop"
APP_VERSION = "1.7.1"
EXE_SRC     = Path("dist/VoxDrop.exe")
ICON_SRC    = Path("icon.ico")
OUT_DIR     = Path("output")

def embed(path: Path) -> str:
    data = path.read_bytes()
    return base64.b64encode(zlib.compress(data, 9)).decode()

print(f"Lese {EXE_SRC} ({EXE_SRC.stat().st_size // 1024} KB)...")
exe_b64  = embed(EXE_SRC)
icon_b64 = embed(ICON_SRC)
print("Einbetten abgeschlossen.")

INSTALLER_TEMPLATE = r'''#!/usr/bin/env python3
"""VoxDrop Setup v__VERSION__"""
import base64, zlib, os, sys, shutil, winreg, subprocess, tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path
import threading, time

APP_NAME    = "VoxDrop"
APP_VERSION = "__VERSION__"
INSTALL_DIR = Path(os.environ.get("LOCALAPPDATA","")) / "Programs" / APP_NAME
APPDATA_DIR = Path(os.environ.get("APPDATA","")) / APP_NAME

_EXE_DATA  = b"__EXE_B64__"
_ICON_DATA = b"__ICON_B64__"

def _decode(b64):
    return zlib.decompress(base64.b64decode(b64))


def _create_shortcut(target, link, icon):
    ps = (
        f'$ws=New-Object -ComObject WScript.Shell; '
        f'$s=$ws.CreateShortcut("{link}"); '
        f'$s.TargetPath="{target}"; '
        f'$s.WorkingDirectory="{target.parent}"; '
        f'$s.IconLocation="{icon}"; '
        f'$s.Save()'
    )
    subprocess.run(["powershell", "-Command", ps], capture_output=True)


def _write_uninstall_reg(install_dir, icon):
    key_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\VoxDrop"
    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as k:
            winreg.SetValueEx(k, "DisplayName",     0, winreg.REG_SZ,    "VoxDrop by Artis")
            winreg.SetValueEx(k, "DisplayVersion",  0, winreg.REG_SZ,    APP_VERSION)
            winreg.SetValueEx(k, "Publisher",       0, winreg.REG_SZ,    "Artis Treuhand GmbH")
            winreg.SetValueEx(k, "InstallLocation", 0, winreg.REG_SZ,    str(install_dir))
            winreg.SetValueEx(k, "DisplayIcon",     0, winreg.REG_SZ,    str(icon))
            winreg.SetValueEx(k, "NoModify",        0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(k, "NoRepair",        0, winreg.REG_DWORD, 1)
    except Exception:
        pass


class InstallerUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"VoxDrop Setup v{APP_VERSION}")
        self.geometry("480x360")
        self.resizable(False, False)
        self.configure(bg="#1a1a1a")
        try:
            icon_path = Path(os.environ["TEMP"]) / "voxdrop_setup.ico"
            icon_path.write_bytes(_decode(_ICON_DATA))
            self.iconbitmap(str(icon_path))
        except Exception:
            pass
        self._build()
        self.protocol("WM_DELETE_WINDOW", self.destroy)

    def _build(self):
        bg, green = "#1a1a1a", "#5cb85c"
        hdr = tk.Frame(self, bg="#1e5c2e", height=70)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="VoxDrop by Artis", font=("Segoe UI", 18, "bold"),
                 bg="#1e5c2e", fg="white").pack(side="left", padx=20, pady=18)
        tk.Label(hdr, text=f"v{APP_VERSION}", font=("Segoe UI", 10),
                 bg="#1e5c2e", fg="#aaddaa").pack(side="right", padx=20, pady=22)

        info = tk.Frame(self, bg=bg)
        info.pack(fill="x", padx=24, pady=(20, 0))
        tk.Label(info,
                 text=("VoxDrop transkribiert Sprache per Tastenkuerzel (Ctrl+Q)\n"
                       "und fuegt den Text direkt in jede Anwendung ein.\n\n"
                       f"Installationsort:\n{INSTALL_DIR}"),
                 font=("Segoe UI", 10), bg=bg, fg="#cccccc",
                 justify="left", anchor="w").pack(fill="x")

        self.var_desktop  = tk.BooleanVar(value=True)
        self.var_autostart = tk.BooleanVar(value=True)
        tk.Checkbutton(self, text="Desktop-Verknuepfung erstellen",
                       variable=self.var_desktop,
                       bg=bg, fg="#cccccc", selectcolor="#333",
                       activebackground=bg, activeforeground="white",
                       font=("Segoe UI", 10)).pack(anchor="w", padx=24, pady=(14,0))
        tk.Checkbutton(self, text="Automatisch mit Windows starten",
                       variable=self.var_autostart,
                       bg=bg, fg="#cccccc", selectcolor="#333",
                       activebackground=bg, activeforeground="white",
                       font=("Segoe UI", 10)).pack(anchor="w", padx=24, pady=(4,0))

        prog_frm = tk.Frame(self, bg=bg)
        prog_frm.pack(fill="x", padx=24, pady=(16, 0))
        self.progress = ttk.Progressbar(prog_frm, length=430, mode="determinate")
        self.progress.pack(fill="x")
        style = ttk.Style()
        style.theme_use("default")
        style.configure("TProgressbar", troughcolor="#333", background=green, thickness=8)

        self.status = tk.Label(self, text="Bereit zur Installation.",
                               font=("Segoe UI", 9), bg=bg, fg="#888888")
        self.status.pack(pady=(6, 0))

        btn_frm = tk.Frame(self, bg=bg)
        btn_frm.pack(side="bottom", pady=20)
        self.btn_install = tk.Button(btn_frm, text="  Installieren  ",
                                     font=("Segoe UI", 11, "bold"),
                                     bg=green, fg="white", relief="flat",
                                     activebackground="#4a9d4a", cursor="hand2",
                                     command=self._start, padx=12, pady=6)
        self.btn_install.pack(side="left", padx=8)
        self.btn_cancel = tk.Button(btn_frm, text="  Abbrechen  ",
                                    font=("Segoe UI", 11),
                                    bg="#444", fg="white", relief="flat",
                                    activebackground="#555", cursor="hand2",
                                    command=self.destroy, padx=12, pady=6)
        self.btn_cancel.pack(side="left", padx=8)

    def _set(self, msg, pct=None):
        self.status.config(text=msg)
        if pct is not None:
            self.progress["value"] = pct
        self.update_idletasks()

    def _start(self):
        self.btn_install.config(state="disabled")
        self.btn_cancel.config(state="disabled")
        threading.Thread(target=self._install, daemon=True).start()

    def _install(self):
        try:
            self._set("Ordner erstellen...", 10)
            INSTALL_DIR.mkdir(parents=True, exist_ok=True)
            APPDATA_DIR.mkdir(parents=True, exist_ok=True)

            self._set("VoxDrop.exe schreiben...", 30)
            exe_path  = INSTALL_DIR / "VoxDrop.exe"
            icon_path = INSTALL_DIR / "icon.ico"
            exe_path.write_bytes(_decode(_EXE_DATA))
            icon_path.write_bytes(_decode(_ICON_DATA))

            self._set("Startmenu-Verknuepfung...", 50)
            start_menu = Path(os.environ.get("APPDATA","")) / "Microsoft/Windows/Start Menu/Programs"
            _create_shortcut(exe_path, start_menu / "VoxDrop.lnk", icon_path)

            if self.var_desktop.get():
                self._set("Desktop-Verknuepfung...", 65)
                desktop = Path(os.environ.get("USERPROFILE","")) / "Desktop"
                _create_shortcut(exe_path, desktop / "VoxDrop.lnk", icon_path)

            if self.var_autostart.get():
                self._set("Autostart einrichten...", 78)
                try:
                    run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, run_key,
                                        0, winreg.KEY_SET_VALUE) as k:
                        winreg.SetValueEx(k, "VoxDrop", 0, winreg.REG_SZ, str(exe_path))
                except Exception:
                    pass

            self._set("Registry-Eintrag...", 88)
            _write_uninstall_reg(INSTALL_DIR, icon_path)

            self._set("Fertig!", 100)
            time.sleep(0.3)
            self.after(0, self._done)
        except Exception as e:
            self.after(0, lambda: messagebox.showerror("Fehler", str(e), parent=self))

    def _done(self):
        for w in self.winfo_children():
            w.destroy()
        bg, green = "#1a1a1a", "#5cb85c"
        self.configure(bg=bg)
        hdr = tk.Frame(self, bg="#1e5c2e", height=70)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(hdr, text="VoxDrop installiert!", font=("Segoe UI", 18, "bold"),
                 bg="#1e5c2e", fg="white").pack(side="left", padx=20, pady=18)
        tk.Label(self, text="Installation erfolgreich abgeschlossen.",
                 font=("Segoe UI", 11), bg=bg, fg="#cccccc").pack(pady=(40, 8))
        tk.Label(self, text=str(INSTALL_DIR / "VoxDrop.exe"),
                 font=("Segoe UI", 9), bg=bg, fg="#888").pack()
        tk.Label(self, text="Ctrl+Q = Aufnahme starten | Ctrl+Q = Aufnahme stoppen & einfuegen",
                 font=("Segoe UI", 9), bg=bg, fg="#5cb85c").pack(pady=(12,0))
        btn_frm = tk.Frame(self, bg=bg)
        btn_frm.pack(side="bottom", pady=24)
        tk.Button(btn_frm, text="  VoxDrop starten  ",
                  font=("Segoe UI", 11, "bold"), bg=green, fg="white",
                  relief="flat", activebackground="#4a9d4a", cursor="hand2",
                  command=lambda: [subprocess.Popen([str(INSTALL_DIR / "VoxDrop.exe")]), self.destroy()],
                  padx=12, pady=6).pack(side="left", padx=8)
        tk.Button(btn_frm, text="  Schliessen  ",
                  font=("Segoe UI", 11), bg="#444", fg="white",
                  relief="flat", activebackground="#555", cursor="hand2",
                  command=self.destroy, padx=12, pady=6).pack(side="left", padx=8)


if __name__ == "__main__":
    InstallerUI().mainloop()
'''

INSTALLER_CODE = (INSTALLER_TEMPLATE
                  .replace("__VERSION__", APP_VERSION)
                  .replace("__EXE_B64__",  exe_b64)
                  .replace("__ICON_B64__", icon_b64))

OUT_DIR.mkdir(exist_ok=True)
tmp_py = Path("_setup_tmp.py")
tmp_py.write_text(INSTALLER_CODE, encoding="utf-8")

print("Baue Setup-EXE...")
result = subprocess.run([
    sys.executable, "-m", "PyInstaller",
    "--noconfirm", "--onefile", "--windowed",
    f"--icon={ICON_SRC}",
    "--name", f"VoxDrop-Setup-v{APP_VERSION}",
    "--distpath", str(OUT_DIR),
    str(tmp_py)
], capture_output=True, text=True)

tmp_py.unlink(missing_ok=True)

if result.returncode == 0:
    out = OUT_DIR / f"VoxDrop-Setup-v{APP_VERSION}.exe"
    print(f"Fertig: {out} ({out.stat().st_size // 1024} KB)")
else:
    print("FEHLER:")
    print(result.stdout[-3000:])
    print(result.stderr[-1000:])
