import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { getPortalAccountOptions } from "@/shared/lib/auth/portalAccountContext";

// Which customer documents a signed-in customer may open — one copy for the
// portal's bill / receipt pages and the customer app's.

// A sale prints as the customer's online invoice; a return, order or estimate
// (reached from its WhatsApp / app message) prints with its own template.
const OWN_TEMPLATE = new Set(["SALE_RETURN", "SALES_ORDER", "POS_ORDER", "ESTIMATE", "POS_ESTIMATE"]);
function customerPrintKind(type: string | undefined): string {
    return type && OWN_TEMPLATE.has(type) ? type : "ONLINE_INVOICE";
}

/**
 * A bill (VoucherDetail id) the customer owns, with the print kind it opens in —
 * or null. Owned when the bill is on one of the customer's ledgers, or — a cash
 * bill at the counter that never touched a ledger — when it names the person or
 * one of their companies as the party (the same rule My Bills lists by).
 */
export async function ownedBillPrintKind(customerId: number, detailId: number): Promise<string | null> {
    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: detailId },
        select: {
            partyType: true,
            partyId: true,
            universalVoucher: { select: { partyAccountId: true, type: true } },
        },
    });
    if (!voucherRow) return null;
    const accountOptions = await getPortalAccountOptions(customerId);
    const partyAccountId = voucherRow.universalVoucher?.partyAccountId;
    const owns = accountOptions.some(
        (o) =>
            (partyAccountId != null && o.accountId === partyAccountId) ||
            (o.accountType === "personal" && voucherRow.partyType === "customer" && voucherRow.partyId === customerId) ||
            (o.companyId != null && voucherRow.partyType === "company" && voucherRow.partyId === o.companyId)
    );
    return owns ? customerPrintKind(voucherRow.universalVoucher?.type) : null;
}

/** A posted receipt / refund (UniversalVoucher id) received on one of the customer's ledgers. */
export async function ownsReceipt(customerId: number, uvId: number): Promise<boolean> {
    const uv = await prisma.universalVoucher.findUnique({
        where: { id: uvId },
        select: { type: true, status: true, partyAccountId: true },
    });
    if (!uv || (uv.type !== "RECEIPT" && uv.type !== "PAYMENT") || uv.status !== "POSTED" || uv.partyAccountId == null) return false;
    const accountOptions = await getPortalAccountOptions(customerId);
    return accountOptions.some((o) => o.accountId === uv.partyAccountId);
}

export type CustomerLink =
    | { to: "repairs" }
    | { to: "due" }
    | { to: "bill"; detailId: number }
    | { to: "receipt"; uvId: number }
    | { to: "orders" };

/**
 * What a customer message's short code points at (/portal/b/<code>):
 *   <uvId>     a voucher — a bill when it has a VoucherDetail (sale, return,
 *              order, estimate), else a receipt / refund
 *   t<ticket>  a repair
 *   due        a due reminder: the outstanding list with its UPI pay button
 * The pages it leads to check ownership, so resolving it reveals nothing.
 */
export async function resolveCustomerLink(code: string): Promise<CustomerLink> {
    if (/^t\d+$/.test(code)) return { to: "repairs" };
    if (code === "due") return { to: "due" };
    const id = Number(code);
    if (!Number.isInteger(id) || id <= 0) return { to: "orders" };
    const uv = await prisma.universalVoucher.findUnique({
        where: { id },
        select: { voucherDetail: { select: { id: true } } },
    });
    if (!uv) return { to: "orders" };
    return uv.voucherDetail ? { to: "bill", detailId: uv.voucherDetail.id } : { to: "receipt", uvId: id };
}
