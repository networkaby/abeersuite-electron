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
export default async function PortalInvoicePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect("/login?callbackUrl=/portal/orders");
    }

    const { id } = await params;
    const detailId = Number(id);
    if (!Number.isFinite(detailId)) notFound();

    const voucherRow = await prisma.voucherDetail.findUnique({
        where:  { id: detailId },
        select: { universalVoucher: { select: { partyAccountId: true } } },
    });
    const partyAccountId = voucherRow?.universalVoucher?.partyAccountId;
    if (partyAccountId == null) notFound();

    const accountOptions = await getPortalAccountOptions(customerId);
    const owns = accountOptions.some((o) => o.accountId === partyAccountId);
    if (!owns) notFound();

    return (
        <InvoiceReceipt
            id={id}
            kindParam="ONLINE_INVOICE"
            paper="A4"
            autoprint="0"
        />
    );
}
