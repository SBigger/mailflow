// scope.ts
import type { ToolRegistry } from "./tool.ts";

export class ToolError extends Error {}
export class ConfigError extends ToolError {}

export interface ToolContext {
  customerId: string | null;
  customerName: string | null;
  mandantId: string | null;
  mandantName: string | null;
  allowWrites: boolean;
  token: string | null;
  userId: string | null;
  /**
   * Registry der Tools DIESES Requests. Bewusst pro Request, nicht global:
   * Deno haelt eine Isolate ueber mehrere gleichzeitige Requests, eine globale
   * Registry wuerde sonst den Kontext (Kunde/Mandant/Token) fremder Requests
   * ueberschreiben.
   */
  registry: ToolRegistry;
}

/**
 * Liefert die explizit uebergebene ID oder faellt auf die ID aus dem Context
 * zurueck. So funktionieren die Tools sowohl mit vorausgewaehltem Kunden
 * (Dropdown im Frontend) als auch, wenn die KI den Kunden selbst per
 * customers_search ermittelt hat.
 */
export function resolveCustomerId(ctx: ToolContext, explicit?: string | null): string {
  if (explicit) return explicit;
  if (ctx.customerId) return ctx.customerId;
  throw new ConfigError(
    "Kein Kunde bestimmt. Entweder customer_id uebergeben oder den Kunden zuerst " +
    "mit customers_search suchen.",
  );
}

export function resolveMandantId(ctx: ToolContext, explicit?: string | null): string {
  if (explicit) return explicit;
  if (ctx.mandantId) return ctx.mandantId;
  throw new ConfigError(
    "Kein FiBu-Mandant bestimmt. Entweder mandant_id uebergeben oder den Mandanten " +
    "zuerst mit finance_list_mandanten suchen.",
  );
}

/** Erfordert CUSTOMER_ID aus dem uebergebenen Context */
export function requireCustomerId(ctx: ToolContext): string {
  return resolveCustomerId(ctx);
}

/** Erfordert MANDANT_ID aus dem uebergebenen Context */
export function requireMandantId(ctx: ToolContext): string {
  return resolveMandantId(ctx);
}

export function requireBearToken(ctx: ToolContext): string {
  if (!ctx.token) {
    throw new ConfigError("BearToken ist im aktuellen Kontext nicht konfiguriert.");
  }
  return ctx.token;
}

/** Prueft Schreibrechte aus dem uebergebenen Context */
export function requireWritesEnabled(ctx: ToolContext): void {
  if (!ctx.allowWrites) {
    throw new ToolError("Schreibzugriff ist deaktiviert (allowWrites=false).");
  }
}
