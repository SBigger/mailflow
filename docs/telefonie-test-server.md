# Telefonie – Test-Server-Anleitung (für Roger)

Ziel: eine **kleine, dauerhaft laufende Test-VM**, damit das neue Softphone in smartis
echte Anrufe über den bestehenden **Peoplefone-SIP-Trunk** machen/empfangen kann.
Reine Testumgebung – produktiv wird derselbe Stack später auf deinem Server gezogen.

> **Wichtig:** **Keine fixe/statische IP nötig.** Wir gehen den **Registrierungs-Weg**:
> ein kleiner **Kamailio** meldet sich mit Benutzer/Passwort beim Peoplefone-Trunk an
> (wie es das 3CX heute tut) und reicht die Anrufe an **LiveKit** durch. Die VM muss nur
> **24/7 laufen** und aus dem Internet erreichbar sein (dyn. IP / DDNS / Reverse-Tunnel ok).

## Architektur
```
Peoplefone (SIP-TRUNK, Registrierung User/PW)
      │  INVITE / REGISTER
      ▼
  Kamailio  ──(SIP, intern)──▶  LiveKit SIP  ──▶  LiveKit-Server  ◀──WebRTC──▶  smartis-Softphone (Browser)
 (Registrar/                                          │
  Front-Proxy)                                    Webhooks ──▶ Supabase (Realtime: „es klingelt" + call_records)
```
- **Kamailio** = der „ständig eingeloggte Anschluss": registriert sich bei Peoplefone, nimmt
  eingehende INVITEs entgegen, leitet sie 1:1 an LiveKit SIP; versteckt LiveKit vor dem Internet.
- **LiveKit SIP** bridged den PSTN-Anrufer als normalen Teilnehmer in einen LiveKit-Room.
- **LiveKit-Server** = Medien-SFU (Audio jetzt, Video später – ein Stack).
- **Supabase** (haben wir) hält Anrufzustand/Realtime; Edge Functions minten die Room-Tokens
  und empfangen die LiveKit-Webhooks (baue ich, sobald die VM erreichbar ist).

## VM-Anforderungen
- Klein reicht: **2 vCPU / 4 GB RAM**, Ubuntu 22.04+, **Docker + docker-compose**.
- Öffentlich erreichbar (dyn. IP ok). Empfehlung: eine **Subdomain** (z. B. `tel-test.sm-artis.ch`)
  per DDNS auf die VM zeigen – dann brauchen weder Zertifikat noch LiveKit-URL eine feste IP.
- **Standort:** für die Testphase egal; produktiv Datenresidenz bewusst wählen
  (Hetzner = EU, Infomaniak/Exoscale = CH). Peoplefone bleibt ohnehin in CH.

## Firewall / Ports (aus dem Internet)
| Port | Protokoll | Wofür |
|---|---|---|
| 5060 | UDP/TCP | SIP-Signalisierung (Kamailio) – **nur auf Peoplefone-IPs freigeben** |
| 5061 | TLS | SIP über TLS (optional/empfohlen) |
| 10000–20000 | UDP | RTP-Medien (SIP-Seite) |
| 7880 | TCP | LiveKit WS/API (hinter Caddy/TLS terminiert) |
| 7881 | TCP | LiveKit WebRTC TCP-Fallback |
| 50000–60000 | UDP | LiveKit WebRTC-Medien (oder Single-Port-Mux 7882/UDP) |
| 3478/5349 | UDP/TCP | TURN (optional, falls NAT-Probleme) |

Redis läuft nur intern (nicht öffentlich). SIP-Port **nie** ungefiltert lassen (Scan-Traffic).

## Was Sascha im Peoplefone-Portal anlegt (hat er selbst Zugriff)
1. Neue **SIP-Linie**, Profiltyp **„SIP-TRUNK"** (nicht 3CX/Teams-Preset), mit einer **freien Testnummer**
   (nicht die Hauptnummer) – die Hauptnummern ziehen wir erst beim Cutover um.
2. Daraus die **Zugangsdaten** (SIP-Proxy/Server, Benutzername, Passwort, Nummer) →
   **direkt bei dir auf den Server** in die Kamailio-Config (bzw. Env), **nicht in Chat/Ticket**.
3. Abklären am Trunk: **REFER** (Weiterverbinden) erlaubt? Anzahl **parallele Kanäle**?

## Komponenten (Skizze `docker-compose.yml`)
```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    network_mode: host          # wegen RTP-Portrange am einfachsten
    restart: unless-stopped
    volumes: [ ./livekit.yaml:/etc/livekit.yaml ]
  livekit-sip:
    image: livekit/sip:latest
    network_mode: host
    restart: unless-stopped
    volumes: [ ./sip.yaml:/etc/sip.yaml ]
  kamailio:
    image: kamailio/kamailio:latest
    network_mode: host
    restart: unless-stopped
    volumes: [ ./kamailio.cfg:/etc/kamailio/kamailio.cfg ]
  caddy:                        # TLS-Terminierung für die LiveKit-WS-URL
    image: caddy:2
    restart: unless-stopped
    ports: [ "443:443", "80:80" ]
    volumes: [ ./Caddyfile:/etc/caddy/Caddyfile, caddy_data:/data ]
volumes: { caddy_data: {} }
```
- **livekit.yaml**: `keys:` (API-Key/Secret generieren), `redis:`, `rtc.use_external_ip: true`, `webhook.urls:` → unsere Supabase Edge Function.
- **sip.yaml**: LiveKit-SIP an `redis` + `ws_url` des LiveKit-Servers; Inbound/Outbound-Trunk zeigt auf **Kamailio (localhost)**, nicht direkt auf Peoplefone.
- **kamailio.cfg**: registriert sich beim Peoplefone-Trunk (uac_reg / auth mit User+PW), leitet eingehende INVITEs an LiveKit SIP (127.0.0.1:5080 o. ä.), ausgehende von LiveKit → Peoplefone. (Config-Vorlage liefere ich, wenn die Trunk-Daten stehen.)

## Was du mir zurückgibst (dann verdrahte ich das Frontend)
1. **LiveKit-WS-URL** (z. B. `wss://tel-test.sm-artis.ch`) + **API-Key** + **API-Secret**
   → als **Supabase-Secrets** (nicht in Chat). Damit minte ich die Room-Tokens serverseitig.
2. Bestätigung, dass Kamailio beim Peoplefone-Trunk **registriert** ist (Inbound testbar).
3. Die öffentliche Erreichbarkeit (Domain/Port-Freigaben) steht.

## Test-Ablauf (wenn alles läuft)
1. smartis-Softphone (`/telefonie`) verbindet sich mit LiveKit (Token via Edge Fn).
2. **Ausgehend:** Nummer wählen → LiveKit SIP → Kamailio → Peoplefone → klingelt extern.
3. **Eingehend:** Anruf auf die Testnummer → Peoplefone → Kamailio → LiveKit → Webhook →
   Supabase-Realtime → Softphone poppt auf (Screen-Pop) → Annehmen → Gespräch.
4. Läuft das stabil, ziehen wir mit Sascha eine echte Nummer um (Cutover) und dann produktiv auf deinen Server.

---
*Frontend-Stand: Das Telefonie-Modul (`/telefonie`) + Softphone-Widget sind auf smartis.me live,
Backend noch gestubbt. Sobald Punkt „Was du mir zurückgibst" steht, ersetze ich den Stub durch
den echten LiveKit-Client + die Edge Functions (Token + Webhook + Nummer→Kunde-Screen-Pop).*
