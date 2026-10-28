import { NextResponse } from "next/server";
import { FacebookError, listFacebookPages } from "@/modules/campaigns/lib/facebookPage";
import { handleApiError } from "@/shared/lib/api";
import { requireFacebookConnect } from "@/modules/campaigns/lib/campaignAccess";

/** GET /api/campaigns/facebook/pages — the pages the connected Facebook account manages. */
export async function GET() {
    const { response } = await requireFacebookConnect();
    if (response) return response;
    try {
        return NextResponse.json({ pages: await listFacebookPages() });
    } catch (e) {
        if (e instanceof FacebookError) return NextResponse.json({ error: e.message }, { status: 502 });
        return handleApiError(e, "Failed to read the Facebook pages");
    }
}
