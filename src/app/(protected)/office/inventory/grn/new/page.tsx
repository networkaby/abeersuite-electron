import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Goods Received Note — increments stock, no GL post (Purchase invoice posts).
// Parent-link picker offers any POSTED Purchase Order to copy lines from.
export default function Page() {
    return <SaleVoucherPage kind="GRN" />;
}
