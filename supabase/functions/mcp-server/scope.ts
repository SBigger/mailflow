// scope.ts
export class ToolError extends Error {}
export class ConfigError extends ToolError {}

export interface ToolContext {
  customerId: string | null;
  mandantId: string | null;
  allowWrites: boolean;
}

/** Erfordert CUSTOMER_ID aus dem übergebenen Context */
export function requireCustomerId(ctx: ToolContext): string {
  if (!ctx.customerId) {
    throw new ConfigError("CUSTOMER_ID ist im aktuellen Kontext nicht konfiguriert.");
  }
  return ctx.customerId;
}

/** Erfordert MANDANT_ID aus dem übergebenen Context */
export function requireMandantId(ctx: ToolContext): string {
  if (!ctx.mandantId) {
    throw new ConfigError("MANDANT_ID ist im aktuellen Kontext nicht konfiguriert.");
  }
  return ctx.mandantId;
}

/** Prüft Schreibrechte aus dem übergebenen Context */
export function requireWritesEnabled(ctx: ToolContext): void {
  if (!ctx.allowWrites) {
    throw new ToolError("Schreibzugriff ist deaktiviert (allowWrites=false).");
  }
}