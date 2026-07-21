import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { canonicalStateName } from "@/modules/delivery/lib/deliveryMethodConfig";

// Public storefront helper: resolve a 6-digit pincode to { city, state,
// localities } via India Post's free pincode API (no key). Proxied server-side so
// there's no browser CORS dependency, one canonicalisation point for the state
// name (so it matches our zone-matching state list), and day-long caching since
// pincode → city/state never changes. Returns { ok:false } when unknown — the
// checkout then just leaves the fields for manual entry.

type IndiaPostResponse = Array<{
    Status?: string;
    PostOffice?: Array<{ Name?: string; District?: string; State?: string }> | null;
}>;

export async function GET(_req: Request, ctx: { params: Promise<{ pincode: string }> }) {
    const { pincode } = await ctx.params;
    if (!/^\d{6}$/u.test(pincode)) {
        return NextResponse.json({ ok: false, error: "Invalid pincode" }, { status: 400 });
    }
    try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
            // Cache a day — pincode geography is static; keeps us off their API.
            next: { revalidate: 86400 },
        });
        const json = (await res.json().catch(() => null)) as IndiaPostResponse | null;
        const entry = Array.isArray(json) ? json[0] : null;
        const offices = entry?.PostOffice;
        if (!entry || entry.Status !== "Success" || !Array.isArray(offices) || offices.length === 0) {
            return NextResponse.json({ ok: false });
        }
        const first = offices[0];
        // District is the "city"; canonicalise the state to our list (falls back
        // to the raw name if it somehow doesn't match).
        const state = canonicalStateName(first.State) ?? first.State ?? "";
        const city = first.District ?? "";
        // Distinct post-office / area names within the pincode — handy for a
        // locality picker (e.g. the local delivery boy's serviceable areas).
        const localities = [...new Set(offices.map((o) => o.Name).filter((n): n is string => !!n))];
        return NextResponse.json({ ok: true, city, state, localities });
    } catch (e) {
        return handleApiError(e, "Pincode lookup failed");
    }
}
