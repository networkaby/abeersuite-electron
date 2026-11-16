import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { partyBalanceAroundVoucher } from "@/shared/lib/accountancy/partyLedgerBalance";
import { formatAmount, withCurrency } from "@/shared/lib/format/moneyInr";
import { sendPushToPerson } from "@/shared/lib/push/sendPush";
import {
    WA_APP_LINK,
    WA_BILL_LINK_BASE,
    WA_TEMPLATE_LABEL,
    autoKindForVoucherType,
    fillBody,
    hasImageHeader,
    isCustomKind,
    type WaAnyKind,
    type WaFieldValues,
    type WaTemplateKind,
} from "./billTemplates";
import { getApprovedWaTemplate, getWaTemplateDraft, isAutoSend } from "./waTemplateStore";
import { recordBillMessage } from "@/modules/message/lib/customerMessages";
import { notifyEmail, notifyRepairEmail } from "@/shared/lib/email/notifyEmail";

export { autoKindForVoucherType };
import { isBillSendConfigured, sendBillTemplate, sendTextMessage } from "./metaTemplates";

/**
 * Tell the customer about a saved document — app notification AND WhatsApp,
 * both, every time (owner, 2026-10-06: watch the app's "shown" rate before ever
 * skipping the WhatsApp). One BillNotification row per (kind, document) records
 * both outcomes for the office chips and that later decision.
 *
 * Save paths call it inside `after()` — it never throws and never slows the save:
 *     after(() => notifyBill("SALE", universalVoucherId));
 * Repair stages call `notifyRepair` from their worker action.
 *
 * Automatic (a save, a repair stage) goes only when the kind's **Auto send** is
 * on. Manual (3-dot menu "Send on WhatsApp" → `sendManually`) goes only when
 * the kind's template is switched on and approved.
 *
 * Skipped without a row: a counter PC (no Meta / push keys there — the relayed
 * save runs on the office server and is announced from there), a draft or
 * cancelled voucher, a walk-in (the pooled walk-in ledger names nobody), any
 * party under Sundry Creditors (a supplier — automatic or manual, every kind;
 * their incoming messages are dropped too, see `ingestInbound`),
 * a REFUND to anyone outside Sundry Debtors, and a document already announced
 * under that kind.
 */
export type NotifyResult = { status: "sent" | "already" | "skipped"; reason?: string };

type SendMode = { manual?: boolean };

/** Automatic needs Auto send on; manual needs the template switched on + approved. */
async function allowed(kind: WaTemplateKind, mode: SendMode): Promise<NotifyResult | null> {
    if (IS_COUNTER_PC) return { status: "skipped", reason: "counter" };
    if (mode.manual) return (await getApprovedWaTemplate(kind)) ? null : { status: "skipped", reason: "template off" };
    return (await isAutoSend(kind)) ? null : { status: "skipped", reason: "auto off" };
}

export async function notifyBill(kind: WaTemplateKind, universalVoucherId: number, mode: SendMode = {}): Promise<NotifyResult> {
    // The automatic send also emails, on its own switches (Settings → Email
    // Templates). Staff's manual "Send on WhatsApp" does not.
    const email = mode.manual ? null : notifyEmail(kind, universalVoucherId);
    try {
        const stop = await allowed(kind, mode);
        if (stop) return stop;
        return await notifyVoucher(kind, universalVoucherId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ${universalVoucherId} failed`, e);
        return { status: "skipped", reason: "error" };
    } finally {
        await email;
    }
}

export async function notifyRepair(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    // The stage completing also emails (Settings → Email Templates); the repair
    // ticket's manual WhatsApp buttons do not.
    const email = mode.manual ? null : notifyRepairEmail(kind, ticketId);
    try {
        const stop = await allowed(kind, mode);
        if (stop) return stop;
        return await notifyTicket(kind, ticketId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    } finally {
        await email;
    }
}

export async function notifyDealCreated(ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    try {
        const stop = await allowed("DEAL_CREATED", mode);
        if (stop) return stop;
        return await notifyTicketDeal(ticketId);
    } catch (e) {
        console.error(`[notify-deal] ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

export async function notifyHelpCreated(ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    try {
        const stop = await allowed("HELP_CREATED", mode);
        if (stop) return stop;
        return await notifyTicketHelp(ticketId);
    } catch (e) {
        console.error(`[notify-help] ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}


/**
 * Staff's "Send on WhatsApp" from a 3-dot menu. `source` + `id` are the menu's
 * own row ids — `inv` is a VoucherDetail id; `uv` is a UniversalVoucher id (a GL
 * row, or any caller that already holds the spine id). Once per document, like the automatic send.
 */
export async function sendManually(source: "inv" | "uv", id: number): Promise<NotifyResult> {
    const uvId = source === "uv"
        ? id
        : (await prisma.voucherDetail.findUnique({ where: { id }, select: { universalVoucherId: true } }))?.universalVoucherId ?? null;
    if (uvId == null) return { status: "skipped", reason: "not posted" };
    const uv = await prisma.universalVoucher.findUnique({ where: { id: uvId }, select: { type: true } });
    const kind = uv ? autoKindForVoucherType(uv.type) : null;
    if (!kind) return { status: "skipped", reason: "not a customer document" };
    return notifyBill(kind, uvId, { manual: true });
}
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export type PhoneRow = { phone: string; isPrimary: boolean; verifiedAt: Date | null };
const phonesSelect = { select: { phone: true, isPrimary: true, verifiedAt: true } } as const;
export type EmailRow = { email: string; isPrimary: boolean; verifiedAt: Date | null };
const emailsSelect = { select: { email: true, isPrimary: true, verifiedAt: true } } as const;
export const partySelect = {
    personId: true,
    companyId: true,
    groupId: true,
    person: { select: { name: true, phones: phonesSelect, emails: emailsSelect } },
    company: { select: { name: true, phones: phonesSelect, emails: emailsSelect } },
} as const;

/** A posted customer voucher, ready to announce on any channel (WhatsApp here,
 *  email in email/notifyEmail.ts) — or why it is not sent at all. */
export type VoucherMessage = {
    personId: number | null;
    phones: PhoneRow[];
    emails: EmailRow[];
    docNo: string;
    amountText: string;
    dateText: string;
    values: WaFieldValues;
};

export async function loadVoucherMessage(kind: WaTemplateKind, uvId: number): Promise<VoucherMessage | NotifyResult> {
    const uv = await prisma.universalVoucher.findUnique({
        where: { id: uvId },
        select: {
            voucherNo: true,
            date: true,
            status: true,
            partyAccountId: true,
            voucherDetail: { select: { totalAmount: true } },
        },
    });
    if (!uv || uv.status !== "POSTED") return { status: "skipped", reason: "not posted" };
    if (uv.partyAccountId == null) return { status: "skipped", reason: "no party" };

    const account = await prisma.account.findUnique({ where: { id: uv.partyAccountId }, select: partySelect });
    const party = account?.person ?? account?.company;
    if (!account || !party) return { status: "skipped", reason: "walk-in" };
    // A supplier never hears from us — automatic or manual, any kind.
    if (await isUnderGroup(account.groupId, ACCOUNT_GROUPS.SUNDRY_CREDITORS)) return { status: "skipped", reason: "supplier" };
    if (kind === "REFUND" && !(await isUnderGroup(account.groupId, ACCOUNT_GROUPS.SUNDRY_DEBTORS))) return { status: "skipped", reason: "not a customer" };

    // An inventory document carries its own total; a money voucher is the sum of
    // its lines on the party (credit for money in, debit for money paid out).
    let amount = uv.voucherDetail ? Number(uv.voucherDetail.totalAmount) : 0;
    if (!uv.voucherDetail) {
        const lines = await prisma.voucherGlLine.findMany({
            where: { universalVoucherId: uvId, accountId: uv.partyAccountId, type: kind === "REFUND" ? "DEBIT" : "CREDIT" },
            select: { amount: true },
        });
        amount = lines.reduce((s, l) => s + Number(l.amount), 0);
    }

    // Previous / closing balance — the same figures the print template shows.
    const bal = await partyBalanceAroundVoucher(uv.partyAccountId, uvId);
    const balanceText = (n: number) => {
        const rounded = Math.round(n * 100) / 100;
        if (rounded === 0) return "Nil";
        return `${withCurrency(formatAmount(Math.abs(rounded)))} ${rounded > 0 ? "due" : "advance"}`;
    };

    const docNo = uv.voucherNo ?? `#${uvId}`;
    const amountText = formatAmount(amount);
    const dateText = day.format(uv.date);
    return {
        personId: account.personId,
        phones: party.phones,
        emails: party.emails,
        docNo,
        amountText,
        dateText,
        values: {
            customer: party.name,
            billNo: docNo,
            amount: amountText,
            date: dateText,
            prevBalance: bal ? balanceText(bal.before) : "Nil",
            balance: bal ? balanceText(bal.after) : "Nil",
            device: "",
            subject: "",
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${uvId}`,
            app: WA_APP_LINK,
        },
    };
}

async function notifyVoucher(kind: WaTemplateKind, uvId: number): Promise<NotifyResult> {
    const m = await loadVoucherMessage(kind, uvId);
    if ("status" in m) return m;
    return deliver({
        kind,
        refId: uvId,
        linkCode: String(uvId),
        personId: m.personId,
        phones: m.phones,
        values: m.values,
        push: { title: `${WA_TEMPLATE_LABEL[kind]} ${m.docNo}`, body: `${withCurrency(m.amountText)} · ${m.dateText} · tap to view` },
        summary: `${WA_TEMPLATE_LABEL[kind]} ${m.docNo} · ${withCurrency(m.amountText)}`,
    });
}

/** A repair ticket's customer and fields, for WhatsApp here and email in
 *  email/notifyEmail.ts — or why it has nobody to tell. */
export async function loadRepairMessage(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number) {
    const t = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            createdAt: true,
            repair: { select: { device: { select: { type: true, brand: true, model: true, account: { select: partySelect } } } } },
        },
    });
    const device = t?.repair?.device;
    const account = device?.account;
    const party = account?.person ?? account?.company;
    if (!t || !device || !account || !party) return { status: "skipped", reason: "no customer" } as NotifyResult;

    const deviceName = [device.brand, device.model].filter(Boolean).join(" ") || device.type || "device";
    const jobNo = `#${ticketId}`;
    const code = `t${ticketId}`;
    return {
        personId: account.personId,
        phones: party.phones,
        emails: party.emails,
        deviceName,
        jobNo,
        code,
        values: {
            customer: party.name,
            billNo: jobNo,
            amount: "",
            prevBalance: "",
            balance: "",
            date: day.format(t.createdAt),
            device: deviceName,
            subject: "",
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${code}`,
            app: WA_APP_LINK,
        } satisfies WaFieldValues,
    };
}

async function notifyTicket(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number): Promise<NotifyResult> {
    const m = await loadRepairMessage(kind, ticketId);
    if ("status" in m) return m;
    const { deviceName, jobNo } = m;
    const ready = kind === "REPAIR_READY";
    return deliver({
        kind,
        refId: ticketId,
        linkCode: m.code,
        personId: m.personId,
        phones: m.phones,
        values: m.values,
        push: {
            title: ready ? `Your ${deviceName} is ready` : `Repair ${jobNo} received`,
            body: ready ? `Job ${jobNo} · ready for pickup · tap for details` : `${deviceName} · tap to track`,
        },
        summary: ready ? `Repair ${jobNo} ready · ${deviceName}` : `Repair ${jobNo} received · ${deviceName}`,
    });
}

async function notifyTicketDeal(ticketId: number): Promise<NotifyResult> {
    const t = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            id: true,
            title: true,
            createdAt: true,
            deal: {
                select: {
                    contactName: true,
                    phone: true,
                    personId: true,
                    person: { select: { id: true, name: true, phones: phonesSelect } },
                    companyId: true,
                    company: { select: { id: true, name: true, phones: phonesSelect } },
                },
            },
        },
    });
    const deal = t?.deal;
    if (!t || !deal) return { status: "skipped", reason: "no deal" };

    const customerName = deal.contactName || deal.person?.name || deal.company?.name || "Customer";
    const subject = t.title || "Sales enquiry";
    const code = `t${ticketId}`;

    let phones: PhoneRow[] = [];
    if (deal.person?.phones?.length) {
        phones = deal.person.phones;
    } else if (deal.company?.phones?.length) {
        phones = deal.company.phones;
    } else if (deal.phone) {
        phones = [{ phone: deal.phone, isPrimary: true, verifiedAt: new Date() }];
    }
    if (!phones.length) return { status: "skipped", reason: "no customer phone" };

    return deliver({
        kind: "DEAL_CREATED",
        refId: ticketId,
        linkCode: code,
        personId: deal.personId ?? null,
        phones,
        values: {
            customer: customerName,
            subject,
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${code}`,
            app: WA_APP_LINK,
            billNo: "",
            amount: "",
            date: day.format(t.createdAt),
            device: "",
            prevBalance: "",
            balance: "",
        },
        push: {
            title: `Enquiry noted · ${getOrganisation().brandName}`,
            body: `${subject} · tap to view`,
        },
        summary: `Enquiry noted: ${subject}`,
    });
}

async function notifyTicketHelp(ticketId: number): Promise<NotifyResult> {
    const t = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            id: true,
            title: true,
            createdAt: true,
            help: {
                select: {
                    contactName: true,
                    subject: true,
                    phone: true,
                    personId: true,
                    person: { select: { id: true, name: true, phones: phonesSelect } },
                    companyId: true,
                    company: { select: { id: true, name: true, phones: phonesSelect } },
                },
            },
        },
    });
    const help = t?.help;
    if (!t || !help) return { status: "skipped", reason: "no help ticket" };

    const customerName = help.contactName || help.person?.name || help.company?.name || "Customer";
    const subject = help.subject || t.title || "Support request";
    const jobNo = `#${ticketId}`;
    const code = `t${ticketId}`;

    let phones: PhoneRow[] = [];
    if (help.person?.phones?.length) {
        phones = help.person.phones;
    } else if (help.company?.phones?.length) {
        phones = help.company.phones;
    } else if (help.phone) {
        phones = [{ phone: help.phone, isPrimary: true, verifiedAt: new Date() }];
    }
    if (!phones.length) return { status: "skipped", reason: "no customer phone" };

    return deliver({
        kind: "HELP_CREATED",
        refId: ticketId,
        linkCode: code,
        personId: help.personId ?? null,
        phones,
        values: {
            customer: customerName,
            subject,
            billNo: jobNo,
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${code}`,
            app: WA_APP_LINK,
            amount: "",
            date: day.format(t.createdAt),
            device: "",
            prevBalance: "",
            balance: "",
        },
        push: {
            title: `Support request ${jobNo} received`,
            body: `${subject} · tap to track`,
        },
        summary: `Support ticket ${jobNo} received · ${subject}`,
    });
}

/** Claim the (kind, refId) row, then send push + WhatsApp side by side. */
async function deliver(d: {
    kind: WaAnyKind;
    /** BillNotification key when it must differ from `kind` — a built-in kind
     *  sent for a ticket, whose refId would clash with a voucher id. */
    claimKind?: string;
    refId: number;
    linkCode: string;
    personId: number | null;
    phones: PhoneRow[];
    values: WaFieldValues;
    push: { title: string; body: string };
    /** One line for the customer's message thread (Messages screen). */
    summary: string;
}): Promise<NotifyResult> {
    // Claim first — a retried request or a second save path for the same
    // document stops here instead of messaging the customer twice.
    try {
        await prisma.billNotification.create({
            data: { kind: d.claimKind ?? d.kind, refId: d.refId, personId: d.personId, pushStatus: "pending", waStatus: "pending" },
        });
    } catch {
        return { status: "already" };
    }

    const { mobile, push, wa } = await sendPushAndWhatsApp(d);

    await prisma.billNotification.update({
        where: { kind_refId: { kind: d.claimKind ?? d.kind, refId: d.refId } },
        data: {
            mobile,
            pushStatus: push.status,
            pushMessageId: push.messageId,
            waStatus: wa.status,
            waMessageId: wa.messageId ?? null,
            waError: wa.error ?? null,
        },
    });
    return { status: "sent" };
}

export type WaOutcome = { status: string; messageId?: string; error?: string };

/** App notification + WhatsApp side by side, and the WhatsApp copied into the
 *  customer's Messages thread. No claim row — `deliver` above claims one per
 *  document; a due reminder logs its own (dueReminders.ts). */
export async function sendPushAndWhatsApp(d: {
    kind: WaAnyKind;
    /** See deliver — a built-in kind sent for a ticket is recorded as TICKET:<kind>. */
    claimKind?: string;
    refId: number;
    linkCode: string;
    personId: number | null;
    phones: PhoneRow[];
    values: WaFieldValues;
    push: { title: string; body: string };
    summary: string;
    /** Photo header link, for a kind with one (hasImageHeader). */
    headerImage?: string;
}): Promise<{ mobile: string | null; push: { status: string; messageId: string | null }; wa: WaOutcome }> {
    const mobile = pickMobile(d.phones);
    const [push, wa] = await Promise.all([
        d.personId != null
            ? sendPushToPerson(d.personId, {
                title: d.push.title,
                body: d.push.body,
                url: `/portal/b/${d.linkCode}`,
                tag: `${d.kind}-${d.refId}`,
                refType: d.kind,
                refId: String(d.refId),
            })
            : Promise.resolve({ status: "no-person" as const, messageId: null }),
        sendWhatsApp(d.kind, d.linkCode, mobile, d.values, d.headerImage),
    ]);
    if (mobile && wa.messageId) {
        await recordBillMessage({ mobile10: mobile, externalId: wa.messageId, billKind: d.claimKind ?? d.kind, billRefId: d.refId, body: d.summary });
    }
    return { mobile, push, wa };
}

async function sendWhatsApp(kind: WaAnyKind, linkCode: string, mobile: string | null, values: WaFieldValues, headerImage?: string): Promise<WaOutcome> {
    if (!mobile) return { status: "no-mobile" };
    const tpl = await getApprovedWaTemplate(kind);
    if (!tpl) {
        if (kind === "DEAL_CREATED" || kind === "HELP_CREATED") {
            const draft = await getWaTemplateDraft(kind);
            const text = fillBody(draft.body, values);
            if (text && (await isBillSendConfigured())) {
                try {
                    const extId = await sendTextMessage(mobile, text);
                    if (extId) return { status: "sent", messageId: extId };
                } catch {
                    // Falls through to disabled
                }
            }
        }
        return { status: "disabled" };
    }
    if (!(await isBillSendConfigured())) return { status: "not-configured" };
    try {
        const messageId = await sendBillTemplate({ mobile10: mobile, name: tpl.name, approved: tpl.draft, values, linkCode, headerImage });
        return { status: "sent", messageId };
    } catch (e) {
        return { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
}

// ── Workflow: "Send WhatsApp / email template" on a worker ───────────────────

export type TicketCustomer = {
    personId: number | null;
    name: string;
    phones: PhoneRow[];
    emails: EmailRow[];
    /** Every field filled from the ticket. A field a ticket has no value for
     *  (amount, balances) is "—" — Meta refuses an empty parameter. */
    values: WaFieldValues;
};

/** The ticket's customer, whatever the pipeline: the repaired device's owner,
 *  else the deal's or help ticket's person / company / typed phone. */
export async function loadTicketCustomer(ticketId: number): Promise<TicketCustomer | null> {
    const party = { select: { id: true, name: true, phones: phonesSelect, emails: emailsSelect } } as const;
    const t = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            title: true,
            createdAt: true,
            repair: { select: { device: { select: { type: true, brand: true, model: true, account: { select: partySelect } } } } },
            deal: { select: { contactName: true, phone: true, personId: true, person: party, company: party } },
            help: { select: { contactName: true, phone: true, personId: true, person: party, company: party } },
        },
    });
    if (!t) return null;
    const dev = t.repair?.device;
    const values = (name: string): WaFieldValues => ({
        customer: name,
        billNo: `#${ticketId}`,
        amount: "—",
        date: day.format(t.createdAt),
        device: [dev?.brand, dev?.model].filter(Boolean).join(" ") || dev?.type || "—",
        subject: t.title || "—",
        prevBalance: "—",
        balance: "—",
        shop: getOrganisation().brandName,
        link: `${WA_BILL_LINK_BASE}t${ticketId}`,
        app: WA_APP_LINK,
    });
    const acc = dev?.account;
    const owner = acc?.person ?? acc?.company;
    if (acc && owner) return { personId: acc.personId, name: owner.name, phones: owner.phones, emails: owner.emails, values: values(owner.name) };
    const c = t.deal ?? t.help;
    if (!c) return null;
    const p = c.person ?? c.company;
    const phones = p?.phones.length ? p.phones : c.phone ? [{ phone: c.phone, isPrimary: true, verifiedAt: null }] : [];
    const name = c.contactName || p?.name || "Customer";
    return { personId: c.personId ?? null, name, phones, emails: p?.emails ?? [], values: values(name) };
}

/** Send any WhatsApp template (built-in or staff's own) to a ticket's
 *  customer, filled from the ticket. Only an approved, switched-on template
 *  goes; once per (template, ticket). No app notification. Repair received /
 *  ready go through notifyRepair instead (it adds the app notification). */
export async function notifyTicketTemplate(kind: WaAnyKind, ticketId: number): Promise<NotifyResult> {
    try {
        if (IS_COUNTER_PC) return { status: "skipped", reason: "counter" };
        // The picker lists every template; what cannot work from a ticket is refused here, with the reason.
        if (hasImageHeader(kind)) return { status: "skipped", reason: "a UPI payment request needs its own QR — send it from POS" };
        const approved = await getApprovedWaTemplate(kind);
        if (!approved) return { status: "skipped", reason: "template not approved or switched off" };
        const c = await loadTicketCustomer(ticketId);
        if (!c) return { status: "skipped", reason: "no customer" };
        if (!pickMobile(c.phones)) return { status: "skipped", reason: "no customer mobile" };
        const values = c.values;
        return await deliver({
            kind,
            claimKind: ticketClaimKind(kind),
            refId: ticketId,
            linkCode: `t${ticketId}`,
            personId: null,
            phones: c.phones,
            values,
            push: { title: "", body: "" },
            summary: fillBody(approved.draft.body, values).slice(0, 200),
        });
    } catch (e) {
        console.error(`[notify-template] ${kind} ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

/** Claim key for a template sent for a TICKET: a built-in kind's refId is
 *  normally a voucher id, so it gets its own key; repair and custom kinds are
 *  already keyed by ticket. */
export function ticketClaimKind(kind: string): string {
    return isCustomKind(kind) || kind === "REPAIR_RECEIVED" || kind === "REPAIR_READY" ? kind : `TICKET:${kind}`;
}

/** Primary verified mobile first, then any verified, then any — 10-digit Indian only. */
function pickMobile(phones: PhoneRow[]): string | null {
    const ranked = [...phones].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(!!b.verifiedAt) - Number(!!a.verifiedAt),
    );
    for (const p of ranked) {
        const m = normalizeMobile10(p.phone);
        if (m) return m;
    }
    return null;
}

// ── Group check: Sundry Creditors (never sent) / Sundry Debtors (REFUND) ──────
// The group tree is a few dozen rows; cached for five minutes per server.
let groupCache: { at: number; byId: Map<number, { parentId: number | null; name: string }> } | null = null;

/** Is this ledger a supplier (under Sundry Creditors)? The inbound webhook drops their messages. */
export async function isSupplierAccount(accountId: number | null | undefined): Promise<boolean> {
    if (accountId == null) return false;
    const acc = await prisma.account.findUnique({ where: { id: accountId }, select: { groupId: true } });
    return isUnderGroup(acc?.groupId ?? null, ACCOUNT_GROUPS.SUNDRY_CREDITORS);
}

async function isUnderGroup(groupId: number | null, groupName: string): Promise<boolean> {
    if (groupId == null) return false;
    if (!groupCache || Date.now() - groupCache.at > 300_000) {
        const rows = await prisma.accountGroup.findMany({ select: { id: true, parentId: true, name: true } });
        groupCache = { at: Date.now(), byId: new Map(rows.map((r) => [r.id, { parentId: r.parentId, name: r.name }])) };
    }
    const seen = new Set<number>();
    for (let id: number | null = groupId; id != null && !seen.has(id); ) {
        seen.add(id);
        const g = groupCache.byId.get(id);
        if (!g) return false;
        if (g.name === groupName) return true;
        id = g.parentId;
    }
    return false;
}
