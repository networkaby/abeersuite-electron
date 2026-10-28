import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { ownedBill } from "@/modules/external/portal/portalDocAccess";
import CustomerBillSheet from "@/modules/external/portal/CustomerBillSheet";
import PortalDocViewer from "@/modules/external/portal/PortalDocViewer";

// Customer-facing bill download — replaces the old direct link to
// `/receipt/invoice/[id]` (a staff print surface that was unauthenticated
// and let anyone walk the sales book by incrementing the id). This route is
// portal-session-scoped: `id` is a `VoucherDetail.id`, and the signed-in
// customer must own the account the voucher was billed to (their personal
// account, or any company account linked to them — the same set
// `/portal/orders` uses to list their orders) before it renders.
//
// A4, printed as its own kind the way the Day Book prints it (CustomerBillSheet),
// framed like the app's bill screen (PortalDocViewer) — no staff print bar.
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

    // Ownership rule: portalDocAccess.ts (shared with the customer app).
    const bill = await ownedBill(customerId, detailId);
    if (!bill) notFound();

    return (
        <PortalDocViewer title={`Bill ${bill.reference}`} fileBase={`Bill ${bill.reference}`} kindLabel="Bill">
            <CustomerBillSheet detailId={detailId} kind={bill.kind} />
        </PortalDocViewer>
    );
}
