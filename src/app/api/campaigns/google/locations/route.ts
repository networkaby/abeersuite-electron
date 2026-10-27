import { NextResponse } from "next/server";
import { GoogleError, listGoogleLocations } from "@/modules/campaigns/lib/googleBusiness";
import { handleApiError } from "@/shared/lib/api";
import { requireGoogleConnect } from "@/modules/campaigns/lib/campaignAccess";

/** GET /api/campaigns/google/locations — the listings the connected Google account manages. */
export async function GET() {
    const { response } = await requireGoogleConnect();
    if (response) return response;
    try {
        return NextResponse.json({ locations: await listGoogleLocations() });
    } catch (e) {
        if (e instanceof GoogleError) return NextResponse.json({ error: e.message }, { status: 502 });
        return handleApiError(e, "Failed to read the Google listings");
    }
}
