import { z } from "npm:zod@3.23.8";
import { registerTool, ok } from "../tool.ts";
import {requireBearToken, requireWritesEnabled, type ToolContext, ToolError} from "../scope.ts";

/**
 * Modul: E-Mail-Versand via bestehende Supabase Edge Function.
 *
 * Dieses Tool dupliziert KEINE Graph-/Token-Logik, sondern ruft die bereits
 * deployte Edge Function (z.B. "send-mail") auf. Token-Refresh, Outlook-Versand
 * und Protokollierung bleiben dort zentral.
 *
 * Benoetigte Env-Variablen:
 *   SUPABASE_URL            -> Basis-URL des Projekts
 *   EDGE_SEND_MAIL_PATH     -> optional, default "send-mail"
 *
 * Auth: Die Edge Function erwartet ein User-JWT im Authorization-Header,
 * um das richtige Outlook-Profil (profiles) zu ermitteln. Dieses JWT muss
 * im ToolContext verfuegbar sein (ctx.userJwt o.ae.).
 */

function edgeFunctionUrl(): string {
    const base = Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL");
    if (!base) throw new ToolError("Weder SUPABASE_PUBLIC_URL noch SUPABASE_URL ist konfiguriert.");
    const path = "replyOutlookMail";
    return `${base.replace(/\/$/, "")}/functions/v1/${path}`;
}

export function registerMailTools(context: ToolContext): void {
    registerTool({
        name: "mail_send",
        title: "E-Mail versenden (via Edge Function)",
        description:
            "Versendet eine E-Mail ueber die bestehende Supabase Edge Function (Outlook / " +
            "Microsoft Graph). Token-Refresh und Versand laufen zentral in der Edge Function.",
        input: {
            to_email: z
                .union([z.string().email(), z.array(z.string().email()).min(1)])
                .describe("Empfaenger (einzeln oder Liste)"),
            subject: z.string().min(1),
            reply_text: z.string().min(1).describe("Inhalt (HTML oder Text)"),
            content_type: z.enum(["HTML", "Text"]).default("HTML"),
        },
        handler: async (args, ctx) => {
            requireBearToken(ctx);
            const res = await fetch(edgeFunctionUrl(), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${ctx.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    to_email: args.to_email,
                    subject: args.subject,
                    reply_text: args.reply_text,
                    content_type: args.content_type,
                }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                console.error(`[mail_send] Edge error ${res.status}:`, data);
                throw new ToolError(
                    `E-Mail-Versand fehlgeschlagen (${res.status}): ${data?.error ?? "unbekannter Fehler"}`,
                );
            }

            return ok({
                sent: true,
                to: args.to_email,
                subject: args.subject,
                edge_response: data,
            });
        },
    }, context);
}