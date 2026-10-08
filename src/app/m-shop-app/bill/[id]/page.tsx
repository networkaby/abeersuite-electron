import { notFound } from "next/navigation";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import InvoiceReceipt from "@/shared/components/print/InvoiceReceipt";
import AppDocFit from "@/modules/external/shopApp/AppDocFit";
import AppShareLink from "@/modules/external/shopApp/AppShareLink";
import { ownedBillPrintKind } from "@/modules/external/portal/portalDocAccess";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";

/** One bill (VoucherDetail id), the customer's own only — the same A4 invoice the portal shows. */
export default async function CustomerAppBillPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const customerId = await requireAppCustomer(`${APP}/bill/${id}`);
    const detailId = Number(id);
    if (!Number.isInteger(detailId)) notFound();
    const printKind = await ownedBillPrintKind(customerId, detailId);
    if (!printKind) notFound();
    return (
        <>
            <MobileHeader title="Bill" back={`${APP}/bills`} actions={<AppShareLink path={`/portal/orders/${detailId}/bill`} title="Bill" />} />
            <AppDocFit>
                <InvoiceReceipt id={id} kindParam={printKind} paper="A4" autoprint="0" embed />
            </AppDocFit>
        </>
    );
}
