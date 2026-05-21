import { TradingVoucherPage } from "@/modules/accountancy/components/TradingVoucherPage";

// Full-screen Sales Order form — same shell as /sale and /purchase. Stock-
// neutral commitment; converts to a Sale invoice / Challan downstream.
// `dynamic` — see /vouchers/challans/new/page.tsx for rationale.
export const dynamic = "force-dynamic";

export default function Page() {
    return <TradingVoucherPage kind="SALES_ORDER" />;
}
