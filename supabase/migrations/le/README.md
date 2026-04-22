# Leistungserfassung · Migrations

**Status:** REVIEW – nichts davon ist auf Supabase ausgeführt.

## Dateien

| Datei | Inhalt | Reversible? |
|---|---|---|
| `0001_le_core_schema.sql` | 7 Tabellen (`le_employee`, `le_service_type`, `le_service_rate_history`, `le_rate_group`, `le_rate_group_rate`, `le_project`, `le_time_entry`) + RLS + updated_at-Trigger + Helper `le_is_admin()` | ja – nur `le_*` und `le_is_admin()` sauber droppen |

## Prinzipien

- **Prefix `le_*`** für alle neuen Tabellen – keine Kollision mit bestehenden Tabellen.
- Bestehende Tabellen werden **nur lesend** via FK referenziert (`customers.id`, `profiles.id`) mit `on delete set null` – Löschen eines Kunden/Profils bricht das Leistungserfassungs-System nicht.
- **RLS strikt an** für alle neuen Tabellen:
  - Lesen: alle authenticated User
  - Stammdaten schreiben: nur Admin (`profiles.role = 'admin'`)
  - Eigene Rapporte schreiben: jeder über `le_employee.profile_id = auth.uid()`
- **Keine Seeds** in dieser Migration. Leistungsarten & Default-Gruppenansatz legen wir später gemeinsam fest.

## Ausführen (später, nach Review)

Zwei Optionen:

1. **Supabase SQL Editor** (Dashboard → SQL → neue Query → Inhalt einfügen → Run)
2. **CLI** (falls supabase-CLI verdrahtet): `supabase db execute -f supabase/migrations/le/0001_le_core_schema.sql`

## Rollback

```sql
drop table if exists public.le_time_entry          cascade;
drop table if exists public.le_rate_group_rate     cascade;
drop table if exists public.le_rate_group          cascade;
drop table if exists public.le_project             cascade;
drop table if exists public.le_service_rate_history cascade;
drop table if exists public.le_service_type        cascade;
drop table if exists public.le_employee            cascade;
drop type  if exists le_project_billing_mode;
drop type  if exists le_project_status;
drop type  if exists le_time_entry_status;
drop function if exists public.le_set_updated_at();
drop function if exists public.le_is_admin();
```
