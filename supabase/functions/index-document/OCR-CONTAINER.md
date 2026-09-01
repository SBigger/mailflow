# OCR-Container an index-document anbinden

Scans, Bilder sowie `.doc` und `.rtf` kann die Edge Function selber nicht lesen.
Dafuer gibt es den OCR-Container (Tesseract, poppler, catdoc), der auf dem
Server neben der Instanz laeuft. Er ist NICHT Teil dieses Repositories.

Angebunden wird er ueber `../_shared/ocrClient.ts`. **Ist `OCR_URL` nicht
gesetzt, passiert nichts** -- die Indexierung laeuft wie bisher, Scans bleiben
ohne Volltext. Genau so laeuft smartis.me weiter, ohne dass etwas bricht.

## Secrets setzen

```bash
supabase secrets set OCR_URL=https://ocr.example.ch/extract --project-ref <ref>
supabase secrets set OCR_TOKEN=<langes-zufaelliges-geheimnis> --project-ref <ref>
# optional:
supabase secrets set OCR_LANGS=deu+eng+fra+ita --project-ref <ref>
supabase secrets set OCR_TIMEOUT_MS=180000 --project-ref <ref>
supabase functions deploy index-document --project-ref <ref>
```

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `OCR_URL` | voller Endpunkt des Containers. Fehlt sie, wird OCR uebersprungen. | -- |
| `OCR_TOKEN` | geht als Header `X-OCR-Token` mit. Leer lassen heisst: keine Absicherung. | leer |
| `OCR_LANGS` | Tesseract-Sprachen, als Feld `lang` im Formular | `deu+eng` |
| `OCR_TIMEOUT_MS` | Abbruch pro Datei | `120000` |

## Vertrag mit dem Container

**Anfrage**

```
POST <OCR_URL>
X-OCR-Token: <OCR_TOKEN>          nur wenn gesetzt
Content-Type: multipart/form-data

file      = die Datei, mit Dateinamen
filename  = derselbe Name nochmal als Feld
lang      = z. B. "deu+eng"
```

**Antwort** -- alle drei Formen werden akzeptiert:

```json
{"text": "..."}
```
```json
{"ok": true, "text": "..."}
```
```
Reiner Text im Body
```

Ein `{"ok": false, "error": "..."}`, ein HTTP-Fehler oder eine Zeitueberschreitung
gelten als Fehlschlag: Es wird protokolliert, aber **nicht geworfen**. Lieber
kein Volltext als ein abgebrochener Upload.

Passt der bestehende Endpunkt nicht zu diesem Vertrag, ist `ocrClient.ts` die
**einzige** Stelle, die angepasst werden muss.

## Was wann an den Container geht

`needsOcr()` in `ocrClient.ts` entscheidet:

| Datei | an den Container |
|---|---|
| PDF, dessen Textebene unter 50 Zeichen liefert (Scan) | ja |
| Bilder: png, jpg, jpeg, webp, bmp, gif, tif, tiff | ja |
| `.doc`, `.rtf` (koennen wir sonst gar nicht lesen) | ja |
| PDF mit Textebene, xlsx, docx, txt | nein, bleibt lokal |

Erst wird also lokal extrahiert, der Container kommt nur, wenn dabei nichts
Brauchbares herauskommt. Das spart Rechenzeit bei den PDF, die schon Text haben.

## Altbestand nachfahren

Der Batch-Modus laeuft in Haeppchen mit Cursor. Beides ist noetig: Ein Scan
braucht im Container Sekunden bis Minuten (Laufzeitgrenze der Edge Function),
und eine Datei, die auch die OCR nicht lesen kann, bliebe ohne Cursor bei jedem
Durchgang wieder in der Auswahl.

```bash
# erster Durchgang
curl -X POST "$URL/functions/v1/index-document" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"batch": true, "limit": 5}'

# weiter mit dem last_id aus der Antwort, bis "fertig": true
curl -X POST "$URL/functions/v1/index-document" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"batch": true, "limit": 5, "after": "<last_id>"}'
```

Die Antwort:

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

`ocr: "nicht konfiguriert"` heisst, dass `OCR_URL` fehlt -- dann werden Scans
zwar angefasst, bleiben aber ohne Text.

## Absicherung

Der Container bekommt Mandantendokumente zu sehen, Berufsgeheimnis. Wenn er von
aussen erreichbar ist, gehoert dazu:

- TLS, nicht blankes HTTP
- ein langes `OCR_TOKEN`, serverseitig geprueft
- eine IP-Beschraenkung auf die aufrufende Instanz, wo moeglich
- kein Entwicklungsserver: `python app.py` startet den eingebauten Flask-Server
  und ist einstraengig. Fuer den Nachlauf und parallele Uploads besser gunicorn
  mit mehreren Arbeitern.
