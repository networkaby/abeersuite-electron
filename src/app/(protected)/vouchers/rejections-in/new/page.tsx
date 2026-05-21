import { TradingVoucherPage } from "@/modules/accountancy/components/TradingVoucherPage";

// Rejection In — customer returns goods; stock increments. Parent-link picker
// offers any POSTED Challan (Sale) so lines can be carried over.
// `dynamic` — see /vouchers/challans/new/page.tsx for rationale.
export const dynamic = "force-dynamic";

export default function Page() {
    return <TradingVoucherPage kind="REJECTION_IN" />;
}
