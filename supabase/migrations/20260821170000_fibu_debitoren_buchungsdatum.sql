-- ============================================================================
-- Debitoren bekommen ein Buchungsdatum
--
-- Bisher kannten nur die Kreditoren zwei Daten: `belegdatum` (das Datum auf dem
-- Papier) und `buchungsdatum` (die Periode, in der gebucht wird). Bei den
-- Debitoren fehlte das zweite ganz - `fibu_debitoren_verbuchen` schrieb stur
-- `beleg.belegdatum` ins Journal.
--
-- Das fuehrt in eine Sackgasse: Eine Rechnung, die im Januar fuer Leistungen
-- des Vorjahres gestellt wird (Belegdatum 31.12.), laesst sich nicht mehr
-- verbuchen, sobald der Dezember gesperrt oder die MWST-Periode abgeschlossen
-- ist - der Trigger `fibu_check_buchungssperre` weist sie ab, und es gibt kein
-- Ausweichdatum. Bei den Kreditoren loest man genau das ueber das
-- Buchungsdatum.
--
-- Die Debitoren erhalten deshalb dieselbe Mechanik wie die Kreditoren:
--   * neue Spalte `buchungsdatum`
--   * Anlage und Entwurfsbearbeitung uebernehmen sie aus dem Beleg-JSON
--   * verbucht wird mit `coalesce(buchungsdatum, belegdatum)`
--
-- Bestandsbelege bleiben unberuehrt: ohne Wert gilt weiterhin das Belegdatum.
-- Das Valutadatum bleibt bewusst wie es ist (die Erfassung setzt es gleich dem
-- Belegdatum) - dafuer braucht es zuerst eine fachliche Festlegung.
--
-- Die drei Funktionen werden gezielt gepatcht statt neu geschrieben: so bleibt
-- der uebrige Rumpf garantiert unveraendert. Fehlt eine erwartete Textstelle,
-- bricht die Migration ab, statt still nichts zu tun. Idempotent.
-- ============================================================================

alter table public.fibu_debitoren_belege
  add column if not exists buchungsdatum date;

comment on column public.fibu_debitoren_belege.buchungsdatum is
  'Datum, mit dem der Beleg ins Journal gebucht wird. Leer = es gilt das '
  'belegdatum. Erlaubt es, eine Rechnung mit altem Belegdatum in einer offenen '
  'Periode zu verbuchen (analog fibu_kreditoren_belege.buchungsdatum).';

do $$
declare
  -- suchen, ersetzen, Funktionsname
  patches text[][] := array[
    array[
      'fibu_debitoren_erstellen',
      'valutadatum, faelligkeit, zahlungsbedingung_tage, waehrung,',
      'valutadatum, buchungsdatum, faelligkeit, zahlungsbedingung_tage, waehrung,'
    ],
    array[
      'fibu_debitoren_erstellen',
      'nullif(p_beleg->>''valutadatum'', '''')::date, (p_beleg->>''faelligkeit'')::date,',
      'nullif(p_beleg->>''valutadatum'', '''')::date, nullif(p_beleg->>''buchungsdatum'', '''')::date, (p_beleg->>''faelligkeit'')::date,'
    ],
    array[
      'fibu_debitoren_entwurf_speichern',
      'valutadatum = coalesce(nullif(p_beleg->>''valutadatum'', '''')::date, valutadatum),',
      'valutadatum = coalesce(nullif(p_beleg->>''valutadatum'', '''')::date, valutadatum),' || chr(10) ||
      '         buchungsdatum = coalesce(nullif(p_beleg->>''buchungsdatum'', '''')::date, buchungsdatum),'
    ],
    array[
      'fibu_debitoren_verbuchen',
      'beleg.mandant_id, buchungs_nr, beleg.belegdatum, beleg.beleg_nr,',
      'beleg.mandant_id, buchungs_nr, coalesce(beleg.buchungsdatum, beleg.belegdatum), beleg.beleg_nr,'
    ]
  ];
  i int;
  fname text; suchen text; ersetzen text;
  def text; neu text;
begin
  for i in 1 .. array_length(patches, 1) loop
    fname    := patches[i][1];
    suchen   := patches[i][2];
    ersetzen := patches[i][3];

    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fname;
    if def is null then
      raise exception 'Funktion % nicht gefunden', fname;
    end if;

    if position(ersetzen in def) > 0 then
      raise notice 'schon angepasst: % (%)', fname, i;
      continue;
    end if;
    if position(suchen in def) = 0 then
      raise exception 'Erwartete Stelle in % nicht gefunden (Patch %): %', fname, i, suchen;
    end if;

    neu := replace(def, suchen, ersetzen);
    execute neu;
    raise notice 'angepasst: % (Patch %)', fname, i;
  end loop;
end $$;

-- Gegenprobe: alle drei Funktionen muessen das Buchungsdatum jetzt kennen.
do $$
declare fehlend text;
begin
  select string_agg(p.proname, ', ')
    into fehlend
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fibu_debitoren_erstellen','fibu_debitoren_entwurf_speichern','fibu_debitoren_verbuchen')
     and p.prosrc not like '%buchungsdatum%';
  if fehlend is not null then
    raise exception 'Buchungsdatum fehlt noch in: %', fehlend;
  end if;
end $$;
