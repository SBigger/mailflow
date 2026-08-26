-- Zwischenabschlüsse: Monat als optionale Periode auf abschluss ergänzen.
-- 0 = Jahresabschluss (bisheriges Verhalten, Default), 1-12 = Zwischenabschluss
-- per Monatsende. Sentinel 0 statt NULL, damit die Eindeutigkeit
-- (Kunde, Jahr, Monat, Version) mit einem normalen UNIQUE-Constraint
-- funktioniert -- Postgres behandelt NULL in UNIQUE als "immer verschieden",
-- ein nullable monat hätte also keinen echten Schutz vor Doppel-Jahresabschlüssen.

alter table public.abschluss
  add column monat integer not null default 0;

alter table public.abschluss
  add constraint abschluss_monat_check check (monat >= 0 and monat <= 12);

alter table public.abschluss
  drop constraint abschluss_customer_jahr_version_unique;

alter table public.abschluss
  add constraint abschluss_customer_jahr_monat_version_unique
  unique (customer_id, geschaeftsjahr, monat, version);
