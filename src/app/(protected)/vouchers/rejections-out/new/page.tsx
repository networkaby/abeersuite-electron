import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Rejection Out — we return goods to supplier; stock decrements. Parent-link
// picker offers any POSTED GRN (Purchase) so lines can be carried over.
// `dynamic` — see /vouchers/challans/new/page.tsx for rationale.
export const dynamic = "force-dynamic";

export default function Page() {
    return <SaleVoucherPage kind="REJECTION_OUT" />;
}
