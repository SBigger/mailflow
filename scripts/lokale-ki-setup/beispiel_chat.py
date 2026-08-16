"""Kleines Beispiel: mit der lokalen KI (Ollama) per Python chatten.

Voraussetzung: setup-lokale-ki.ps1 wurde ausgefuehrt (Python + Ollama +
Modell installiert). Ollama laeuft danach automatisch im Hintergrund.

Nutzt nur die Python-Standardbibliothek, kein "pip install" noetig.
"""
import json
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
MODELL = "llama3.2"


def frage_ki(prompt):
    daten = json.dumps({"model": MODELL, "prompt": prompt, "stream": False}).encode("utf-8")
    anfrage = urllib.request.Request(
        OLLAMA_URL, data=daten, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(anfrage) as antwort:
        ergebnis = json.loads(antwort.read())
    return ergebnis["response"]


if __name__ == "__main__":
    print("Frag die lokale KI etwas (leer + Enter zum Beenden):")
    while True:
        frage = input("> ")
        if not frage.strip():
            break
        try:
            print(frage_ki(frage))
        except Exception as fehler:
            print(f"Fehler beim Ansprechen von Ollama: {fehler}")
            print("Laeuft Ollama? Testweise im Terminal: ollama run llama3.2")
