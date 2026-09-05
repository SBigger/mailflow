/**
 * eCH-0276 "E-Bilanz und E-Tax JP" (Version 1.0.0) – XML-Erzeugung aus den
 * Smartis-Abschlusskonten.
 *
 * Quelle: https://www.ech.ch/de/ech/ech-0276/1.0.0 (XSD eCH-0276-1-0.xsd,
 * Beispiel_XML_eBalanceSheetETaxLegalEntity.xml). Der Standard ist das
 * Austauschformat, das ZHcorporateTax (ab Steuerperiode 2025) und die ab 2026
 * folgenden kantonalen Deklarationsloesungen fuer den Import der Jahresrechnung
 * verwenden. Betraege sind xs:long, also ganze Franken.
 *
 * Es werden nur die Gruppen-Totale gefuellt, die sich aus den Smartis-Positionen
 * (KONTENRAHMEN_POSITIONEN in Abschlussdokumentation.jsx) eindeutig ableiten
 * lassen. Feinere Zuordnungen (z.B. Produktions- vs. Dienstleistungserloese)
 * laufen ueber die Kontonummer nach KMU-Kontenrahmen.
 */
import type { Kennzahlen, Konto } from "./lib.js";
const kontonummerAlsZahl = (k: Konto): number => parseInt(String(k.kontonummer).replace(/\D/g, "").slice(0, 4), 10) || 0;
const alsZahl = (v: unknown): number => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };

export interface EbilanzHeader {
  organisationName: string;
  registerNumber: number | null;        // xs:long, Pflicht
  uid: string | null;                   // CHE123456789 (ohne Punkte/Bindestrich)
  assessmentMunicipality: string;       // Pflicht
  assessmentMunicipalityId: number | null;
  street: string;                       // Pflicht
  houseNumber: string;                  // Pflicht
  zip: string;                          // Pflicht
  town: string;                         // Pflicht
  municipalityId: number | null;        // Pflicht (BFS-Nr.)
  canton: string;                       // Pflicht (ZH, SG, ...)
  taxPeriodFrom: string;
  taxPeriodTo: string;
  chairman?: string | null;
  management?: string | null;
  accounting?: string | null;
  iban?: string | null;
}

export interface EbilanzErgebnis {
  xml: string;
  warnungen: string[];
  pflichtfelder_fehlen: string[];
  summen: Record<string, number>;
}

const NS = "http://www.ech.ch/xmlns/eCH-0276/1";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const L = (n: number) => String(Math.round(n)); // xs:long

type Node = { name: string; children?: Node[]; text?: string | null };
const el = (name: string, text: number | string | null | undefined): Node | null =>
  text == null || text === "" || (typeof text === "number" && !Number.isFinite(text)) ? null : { name, text: typeof text === "number" ? L(text) : String(text) };
const grp = (name: string, children: (Node | null)[]): Node | null => {
  const c = children.filter((x): x is Node => !!x);
  return c.length ? { name, children: c } : null;
};
function render(n: Node, depth: number): string {
  const pad = "  ".repeat(depth);
  if (n.children) return `${pad}<eCH-0276:${n.name}>\n${n.children.map((c) => render(c, depth + 1)).join("")}${pad}</eCH-0276:${n.name}>\n`;
  return `${pad}<eCH-0276:${n.name}>${esc(n.text ?? "")}</eCH-0276:${n.name}>\n`;
}

/** Aktiven/Passiven/ER in Kontonatur (positiv) je Zielelement summieren. */
function summiere(konten: Konto[], vz: Kennzahlen["vorzeichen"], umgliederungen: string[]): Record<string, number> {
  const s: Record<string, number> = {};
  const add = (key: string, v: number) => { s[key] = (s[key] ?? 0) + v; };
  for (const k of konten) {
    const nr = kontonummerAlsZahl(k);
    let v = alsZahl(k.saldo_ist);
    if (nr >= 2000 && nr < 3000 && vz.passiven_negativ) v = -v;
    if (nr >= 3000 && nr < 9000 && vz.ertrag_negativ) v = -v; // Ertrag +, Aufwand −
    const p = k.position_id ?? "";
    const bankartig = /bank|post|konto|kontokorrent|ubs|zkb|raiffeisen|credit/i.test(k.kontoname ?? "") || p === "FK_KURZ_BANK" || p === "UV_FLUESSIG";
    if (v === 0) continue;
    // Bilanzkonten mit "falschem" Saldo (Bank im Passiv-Bereich mit Guthaben, Aktivkonto mit Kreditsaldo)
    // gehoeren in der E-Bilanz auf die andere Seite – der Standard kennt keine negativen Bilanzpositionen.
    if (nr >= 2000 && nr < 2800 && v < 0) {
      add(bankartig ? "cashAndCashEquivalents" : "otherShortTermReceivablesPayableByThirdParties", -v);
      umgliederungen.push(`${k.kontonummer} ${k.kontoname}: Sollsaldo ${(-v).toFixed(2)} auf die Aktivseite umgegliedert`);
      continue;
    }
    if (nr >= 1000 && nr < 2000 && v < 0) {
      const wb = /delkredere|wertberichtigung|\bwb\b|kumuliert|abschreibung/i.test(k.kontoname ?? "");
      if (wb && nr >= 1100 && nr < 1200) { add("valueAdjustmentTradeAndOtherCurrentReceivables", -v); continue; }
      if (wb && nr >= 1200 && nr < 1300) { add("valueAdjustmentInventories", -v); continue; }
      if (wb) { /* kumulierte Abschreibungen: mit dem Anlagewert verrechnen (faellt unten in die normale Zuordnung, negativ) */ }
      else {
        add(bankartig ? "currentInterestBearingLiabilitiesThirdParties" : "otherCurrentLieabilitiesIntrestFreeThirdParties", -v);
        umgliederungen.push(`${k.kontonummer} ${k.kontoname}: Habensaldo ${(-v).toFixed(2)} auf die Passivseite umgegliedert`);
        continue;
      }
    }
    if (nr >= 1000 && nr < 2000) {
      const key =
        p === "UV_FLUESSIG" ? "cashAndCashEquivalents" :
        p === "UV_WERTSCHRIFTEN" ? "currentAssetsWithStockMarketPrice" :
        p === "UV_FORD_LL" ? "tradeReceivablesPayableByThirdParties" :
        p === "UV_FORD_LL_NAHE" ? "tradeReceivablesPayableByParticipantsAndManagingOfficers" :
        p === "UV_FORD_SONST" ? "otherShortTermReceivablesPayableByThirdParties" :
        p === "UV_FORD_SONST_NAHE" ? "otherShortTermReceivablesPayableByParticipationsAndManagingOfficers" :
        p === "UV_VORRAETE" ? "inventories" :
        p === "UV_ABGRENZUNG" ? "accruedIncomeAndPrepaidExpenses" :
        p === "AV_FINANZ" ? "otherFinancialAssets" :
        p === "AV_FINANZ_NAHE" ? "longTermShareholdersReceivables" :
        p === "AV_MOBIL" ? "otherMobileTangibleAssets" :
        p === "AV_IMMOBIL" ? "fixedTangibleAssets" :
        p === "AV_IMMATERIELL" ? "otherIntangibleAssets" :
        nr < 1100 ? "cashAndCashEquivalents" : nr < 1200 ? "otherShortTermReceivablesPayableByThirdParties" :
        nr < 1300 ? "inventories" : nr < 1400 ? "accruedIncomeAndPrepaidExpenses" : nr < 1500 ? "otherFinancialAssets" :
        nr < 1600 ? "otherMobileTangibleAssets" : nr < 1700 ? "fixedTangibleAssets" : "otherIntangibleAssets";
      add(key, v);
    } else if (nr >= 2000 && nr < 2800) {
      const key =
        p === "FK_KURZ_LL" ? "currentPayablesThirdParties" :
        p === "FK_KURZ_LL_NAHE" ? "currentPayablesShareholders" :
        p === "FK_KURZ_BANK" ? "currentInterestBearingLiabilitiesThirdParties" :
        p === "FK_KURZ_VERZ_NAHE" ? "currentInterestBearingLiabilitiesShareholders" :
        p === "FK_KURZ_SONST" ? "otherCurrentLieabilitiesIntrestFreeThirdParties" :
        p === "FK_KURZ_SONST_NAHE" ? "otherCurrentLieabilitiesIntrestFreeShareholders" :
        p === "FK_KURZ_ABGRENZUNG" ? "accruedExpenses" :
        p === "FK_LANG_BANK" ? "noncurrentInterestBearingLiabilitiesThirdParties" :
        p === "FK_LANG_VERZ_NAHE" ? "noncurrentInterestBearingLiabilitiesShareholders" :
        p === "FK_LANG_SONST" ? "otherNoncurrentLieabilitiesIntrestFreeThirdParties" :
        p === "FK_LANG_SONST_NAHE" ? "otherNoncurrentLieabilitiesIntrestFreeShareholders" :
        p === "FK_RUECKSTELLUNGEN" ? "otherProvisions" :
        nr < 2100 ? "currentPayablesThirdParties" : nr < 2300 ? "otherCurrentLieabilitiesIntrestFreeThirdParties" :
        nr < 2400 ? "accruedExpenses" : nr < 2600 ? "noncurrentInterestBearingLiabilitiesThirdParties" : "otherProvisions";
      add(key, v);
    } else if (nr >= 3000 && nr < 9000) {
      const key =
        nr < 3200 ? "productionRevenue" : nr < 3400 ? "tradeRevenue" : nr < 3600 ? "serviceRevenue" :
        nr < 3700 ? "otherOperatingRevenue" : nr < 3800 ? "ownWork" : nr < 3900 ? "revenueReduction" : nr < 4000 ? "lossesOnReceivablesChangeInValueAdjustments" :
        nr < 4200 ? "productionMaterialCosts" : nr < 4400 ? "totalExpensesGoodsForResale" : nr < 4500 ? "expensesForPurchasedServices" :
        nr < 4600 ? "powerExpensesGoodsAndServices" : nr < 5000 ? "otherDirectExpenses" :
        nr < 5700 ? "salaryExpenses" : nr < 5800 ? "socialSecurityExpenses" : nr < 5900 ? "otherEmployeeExpenses" : nr < 6000 ? "expensesThirdParties" :
        nr < 6100 ? "rentalExpense" : nr < 6200 ? "maintenanceRepairsReplacementOfMobileAssets" : nr < 6300 ? "vehicleTransportationExpenses" :
        nr < 6400 ? "insuranceContributionFeeApprovalExpenses" : nr < 6500 ? "energyAndDisposalExpenses" : nr < 6600 ? "administrativeAndItExpenses" :
        nr < 6700 ? "advertisingExpense" : nr < 6800 ? "miscellaneousOperatingExpenses" : nr < 6900 ? "totalDepreciationValueAdjustmentNoncurrentAssets" :
        nr < 6950 ? "interestExpenseFromLiabilities" : nr < 7000 ? "otherFinancialIncome" :
        nr < 7500 ? (v >= 0 ? "otherFinancialIncome" : "otherFinancialExpenses") :
        nr < 8000 ? (v >= 0 ? "incomeFromAncillaryOperationsAndOperatingProperties" : "expensesFromAncillaryOperationsAndOperatingProperties") :
        nr < 8100 ? "otherExternalIncome" : nr < 8500 ? "otherExternalExpenses" :
        nr < 8600 ? "externalExtraordinaryOneoffOrNonperiodicIncome" : nr < 8900 ? "externalExtraordinaryOneoffOrNonperiodicExpenses" : "directTaxes";
      // Erloesminderungen und Aufwand als Betrag in Kontonatur (positiv)
      const aufwand = /Expense|Costs|Reduction|losses|expenses|Taxes|Depreciation|ForResale|ForPurchased/i.test(key) && !/Income|Revenue/.test(key);
      add(key, aufwand ? -v : v);
    }
  }
  for (const k of Object.keys(s)) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

export function erzeugeEbilanzXml(konten: Konto[], k: Kennzahlen, h: EbilanzHeader): EbilanzErgebnis {
  const warnungen: string[] = [];
  const fehlen: string[] = [];
  if (h.registerNumber == null) fehlen.push("registerNumber (Register-/PID-Nr. des Kantons, ganze Zahl)");
  if (!h.assessmentMunicipality) fehlen.push("assessmentMunicipality (Veranlagungsgemeinde)");
  if (!h.street) fehlen.push("streetHeadOffice");
  if (!h.houseNumber) fehlen.push("houseNumberHeadOffice");
  if (!h.zip) fehlen.push("zipCodeHeadOffice");
  if (!h.town) fehlen.push("townHeadOffice");
  if (h.municipalityId == null) fehlen.push("headOfficeMunicipalityId (BFS-Gemeindenummer)");
  if (!h.canton) fehlen.push("headOfficeCanton");

  const umgliederungen: string[] = [];
  const s = summiere(konten, k.vorzeichen, umgliederungen);
  if (umgliederungen.length) warnungen.push("Umgliederungen: " + umgliederungen.join("; "));
  const g = (key: string) => s[key] ?? 0;
  const sumKeys = (...keys: string[]) => keys.reduce((a, key) => a + g(key), 0);

  const uv = sumKeys("cashAndCashEquivalents", "currentAssetsWithStockMarketPrice", "tradeReceivablesPayableByThirdParties",
    "tradeReceivablesPayableByParticipantsAndManagingOfficers", "otherShortTermReceivablesPayableByThirdParties",
    "otherShortTermReceivablesPayableByParticipationsAndManagingOfficers", "inventories", "accruedIncomeAndPrepaidExpenses")
    - sumKeys("valueAdjustmentTradeAndOtherCurrentReceivables", "valueAdjustmentInventories");
  const av = sumKeys("otherFinancialAssets", "longTermShareholdersReceivables", "otherMobileTangibleAssets", "fixedTangibleAssets", "otherIntangibleAssets");
  const fkKurz = sumKeys("currentPayablesThirdParties", "currentPayablesShareholders", "currentInterestBearingLiabilitiesThirdParties",
    "currentInterestBearingLiabilitiesShareholders", "otherCurrentLieabilitiesIntrestFreeThirdParties", "otherCurrentLieabilitiesIntrestFreeShareholders", "accruedExpenses");
  const fkLang = sumKeys("noncurrentInterestBearingLiabilitiesThirdParties", "noncurrentInterestBearingLiabilitiesShareholders",
    "otherNoncurrentLieabilitiesIntrestFreeThirdParties", "otherNoncurrentLieabilitiesIntrestFreeShareholders", "otherProvisions");

  const ek = k; // Eigenkapital VOR Gewinnverwendung (Bilanzstand), wie im Beispiel des Standards
  const totalEquity = ek.eigenkapital_total;
  const totalPassiven = fkKurz + fkLang + totalEquity;
  if (Math.abs(Math.round(uv + av) - Math.round(totalPassiven)) > 1)
    warnungen.push(`Aktiven (${Math.round(uv + av)}) und Passiven inkl. Eigenkapital (${Math.round(totalPassiven)}) weichen ab – Zuordnung der Konten pruefen.`);

  const g_ = k.gewinnverwendung;
  const optNeg = (key: string) => (g(key) !== 0 ? el(key, g(key)) : null);

  const root: Node = {
    name: "eBalanceSheetETaxLegalEntity",
    children: [
      grp("header", [grp("title", [
        el("sourceSystem", "Smartis by Artis Treuhand – MCP steuern"),
        el("organisationName", h.organisationName),
        el("registerNumber", h.registerNumber ?? 0),
        el("uid", h.uid),
        el("assessmentMunicipality", h.assessmentMunicipality),
        el("assessmentMunicipalityId", h.assessmentMunicipalityId),
        grp("headOffice", [
          el("streetHeadOffice", h.street), el("houseNumberHeadOffice", h.houseNumber || "0"),
          el("zipCodeHeadOffice", h.zip), el("townHeadOffice", h.town),
          el("headOfficeMunicipalityId", h.municipalityId ?? 0), el("headOfficeCanton", h.canton),
        ]),
        el("taxPeriodFrom", h.taxPeriodFrom), el("taxPeriodTo", h.taxPeriodTo),
        el("currencyShareEquity", "CHF"), el("currencyFinancialReporting", "CHF"),
        el("chairmanOfTheBoardOfDirectors", h.chairman), el("management", h.management), el("responsibleForAccounting", h.accounting),
        h.iban ? grp("bankDetailsForRefund", [el("iban", h.iban.replace(/\s+/g, "")), el("beneficiary", h.organisationName)]) : null,
      ])])!,
      grp("content", [
        grp("assets", [
          grp("currentAssets", [
            grp("cashAndCashEquivalentsAndCurrentAssetsWithStockMarketPrice", [optNeg("cashAndCashEquivalents"), optNeg("currentAssetsWithStockMarketPrice")]),
            grp("tradeAndOtherCurrentReceivables", [optNeg("tradeReceivablesPayableByThirdParties"), optNeg("tradeReceivablesPayableByParticipantsAndManagingOfficers"), optNeg("valueAdjustmentTradeAndOtherCurrentReceivables")]),
            grp("otherShortTermReceivables", [optNeg("otherShortTermReceivablesPayableByThirdParties"), optNeg("otherShortTermReceivablesPayableByParticipationsAndManagingOfficers")]),
            grp("inventoriesAndWorkInProgress", [optNeg("inventories"), optNeg("valueAdjustmentInventories")]),
            optNeg("accruedIncomeAndPrepaidExpenses"),
            el("totalCurrentAssets", uv),
          ]),
          grp("noncurrentAssets", [
            (g("otherFinancialAssets") !== 0 || g("longTermShareholdersReceivables") !== 0)
              ? grp("financialAssets", [el("otherFinancialAssets", g("otherFinancialAssets")), optNeg("longTermShareholdersReceivables")]) : null,
            grp("propertyPlantEquipment", [optNeg("otherMobileTangibleAssets"), optNeg("fixedTangibleAssets")]),
            grp("intangibleAssets", [optNeg("otherIntangibleAssets")]),
            el("totalNoncurrentAssets", av),
          ]),
          el("totalAssets", uv + av),
        ]),
        grp("equityAndLiabilities", [
          grp("currentLiabilities", [
            grp("tradeAndOtherCurrentPayables", [optNeg("currentPayablesThirdParties"), optNeg("currentPayablesShareholders")]),
            grp("currentInterestBearingLiabilities", [optNeg("currentInterestBearingLiabilitiesThirdParties"), optNeg("currentInterestBearingLiabilitiesShareholders")]),
            grp("otherCurrentLieabilitiesIntrestFree", [optNeg("otherCurrentLieabilitiesIntrestFreeThirdParties"), optNeg("otherCurrentLieabilitiesIntrestFreeShareholders")]),
            optNeg("accruedExpenses"),
            el("totalCurrentLiabilities", fkKurz),
          ]),
          grp("noncurrentLiabilities", [
            grp("noncurrentInterestBearingLiabilities", [optNeg("noncurrentInterestBearingLiabilitiesThirdParties"), optNeg("noncurrentInterestBearingLiabilitiesShareholders")]),
            grp("otherNoncurrentLieabilitiesIntrestFree", [optNeg("otherNoncurrentLieabilitiesIntrestFreeThirdParties"), optNeg("otherNoncurrentLieabilitiesIntrestFreeShareholders")]),
            grp("provisionsAndSimilarItemsStipulatedByLaw", [optNeg("otherProvisions")]),
            el("totalNoncurrentLiabilities", fkLang),
          ]),
          grp("equity", [
            el("shareCapitalShareholderCapitalAssociationCapitalFoundationCapital", ek.aktienkapital),
            (ek.gesetzl_kapitalreserve || ek.kapitaleinlagereserve)
              ? grp("statuatoryCapitalReserveLimitedCompanies", [el("statuatoryCapitalReserveLimitedCompaniesAmount", ek.gesetzl_kapitalreserve + ek.kapitaleinlagereserve), ek.kapitaleinlagereserve ? el("capitalDepositReserve", ek.kapitaleinlagereserve) : null]) : null,
            (ek.gesetzl_gewinnreserve || ek.uebrige_reserve || ek.versteuerte_stille_reserven)
              ? grp("statutoryProfitReserveLimitedCompanies", [el("statutoryProfitReserveLimitedCompaniesAmount", ek.gesetzl_gewinnreserve + ek.uebrige_reserve + ek.versteuerte_stille_reserven)]) : null,
            ek.freiwillige_reserve ? grp("voluntaryProfitReservesLimitedCompanies", [el("voluntaryProfitReservesLimitedCompaniesAmount", ek.freiwillige_reserve)]) : null,
            ek.eigene_kapitalanteile ? grp("ownCapitalShares", [el("ownCapitalSharesAsNegativeItem", ek.eigene_kapitalanteile)]) : null,
            grp("netProfitOrLoss", [el("profitOrLossBroughtForward", ek.gewinnvortrag), el("annualProfitOrAnnualLoss", ek.jahresergebnis)]),
            el("totalEquity", totalEquity),
          ]),
          el("totalEquityAndLiabilities", totalPassiven),
        ]),
        grp("incomeStatement", [
          grp("deliveriesAndServicesRevenue", [
            optNeg("productionRevenue"), optNeg("tradeRevenue"), optNeg("serviceRevenue"), optNeg("otherOperatingRevenue"), optNeg("ownWork"),
            optNeg("revenueReduction"), optNeg("lossesOnReceivablesChangeInValueAdjustments"),
            el("totalDeliveriesAndServicesRevenue", sumKeys("productionRevenue", "tradeRevenue", "serviceRevenue", "otherOperatingRevenue", "ownWork") - sumKeys("revenueReduction", "lossesOnReceivablesChangeInValueAdjustments")),
          ]),
          grp("expenses", [
            grp("expensesForMaterialsGoodsServices", [optNeg("productionMaterialCosts"), optNeg("totalExpensesGoodsForResale"), optNeg("expensesForPurchasedServices"), optNeg("powerExpensesGoodsAndServices"), optNeg("otherDirectExpenses"),
              el("totalExpensesForMaterialsGoodsServices", sumKeys("productionMaterialCosts", "totalExpensesGoodsForResale", "expensesForPurchasedServices", "powerExpensesGoodsAndServices", "otherDirectExpenses"))]),
            grp("employeeExpenses", [optNeg("salaryExpenses"), optNeg("socialSecurityExpenses"), optNeg("otherEmployeeExpenses"), optNeg("expensesThirdParties"),
              el("totalEmployeeExpenses", sumKeys("salaryExpenses", "socialSecurityExpenses", "otherEmployeeExpenses", "expensesThirdParties"))]),
            grp("otherOperatingExpenses", [optNeg("rentalExpense"), optNeg("maintenanceRepairsReplacementOfMobileAssets"), optNeg("vehicleTransportationExpenses"), optNeg("insuranceContributionFeeApprovalExpenses"),
              optNeg("energyAndDisposalExpenses"), optNeg("administrativeAndItExpenses"), optNeg("advertisingExpense"), optNeg("miscellaneousOperatingExpenses"),
              el("TotalOtherOperatingExpenses", sumKeys("rentalExpense", "maintenanceRepairsReplacementOfMobileAssets", "vehicleTransportationExpenses", "insuranceContributionFeeApprovalExpenses", "energyAndDisposalExpenses", "administrativeAndItExpenses", "advertisingExpense", "miscellaneousOperatingExpenses"))]),
          ]),
          g("totalDepreciationValueAdjustmentNoncurrentAssets") ? grp("depreciationValueAdjustmentNoncurrentAssets", [el("totalDepreciationValueAdjustmentNoncurrentAssets", g("totalDepreciationValueAdjustmentNoncurrentAssets"))]) : null,
          grp("financialExpensesAndFinancialIncome", [optNeg("interestExpenseFromLiabilities"), optNeg("otherFinancialExpenses"), optNeg("otherFinancialIncome"),
            el("totalFinancialExpensesAndFinancialIncome", g("otherFinancialIncome") - g("interestExpenseFromLiabilities") - g("otherFinancialExpenses"))]),
          grp("profitOtherOperatingAncillaryBusiness", [optNeg("incomeFromAncillaryOperationsAndOperatingProperties"), optNeg("expensesFromAncillaryOperationsAndOperatingProperties")]),
          grp("externalExpensesAndExternalIncome", [optNeg("otherExternalExpenses"), optNeg("otherExternalIncome")]),
          grp("externalExtraordinaryOneoffOrNonperiodicExpensesAndIncome", [optNeg("externalExtraordinaryOneoffOrNonperiodicExpenses"), optNeg("externalExtraordinaryOneoffOrNonperiodicIncome")]),
          optNeg("directTaxes"),
          el("annualProfitOrAnnualLoss", k.jahresergebnis),
        ]),
        grp("profitAppropriation", [
          el("profitOrLossCarriedForward", k.gewinnvortrag),
          el("totalProfitToBeDistributed", k.bilanzgewinn),
          g_.dividende ? el("distributionOfDividendsRoyalties", g_.dividende) : null,
          g_.zuweisung_gesetzl_gewinnreserve ? el("depositInStatutoryProfitReserves", g_.zuweisung_gesetzl_gewinnreserve) : null,
          g_.zuweisung_freiwillige_reserve ? el("depositInVoluntaryProfitReserves", g_.zuweisung_freiwillige_reserve) : null,
          ...g_.uebrige.map((u) => grp("otherProfitAppropriation", [el("description", u.bezeichnung), el("amount", u.betrag)])),
          g_.tantiemen ? grp("otherProfitAppropriation", [el("description", "Tantiemen"), el("amount", g_.tantiemen)]) : null,
          el("totalProfitAppropriation", g_.total),
          el("profitOrLossBroughtForward", g_.vortrag_neu),
        ]),
      ])!,
    ],
  };

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<eCH-0276:eBalanceSheetETaxLegalEntity xmlns:eCH-0276="${NS}" minorVersion="0">\n` +
    (root.children ?? []).map((c) => render(c, 1)).join("") +
    `</eCH-0276:eBalanceSheetETaxLegalEntity>\n`;

  if (fehlen.length) warnungen.push("Pflichtfelder fehlen (mit Platzhalter 0 gefuellt): " + fehlen.join(", "));
  return { xml, warnungen, pflichtfelder_fehlen: fehlen, summen: s };
}
