import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { loadRepairMessage, loadTicketCustomer, loadVoucherMessage, ticketClaimKind, type EmailRow, type NotifyResult } from "@/shared/lib/whatsapp/notifyBill";
import {
    EMAIL_TEMPLATE_KINDS,
    PORTAL_URL,
    SHOP_APP_URL,
    emailBodyToHtml,
    fillEmail,
    hasAutoSendSwitch,
    isDocEmailKind,
    isMarketingKind,
    isSecurityKind,
    unsubscribeLine,
    type EmailFieldValues,
    type EmailTemplateDraft,
    type EmailAnyKind,
    type EmailTemplateKind,
} from "./emailTemplates";
import { getEmailTemplate, type EmailSendState } from "./emailTemplateStore";
import { isEmailConfigured, sendEmail } from "./sendEmail";
import { isOptedOut, unsubscribeUrl } from "./unsubscribe";

/**
 * Every customer email goes through `sendTemplatedEmail` — documents (here),
 * repairs, due reminders, welcome (here) and the hourly cart / payment
 * reminders (emailReminders.ts).
 *
 * It goes only when: the kind is switched on (Settings → Email Templates); for
 * a kind with an Auto send switch, that is on too — unless staff pressed "Send
 * email"; email is set up on this server; the customer has a VERIFIED email;
 * and, for a marketing kind, they have not unsubscribed.
 *
 * One EmailNotification row per (kind, refId), claimed before sending, so a
 * retry or a second click never emails twice. A FAILED row can be claimed
 * again, so a failure is retried instead of reading "already sent".
 * Never throws.
 */
export async function sendTemplatedEmail(d: {
    kind: EmailAnyKind;
    refId: number;
    /** EmailNotification key when it must differ from `kind` (see ticketClaimKind). */
    claimKind?: string;
    emails: EmailRow[];
    /** Loaded only once the cheap checks pass. */
    values: EmailFieldValues | (() => Promise<EmailFieldValues | NotifyResult>);
    manual?: boolean;
}): Promise<NotifyResult> {
    const { kind, refId } = d;
    try {
        if (IS_COUNTER_PC) return { status: "skipped", reason: "counter" };
        const tpl = await getEmailTemplate(kind);
        if (!tpl.enabled) return { status: "skipped", reason: "template off" };
        if (hasAutoSendSwitch(kind) && !d.manual && !tpl.autoSend) return { status: "skipped", reason: "auto off" };
        if (!isEmailConfigured()) return { status: "skipped", reason: "email not configured" };
        const to = pickEmail(d.emails);
        if (!to) return { status: "skipped", reason: "no email" };
        const marketing = isMarketingKind(kind);
        if (marketing && (await isOptedOut(to))) return { status: "skipped", reason: "unsubscribed" };

        const values = typeof d.values === "function" ? await d.values() : d.values;
        if ("status" in values) return values as NotifyResult;

        const key = d.claimKind ?? kind;
        if (!(await claim(key, refId, to))) return { status: "already" };
        const out = await sendFilled(to, tpl.draft, values as EmailFieldValues, marketing ? unsubscribeUrl(to) : undefined);
        await prisma.emailNotification.update({
            where: { kind_refId: { kind: key, refId } },
            data: { status: out.error ? "failed" : "sent", error: out.error ?? null },
        });
        return out.error ? { status: "skipped", reason: "send failed" } : { status: "sent" };
    } catch (e) {
        console.error(`[notify-email] ${kind} ${refId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

/** A posted customer document (notifyBill on a save, or staff's "Send email"). */
export async function notifyEmail(kind: string, uvId: number, mode: { manual?: boolean } = {}): Promise<NotifyResult> {
    if (!isDocEmailKind(kind)) return { status: "skipped", reason: "not a customer document" };
    // The party's emails come with the voucher, so load it first; the template
    // checks inside sendTemplatedEmail still run before anything is claimed.
    try {
        const tpl = await getEmailTemplate(kind);
        if (!tpl.enabled) return { status: "skipped", reason: "template off" };
        const m = await loadVoucherMessage(kind, uvId);
        if ("status" in m) return m;
        return sendTemplatedEmail({ kind, refId: uvId, emails: m.emails, values: m.values, manual: mode.manual });
    } catch (e) {
        console.error(`[notify-email] ${kind} ${uvId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

/** A repair stage with "Tell customer: repair received / ready" completed. */
export async function notifyRepairEmail(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number): Promise<NotifyResult> {
    try {
        const tpl = await getEmailTemplate(kind);
        if (!tpl.enabled || !tpl.autoSend) return { status: "skipped", reason: "template off" };
        const m = await loadRepairMessage(kind, ticketId);
        if ("status" in m) return m;
        return sendTemplatedEmail({ kind, refId: ticketId, emails: m.emails, values: m.values });
    } catch (e) {
        console.error(`[notify-email] ${kind} ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

/** A new portal account — once per person. */
export async function notifyWelcomeEmail(personId: number): Promise<NotifyResult> {
    const p = await prisma.person.findUnique({
        where: { id: personId },
        select: { name: true, emails: { select: { email: true, isPrimary: true, verifiedAt: true } } },
    });
    if (!p) return { status: "skipped", reason: "no person" };
    return sendTemplatedEmail({
        kind: "WELCOME",
        refId: personId,
        emails: p.emails,
        values: { customer: p.name, shop: getOrganisation().brandName, link: PORTAL_URL, app: SHOP_APP_URL },
    });
}

/** Fill a template and send it. Used by the real send and the settings test. */
export async function sendFilled(to: string, draft: EmailTemplateDraft, values: EmailFieldValues, unsubscribe?: string): Promise<{ error?: string }> {
    const text = fillEmail(draft.body, values) + (unsubscribe ? unsubscribeLine(unsubscribe) : "");
    try {
        await sendEmail({
            to,
            subject: fillEmail(draft.subject, values),
            text,
            html: emailBodyToHtml(text),
            // One-click unsubscribe in Gmail / Outlook — keeps marketing mail out of spam.
            ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
        });
        return {};
    } catch (e) {
        return { error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
}

/** Per kind, whether the 3-dot menu's "Send email" works now. */
export async function emailSendStates(): Promise<Record<EmailTemplateKind, EmailSendState>> {
    const configured = isEmailConfigured();
    const pairs = await Promise.all(
        EMAIL_TEMPLATE_KINDS.map(async (k) => [k, !configured ? "not-configured" : (await getEmailTemplate(k)).enabled ? "ready" : "off"] as const),
    );
    return Object.fromEntries(pairs) as Record<EmailTemplateKind, EmailSendState>;
}

/** Take the (kind, refId) row: a new one, or a failed one back to pending.
 *  Both are single atomic writes, so two tries at once still send only once. */
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

/** Workflow: any email template (built-in or staff's own, never a sign-in
 *  code) to the ticket's customer, filled from the ticket; verified email only.
 *  Goes when the template is on (its Auto send does not apply — the workflow
 *  chose it). Once per (template, ticket). */
export async function notifyTicketEmail(kind: EmailAnyKind, ticketId: number): Promise<NotifyResult> {
    try {
        if (isSecurityKind(kind)) return { status: "skipped", reason: "a sign-in code cannot be sent from a ticket" };
        const c = await loadTicketCustomer(ticketId);
        if (!c) return { status: "skipped", reason: "no customer" };
        return sendTemplatedEmail({ kind, refId: ticketId, claimKind: ticketClaimKind(kind), emails: c.emails, values: c.values, manual: true });
    } catch (e) {
        console.error(`[notify-email] ${kind} ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}
