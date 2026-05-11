import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Purchase Invoice — full-page route using the shared TradingVoucherPage
// (exported as SaleVoucherPage) parameterized by kind.
export default function Page() {
    return <SaleVoucherPage kind="PURCHASE" />;
}
