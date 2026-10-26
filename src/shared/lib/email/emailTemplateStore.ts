import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { EmailTemplate } from "@/generated/prisma/client";
import {
    EMAIL_TEMPLATE_DEFAULTS,
    EMAIL_TEMPLATE_KINDS,
    checkEmailDraft,
    emailAutoSendDefault,
    type EmailTemplateDraft,
    type EmailTemplateKind,
} from "./emailTemplates";

/**
 * EmailTemplate rows: read and edit. The sender reads one on every posted bill,
 * so each kind is cached in memory for a minute (dropped on any save here) —
 * the same shape as whatsapp/waTemplateStore.ts.
 */

/** Whether staff can send a kind by hand now: "ready", or why not. */
export type EmailSendState = "ready" | "off" | "not-configured";

export type EmailTemplateView = {
    kind: EmailTemplateKind;
    enabled: boolean;
    autoSend: boolean;
    draft: EmailTemplateDraft;
};

function toView(kind: EmailTemplateKind, r: EmailTemplate | null | undefined): EmailTemplateView {
    if (!r) return { kind, enabled: false, autoSend: emailAutoSendDefault(kind), draft: EMAIL_TEMPLATE_DEFAULTS[kind] };
    return { kind, enabled: r.enabled, autoSend: r.autoSend, draft: { subject: r.subject, body: r.body } };
}

export async function listEmailTemplates(): Promise<EmailTemplateView[]> {
    const rows = await prisma.emailTemplate.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return EMAIL_TEMPLATE_KINDS.map((k) => toView(k, byKind.get(k)));
}

const TTL_MS = 60_000;
const cache = new Map<EmailTemplateKind, { at: number; value: EmailTemplateView }>();

/** The saved template for a kind, cached a minute. */
export async function getEmailTemplate(kind: EmailTemplateKind): Promise<EmailTemplateView> {
    const hit = cache.get(kind);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = toView(kind, await prisma.emailTemplate.findUnique({ where: { kind } }));
    cache.set(kind, { at: Date.now(), value });
    return value;
}

export class EmailTemplateError extends Error {}

export async function saveEmailTemplate(kind: EmailTemplateKind, input: { enabled: boolean; autoSend: boolean; draft: EmailTemplateDraft }): Promise<EmailTemplateView> {
    const errs = checkEmailDraft(input.draft, kind);
    if (errs.length) throw new EmailTemplateError(errs.join(" "));
    const data = { enabled: input.enabled, autoSend: input.autoSend, subject: input.draft.subject, body: input.draft.body };
    const row = await prisma.emailTemplate.upsert({ where: { kind }, create: { kind, ...data }, update: data });
    cache.delete(kind);
    return toView(kind, row);
}
