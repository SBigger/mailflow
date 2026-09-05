#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerTaskTools } from "./modules/tasks.js";
import { registerDocumentTools } from "./modules/documents.js";
import { registerCustomerTools } from "./modules/customers.js";
import { registerFinanceTools } from "./modules/finance.js";
import { registerShareTools } from "./modules/shares.js";
import { registerSteuernTools } from "./modules/steuern.js";

/**
 * artis MCP-Server – Einstiegspunkt.
 *
 * Lokaler stdio-Transport (keine Netzwerk-Exposition). Registriert die Tool-Sets
 * der Module Aufgaben-, Dokumenten-, Kunden-, Finanz- und Aktienbuch-Verwaltung.
 */
async function main(): Promise<void> {
  const server = new McpServer({
    name: "artis-mcp-server",
    version: "0.1.0",
  });

  registerTaskTools(server);
  registerDocumentTools(server);
  registerCustomerTools(server);
  registerFinanceTools(server);
  registerShareTools(server);
  registerSteuernTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("server_started", {
    transport: "stdio",
    writes_enabled: config.allowWrites,
    customer_scope: config.customerId ? "set" : "unset",
    mandant_scope: config.mandantId ? "set" : "unset",
  });
}

main().catch((err) => {
  logger.error("server_fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
