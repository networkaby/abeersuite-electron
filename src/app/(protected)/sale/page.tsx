import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Fresh full-page Sale Voucher (reference-matching layout, no Dialog).
// Mounted at /sale. Posts via the same POST /api/inventory/vouchers
// endpoint as the dialog flows — schema/back-end is shared.
export default function Page() {
    return <SaleVoucherPage />;
}
