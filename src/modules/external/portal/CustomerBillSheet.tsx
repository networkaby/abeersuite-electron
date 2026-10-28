import { notFound } from "next/navigation";
import InvoiceReceipt from "@/shared/components/print/InvoiceReceipt";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { buildVoucherReceiptSample } from "@/modules/accountancy/lib/voucherReceiptSample";

/**
 * A customer's bill (VoucherDetail id) on A4, printed the way the Day Book
 * prints it (receiptHref): a counter POS sale or an online invoice through the
 * invoice body, every other kind — Sale, Return, Order, Estimate — through the
 * template-driven voucher renderer with its own template. The caller checks
 * ownership first (ownedBill). Always the bare sheet: the app screen and the
 * portal viewer (PortalDocViewer) frame it — never the staff print bar.
 */
export default async function CustomerBillSheet({ detailId, kind }: { detailId: number; kind: string }) {
    if (kind === "POS" || kind === "ONLINE_INVOICE") {
        return <InvoiceReceipt id={String(detailId)} kindParam={kind} paper="A4" autoprint="0" embed />;
    }
    const data = await buildVoucherReceiptSample("inv", detailId);
    if (!data) notFound();
    const template = await getVoucherTemplate(data.kind);
    return (
        <ReceiptPreview
            format="A4"
            template={template}
            sample={data.sample}
            previewMode
            previewFill
            docTitle={data.docTitle}
        />
    );
}
