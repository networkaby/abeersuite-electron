import "server-only";
import { prisma, prismaLive, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import type { PrismaClient } from "@/generated/prisma/client";
import { IS_COUNTER_PC, WRITE_PREFERENCE, shouldWriteLocal } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { partyBalanceAroundVoucher } from "@/shared/lib/accountancy/partyLedgerBalance";
import { formatAmount, withCurrency } from "@/shared/lib/format/moneyInr";
import { sendPushToPerson, type PushPayload } from "@/shared/lib/push/sendPush";
import {
    WA_APP_LINK,
    WA_BILL_LINK_BASE,
    VOUCHER_KINDS,
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
import { askOffice } from "@/shared/lib/counter/officeNotify";
import { notifyEmail, notifyRepairEmail, queueDocEmail, queueRepairEmail } from "@/shared/lib/email/notifyEmail";
import { AUTO_WAITS_MS, MANUAL_WAITS_MS, claimOnce, claimToken, retryBeforeClaim, sendsFromCounter } from "./counterSend";

export { autoKindForVoucherType };
import { isBillSendConfigured, sendBillTemplate, sendTextMessage } from "./metaTemplates";
import { sendWithFallback, type WaOutcome } from "./waSendOutcome";
import { billsWaNumber, listWaNumbers } from "./waNumbers";

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
 * A counter under `WRITE_MODE=live` sends the WhatsApp itself (it holds the Meta
 * token) and reads + claims in Supabase only (`db()` = prismaLive), never the
 * replica. It has no push / email keys, so those wait in Supabase as "queued" for
 * the office's communications cron (counter/counterQueue.ts). No internet before
 * the claim -> retried in the background, then "no internet" (nothing went out).
 * `v_live` and an outage still ask the office (`askOffice`): the save is there,
 * or not in Supabase yet.
 *
 * Skipped without a row: a draft or
 * cancelled voucher, a walk-in (the pooled walk-in ledger names nobody), any
 * party under Sundry Creditors (a supplier — automatic or manual, every kind;
 * their incoming messages are dropped too, see `ingestInbound`),
 * a REFUND to anyone outside Sundry Debtors, and a document already announced
 * under that kind.
 */

/** `wa` = the WhatsApp's own outcome (BillNotification.waStatus) when the
 *  document was processed: "sent" here means announced, not that WhatsApp took it. */
export type NotifyResult = { status: "sent" | "already" | "skipped"; reason?: string; wa?: string };

type SendMode = { manual?: boolean };

/** Where message data is read and claimed: Supabase only on a counter (the replica
 *  may not have the save yet, and a claim must never land in the outbox). */
const db = (): PrismaClient => (IS_COUNTER_PC ? prismaLive : prisma);

/** False on a counter that must ask the office (v_live, outage). */
function sendsHere(): boolean {
    return !IS_COUNTER_PC || sendsFromCounter({ isCounter: true, write: WRITE_PREFERENCE, writeLocal: shouldWriteLocal() });
}

/** On a counter, retry while nothing is claimed yet (no internet). */
async function untilClaimed(attempt: () => Promise<NotifyResult>, mode: SendMode): Promise<NotifyResult> {
    if (!IS_COUNTER_PC) return attempt();
    return (await retryBeforeClaim(attempt, mode.manual ? MANUAL_WAITS_MS : AUTO_WAITS_MS)) ?? { status: "skipped", reason: "no internet" };
}

/** Automatic needs Auto send on; manual needs the template switched on + approved. */
async function allowed(kind: WaTemplateKind, mode: SendMode): Promise<NotifyResult | null> {
    if (mode.manual) return (await getApprovedWaTemplate(kind)) ? null : { status: "skipped", reason: "template off" };
    return (await isAutoSend(kind)) ? null : { status: "skipped", reason: "auto off" };
}

export async function notifyBill(kind: WaTemplateKind, universalVoucherId: number, mode: SendMode = {}): Promise<NotifyResult> {
    if (!sendsHere()) return askOffice({ what: "bill", kind, id: universalVoucherId, manual: mode.manual }, { staffWaiting: mode.manual });
    // The automatic send also emails, on its own switches (Settings → Email
    // Templates). Staff's manual "Send on WhatsApp" does not. A counter queues it.
    const email = mode.manual ? null : IS_COUNTER_PC ? queueDocEmail(kind, universalVoucherId) : notifyEmail(kind, universalVoucherId);
    try {
        const stop = await allowed(kind, mode);
        if (stop) return stop;
        return await untilClaimed(() => notifyVoucher(kind, universalVoucherId), mode);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ${universalVoucherId} failed`, e);
        return { status: "skipped", reason: "error" };
    } finally {
        await email;
    }
}

export async function notifyRepair(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    if (!sendsHere()) return askOffice({ what: "repair", kind, id: ticketId, manual: mode.manual }, { staffWaiting: mode.manual });
    // The stage completing also emails (Settings → Email Templates); the repair
    // ticket's manual WhatsApp buttons do not. A counter queues it.
    const email = mode.manual ? null : IS_COUNTER_PC ? queueRepairEmail(kind, ticketId) : notifyRepairEmail(kind, ticketId);
    try {
        const stop = await allowed(kind, mode);
        if (stop) return stop;
        return await untilClaimed(() => notifyTicket(kind, ticketId), mode);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    } finally {
        await email;
    }
}

export async function notifyDealCreated(ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    if (!sendsHere()) return askOffice({ what: "deal", id: ticketId });
    try {
        const stop = await allowed("DEAL_CREATED", mode);
        if (stop) return stop;
        return await untilClaimed(() => notifyTicketDeal(ticketId), mode);
    } catch (e) {
        console.error(`[notify-deal] ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

export async function notifyHelpCreated(ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    if (!sendsHere()) return askOffice({ what: "help", id: ticketId });
    try {
        const stop = await allowed("HELP_CREATED", mode);
        if (stop) return stop;
        return await untilClaimed(() => notifyTicketHelp(ticketId), mode);
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
        : (await prismaWhereSaved().voucherDetail.findUnique({ where: { id }, select: { universalVoucherId: true } }))?.universalVoucherId ?? null;
    if (uvId == null) return { status: "skipped", reason: "not posted" };
    const uv = await prismaWhereSaved().universalVoucher.findUnique({ where: { id: uvId }, select: { type: true } });
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
    const uv = await db().universalVoucher.findUnique({
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

    const account = await db().account.findUnique({ where: { id: uv.partyAccountId }, select: partySelect });
    const party = account?.person ?? account?.company;
    if (!account || !party) return { status: "skipped", reason: "walk-in" };
    // A supplier never hears from us — automatic or manual, any kind.
    if (await isUnderGroup(account.groupId, ACCOUNT_GROUPS.SUNDRY_CREDITORS)) return { status: "skipped", reason: "supplier" };
    if (kind === "REFUND" && !(await isUnderGroup(account.groupId, ACCOUNT_GROUPS.SUNDRY_DEBTORS))) return { status: "skipped", reason: "not a customer" };

    // An inventory document carries its own total; a money voucher is the sum of
    // its lines on the party (credit for money in, debit for money paid out).
    let amount = uv.voucherDetail ? Number(uv.voucherDetail.totalAmount) : 0;
    if (!uv.voucherDetail) {
        const lines = await db().voucherGlLine.findMany({
            where: { universalVoucherId: uvId, accountId: uv.partyAccountId, type: kind === "REFUND" ? "DEBIT" : "CREDIT" },
            select: { amount: true },
        });
        amount = lines.reduce((s, l) => s + Number(l.amount), 0);
    }

    // Previous / closing balance — the same figures the print template shows.
    const bal = await partyBalanceAroundVoucher(uv.partyAccountId, uvId, db());
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

type DeliverInput = Parameters<typeof deliver>[0];
const built = async (input: Promise<DeliverInput | NotifyResult>): Promise<NotifyResult> => {
    const d = await input;
    return "status" in d ? d : deliver(d);
};

const notifyVoucher = (kind: WaTemplateKind, uvId: number) => built(buildVoucher(kind, uvId));
async function buildVoucher(kind: WaTemplateKind, uvId: number): Promise<DeliverInput | NotifyResult> {
    const m = await loadVoucherMessage(kind, uvId);
    if ("status" in m) return m;
    return {
        kind,
        refId: uvId,
        linkCode: String(uvId),
        personId: m.personId,
        phones: m.phones,
        values: m.values,
        push: { title: `${WA_TEMPLATE_LABEL[kind]} ${m.docNo}`, body: `${withCurrency(m.amountText)} · ${m.dateText} · tap to view` },
        summary: `${WA_TEMPLATE_LABEL[kind]} ${m.docNo} · ${withCurrency(m.amountText)}`,
    };
}

/** A repair ticket's customer and fields, for WhatsApp here and email in
 *  email/notifyEmail.ts — or why it has nobody to tell. */
export async function loadRepairMessage(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number) {
    const t = await db().ticket.findUnique({
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

const notifyTicket = (kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number) => built(buildRepair(kind, ticketId));
async function buildRepair(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number): Promise<DeliverInput | NotifyResult> {
    const m = await loadRepairMessage(kind, ticketId);
    if ("status" in m) return m;
    const { deviceName, jobNo } = m;
    const ready = kind === "REPAIR_READY";
    return {
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
    };
}

const notifyTicketDeal = (ticketId: number) => built(buildDeal(ticketId));
async function buildDeal(ticketId: number): Promise<DeliverInput | NotifyResult> {
    const t = await db().ticket.findUnique({
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

    return {
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
    };
}

const notifyTicketHelp = (ticketId: number) => built(buildHelp(ticketId));
async function buildHelp(ticketId: number): Promise<DeliverInput | NotifyResult> {
    const t = await db().ticket.findUnique({
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

    return {
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
    };
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
    // document stops here instead of messaging the customer twice. A claim left
    // "pending" by a crash counts as taken: never resent by itself. Throws
    // (NotClaimed) only when nothing was claimed — the caller may retry.
    const key = d.claimKind ?? d.kind;
    const where = { kind_refId: { kind: key, refId: d.refId } };
    const claim = await claimOnce({
        create: (token) => db().billNotification.create({
            data: { kind: key, refId: d.refId, personId: d.personId, pushStatus: "pending", waStatus: "pending", waError: token },
        }),
        find: () => db().billNotification.findUnique({ where, select: { waStatus: true, waError: true } }),
    }, claimToken());
    if (!claim.mine) return { status: "already", wa: claim.wa };

    // Claimed: from here nothing throws, so nothing is retried.
    let out: Awaited<ReturnType<typeof sendPushAndWhatsApp>>;
    try {
        out = await sendPushAndWhatsApp({ ...d, queuePush: IS_COUNTER_PC });
    } catch (e) {
        console.error(`[notify-bill] ${key} ${d.refId}: stopped after the claim`, e);
        return { status: "sent", wa: "pending" };
    }
    const { mobile, push, wa } = out;
    await db().billNotification.update({
        where,
        data: {
            mobile,
            pushStatus: push.status,
            pushMessageId: push.messageId,
            waStatus: wa.status,
            waMessageId: wa.messageId ?? null,
            waError: wa.error ?? null,
        },
    }).catch((e) => console.error(`[notify-bill] ${key} ${d.refId}: outcome not saved (${wa.status})`, e));
    return { status: "sent", wa: wa.status };
}

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
    /** A counter has no push keys: leave it "queued" for the office (counterQueue.ts). */
    queuePush?: boolean;
}): Promise<{ mobile: string | null; push: { status: string; messageId: string | null }; wa: WaOutcome }> {
    const mobile = pickMobile(d.phones);
    const personId = d.personId;
    const [push, wa] = await Promise.all([
        personId == null
            ? Promise.resolve({ status: "no-person", messageId: null })
            : d.queuePush
              ? queuePush(personId)
              : sendPushToPerson(personId, pushPayload(d)),
        sendWhatsApp(d.kind, d.linkCode, mobile, d.values, d.headerImage),
    ]);
    if (mobile && wa.messageId) {
        // The WhatsApp went: a failed copy into Messages must not read as a failed send.
        await recordBillMessage({ mobile10: mobile, externalId: wa.messageId, billKind: d.claimKind ?? d.kind, billRefId: d.refId, body: d.summary })
            .catch((e) => console.error(`[notify-bill] ${d.kind} ${d.refId}: not copied into Messages`, e));
    }
    return { mobile, push, wa };
}

/** The app notification for a document — sent now, or later by the office for a counter. */
function pushPayload(d: { kind: string; refId: number; linkCode: string; push: { title: string; body: string } }): PushPayload {
    return { title: d.push.title, body: d.push.body, url: `/portal/b/${d.linkCode}`, tag: `${d.kind}-${d.refId}`, refType: d.kind, refId: String(d.refId) };
}

/** Queued only when the customer has a phone that can show it; unsure → queued. */
async function queuePush(personId: number): Promise<{ status: string; messageId: null }> {
    const subs = await db().pushSubscription.count({ where: { personId } }).catch(() => 1);
    return { status: subs ? "queued" : "no-subscription", messageId: null };
}

/** For the office draining a counter's queue: the same notification, rebuilt
 *  from the document. Null when the document no longer has anyone to tell. */
export async function queuedPushPayload(kind: string, refId: number): Promise<{ personId: number; payload: PushPayload } | null> {
    const input =
        kind === "REPAIR_RECEIVED" || kind === "REPAIR_READY" ? await buildRepair(kind, refId)
        : kind === "DEAL_CREATED" ? await buildDeal(refId)
        : kind === "HELP_CREATED" ? await buildHelp(refId)
        : VOUCHER_KINDS.has(kind) ? await buildVoucher(kind as WaTemplateKind, refId)
        : null;
    if (!input || "status" in input || input.personId == null) return null;
    return { personId: input.personId, payload: pushPayload(input) };
}

async function sendWhatsApp(kind: WaAnyKind, linkCode: string, mobile: string | null, values: WaFieldValues, headerImage?: string): Promise<WaOutcome> {
    if (!mobile) return { status: "no-mobile" };
    const tpl = await getApprovedWaTemplate(kind);
    if (!tpl) {
        if (kind === "DEAL_CREATED" || kind === "HELP_CREATED") {
            const draft = await getWaTemplateDraft(kind);
            const text = fillBody(draft.body, values);
            if (text && (await isBillSendConfigured())) {
                return sendWithFallback(() => sendTextMessage(mobile, text));
            }
        }
        return { status: "disabled" };
    }
    if (!(await isBillSendConfigured())) return { status: "not-configured" };
    const send = (fromNumberId?: string) =>
        sendBillTemplate({ mobile10: mobile, name: tpl.name, approved: tpl.draft, values, linkCode, headerImage, fromNumberId });
    // Only a proven refusal tries the other numbers on the same WhatsApp account
    // (they share the template). Unclear stops — the customer may have it.
    return sendWithFallback(() => send(), async () => {
        const bills = await billsWaNumber();
        return (await listWaNumbers())
            .filter((n) => n.id !== bills?.id && n.wabaId === bills?.wabaId)
            .map((n) => () => send(n.phoneNumberId));
    });
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
    const t = await db().ticket.findUnique({
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
export async function notifyTicketTemplate(kind: WaAnyKind, ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    if (!sendsHere()) return askOffice({ what: "ticket-wa", kind, id: ticketId }, { staffWaiting: mode.manual });
    try {
        // The picker lists every template; what cannot work from a ticket is refused here, with the reason.
        if (hasImageHeader(kind)) return { status: "skipped", reason: "a UPI payment request needs its own QR — send it from POS" };
        const approved = await getApprovedWaTemplate(kind);
        if (!approved) return { status: "skipped", reason: "template not approved or switched off" };
        const c = await loadTicketCustomer(ticketId);
        if (!c) return { status: "skipped", reason: "no customer" };
        if (!pickMobile(c.phones)) return { status: "skipped", reason: "no customer mobile" };
        const values = c.values;
        return await untilClaimed(() => deliver({
            kind,
            claimKind: ticketClaimKind(kind),
            refId: ticketId,
            linkCode: `t${ticketId}`,
            personId: null,
            phones: c.phones,
            values,
            push: { title: "", body: "" },
            summary: fillBody(approved.draft.body, values).slice(0, 200),
        }), mode);
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
    const acc = await db().account.findUnique({ where: { id: accountId }, select: { groupId: true } });
    return isUnderGroup(acc?.groupId ?? null, ACCOUNT_GROUPS.SUNDRY_CREDITORS);
}

async function isUnderGroup(groupId: number | null, groupName: string): Promise<boolean> {
    if (groupId == null) return false;
    if (!groupCache || Date.now() - groupCache.at > 300_000) {
        const rows = await db().accountGroup.findMany({ select: { id: true, parentId: true, name: true } });
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
