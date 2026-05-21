import { TradingVoucherPage } from "@/modules/accountancy/components/TradingVoucherPage";

// Goods Received Note — increments stock, no GL post (Purchase invoice posts).
// Parent-link picker offers any POSTED Purchase Order to copy lines from.
// `dynamic` — see /vouchers/challans/new/page.tsx for rationale.
export const dynamic = "force-dynamic";

export default function Page() {
    return <TradingVoucherPage kind="GRN" />;
}
