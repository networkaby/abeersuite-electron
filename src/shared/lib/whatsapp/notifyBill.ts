import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { sendPushToPerson } from "@/shared/lib/push/sendPush";
import {
    WA_APP_LINK,
    WA_BILL_LINK_BASE,
    WA_TEMPLATE_LABEL,
    type WaFieldValues,
    type WaTemplateKind,
} from "./billTemplates";
import { getApprovedWaTemplate } from "./waTemplateStore";
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
 * Skipped without a row: a counter PC (no Meta / push keys there — the relayed
 * save runs on the office server and is announced from there), a draft or
 * cancelled voucher, a walk-in (the pooled walk-in ledger names nobody), a
 * REFUND to anyone outside Sundry Debtors (a supplier payment), and a document
 * already announced under that kind.
 */
export type NotifyResult = { status: "sent" | "already" | "skipped"; reason?: string };

export async function notifyBill(kind: WaTemplateKind, universalVoucherId: number): Promise<NotifyResult> {
    if (IS_COUNTER_PC) return { status: "skipped", reason: "counter" };
    try {
        return await notifyVoucher(kind, universalVoucherId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ${universalVoucherId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

export async function notifyRepair(kind: "REPAIR_RECEIVED" | "REPAIR_READY", ticketId: number): Promise<NotifyResult> {
    if (IS_COUNTER_PC) return { status: "skipped", reason: "counter" };
    try {
        return await notifyTicket(kind, ticketId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ticket ${ticketId} failed`, e);
        return { status: "skipped", reason: "error" };
    }
}

/** Inventory voucher type → the template that announces it. Estimates are
 *  manual only (staff press Send), so they are not in the automatic map. */
const AUTO_KIND: Record<string, WaTemplateKind> = {
    SALE: "SALE",
    POS: "SALE",
    ONLINE_INVOICE: "SALE",
    SALE_RETURN: "SALE_RETURN",
    SALES_ORDER: "ORDER",
    POS_ORDER: "ORDER",
};
export function autoKindForVoucherType(type: string): WaTemplateKind | null {
    return AUTO_KIND[type] ?? null;
}
export function isEstimateType(type: string): boolean {
    return type === "ESTIMATE" || type === "POS_ESTIMATE";
}

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

type PhoneRow = { phone: string; isPrimary: boolean; verifiedAt: Date | null };
const phonesSelect = { select: { phone: true, isPrimary: true, verifiedAt: true } } as const;
const partySelect = {
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
            device: "",
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${uvId}`,
            app: WA_APP_LINK,
        },
        push: { title: `${WA_TEMPLATE_LABEL[kind]} ${docNo}`, body: `Rs ${amountText} · ${dateText} · tap to view` },
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

type WaOutcome = { status: string; messageId?: string; error?: string };

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
