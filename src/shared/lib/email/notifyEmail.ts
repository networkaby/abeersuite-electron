import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { fillBody, type WaFieldValues } from "@/shared/lib/whatsapp/billTemplates";
import { loadVoucherMessage, type EmailRow, type NotifyResult } from "@/shared/lib/whatsapp/notifyBill";
import { emailBodyToHtml, isEmailKind, type EmailTemplateDraft } from "./emailTemplates";
import { getEmailTemplate } from "./emailTemplateStore";
import { isEmailConfigured, sendEmail } from "./sendEmail";

/**
 * Email a posted customer document — the email twin of notifyBill's WhatsApp.
 *
 * Automatic only (notifyBill on a save): goes when the kind is switched on AND
 * its Auto send is on AND the customer has a verified email. No manual send
 * yet — owner's call 2026-10-26. Same skip rules as WhatsApp
 * (loadVoucherMessage: walk-in, supplier, …).
 *
 * One EmailNotification row per (kind, document), claimed before sending, so a
 * retried save never emails twice. A FAILED row can be claimed again — the
 * next save of that document retries instead of reading "already sent".
 * Never throws.
 */
export async function notifyEmail(kind: string, uvId: number): Promise<NotifyResult> {
    if (!isEmailKind(kind)) return { status: "skipped", reason: "not a customer document" };
    try {
        if (IS_COUNTER_PC) return { status: "skipped", reason: "counter" };
        const tpl = await getEmailTemplate(kind);
        if (!tpl.enabled) return { status: "skipped", reason: "template off" };
        if (!tpl.autoSend) return { status: "skipped", reason: "auto off" };
        if (!isEmailConfigured()) return { status: "skipped", reason: "email not configured" };

        const m = await loadVoucherMessage(kind, uvId);
        if ("status" in m) return m;
        const to = pickEmail(m.emails);
        if (!to) return { status: "skipped", reason: "no email" };

        if (!(await claim(kind, uvId, to))) return { status: "already" };
        const out = await sendFilled(to, tpl.draft, m.values);
        await prisma.emailNotification.update({
            where: { kind_refId: { kind, refId: uvId } },
            data: { status: out.error ? "failed" : "sent", error: out.error ?? null },
        });
        return out.error ? { status: "skipped", reason: "send failed" } : { status: "sent" };
    } catch (e) {
        console.error(`[notify-email] ${kind} ${uvId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

/** Fill a template and send it. Used by the real send and the settings test. */
export async function sendFilled(to: string, draft: EmailTemplateDraft, values: Partial<WaFieldValues>): Promise<{ error?: string }> {
    const text = fillBody(draft.body, values);
    try {
        await sendEmail({ to, subject: fillBody(draft.subject, values), text, html: emailBodyToHtml(text) });
        return {};
    } catch (e) {
        return { error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
}

/** Take the (kind, document) row: a new one, or a failed one back to pending.
 *  Both are single atomic writes, so two saves at once still send only once. */
async function claim(kind: string, refId: number, email: string): Promise<boolean> {
    try {
        await prisma.emailNotification.create({ data: { kind, refId, email, status: "pending" } });
        return true;
    } catch {
        const r = await prisma.emailNotification.updateMany({
            where: { kind, refId, status: "failed" },
            data: { email, status: "pending", error: null },
        });
        return r.count === 1;
    }
}

/** Primary verified email first, then any verified — never one the customer typed unproved. */
function pickEmail(emails: EmailRow[]): string | null {
    const ok = emails.filter((e) => e.verifiedAt && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email));
    ok.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    return ok[0]?.email ?? null;
}
