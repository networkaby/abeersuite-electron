import { NextResponse } from "next/server";
import { ensureFeeds, feedFileLink } from "@/modules/campaigns/lib/productFeed";

// GET /feeds/meta.csv — the shop's catalogue for the Meta catalog (Facebook,
// Instagram, WhatsApp). Public (a path with a file extension skips proxy.ts). At
// most one rebuild a business day, only when the products changed
// (productFeed.ts); then a redirect to the stored file.
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await ensureFeeds();
        return NextResponse.redirect(feedFileLink("meta"), { status: 302, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        console.error("[feed] meta", e);
        return NextResponse.json({ error: "The product feed is not available right now." }, { status: 503 });
    }
}
