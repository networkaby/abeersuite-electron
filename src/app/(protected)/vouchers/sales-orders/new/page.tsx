import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Full-screen Sales Order form — same shell as /sale and /purchase. Stock-
// neutral commitment; converts to a Sale invoice / Challan downstream.
export default function Page() {
    return <SaleVoucherPage kind="SALES_ORDER" />;
}
