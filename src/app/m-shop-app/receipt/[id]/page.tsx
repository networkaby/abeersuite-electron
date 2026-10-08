import { notFound } from "next/navigation";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import AppDocFit from "@/modules/external/shopApp/AppDocFit";
import AppShareLink from "@/modules/external/shopApp/AppShareLink";
import { ownsReceipt } from "@/modules/external/portal/portalDocAccess";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { buildVoucherReceiptSample } from "@/modules/accountancy/lib/voucherReceiptSample";

/** One receipt or refund slip, the customer's own only — the same A4 slip the portal shows. */
export default async function CustomerAppReceiptPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const customerId = await requireAppCustomer(`${APP}/receipt/${id}`);
    const uvId = Number(id);
    if (!Number.isInteger(uvId) || !(await ownsReceipt(customerId, uvId))) notFound();
    const data = await buildVoucherReceiptSample("gl", uvId);
    if (!data) notFound();
    const template = await getVoucherTemplate(data.kind);
    return (
        <>
            <MobileHeader title={data.docTitle ?? "Receipt"} back={`${APP}/bills`} actions={<AppShareLink path={`/portal/receipts/${uvId}`} title="Receipt" />} />
            <AppDocFit>
                <ReceiptPreview format="A4" template={template} sample={data.sample} previewMode previewFill />
            </AppDocFit>
        </>
    );
}
