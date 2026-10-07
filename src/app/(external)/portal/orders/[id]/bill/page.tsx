import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { getPortalAccountOptions } from "@/shared/lib/auth/portalAccountContext";
import InvoiceReceipt from "@/shared/components/print/InvoiceReceipt";

// Customer-facing bill download — replaces the old direct link to
// `/receipt/invoice/[id]` (a staff print surface that was unauthenticated
// and let anyone walk the sales book by incrementing the id). This route is
// portal-session-scoped: `id` is a `VoucherDetail.id`, and the signed-in
// customer must own the account the voucher was billed to (their personal
// account, or any company account linked to them — the same set
// `/portal/orders` uses to list their orders) before it renders.
//
// Always the customer's own online invoice: A4, ONLINE_INVOICE kind, no
// thermal/autoprint controls — those are staff-only knobs on
// `/receipt/invoice/[id]`, which this page does not expose.
// A sale prints as the customer's online invoice; a return, order or estimate
// (reached from its WhatsApp / app message) prints with its own template.
const OWN_TEMPLATE = new Set(["SALE_RETURN", "SALES_ORDER", "POS_ORDER", "ESTIMATE", "POS_ESTIMATE"]);
function customerPrintKind(type: string | undefined): string {
    return type && OWN_TEMPLATE.has(type) ? type : "ONLINE_INVOICE";
}

export default async function PortalInvoicePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect(`/login?callbackUrl=${encodeURIComponent(`/portal/orders/${id}/bill`)}`);
    }

    const detailId = Number(id);
    if (!Number.isFinite(detailId)) notFound();

    const voucherRow = await prisma.voucherDetail.findUnique({
        where:  { id: detailId },
        select: {
            partyType: true,
            partyId: true,
            universalVoucher: { select: { partyAccountId: true, type: true } },
        },
    });
    if (!voucherRow) notFound();

    // Owned when the bill is on one of the customer's ledgers, or — a cash bill
    // at the counter that never touched a ledger — when it names the person or
    // one of their companies as the party (the same rule My Bills lists by).
    const accountOptions = await getPortalAccountOptions(customerId);
    const partyAccountId = voucherRow.universalVoucher?.partyAccountId;
    const owns = accountOptions.some((o) =>
        (partyAccountId != null && o.accountId === partyAccountId)
        || (o.accountType === "personal" && voucherRow.partyType === "customer" && voucherRow.partyId === customerId)
        || (o.companyId != null && voucherRow.partyType === "company" && voucherRow.partyId === o.companyId));
    if (!owns) notFound();

    return (
        <InvoiceReceipt
            id={id}
            kindParam={customerPrintKind(voucherRow?.universalVoucher?.type)}
            paper="A4"
            autoprint="0"
        />
    );
}
