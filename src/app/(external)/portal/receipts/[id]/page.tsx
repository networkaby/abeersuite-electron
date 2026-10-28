import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { ownsReceipt } from "@/modules/external/portal/portalDocAccess";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import PortalDocViewer from "@/modules/external/portal/PortalDocViewer";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { buildVoucherReceiptSample } from "@/modules/accountancy/lib/voucherReceiptSample";

// Customer-facing receipt or refund slip — the money twin of
// /portal/orders/[id]/bill, opened from its WhatsApp / app message
// (/portal/b/<id>). `id` is the Receipt / Payment UniversalVoucher id; the signed-in customer must own the
// account it was received on. Rendered by the same template-driven renderer as
// the staff print (/receipt/voucher/gl/<id>), always A4, no autoprint.
export default async function PortalReceiptPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect(`/login?callbackUrl=${encodeURIComponent(`/portal/receipts/${id}`)}`);
    }

    const uvId = Number(id);
    if (!Number.isInteger(uvId)) notFound();
    if (!(await ownsReceipt(customerId, uvId))) notFound();

    const data = await buildVoucherReceiptSample("gl", uvId);
    if (!data) notFound();
    const template = await getVoucherTemplate(data.kind);

    return (
        <PortalDocViewer title={data.docTitle ?? "Receipt"} fileBase={data.docTitle || `Receipt ${uvId}`} kindLabel="Receipt">
            <ReceiptPreview format="A4" template={template} sample={data.sample} previewMode previewFill />
        </PortalDocViewer>
    );
}
