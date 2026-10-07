import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { sendPushToPerson } from "@/shared/lib/push/sendPush";
import { WA_APP_LINK, WA_BILL_LINK_BASE, WA_TEMPLATE_LABEL, type WaFieldValues, type WaTemplateKind } from "./billTemplates";
import { getApprovedWaTemplate } from "./waTemplateStore";
import { isBillSendConfigured, sendBillTemplate } from "./metaTemplates";

/**
 * Tell the customer about a saved bill or receipt — app notification AND
 * WhatsApp, both, every time (owner, 2026-10-06: watch the app's "shown" rate
 * before ever skipping the WhatsApp). One BillNotification row records both
 * outcomes for the office badge and that later decision.
 *
 * Call it inside `after()` — it never throws and never slows the save:
 *     after(() => notifyBill("SALE", universalVoucherId));
 *
 * Skipped without a row: a counter PC (no Meta / push keys there — the
 * relayed sale runs on the office server and is announced from there), a
 * draft, a walk-in (the pooled walk-in ledger names nobody), and a voucher
 * already announced (unique refId makes a second call a no-op).
 */
export async function notifyBill(kind: WaTemplateKind, universalVoucherId: number): Promise<void> {
    if (IS_COUNTER_PC) return;
    try {
        await notify(kind, universalVoucherId);
    } catch (e) {
        console.error(`[notify-bill] ${kind} ${universalVoucherId} failed`, e);
    }
}

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function notify(kind: WaTemplateKind, uvId: number) {
    const uv = await prisma.universalVoucher.findUnique({
        where: { id: uvId },
        select: { voucherNo: true, date: true, status: true, partyAccountId: true },
    });
    if (!uv || uv.status !== "POSTED" || uv.partyAccountId == null) return;

    const [account, partyLines] = await Promise.all([
        prisma.account.findUnique({
            where: { id: uv.partyAccountId },
            select: {
                personId: true,
                companyId: true,
                person: { select: { name: true, phones: { select: { phone: true, isPrimary: true, verifiedAt: true } } } },
                company: { select: { name: true, phones: { select: { phone: true, isPrimary: true, verifiedAt: true } } } },
            },
        }),
        prisma.voucherGlLine.findMany({
            where: { universalVoucherId: uvId, accountId: uv.partyAccountId, type: kind === "SALE" ? "DEBIT" : "CREDIT" },
            select: { amount: true },
        }),
    ]);
    const party = account?.person ?? account?.company;
    if (!account || !party) return; // walk-in ledger

    // Claim the voucher first — a retried request or a second save path for
    // the same voucher stops here instead of messaging the customer twice.
    try {
        await prisma.billNotification.create({
            data: { kind, refId: uvId, personId: account.personId, pushStatus: "pending", waStatus: "pending" },
        });
    } catch {
        return; // already announced
    }

    const mobile = pickMobile(party.phones);
    const amount = partyLines.reduce((s, l) => s + Number(l.amount), 0);
    const values: WaFieldValues = {
        customer: party.name,
        billNo: uv.voucherNo ?? `#${uvId}`,
        amount: money.format(amount),
        date: day.format(uv.date),
        shop: getOrganisation().brandName,
        link: `${WA_BILL_LINK_BASE}${uvId}`,
        app: WA_APP_LINK,
    };

    const [push, wa] = await Promise.all([
        account.personId != null
            ? sendPushToPerson(account.personId, {
                title: `${WA_TEMPLATE_LABEL[kind]} ${values.billNo}`,
                body: `Rs ${values.amount} · ${values.date} · tap to view`,
                url: `/portal/b/${uvId}`,
                tag: `bill-${uvId}`,
                refType: "voucher",
                refId: String(uvId),
            })
            : Promise.resolve({ status: "no-person" as const, messageId: null }),
        sendWhatsApp(kind, uvId, mobile, values),
    ]);

    await prisma.billNotification.update({
        where: { refId: uvId },
        data: {
            mobile,
            pushStatus: push.status,
            pushMessageId: push.messageId,
            waStatus: wa.status,
            waMessageId: wa.messageId ?? null,
            waError: wa.error ?? null,
        },
    });
}

type WaOutcome = { status: string; messageId?: string; error?: string };

async function sendWhatsApp(kind: WaTemplateKind, uvId: number, mobile: string | null, values: WaFieldValues): Promise<WaOutcome> {
    if (!mobile) return { status: "no-mobile" };
    const tpl = await getApprovedWaTemplate(kind);
    if (!tpl) return { status: "disabled" };
    if (!isBillSendConfigured()) return { status: "not-configured" };
    try {
        const messageId = await sendBillTemplate({ mobile10: mobile, name: tpl.name, approved: tpl.draft, values, refId: uvId });
        return { status: "sent", messageId };
    } catch (e) {
        return { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
}

/** Primary verified mobile first, then any verified, then any — 10-digit Indian only. */
function pickMobile(phones: { phone: string; isPrimary: boolean; verifiedAt: Date | null }[]): string | null {
    const ranked = [...phones].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(!!b.verifiedAt) - Number(!!a.verifiedAt),
    );
    for (const p of ranked) {
        const m = normalizeMobile10(p.phone);
        if (m) return m;
    }
    return null;
}

/** Inventory voucher kinds that are a sale to the customer — the ones a
 *  posted office invoice announces with the SALE template. */
const SALE_TYPES = new Set(["SALE", "POS", "ONLINE_INVOICE"]);
export function isCustomerSaleType(type: string): boolean {
    return SALE_TYPES.has(type);
}
