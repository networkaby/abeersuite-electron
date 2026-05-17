import { MoneyFlowVoucherPage } from "@/modules/accountancy/components/preview/MoneyFlowVoucherPage";

// Edit-mode entry for a Credit Note — prefills the form from the existing
// voucher and PATCHes on save (in-place reversal + re-apply for POSTED).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <MoneyFlowVoucherPage kind="CREDIT_NOTE" voucherId={Number(id)} />;
}
