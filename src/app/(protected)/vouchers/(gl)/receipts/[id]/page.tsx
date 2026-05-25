import { GlVoucherPage } from "@/modules/accountancy/components/GlVoucherPage";

// Edit-mode entry for a Receipt voucher — prefills the form from the existing
// voucher and PATCHes on save (in-place reversal + re-apply for POSTED).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <GlVoucherPage kind="RECEIPT" voucherId={Number(id)} />;
}
