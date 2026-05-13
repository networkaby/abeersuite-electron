// PREVIEW MIGRATION — Estimate / Quotation (extends the rich SaleVoucherPage
// with a new TradingKind="ESTIMATE" entry). Edit mode (?voucherId=…) is
// supported via the same machinery as the trading vouchers.
import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

export default function Page() {
    return <SaleVoucherPage kind="ESTIMATE" />;
}
