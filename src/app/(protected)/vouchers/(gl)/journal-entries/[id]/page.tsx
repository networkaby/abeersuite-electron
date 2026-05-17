import { JournalVoucherPage } from "@/modules/accountancy/components/preview/JournalVoucherPage";

// Edit-mode entry for a Journal Voucher — prefills the form from the existing
// JE and PATCHes on save (in-place reversal + re-apply for POSTED).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <JournalVoucherPage voucherId={Number(id)} />;
}
