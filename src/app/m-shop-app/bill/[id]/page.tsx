import { notFound } from "next/navigation";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import CustomerBillSheet from "@/modules/external/portal/CustomerBillSheet";
import AppDocFit from "@/modules/external/shopApp/AppDocFit";
import AppDocActions from "@/modules/external/shopApp/AppDocActions";
import { ownedBill } from "@/modules/external/portal/portalDocAccess";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";

/** One bill (VoucherDetail id), the customer's own only — the same A4 bill the portal and the Day Book show. */
export default async function CustomerAppBillPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const customerId = await requireAppCustomer(`${APP}/bill/${id}`);
    const detailId = Number(id);
    if (!Number.isInteger(detailId)) notFound();
    const bill = await ownedBill(customerId, detailId);
    if (!bill) notFound();
    return (
        <>
            <MobileHeader title="Bill" back={`${APP}/bills`} actions={<AppDocActions fileBase={`Bill ${bill.reference}`} title="Bill" />} />
            <AppDocFit>
                <CustomerBillSheet detailId={detailId} kind={bill.kind} />
            </AppDocFit>
        </>
    );
}

