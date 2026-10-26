import { redirect } from "next/navigation";

// Shop ads moved to Campaigns → Shop Ads (2026-10-26); old bookmarks land there.
export default function EcommerceAdsMovedPage() {
    redirect("/office/campaigns/ads");
}
