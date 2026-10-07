import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { partyBalanceAroundVoucher } from "@/shared/lib/accountancy/partyLedgerBalance";
import { sendPushToPerson } from "@/shared/lib/push/sendPush";
import {
    WA_APP_LINK,
    WA_BILL_LINK_BASE,
    WA_TEMPLATE_LABEL,
    autoKindForVoucherType,
    type WaFieldValues,
    type WaTemplateKind,
} from "./billTemplates";
import { getApprovedWaTemplate, isAutoSend } from "./waTemplateStore";
import { recordBillMessage } from "@/modules/message/lib/customerMessages";

export { autoKindForVoucherType };
import { isBillSendConfigured, sendBillTemplate } from "./metaTemplates";

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
 * cancelled voucher, a walk-in (the pooled walk-in ledger names nobody), a
 * REFUND to anyone outside Sundry Debtors (a supplier payment), and a document
 * already announced under that kind.
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
    try {
        const stop = await allowed(kind, mode);
        if (stop) return stop;
        return await notifyVoucher(kind, universalVoucherId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ${universalVoucherId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

export async function notifyRepair(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number, mode: SendMode = {}): Promise<NotifyResult> {
    try {
        const stop = await allowed(kind, mode);
        if (stop) return stop;
        return await notifyTicket(kind, ticketId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ticket ${ticketId} failed`, e);
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

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export type PhoneRow = { phone: string; isPrimary: boolean; verifiedAt: Date | null };
const phonesSelect = { select: { phone: true, isPrimary: true, verifiedAt: true } } as const;
export const partySelect = {
    personId: true,
    companyId: true,
    groupId: true,
    person: { select: { name: true, phones: phonesSelect } },
    company: { select: { name: true, phones: phonesSelect } },
} as const;

async function notifyVoucher(kind: WaTemplateKind, uvId: number): Promise<NotifyResult> {
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
    if (kind === "REFUND" && !(await isUnderDebtors(account.groupId))) return { status: "skipped", reason: "not a customer" };

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
        return `Rs ${money.format(Math.abs(rounded))} ${rounded > 0 ? "due" : "advance"}`;
    };

    const docNo = uv.voucherNo ?? `#${uvId}`;
    const amountText = money.format(amount);
    const dateText = day.format(uv.date);
    return deliver({
        kind,
        refId: uvId,
        linkCode: String(uvId),
        personId: account.personId,
        phones: party.phones,
        values: {
            customer: party.name,
            billNo: docNo,
            amount: amountText,
            date: dateText,
            prevBalance: bal ? balanceText(bal.before) : "Nil",
            balance: bal ? balanceText(bal.after) : "Nil",
            device: "",
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${uvId}`,
            app: WA_APP_LINK,
        },
        push: { title: `${WA_TEMPLATE_LABEL[kind]} ${docNo}`, body: `Rs ${amountText} · ${dateText} · tap to view` },
        summary: `${WA_TEMPLATE_LABEL[kind]} ${docNo} · Rs ${amountText}`,
    });
}

async function notifyTicket(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number): Promise<NotifyResult> {
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
    if (!t || !device || !account || !party) return { status: "skipped", reason: "no customer" };

    const deviceName = [device.brand, device.model].filter(Boolean).join(" ") || device.type || "device";
    const jobNo = `#${ticketId}`;
    const code = `t${ticketId}`;
    const ready = kind === "REPAIR_READY";
    return deliver({
        kind,
        refId: ticketId,
        linkCode: code,
        personId: account.personId,
        phones: party.phones,
        values: {
            customer: party.name,
            billNo: jobNo,
            amount: "",
            prevBalance: "",
            balance: "",
            date: day.format(t.createdAt),
            device: deviceName,
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${code}`,
            app: WA_APP_LINK,
        },
        push: {
            title: ready ? `Your ${deviceName} is ready` : `Repair ${jobNo} received`,
            body: ready ? `Job ${jobNo} · ready for pickup · tap for details` : `${deviceName} · tap to track`,
        },
        summary: ready ? `Repair ${jobNo} ready · ${deviceName}` : `Repair ${jobNo} received · ${deviceName}`,
    });
}

/** Claim the (kind, refId) row, then send push + WhatsApp side by side. */
async function deliver(d: {
    kind: WaTemplateKind;
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
            data: { kind: d.kind, refId: d.refId, personId: d.personId, pushStatus: "pending", waStatus: "pending" },
        });
    } catch {
        return { status: "already" };
    }

    const { mobile, push, wa } = await sendPushAndWhatsApp(d);

    await prisma.billNotification.update({
        where: { kind_refId: { kind: d.kind, refId: d.refId } },
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
    kind: WaTemplateKind;
    refId: number;
    linkCode: string;
    personId: number | null;
    phones: PhoneRow[];
    values: WaFieldValues;
    push: { title: string; body: string };
    summary: string;
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
        sendWhatsApp(d.kind, d.linkCode, mobile, d.values),
    ]);
    if (mobile && wa.messageId) {
        await recordBillMessage({ mobile10: mobile, externalId: wa.messageId, billKind: d.kind, billRefId: d.refId, body: d.summary });
    }
    return { mobile, push, wa };
}

async function sendWhatsApp(kind: WaTemplateKind, linkCode: string, mobile: string | null, values: WaFieldValues): Promise<WaOutcome> {
    if (!mobile) return { status: "no-mobile" };
    const tpl = await getApprovedWaTemplate(kind);
    if (!tpl) return { status: "disabled" };
    if (!isBillSendConfigured()) return { status: "not-configured" };
    try {
        const messageId = await sendBillTemplate({ mobile10: mobile, name: tpl.name, approved: tpl.draft, values, linkCode });
        return { status: "sent", messageId };
    } catch (e) {
        return { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
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

// ── Sundry Debtors check (REFUND only) ────────────────────────────────────────
// The group tree is a few dozen rows; cached for five minutes per server.
let groupCache: { at: number; byId: Map<number, { parentId: number | null; name: string }> } | null = null;

async function isUnderDebtors(groupId: number | null): Promise<boolean> {
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
        if (g.name === ACCOUNT_GROUPS.SUNDRY_DEBTORS) return true;
        id = g.parentId;
    }
    return false;
}
