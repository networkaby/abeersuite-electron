import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { EmailTemplate } from "@/generated/prisma/client";
import { isCustomKind, newCustomKind } from "@/shared/lib/whatsapp/billTemplates";
import {
    CUSTOM_EMAIL_DEFAULT,
    EMAIL_TEMPLATE_DEFAULTS,
    EMAIL_TEMPLATE_KINDS,
    checkEmailDraft,
    emailAutoSendDefault,
    isSecurityKind,
    type EmailAnyKind,
    type EmailTemplateDraft,
} from "./emailTemplates";

/**
 * EmailTemplate rows: read and edit. The sender reads one on every posted bill,
 * so each kind is cached in memory for a minute (dropped on any save here) —
 * the same shape as whatsapp/waTemplateStore.ts.
 */

/** Whether staff can send a kind by hand now: "ready", or why not. */
export type EmailSendState = "ready" | "off" | "not-configured";

export type EmailTemplateView = {
    kind: EmailAnyKind;
    /** Staff's name for a custom template; null on a built-in one. */
    name: string | null;
    enabled: boolean;
    autoSend: boolean;
    draft: EmailTemplateDraft;
};

function toView(kind: EmailAnyKind, r: EmailTemplate | null | undefined): EmailTemplateView {
    // A sign-in / reset code always goes — whatever the row says.
    const always = isSecurityKind(kind);
    if (!r) {
        const draft = isCustomKind(kind) ? CUSTOM_EMAIL_DEFAULT : EMAIL_TEMPLATE_DEFAULTS[kind];
        return { kind, name: null, enabled: always, autoSend: emailAutoSendDefault(kind), draft };
    }
    return { kind, name: r.name, enabled: always || r.enabled, autoSend: r.autoSend, draft: { subject: r.subject, body: r.body } };
}

export async function listEmailTemplates(): Promise<EmailTemplateView[]> {
    const rows = await prisma.emailTemplate.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    const custom = rows.filter((r) => isCustomKind(r.kind)).sort((a, b) => a.kind.localeCompare(b.kind));
    return [...EMAIL_TEMPLATE_KINDS.map((k) => toView(k, byKind.get(k))), ...custom.map((r) => toView(r.kind as EmailAnyKind, r))];
}

const TTL_MS = 60_000;
const cache = new Map<EmailAnyKind, { at: number; value: EmailTemplateView }>();

/** The saved template for a kind, cached a minute. */
export async function getEmailTemplate(kind: EmailAnyKind): Promise<EmailTemplateView> {
    const hit = cache.get(kind);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = toView(kind, await prisma.emailTemplate.findUnique({ where: { kind } }));
    cache.set(kind, { at: Date.now(), value });
    return value;
}

export class EmailTemplateError extends Error {}

export async function saveEmailTemplate(kind: EmailAnyKind, input: { enabled: boolean; autoSend: boolean; draft: EmailTemplateDraft }): Promise<EmailTemplateView> {
    if (isCustomKind(kind) && !(await prisma.emailTemplate.findUnique({ where: { kind }, select: { kind: true } }))) {
        throw new EmailTemplateError("This template has been deleted.");
    }
    const errs = checkEmailDraft(input.draft, kind);
    if (errs.length) throw new EmailTemplateError(errs.join(" "));
    const data = { enabled: isSecurityKind(kind) || input.enabled, autoSend: input.autoSend, subject: input.draft.subject, body: input.draft.body };
    const row = await prisma.emailTemplate.upsert({ where: { kind }, create: { kind, ...data }, update: data });
    cache.delete(kind);
    return toView(kind, row);
}

// ── Custom templates ────────────────────────────────────────────────────────

export async function createCustomEmailTemplate(name: string): Promise<EmailTemplateView> {
    const kind = newCustomKind();
    const d = CUSTOM_EMAIL_DEFAULT;
    const row = await prisma.emailTemplate.create({ data: { kind, name: name.trim(), enabled: false, autoSend: false, subject: d.subject, body: d.body } });
    return toView(kind, row);
}

export async function renameCustomEmailTemplate(kind: EmailAnyKind, name: string): Promise<EmailTemplateView> {
    if (!isCustomKind(kind)) throw new EmailTemplateError("A built-in template cannot be renamed.");
    const row = await prisma.emailTemplate.update({ where: { kind }, data: { name: name.trim() } });
    cache.delete(kind);
    return toView(kind, row);
}

export async function deleteCustomEmailTemplate(kind: EmailAnyKind): Promise<void> {
    if (!isCustomKind(kind)) throw new EmailTemplateError("A built-in template cannot be deleted.");
    await prisma.emailTemplate.deleteMany({ where: { kind } });
    cache.delete(kind);
}
