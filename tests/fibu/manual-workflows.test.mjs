import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260726192000_fibu_manual_workflows_atomic.sql',
);

const bootstrapSql = `
  create role authenticated;
  create role service_role;
  create role anon;
  create schema auth;
  create table auth.users(id uuid primary key);
  create table auth.test_session(
    singleton boolean primary key default true,
    user_id uuid,
    jwt_role text not null default 'authenticated'
  );
  insert into auth.test_session(singleton) values (true);
  create function auth.uid() returns uuid language sql stable as
    'select user_id from auth.test_session where singleton';
  create function auth.role() returns text language sql stable as
    'select jwt_role from auth.test_session where singleton';

  create table fibu_mandanten(
    id uuid primary key default gen_random_uuid(),
    name text not null,
    aktiv boolean not null default true,
    mwst_methode text not null default 'effektiv',
    fw_buchungskurs text not null default 'monat',
    belegfreigabe_aktiv boolean not null default false
  );
  create table fibu_user_mandant_access(
    user_id uuid not null,
    mandant_id uuid not null references fibu_mandanten(id),
    role text not null,
    primary key(user_id, mandant_id)
  );
  create function fibu_can_write_for(p_mandant_id uuid) returns boolean
    language sql stable security definer set search_path=public as
    'select exists(select 1 from fibu_user_mandant_access where user_id=auth.uid() and mandant_id=p_mandant_id and role in (''admin'',''buchhalter''))';
  create function fibu_mandant_ids_for_user() returns uuid[]
    language sql stable security definer set search_path=public as
    'select coalesce(array_agg(mandant_id), array[]::uuid[]) from fibu_user_mandant_access where user_id=auth.uid()';

  create table fibu_konten(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    konto_nr text not null,
    bezeichnung text not null,
    konto_typ text not null,
    aktiv boolean not null default true,
    unique(mandant_id, konto_nr)
  );
  create table fibu_lieferanten(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    nr text not null,
    name text not null,
    iban text,
    standard_konto_nr text,
    mwst_code text not null default 'M81',
    aktiv boolean not null default true,
    updated_at timestamptz not null default now()
  );
  create table fibu_mwst_codes(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    code text not null,
    bezeichnung text not null,
    satz numeric not null,
    typ text not null,
    konto_vorsteuer text,
    konto_umsatz text,
    aktiv boolean not null default true,
    unique(mandant_id, code)
  );
  create table fibu_wechselkurse(
    id uuid primary key default gen_random_uuid(),
    waehrung text not null,
    datum date not null,
    typ text not null,
    kurs numeric not null
  );

  create table fibu_kreditoren_belege(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    beleg_nr text not null,
    lieferant_id uuid not null references fibu_lieferanten(id),
    lieferant_beleg_nr text,
    belegdatum date not null,
    buchungsdatum date,
    valutadatum date,
    faelligkeit date not null,
    zahlungsbedingung_tage smallint,
    waehrung text not null default 'CHF',
    betrag_netto numeric not null default 0,
    betrag_mwst numeric not null default 0,
    betrag_brutto numeric not null default 0,
    betrag_bezahlt numeric not null default 0,
    bezahlt_am date,
    zahlungsreferenz text,
    status text not null default 'offen',
    notiz text,
    scan_url text,
    scan_ocr_text text,
    gebucht_am timestamptz not null default now(),
    gebucht_von uuid,
    verbucht boolean not null default false,
    belegtyp text not null default 'rechnung',
    storno_beleg_id uuid,
    kurs numeric,
    freigabe_status text not null default 'freigegeben',
    freigegeben_am timestamptz,
    freigegeben_von uuid,
    mwst_abgerechnet boolean not null default false,
    mwst_abrechnung_ref text,
    belegreferenz text,
    gruppe text,
    belegtext text,
    skonto_gebucht boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(mandant_id, beleg_nr)
  );
  create table fibu_kreditoren_positionen(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    beleg_id uuid not null references fibu_kreditoren_belege(id) on delete cascade,
    position smallint not null,
    konto_nr text not null,
    bezeichnung text,
    mwst_code text not null,
    mwst_satz numeric not null,
    betrag_netto numeric not null,
    betrag_mwst numeric not null,
    betrag_brutto numeric not null,
    kostenstelle text
  );

  create table fibu_kunden(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    nr text not null,
    name text not null,
    aktiv boolean not null default true
  );
  create table fibu_artikel(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    nr text not null,
    name text not null,
    aktiv boolean not null default true
  );
  create table fibu_debitoren_belege(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    beleg_nr text not null,
    kunde_id uuid not null references fibu_kunden(id),
    belegtyp text not null default 'rechnung',
    titel text,
    belegdatum date not null,
    valutadatum date,
    faelligkeit date not null,
    zahlungsbedingung_tage smallint,
    waehrung text not null default 'CHF',
    betrag_netto numeric not null default 0,
    betrag_mwst numeric not null default 0,
    betrag_brutto numeric not null default 0,
    betrag_bezahlt numeric not null default 0,
    bezahlt_am date,
    zahlungsreferenz text,
    status text not null default 'entwurf',
    notiz text,
    pdf_url text,
    verbucht boolean not null default false,
    storno_beleg_id uuid,
    gebucht_am timestamptz,
    gebucht_von uuid,
    mahnstufe smallint not null default 0,
    letzte_mahnung_am date,
    source_system text,
    source_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(mandant_id, beleg_nr)
  );
  create table fibu_debitoren_positionen(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    beleg_id uuid not null references fibu_debitoren_belege(id) on delete cascade,
    position smallint not null,
    artikel_id uuid,
    bezeichnung text,
    menge numeric not null default 1,
    einheit text,
    einzelpreis numeric not null default 0,
    konto_nr text not null,
    mwst_code text not null,
    mwst_satz numeric not null,
    betrag_netto numeric not null,
    betrag_mwst numeric not null,
    betrag_brutto numeric not null,
    kostenstelle text
  );

  create table fibu_buchungen(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    buchungs_nr text not null,
    buchungsdatum date not null,
    beleg_ref text,
    konto_soll text not null,
    konto_haben text not null,
    betrag numeric not null,
    mwst_code text,
    mwst_betrag numeric,
    text text,
    quelle text,
    quelle_id uuid,
    created_by uuid,
    fw_waehrung text,
    fw_betrag numeric,
    unique(mandant_id, buchungs_nr)
  );
  create table fibu_buchungs_counter(
    mandant_id uuid primary key references fibu_mandanten(id),
    value integer not null default 0
  );
  create function fibu_next_buchungs_nr(p_mandant_id uuid) returns text
    language plpgsql security definer set search_path=public as $$
    declare n integer;
    begin
      insert into fibu_buchungs_counter(mandant_id,value) values(p_mandant_id,1)
      on conflict(mandant_id) do update set value=fibu_buchungs_counter.value+1
      returning value into n;
      return 'B-' || lpad(n::text, 6, '0');
    end $$;

  create table fibu_debitoren_counter(
    mandant_id uuid not null references fibu_mandanten(id),
    year integer not null,
    value integer not null default 0,
    primary key(mandant_id, year)
  );
  create function fibu_next_debitoren_nr(p_mandant_id uuid) returns text
    language plpgsql security definer set search_path=public as $$
    declare y integer := extract(year from current_date)::integer; n integer;
    begin
      if coalesce(auth.role(),'') <> 'service_role'
         and not fibu_can_write_for(p_mandant_id) then raise exception 'Keine Rolle'; end if;
      insert into fibu_debitoren_counter(mandant_id,year,value) values(p_mandant_id,y,1)
      on conflict(mandant_id,year) do update set value=fibu_debitoren_counter.value+1
      returning value into n;
      return 'DR-' || y || '-' || lpad(n::text,4,'0');
    end $$;

  create table fibu_zahlungslaeufe(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    lauf_nr text not null,
    valutadatum date not null,
    zahlungskonto_nr text not null,
    zahlungskonto_iban text,
    total_betrag numeric not null default 0,
    anzahl_zahlungen smallint not null default 0,
    status text not null default 'entwurf',
    pain001_xml text,
    exportiert_am timestamptz,
    verbucht_am timestamptz,
    created_at timestamptz not null default now(),
    created_by uuid,
    unique(mandant_id,lauf_nr)
  );
  create table fibu_zahlungslauf_positionen(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    zahlungslauf_id uuid not null references fibu_zahlungslaeufe(id) on delete cascade,
    beleg_id uuid not null references fibu_kreditoren_belege(id),
    lieferant_id uuid not null references fibu_lieferanten(id),
    iban text not null,
    betrag numeric not null,
    zahlungsreferenz text,
    zahlungsmitteilung text,
    skonto_betrag numeric not null default 0,
    status text not null default 'offen'
  );
  create function fibu_zlp_no_double() returns trigger language plpgsql as $$
  begin
    if exists(
      select 1 from fibu_zahlungslauf_positionen p
      join fibu_zahlungslaeufe l on l.id=p.zahlungslauf_id
      where p.beleg_id=new.beleg_id and p.status<>'storniert' and l.status<>'storniert'
    ) then raise exception 'Beleg ist bereits in einem aktiven Zahlungslauf'; end if;
    return new;
  end $$;
  create trigger trg_no_double before insert on fibu_zahlungslauf_positionen
    for each row execute function fibu_zlp_no_double();

  create table fibu_debitoren_mahnungen(
    id uuid primary key default gen_random_uuid(),
    mandant_id uuid not null references fibu_mandanten(id),
    beleg_id uuid not null references fibu_debitoren_belege(id),
    stufe smallint not null,
    mahndatum date not null,
    faellig_am date,
    gebuehr numeric not null,
    betrag_offen numeric not null,
    pdf_url text,
    gesendet_am timestamptz,
    gesendet_an text,
    created_at timestamptz not null default now(),
    created_by uuid
  );

  alter table fibu_debitoren_belege enable row level security;
  alter table fibu_debitoren_positionen enable row level security;
  alter table fibu_debitoren_mahnungen enable row level security;
`;

async function one(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0];
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(bootstrapSql);
  const sql = await readFile(migrationPath, 'utf8');
  await db.exec(sql);
  return db;
}

test('manual FiBu workflows are atomic and server-derived', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const user = '10000000-0000-0000-0000-000000000001';
  const mandant = '20000000-0000-0000-0000-000000000001';
  const supplier = '30000000-0000-0000-0000-000000000001';
  const customer = '40000000-0000-0000-0000-000000000001';
  await db.query(`insert into auth.users(id) values($1)`, [user]);
  await db.query(`insert into fibu_mandanten(id,name) values($1,'Test AG')`, [mandant]);
  await db.query(
    `insert into fibu_user_mandant_access values($1,$2,'admin')`,
    [user, mandant],
  );
  await db.query(
    `insert into fibu_konten(mandant_id,konto_nr,bezeichnung,konto_typ) values
       ($1,'1020','Bank','aktiv'),($1,'1100','Debitoren','aktiv'),($1,'1170','Vorsteuer','aktiv'),
       ($1,'2000','Kreditoren','passiv'),($1,'2200','Umsatzsteuer','passiv'),
       ($1,'3400','Ertrag','ertrag'),($1,'6500','Bueromaterial','aufwand')`,
    [mandant],
  );
  await db.query(
    `insert into fibu_mwst_codes(mandant_id,code,bezeichnung,satz,typ,konto_vorsteuer,konto_umsatz) values
       ($1,'M81','Vorsteuer 8.1',8.1,'vorsteuer','1170',null),
       ($1,'V81','Umsatzsteuer 8.1',8.1,'umsatzsteuer',null,'2200')`,
    [mandant],
  );
  await db.query(
    `insert into fibu_lieferanten(id,mandant_id,nr,name,iban)
     values($1,$2,'L-1','Lieferant AG','CH9300762011623852957')`,
    [supplier, mandant],
  );
  await db.query(
    `insert into fibu_kunden(id,mandant_id,nr,name) values($1,$2,'K-1','Kunde AG')`,
    [customer, mandant],
  );
  await db.query(`update auth.test_session set user_id=$1 where singleton`, [user]);

  const creditor = await one(
    db,
    `select x.* from fibu_kreditoren_erstellen(
       $1,
       jsonb_build_object(
         'lieferant_id',$2::text,'belegdatum','2026-01-05','buchungsdatum','2025-12-31',
         'faelligkeit','2026-02-04','waehrung','CHF','status','offen',
         'betrag_brutto',999999
       ),
       jsonb_build_array(jsonb_build_object(
         'konto_nr','6500','mwst_code','M81','betrag_netto',100,
         'betrag_mwst',8.1,'betrag_brutto',108.1
       ))
     ) x`,
    [mandant, supplier],
  );
  assert.match(creditor.beleg_nr, /^KR-\d{4}-0001$/);
  assert.equal(Number(creditor.betrag_brutto), 108.1);
  assert.equal(creditor.verbucht, true);
  const creditorGl = await db.query(
    `select buchungsdatum, konto_soll, konto_haben, betrag, mwst_code
       from fibu_buchungen where quelle='kreditoren' and quelle_id=$1
       order by betrag desc`,
    [creditor.id],
  );
  assert.equal(creditorGl.rows.length, 2);
  assert.ok(creditorGl.rows.every((row) =>
    new Date(row.buchungsdatum).toISOString().slice(0, 10) === '2025-12-31'));
  assert.equal(creditorGl.rows.filter((row) => row.mwst_code !== null).length, 1);

  await db.query(
    `select fibu_kreditoren_bearbeiten(
       $1,
       jsonb_build_object(
         'belegdatum','2026-01-06','buchungsdatum','2026-01-02',
         'faelligkeit','2026-02-05'
       ),
       jsonb_build_array(jsonb_build_object(
         'konto_nr','6500','mwst_code','M81','betrag_netto',200,
         'betrag_mwst',16.2,'betrag_brutto',216.2
       ))
     )`,
    [creditor.id],
  );
  const editedCreditor = await one(
    db,
    `select betrag_brutto,verbucht from fibu_kreditoren_belege where id=$1`,
    [creditor.id],
  );
  assert.equal(Number(editedCreditor.betrag_brutto), 216.2);
  assert.equal(editedCreditor.verbucht, true);
  const editedGl = await db.query(
    `select buchungsdatum from fibu_buchungen
      where quelle='kreditoren' and quelle_id=$1`,
    [creditor.id],
  );
  assert.equal(editedGl.rows.length, 2);
  assert.ok(editedGl.rows.every((row) =>
    new Date(row.buchungsdatum).toISOString().slice(0, 10) === '2026-01-02'));

  const beforeBad = await one(db, `select count(*)::int as n from fibu_kreditoren_belege`);
  await assert.rejects(
    db.query(
      `select fibu_kreditoren_erstellen(
         $1,
         jsonb_build_object('lieferant_id',$2::text,'belegdatum','2026-02-01','faelligkeit','2026-03-01'),
         jsonb_build_array(jsonb_build_object(
           'konto_nr','9999','mwst_code','M81','betrag_netto',10,
           'betrag_mwst',0.81,'betrag_brutto',10.81
         ))
       )`,
      [mandant, supplier],
    ),
    /Ungueltiges.*konto/i,
  );
  const afterBad = await one(db, `select count(*)::int as n from fibu_kreditoren_belege`);
  assert.equal(afterBad.n, beforeBad.n);

  const debtor = await one(
    db,
    `select x.* from fibu_debitoren_erstellen(
       $1,
       jsonb_build_object(
         'kunde_id',$2::text,'belegdatum','2026-07-26','faelligkeit','2026-08-25',
         'status','offen','waehrung','CHF','betrag_brutto',1
       ),
       jsonb_build_array(jsonb_build_object(
         'bezeichnung','Beratung','menge',1,'einzelpreis',200,
         'konto_nr','3400','mwst_code','V81','betrag_netto',200,
         'betrag_mwst',16.2,'betrag_brutto',216.2
       ))
     ) x`,
    [mandant, customer],
  );
  assert.equal(Number(debtor.betrag_brutto), 216.2);
  assert.equal(debtor.verbucht, true);
  assert.equal(debtor.zahlungsreferenz.length, 27);
  await assert.rejects(
    db.query(`select fibu_debitoren_entwurf_loeschen($1)`, [debtor.id]),
    /Nur ungebuchte.*Entwuerfe/i,
  );

  const draft = await one(
    db,
    `select x.* from fibu_debitoren_erstellen(
       $1,
       jsonb_build_object(
         'kunde_id',$2::text,'belegdatum','2026-07-26','faelligkeit','2026-08-25',
         'status','entwurf','waehrung','CHF'
       ),
       jsonb_build_array(jsonb_build_object(
         'bezeichnung','Entwurf','konto_nr','3400','mwst_code','V81',
         'betrag_netto',10,'betrag_mwst',0.81,'betrag_brutto',10.81
       ))
     ) x`,
    [mandant, customer],
  );
  await db.query(`select fibu_debitoren_entwurf_loeschen($1)`, [draft.id]);
  const deletedDraft = await one(
    db,
    `select count(*)::int as n from fibu_debitoren_belege where id=$1`,
    [draft.id],
  );
  assert.equal(deletedDraft.n, 0);

  await one(
    db,
    `select x.* from fibu_debitoren_zahlung_erfassen($1,100,'2026-07-27') x`,
    [debtor.id],
  );
  await assert.rejects(
    db.query(
      `select fibu_debitoren_zahlung_erfassen($1,200,'2026-07-28')`,
      [debtor.id],
    ),
    /uebersteigt/i,
  );
  const paid = await one(
    db,
    `select betrag_bezahlt,status from fibu_debitoren_belege where id=$1`,
    [debtor.id],
  );
  assert.equal(Number(paid.betrag_bezahlt), 100);
  assert.equal(paid.status, 'teilbezahlt');

  await assert.rejects(
    db.query(
      `select fibu_zahlungslauf_erstellen(
         $1,
         jsonb_build_object(
           'lauf_nr','ZL-FAIL','valutadatum','2026-07-27',
           'zahlungskonto_nr','1020','status','exportiert'
         ),
         jsonb_build_array(
           jsonb_build_object(
             'beleg_id',$2::text,'lieferant_id',$3::text,
             'iban','CH9300762011623852957','betrag',50
           ),
           jsonb_build_object(
             'beleg_id',gen_random_uuid()::text,'lieferant_id',$3::text,
             'iban','CH9300762011623852957','betrag',1
           )
         )
       )`,
      [mandant, creditor.id, supplier],
    ),
    /gehoert nicht zum Mandanten/i,
  );
  const failedRun = await one(
    db,
    `select count(*)::int as n from fibu_zahlungslaeufe where lauf_nr='ZL-FAIL'`,
  );
  assert.equal(failedRun.n, 0);
  const creditorAfterRun = await one(
    db,
    `select status from fibu_kreditoren_belege where id=$1`,
    [creditor.id],
  );
  assert.equal(creditorAfterRun.status, 'offen');

  const run = await one(
    db,
    `select x.* from fibu_zahlungslauf_erstellen(
       $1,
       jsonb_build_object(
         'lauf_nr','ZL-OK','valutadatum','2026-07-27',
         'zahlungskonto_nr','1020','status','exportiert'
       ),
       jsonb_build_array(jsonb_build_object(
         'beleg_id',$2::text,'lieferant_id',$3::text,
         'iban','CH9300762011623852957','betrag',50,'skonto_betrag',10
       ))
     ) x`,
    [mandant, creditor.id, supplier],
  );
  assert.equal(Number(run.total_betrag), 50);
  assert.equal(run.anzahl_zahlungen, 1);
  const creditorInRun = await one(
    db,
    `select status from fibu_kreditoren_belege where id=$1`,
    [creditor.id],
  );
  assert.equal(creditorInRun.status, 'ebanking');
  await assert.rejects(
    db.query(
      `select fibu_zahlungslauf_erstellen(
         $1,
         jsonb_build_object(
           'lauf_nr','ZL-DUP','valutadatum','2026-07-27',
           'zahlungskonto_nr','1020','status','exportiert'
         ),
         jsonb_build_array(jsonb_build_object(
           'beleg_id',$2::text,'lieferant_id',$3::text,
           'iban','CH9300762011623852957','betrag',1
         ))
       )`,
      [mandant, creditor.id, supplier],
    ),
    /nicht zahlbar|aktiven Zahlungslauf/i,
  );
  const duplicateRun = await one(
    db,
    `select count(*)::int as n from fibu_zahlungslaeufe where lauf_nr='ZL-DUP'`,
  );
  assert.equal(duplicateRun.n, 0);

  const reminder = await one(
    db,
    `select x.* from fibu_debitoren_mahnung_erstellen(
       $1,1::smallint,20,'2026-08-10',null,'billing@test.invalid'
     ) x`,
    [debtor.id],
  );
  assert.equal(reminder.stufe, 1);
  assert.equal(Number(reminder.betrag_offen), 116.2);
  const remindedDebtor = await one(
    db,
    `select mahnstufe from fibu_debitoren_belege where id=$1`,
    [debtor.id],
  );
  assert.equal(remindedDebtor.mahnstufe, 1);
});

test('readonly users cannot call financial write facades', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const user = '50000000-0000-0000-0000-000000000001';
  const mandant = '60000000-0000-0000-0000-000000000001';
  await db.query(`insert into auth.users(id) values($1)`, [user]);
  await db.query(`insert into fibu_mandanten(id,name) values($1,'Read only')`, [mandant]);
  await db.query(
    `insert into fibu_user_mandant_access values($1,$2,'readonly')`,
    [user, mandant],
  );
  await db.query(`update auth.test_session set user_id=$1 where singleton`, [user]);
  await assert.rejects(
    db.query(
      `select fibu_kreditoren_erstellen(
         $1, '{}'::jsonb, '[]'::jsonb
       )`,
      [mandant],
    ),
    /Keine Buchungsberechtigung/i,
  );
});
