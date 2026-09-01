# OCR-Container: Vertrag und Inbetriebnahme

Der OCR-Container (Tesseract, poppler, catdoc) liegt **nicht** in diesem
Repository. Er laeuft auf dem Server neben der jeweiligen Instanz. Die
Edge Function `index-document` ruft ihn ueber `_shared/ocrClient.ts` auf.

**Ohne gesetzte `OCR_URL` passiert nichts.** Die Funktion verhaelt sich dann
exakt wie vorher: Textebene aus PDF, Excel, Word und Klartext werden gelesen,
Scans bleiben ohne Volltext. So laeuft smartis.me weiter, ohne dass etwas
kaputtgeht oder anders aussieht.

## Umgebungsvariablen

| Variable | Pflicht | Vorgabe | Bedeutung |
|---|---|---|---|
| `OCR_URL` | ja, sonst aus | – | Voller Endpunkt, z. B. `https://ocr.sm-artis.ch/extract` |
| `OCR_TOKEN` | empfohlen | leer | Gemeinsames Geheimnis, geht als `X-OCR-Token` mit |
| `OCR_TIMEOUT_MS` | nein | `120000` | Abbruch nach dieser Zeit |
| `OCR_LANGS` | nein | `deu+eng` | Tesseract-Sprachen, z. B. `deu+eng+fra+ita` |

Setzen:

```bash
supabase secrets set OCR_URL=https://ocr.example.ch/extract OCR_TOKEN=<geheim>
```

## Vertrag

**Anfrage**

```
POST <OCR_URL>
X-OCR-Token: <OCR_TOKEN>          nur wenn gesetzt
Content-Type: multipart/form-data

file      die Datei, mit Dateinamen
filename  derselbe Name nochmals als Feld
lang      z. B. "deu+eng"
```

**Antwort** – alle drei Formate werden akzeptiert:

```json
{"text": "..."}
{"ok": true, "text": "..."}
```

oder schlicht der Text als `text/plain` im Body.

Ein Fehler wird als `{"ok": false, "error": "..."}` oder ueber einen
HTTP-Status ungleich 200 gemeldet.

**Wichtig:** Ein Fehlschlag des Containers darf den Upload nie stoppen. Der
Client faengt HTTP-Fehler, Zeitueberschreitungen und ungueltige Antworten ab
und liefert dann einen leeren Text zurueck. Das Dokument wird abgelegt, es hat
nur keinen Volltext. Lieber kein Volltext als ein verlorener Upload.

Weicht der bestehende Endpunkt davon ab, ist `_shared/ocrClient.ts` die einzige
Stelle, die angepasst werden muss.

## Was an den Container geht

Entschieden in `needsOcr()`:

| Fall | an den Container |
|---|---|
| PDF, lokale Textextraktion unter 50 Zeichen (Scan) | ja |
| Bild (png, jpg, jpeg, webp, bmp, gif, tif, tiff) | ja |
| `.doc` und `.rtf` | ja, koennen wir sonst gar nicht lesen |
| PDF mit Textebene | nein, lokal erledigt |
| xlsx, docx, csv, txt | nein, lokal erledigt |

Die Schwelle von 50 Zeichen ist bewusst tief: Manche Scans tragen eine
Kopfzeile oder eine Seitenzahl als echten Text und saehen sonst wie ein
Dokument mit Textebene aus.

## Nachlauf ueber den Altbestand

Der Batch-Modus arbeitet in Haeppchen und mit einem Cursor. Beides ist noetig:
Ein Scan braucht im Container Sekunden bis Minuten, ein Durchgang ueber alle
Dokumente liefe in die Laufzeitgrenze der Edge Function. Und ein Dokument, das
auch die OCR nicht lesen kann, bleibt ohne `content_text` und waere sonst bei
jedem Durchgang wieder dabei.

```bash
# erster Durchgang
curl -X POST "$SUPABASE_URL/functions/v1/index-document" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch": true, "limit": 5}'
```

Antwort:

```json
{
  "status": "batch_done",
  "verarbeitet": 5,
  "indexed": 4,
  "ohne_text": 1,
  "last_id": "…",
  "fertig": false,
  "offen_gesamt": 188,
  "ocr": "aktiv",
  "errors": []
}
```

Danach mit `{"batch": true, "limit": 5, "after": "<last_id>"}` weiter, bis
`"fertig": true`. `ohne_text` zaehlt die Dokumente, aus denen auch der
Container nichts holen konnte.

Auf smartis.me steht dort `"ocr": "nicht konfiguriert"` – der Nachlauf laeuft
trotzdem, holt aber bei Scans erwartungsgemaess nichts.

## Anmerkungen zum Container

Nicht blockierend, aber der Vollstaendigkeit halber, aus der Durchsicht des
Dockerfiles vom 01.09.2026:

- `CMD ["python", "/app.py"]` startet den eingebauten Flask-Entwicklungsserver.
  Der ist einzelstrangig; beim Nachlauf und bei parallelen Uploads wird das
  eine Warteschlange. gunicorn mit einigen Arbeitern waere die Ergaenzung.
- `EXPOSE 80` ohne TLS. Sobald der Endpunkt von aussen erreichbar ist, braucht
  es TLS, das Token und eine IP-Beschraenkung. Es gehen Mandantendokumente
  durch, Berufsgeheimnis.
- Im Image steckt nur `tesseract-ocr-deu` samt eingebautem `eng`. Fuer Mandate
  in der Romandie und im Tessin waeren `tesseract-ocr-fra` und
  `tesseract-ocr-ita` sinnvoll, plus `OCR_LANGS=deu+eng+fra+ita`.
- Im Container zuerst `pdftotext` versuchen und nur bei leerem Ergebnis in die
  OCR gehen. Wir filtern zwar schon vor, aber doppelt haelt besser und spart
  Rechenzeit.
