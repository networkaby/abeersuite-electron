import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Purchase Return — we return goods to supplier. Stock OUT, GL: Dr supplier,
// Cr Purchase Returns (or refund in via cash/bank picker).
export default function Page() {
    return <SaleVoucherPage kind="PURCHASE_RETURN" />;
}
