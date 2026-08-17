# Motor-Schnittstelle (`phoneEngine`)

Die Oberfläche kennt **ausschliesslich** diese Schnittstelle. Welcher SIP-Stack
dahinter arbeitet (JsSIP über WebSocket, nativer Stack via IPC, oder heute der
Mock), ist ihr egal — genau deshalb kann die Oberfläche fertig gebaut werden,
bevor der Motor feststeht.

## Zustände eines Anrufs

```
ringing  →  active  →  ended        (eingehend, angenommen)
ringing  →  ended                   (eingehend, abgelehnt/verpasst)
calling  →  active  →  ended        (ausgehend, angenommen)
calling  →  ended                   (ausgehend, nicht erreicht)
```

Rückwärtsübergänge sind verboten. (Lehre aus der Tray-App: peoplefone liefert
Ereignisse mehrfach und unsortiert — der Motor muss das glätten, nicht die
Oberfläche.)

## Methoden

| Methode | Zweck |
|---|---|
| `connect()` | Am Anlagen-Anschluss anmelden (Registrierung) |
| `disconnect()` | Abmelden |
| `dial(number)` | Ausgehenden Anruf starten |
| `answer()` | Klingelnden Anruf annehmen |
| `hangup()` | Aktiven Anruf beenden / klingelnden ablehnen |
| `setMuted(bool)` | Mikrofon stumm |
| `setHold(bool)` | Anruf halten |
| `sendDtmf(digit)` | Tastenton senden |
| `transfer(number)` | Verbinden (blind) |
| `getState()` | Aktueller Gesamtzustand (siehe unten) |

## Ereignisse (`on(event, handler)`)

| Ereignis | Nutzlast |
|---|---|
| `registration` | `{ state: "connecting" \| "registered" \| "failed", extension?, message? }` |
| `call` | `{ id, dir: "in"\|"out", status, peerNumber, peerName?, customer?, dossier?, startedAt?, muted, onHold }` bei jeder Änderung |
| `callEnded` | `{ id, durationSec, reason }` |

## Regeln für jeden künftigen Motor

1. **Ereignisse glätten**: Doppelte/verspätete Meldungen der Anlage dürfen die
   Oberfläche nie erreichen (Status-Rangfolge wie oben, beendete Anruf-IDs merken).
2. **Ehrliche Zustände**: `registered` erst melden, wenn die Anlage wirklich
   bestätigt hat — kein optimistisches Vortäuschen.
3. **Fehler nach oben reichen**, nicht verschlucken: Die Oberfläche zeigt sie an.
