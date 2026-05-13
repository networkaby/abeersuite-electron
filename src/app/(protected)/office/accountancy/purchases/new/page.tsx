import { redirect } from "next/navigation";

// Legacy route that used to open the PurchaseDialog. Purchase is now a
// full-page route at /purchase — bounce there for any stale links / bookmarks.
export default function NewPurchaseRedirect() {
    redirect("/vouchers/purchase");
}
