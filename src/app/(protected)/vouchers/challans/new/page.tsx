import { TradingVoucherPage } from "@/modules/accountancy/components/TradingVoucherPage";

// Delivery Challan — decrements stock; no GL post (Sale invoice posts).
// Parent-link picker offers any POSTED Sales Order to copy lines from.
// `showPrices` toggle persists on the voucher for the print job.
//
// Dynamic: TradingVoucherPage calls useSearchParams(); without this export
// the build prerenders and bails out (the inner <Suspense> doesn't help
// at SSG time because there's no parent layout forcing dynamic rendering,
// unlike the (gl) route group which does `await auth()` in its layout).
export const dynamic = "force-dynamic";

export default function Page() {
    return <TradingVoucherPage kind="CHALLAN" />;
}
