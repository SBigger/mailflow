# artis.sm-artis.ch – Sichere Härtung (Klick-Anleitung Supabase-Dashboard)

**Für: das produktive artis-Projekt (scharfe Daten).**
**Grundregel: Alles hier ist Anschauen + Einstellungen. Kein Test gegen Live-Daten, keine Angriffe.**
Der eigentliche Stress-/Pentest wird separat, geplant und gegen Staging mit Roger gemacht – nicht hier.

Legende je Schritt:
- 🟢 **Gefahrlos** – reines Anschauen oder Einstellung ohne Wirkung auf eingeloggte Nutzer.
- 🟡 **Wirkung möglich** – kann NEUE Logins/Registrierungen betreffen. Bestehende Sessions bleiben. Bewusst setzen.
- 🔴 **Kann aussperren** – nur mit Bedacht / Ankündigung. Hier markiere ich, wie man es sanft macht.

> Login ins Dashboard: https://supabase.com/dashboard → artis-Projekt auswählen.
> Menü-Bezeichnungen können je nach Dashboard-Version leicht abweichen – ich beschreibe zusätzlich das *Ziel*, damit du es auch findest, wenn ein Label umbenannt wurde.

---

## 0. Der wichtigste Klick zuerst: Security Advisor 🟢
Supabase hat einen eingebauten Prüfer, der genau die gefährlichen Lücken meldet – **ohne irgendetwas zu verändern**.

1. Linkes Menü → **Advisors** → **Security Advisor** (früher unter *Database → Advisors*).
2. Liste durchgehen. Typische Funde:
   - **Tabellen ohne RLS** („RLS disabled in public schema") → das ist der kritischste Befund, siehe Schritt 1.
   - **Views mit `security definer`**, **Funktionen mit unsicherem `search_path`**, **exposed Auth-Daten**.
3. Jeden Punkt notieren. Advisor **behebt nichts automatisch** – er zeigt nur. Das Anschauen ist 100 % gefahrlos.

➡️ Ergebnis dieser Seite ist deine To-do-Liste. Wenn hier „No issues" steht, ist das Fundament sehr gut.

---

## 1. Row Level Security (RLS) – die eigentliche Aussenmauer 🟢 (prüfen) / 🟡 (aktivieren)
RLS entscheidet, wer welche Datenzeilen sieht – auch mit dem öffentlichen anon-Key. Das ist DIE Schicht, die „von aussen reinkommen" verhindert.

**Prüfen (🟢):**
1. Menü → **Database** → **Tables**. Jede Tabelle im Schema `public` zeigt einen **RLS-Status**.
2. Oder Menü → **Authentication** → **Policies**: hier siehst du pro Tabelle die Policies.
3. **Jede Tabelle ohne aktivierte RLS ist ein potenzielles Loch** (mit anon-Key von aussen lesbar/schreibbar).

**Aktivieren, falls eine Tabelle offen ist (🟡):**
- ⚠️ Reihenfolge wichtig: **erst Policies definieren, dann RLS einschalten.** Wenn du RLS einschaltest *ohne* Policy, ist die Tabelle für alle **gesperrt** (Default deny) → die App-Funktion, die darauf zugreift, bricht. Das ist „sicher, aber kaputt".
- Vorgehen sanft: Tabelle in der App identifizieren → passende Policy schreiben (z. B. „nur eigener Mandant/eigene Zeilen") → in einer ruhigen Zeit aktivieren → Funktion testen.
- Tipp: Die smartis-Migrationen enthalten schon ~39 Policy-Definitionen – die gleichen gehören auf artis. Roger gleicht das beim Portieren ab.

---

## 2. Multi-Faktor / 2FA aktivieren 🟢 (verfügbar machen)
Aktuell ist MFA im Code-Config aus. Für Produktivdaten stark empfohlen – mindestens für Admins.

1. Menü → **Authentication** → **Sign In / Providers** (bzw. **Configuration**) → Abschnitt **Multi-Factor Authentication**.
2. **TOTP (Authenticator-App)** aktivieren → *enroll* + *verify* einschalten.
3. 🟢 Das **Verfügbar-Machen** von MFA sperrt niemanden aus – Nutzer können es dann freiwillig einrichten.
4. 🔴 **Nicht** sofort „MFA erzwingen" für alle anschalten – das würde Nutzer ohne eingerichtetes 2FA aussperren. Sanft: erst verfügbar machen, Team 2FA einrichten lassen, später (optional) für Admin-Rollen verpflichtend machen.

---

## 3. Registrierung & E-Mail-Bestätigung 🟡
1. Menü → **Authentication** → **Sign In / Providers** → **Email**.
2. **„Allow new users to sign up" / Enable Signup**:
   - Wenn artis ein geschlossenes System ist (nur eingeladene Mitarbeiter): 🟡 **ausschalten**. Bestehende Nutzer sind nicht betroffen, es können sich nur keine Fremden mehr selbst anlegen.
3. **„Confirm email"** (E-Mail-Bestätigung vor erstem Login):
   - 🔴 Vorsicht: Wenn du das anschaltest und es gibt **bestehende, unbestätigte** Konten, können die sich evtl. nicht mehr einloggen. Vor dem Anschalten prüfen (Authentication → Users → Spalte „Confirmed"). Für neue Nutzer sinnvoll, für Bestand erst bereinigen.

---

## 4. Passwort-Richtlinie 🟡
1. Menü → **Authentication** → **Sign In / Providers** bzw. **Policies** → Abschnitt **Passwords** / **Attack Protection**.
2. **Minimum password length**: von 6 auf **≥ 10** anheben. 🟡 Wirkt nur bei **neuen** Passwörtern/Änderungen – bestehende Logins bleiben gültig.
3. **Password Requirements** (Zeichenklassen) optional aktivieren.
4. **Leaked Password Protection** (Abgleich mit HaveIBeenPwned) **einschalten**. 🟡 Blockt nur das Setzen bekannter geleakter Passwörter – kein Einfluss auf bestehende Sessions.

---

## 5. API-Oberfläche & Netzwerk 🟢
1. Menü → **Project Settings** → **API**:
   - **Exposed schemas**: sollte nur `public` (+ ggf. `storage`, `graphql_public`) sein. Nichts Internes exponieren. 🟢 nur prüfen.
   - **Service Role Key**: dieser Key umgeht RLS. Er darf **nur serverseitig** (Edge Functions / Vercel-Env) liegen, **nie** im Frontend-Bundle. Kurz gegenchecken, dass er nirgends im Client-Code steht.
2. Menü → **Project Settings** → **Database**:
   - **SSL enforcement**: an. 🟢
   - **Network Restrictions** (falls im Plan enthalten): DB-Zugriff auf bekannte IPs/Supabase begrenzen. 🟡 Nur setzen, wenn du die zugreifenden IPs kennst (sonst sperrst du dich/Backups aus).

---

## 6. Backups & Wiederherstellung 🟢
1. Menü → **Database** → **Backups**.
2. Prüfen: Gibt es **tägliche Backups**? Ist **Point-in-Time-Recovery (PITR)** aktiv (je nach Plan)?
3. 🟢 **Wichtigster Punkt fürs Gefühl „voll sicher":** Backup ohne getesteten Restore ist kein Backup. Den Restore-Test macht man aber in ein **separates/neues Projekt** (nie über die Produktion drüber) – das planen wir mit Roger.

---

## 7. Postgres- & Plattform-Updates 🟡
1. Menü → **Project Settings** → **Infrastructure**.
2. Steht dort ein **„Upgrade available"** (Postgres-Version)? Sicherheitsupdates einspielen.
3. 🟡 Ein Postgres-Upgrade hat eine **kurze Downtime** → in einer Randzeit machen, vorher Backup prüfen.

---

## 8. Beobachten (laufend) 🟢
1. Menü → **Logs** → **Auth Logs** / **API / Edge Logs**: gelegentlich auf auffällige Muster schauen (viele 401/403, ungewöhnliche IPs, Brute-Force auf Login).
2. Menü → **Authentication** → **Rate Limits**: sinnvolle Limits gesetzt? (Schutz gegen Login-Brute-Force.)

---

## Zusammengefasst – Reihenfolge fürs sichere Vorgehen
1. 🟢 **Security Advisor** laufen lassen → To-do-Liste.
2. 🟢 **RLS-Status** aller Tabellen prüfen (kein Loch offen).
3. 🟡 **MFA verfügbar** machen (nicht erzwingen), **Signup** ggf. zu, **Passwort-Policy** hoch, **Leaked-Password-Schutz** an.
4. 🟢 **API-Schemas / Service-Key / SSL** gegenchecken.
5. 🟢 **Backups/PITR** prüfen.
6. 🟡 **Postgres-Update** in Randzeit.
7. ➡️ **Die drei Code-Fixes aus PR #17** (zefix-search, Security-Header, xlsx) von smartis nach artis portieren (Roger).

**Nichts davon greift Produktion an.** Die einzigen Punkte, die überhaupt Nutzer betreffen können, sind mit 🟡/🔴 markiert – und da steht jeweils, wie man es sanft macht. Der aktive Stress-/Pentest kommt separat, geplant, mit Roger, gegen Staging.
