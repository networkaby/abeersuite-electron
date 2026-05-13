import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Rejection In — customer returns goods; stock increments. Parent-link picker
// offers any POSTED Challan (Sale) so lines can be carried over.
export default function Page() {
    return <SaleVoucherPage kind="REJECTION_IN" />;
}
