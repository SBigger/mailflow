# Deployment Status – Artis MailFlow

**Produktion:** https://smartis.me
**Repo:** https://github.com/SBigger/mailflow
**Letzter Commit:** `865a841` (2026-03-06)

---

## ✅ Deployed (Stand 2026-03-06)

### Code (Vercel)
- Fristen-Management: Seite `/Fristen`, `CustomerFristenTab`, `AddFristDialog`, `GenerateFristenDialog`
- Privatpersonen: Seite `/Personen`, `PrivatpersonImportDialog`
- Steuer-Zugänge Tab (`CustomerSteuerZugaengeTab`)
- Kunden-Erweiterungen: Kanton, Aktiv/Inaktiv, person_type
- Navigation: Fristen-Link mit CalendarClock-Icon
- Settings: updateUserNameMutation direkt via Supabase (RLS policy statt Edge Function)

### Datenbank (Supabase – manuell via SQL Editor ausgeführt)
- `customers.aktiv` (BOOLEAN DEFAULT TRUE)
- `customers.kanton` (TEXT) + Index
- `customers.person_type`, `vorname`, `nachname`, `ahv_nummer`, `geburtsdatum`, `steuer_zugaenge`
- `customers.partner_name`, `customers.partner_vorname`
- Tabelle `fristen` (mit RLS-Policies: `fristen_admin_all`, `fristen_user_access`)
- Trigger `fristen_updated_at`

### Daten
- 93 Privatpersonen aus `Np2_ExportToExcel_202603060655.xlsx` importiert

---

## ⏳ Noch ausstehend / TODO

### Code
- [ ] Fristen-Seite: Standard-Fristen für Privatpersonen generieren (der User macht das manuell via UI)
- [ ] `Personen`-Seite: Noch leer (`src/pages/Personen.jsx` – nur Stub, muss ausgebaut werden)
- [ ] `CustomerSteuerZugaengeTab`: Prüfen ob vollständig funktioniert

### Datenbank
- [ ] RLS-Policy für `fristen` prüfen: Admins sehen alle, User nur eigene → testen
- [ ] `partner_name`/`partner_vorname` in UI sichtbar machen (CustomerHeader etc.)

### Sonstiges
- [ ] `functions/updateUserProfile.ts` (alte Base44-Version im Root) – löschen oder ignorieren
- [ ] `_ul` und `_ul-HPBIG25` Dateien im Root – aufräumen

---

## Deployment-Prozess

```bash
# Code deployen:
cd "C:\Users\SaschaBigger\Artis Treuhand GmbH\OneDrive - Artis Treuhand GmbH\Claude\mailflow"
git add <dateien>
git commit -m "..."
git push origin master
# → Vercel deployed automatisch

# DB-Migration ausführen:
# https://supabase.com/dashboard/project/uawgpxcihixqxqxxbjak/sql/new
# SQL einfügen und Run klicken
```

---

## Credentials (Details in memory/mailflow.md)
- Supabase Project: `uawgpxcihixqxqxxbjak`
- Vercel Project: `prj_rBjE8esZZ0JQCeCqfNgzrqcHE3tA`
- GitHub: `SBigger/mailflow`
- Node.js: `C:\Program Files\nodejs`
