-- =====================================================================
-- Neuer Ansatz-Modus 'auto' (Gruppenansatz-Kaskade): Satz wird automatisch
-- aufgeloest -> 1) Tarifgruppe/Rolle des erfassenden MA x Leistungsart,
-- 2) sonst Mitarbeitergruppe, 3) sonst MA-Stundensatz.
-- HINWEIS: ALTER TYPE ... ADD VALUE muss ALLEIN (ausserhalb Transaktion) laufen.
-- =====================================================================

alter type public.le_rate_mode add value if not exists 'auto';
