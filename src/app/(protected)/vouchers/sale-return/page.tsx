import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Sale Return — customer returns goods. Stock IN, GL: Dr Sales Returns,
// Cr customer (or refund out via cash/bank picker).
export default function Page() {
    return <SaleVoucherPage kind="SALE_RETURN" />;
}
