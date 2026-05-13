import { SaleVoucherPage } from "@/modules/accountancy/components/SaleVoucherPage";

// Delivery Challan — decrements stock; no GL post (Sale invoice posts).
// Parent-link picker offers any POSTED Sales Order to copy lines from.
// `showPrices` toggle persists on the voucher for the print job.
export default function Page() {
    return <SaleVoucherPage kind="CHALLAN" />;
}
