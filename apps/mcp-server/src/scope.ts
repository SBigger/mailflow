import { config } from "./config.js";

/**
 * Mandanten-Scoping (App-Layer).
 *
 * Das Datenmodell trennt den Mandanten-Begriff:
 *   • customers.id      → Aufgaben, Dokumente, Aktienbuch  (CUSTOMER_ID)
 *   • fibu_mandanten.id → Finanzbuchhaltung (fibu_*)        (MANDANT_ID)
 *
 * Beide IDs zeigen auf denselben realen Kunden, sind aber im Schema nicht per
 * Foreign Key verbunden. Darum werden sie getrennt konfiguriert und hier
 * getrennt erzwungen.
 */

/** Wird vom Tool-Wrapper in eine saubere isError-Antwort uebersetzt. */
export class ToolError extends Error {}

export class ConfigError extends ToolError {}

/** customers.id fuer Tasks/Dokumente/Aktienbuch. Wirft, wenn nicht gesetzt. */
export function requireCustomerId(): string {
  if (!config.customerId) {
    throw new ConfigError(
      "CUSTOMER_ID ist nicht konfiguriert. Dieses Tool greift auf kundengebundene " +
        "Daten zu (Aufgaben/Dokumente/Aktienbuch) und benoetigt CUSTOMER_ID in der .env.",
    );
  }
  return config.customerId;
}

/** fibu_mandanten.id fuer die Finanzbuchhaltung. Wirft, wenn nicht gesetzt. */
export function requireMandantId(): string {
  if (!config.mandantId) {
    throw new ConfigError(
      "MANDANT_ID ist nicht konfiguriert. Das Finanz-Modul greift auf fibu_*-Tabellen " +
        "zu und benoetigt MANDANT_ID (fibu_mandanten.id) in der .env.",
    );
  }
  return config.mandantId;
}

/** Schreib-Tools rufen das zuerst auf; respektiert MCP_ALLOW_WRITES. */
export function requireWritesEnabled(): void {
  if (!config.allowWrites) {
    throw new ToolError(
      "Schreibzugriff ist deaktiviert (MCP_ALLOW_WRITES=false). " +
        "Dieses Tool veraendert Daten und ist im Lese-Modus gesperrt.",
    );
  }
}
