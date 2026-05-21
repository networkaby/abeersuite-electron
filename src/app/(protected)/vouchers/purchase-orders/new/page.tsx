import { TradingVoucherPage } from "@/modules/accountancy/components/TradingVoucherPage";

// Full-screen Purchase Order form — stock-neutral commitment; converts to a
// GRN on receipt and ultimately a Purchase invoice.
// `dynamic` — see /vouchers/challans/new/page.tsx for rationale.
export const dynamic = "force-dynamic";

export default function Page() {
    return <TradingVoucherPage kind="PURCHASE_ORDER" />;
}
