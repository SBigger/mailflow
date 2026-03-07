-- ============================================================
-- PLZ → Kanton für alle Kunden automatisch befüllen
-- Nur Kunden ohne gesetzten Kanton werden aktualisiert
-- Ausführen im Supabase Dashboard → SQL Editor
-- ============================================================

UPDATE public.customers
SET kanton = CASE

  -- ── GE (Genf / Genève) ────────────────────────────────────
  WHEN plz::int BETWEEN 1200 AND 1299 THEN 'GE'

  -- ── VS (Wallis / Valais) ──────────────────────────────────
  WHEN plz::int BETWEEN 1870 AND 1999 THEN 'VS'
  WHEN plz::int BETWEEN 3900 AND 3999 THEN 'VS'

  -- ── VD (Waadt / Vaud) ─────────────────────────────────────
  WHEN plz::int BETWEEN 1000 AND 1197 THEN 'VD'
  WHEN plz::int BETWEEN 1400 AND 1469 THEN 'VD'

  -- ── FR (Freiburg / Fribourg) ──────────────────────────────
  WHEN plz::int BETWEEN 1470 AND 1744 THEN 'FR'
  WHEN plz::int BETWEEN 3175 AND 3215 THEN 'FR'

  -- ── NE (Neuenburg / Neuchâtel) ────────────────────────────
  WHEN plz::int BETWEEN 2000 AND 2416 THEN 'NE'

  -- ── JU (Jura) ─────────────────────────────────────────────
  WHEN plz::int BETWEEN 2800 AND 2900 THEN 'JU'

  -- ── SO (Solothurn) ────────────────────────────────────────
  WHEN plz::int BETWEEN 2540 AND 2554 THEN 'SO'
  WHEN plz::int BETWEEN 3250 AND 3273 THEN 'SO'
  WHEN plz::int BETWEEN 4500 AND 4583 THEN 'SO'
  WHEN plz::int BETWEEN 4600 AND 4665 THEN 'SO'
  WHEN plz::int BETWEEN 4700 AND 4716 THEN 'SO'

  -- ── BE (Bern) ─────────────────────────────────────────────
  WHEN plz::int BETWEEN 2500 AND 2539 THEN 'BE'
  WHEN plz::int BETWEEN 2555 AND 2564 THEN 'BE'
  WHEN plz::int BETWEEN 2600 AND 2615 THEN 'BE'
  WHEN plz::int BETWEEN 3000 AND 3174 THEN 'BE'
  WHEN plz::int BETWEEN 3216 AND 3249 THEN 'BE'
  WHEN plz::int BETWEEN 3274 AND 3429 THEN 'BE'
  WHEN plz::int BETWEEN 3432 AND 3508 THEN 'BE'
  WHEN plz::int BETWEEN 3510 AND 3774 THEN 'BE'
  WHEN plz::int BETWEEN 3800 AND 3899 THEN 'BE'

  -- ── BS (Basel-Stadt) ──────────────────────────────────────
  WHEN plz::int BETWEEN 4001 AND 4059 THEN 'BS'

  -- ── BL (Basel-Landschaft) ─────────────────────────────────
  WHEN plz::int BETWEEN 4100 AND 4149 THEN 'BL'
  WHEN plz::int BETWEEN 4202 AND 4247 THEN 'BL'
  WHEN plz::int BETWEEN 4402 AND 4468 THEN 'BL'

  -- ── AG (Aargau) ───────────────────────────────────────────
  WHEN plz::int BETWEEN 4300 AND 4317 THEN 'AG'
  WHEN plz::int BETWEEN 5000 AND 5086 THEN 'AG'
  WHEN plz::int BETWEEN 5100 AND 5116 THEN 'AG'
  WHEN plz::int BETWEEN 5200 AND 5275 THEN 'AG'
  WHEN plz::int BETWEEN 5300 AND 5417 THEN 'AG'
  WHEN plz::int BETWEEN 5430 AND 5512 THEN 'AG'
  WHEN plz::int BETWEEN 5600 AND 5643 THEN 'AG'
  WHEN plz::int BETWEEN 5700 AND 5742 THEN 'AG'

  -- ── ZG (Zug) ──────────────────────────────────────────────
  WHEN plz::int BETWEEN 6300 AND 6345 THEN 'ZG'

  -- ── OW (Obwalden) ─────────────────────────────────────────
  WHEN plz::int BETWEEN 6060 AND 6078 THEN 'OW'

  -- ── NW (Nidwalden) ────────────────────────────────────────
  WHEN plz::int BETWEEN 6370 AND 6390 THEN 'NW'

  -- ── UR (Uri) ──────────────────────────────────────────────
  WHEN plz::int BETWEEN 6450 AND 6473 THEN 'UR'

  -- ── SZ (Schwyz) ───────────────────────────────────────────
  WHEN plz::int BETWEEN 6403 AND 6443 THEN 'SZ'
  WHEN plz::int BETWEEN 8832 AND 8840 THEN 'SZ'
  WHEN plz::int BETWEEN 8854 AND 8862 THEN 'SZ'
  WHEN plz::int BETWEEN 8880 AND 8896 THEN 'SZ'

  -- ── LU (Luzern) ───────────────────────────────────────────
  WHEN plz::int BETWEEN 6000 AND 6059 THEN 'LU'
  WHEN plz::int BETWEEN 6102 AND 6170 THEN 'LU'
  WHEN plz::int BETWEEN 6173 AND 6299 THEN 'LU'

  -- ── TI (Tessin / Ticino) ──────────────────────────────────
  WHEN plz::int BETWEEN 6500 AND 6999 THEN 'TI'

  -- ── GR (Graubünden) ───────────────────────────────────────
  WHEN plz::int BETWEEN 7000 AND 7742 THEN 'GR'

  -- ── SH (Schaffhausen) ─────────────────────────────────────
  WHEN plz::int BETWEEN 8200 AND 8260 THEN 'SH'

  -- ── GL (Glarus) ───────────────────────────────────────────
  WHEN plz::int BETWEEN 8750 AND 8784 THEN 'GL'

  -- ── TG (Thurgau) ──────────────────────────────────────────
  WHEN plz::int BETWEEN 8261 AND 8299 THEN 'TG'
  WHEN plz::int BETWEEN 8500 AND 8598 THEN 'TG'
  WHEN plz::int BETWEEN 9310 AND 9327 THEN 'TG'

  -- ── AI (Appenzell Innerrhoden) ────────────────────────────
  WHEN plz::int BETWEEN 9050 AND 9069 THEN 'AI'

  -- ── AR (Appenzell Ausserrhoden) ───────────────────────────
  WHEN plz::int BETWEEN 9030 AND 9049 THEN 'AR'
  WHEN plz::int BETWEEN 9070 AND 9112 THEN 'AR'

  -- ── SG (St. Gallen) ───────────────────────────────────────
  WHEN plz::int BETWEEN 7310 AND 7320 THEN 'SG'
  WHEN plz::int BETWEEN 9000 AND 9029 THEN 'SG'
  WHEN plz::int BETWEEN 9200 AND 9211 THEN 'SG'
  WHEN plz::int BETWEEN 9220 AND 9249 THEN 'SG'
  WHEN plz::int BETWEEN 9300 AND 9309 THEN 'SG'
  WHEN plz::int BETWEEN 9400 AND 9499 THEN 'SG'
  WHEN plz::int BETWEEN 9500 AND 9548 THEN 'SG'

  -- ── ZH (Zürich) ───────────────────────────────────────────
  WHEN plz::int BETWEEN 8000 AND 8199 THEN 'ZH'
  WHEN plz::int BETWEEN 8302 AND 8499 THEN 'ZH'
  WHEN plz::int BETWEEN 8600 AND 8638 THEN 'ZH'
  WHEN plz::int BETWEEN 8700 AND 8718 THEN 'ZH'
  WHEN plz::int BETWEEN 8800 AND 8831 THEN 'ZH'
  WHEN plz::int BETWEEN 8841 AND 8853 THEN 'ZH'
  WHEN plz::int BETWEEN 8900 AND 8966 THEN 'ZH'

  ELSE kanton  -- kein Match → unveränderter Wert
END
WHERE
  (kanton IS NULL OR kanton = '')   -- nur leere Felder befüllen
  AND plz IS NOT NULL
  AND plz != ''
  AND plz ~ '^\d{4}$';             -- nur valide 4-stellige PLZ

-- ── Kontrolle: Wie viele wurden aktualisiert? ─────────────────
-- SELECT kanton, COUNT(*) FROM customers
-- WHERE kanton IS NOT NULL GROUP BY kanton ORDER BY kanton;
