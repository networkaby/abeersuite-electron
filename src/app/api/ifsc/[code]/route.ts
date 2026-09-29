import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { isValidIfsc } from "@/shared/lib/parties/partyBank";

// Resolve an 11-character IFSC to its bank and branch, so the bank-account
// forms (party Bank tab, staff salary account, bank ledger particulars) can
// fill Bank Name and Branch by themselves — see shared/hooks/useIfscLookup.ts.
//
// Asks Razorpay's free IFSC service (their mirror of RBI's list, no key). Proxied
// server-side, like /api/shop/pincode, so the answer is trimmed to what the
// forms use and cached: a branch's details almost never change, so one call per
// code a month keeps us off their service. Answers { ok:false } for a code that
// is not in the list — the form then just says so and leaves the fields alone.

type RazorpayIfsc = {
    BANK?: string;
    BRANCH?: string;
    ADDRESS?: string;
    DISTRICT?: string;
    STATE?: string;
};

const MONTH_S = 30 * 86400;

/** RBI's list is upper-case ("PANBAZAR", "TAMIL NADU"); the forms are not. Bank
 *  names already arrive mixed-case ("HDFC Bank") and are left as they are. */
const properCase = (s: string | undefined): string => {
    const v = (s ?? "").trim();
    if (v !== v.toUpperCase()) return v;
    return v.toLowerCase().replace(/(^|[\s,.\-/(])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
};

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const code = (await ctx.params).code.trim().toUpperCase();
    if (!code || !isValidIfsc(code)) {
        return NextResponse.json({ ok: false, error: "Invalid IFSC" }, { status: 400 });
    }
    try {
        const res = await fetch(`https://ifsc.razorpay.com/${code}`, {
            next: { revalidate: MONTH_S },
            // A hung lookup must not hold the form's hint on "Looking up…" forever.
            signal: AbortSignal.timeout(8000),
        });
        // The browser keeps its own copy for a day, so reopening the same party
        // never reaches the server at all.
        const headers = { "Cache-Control": "private, max-age=86400" };
        if (res.status === 404) return NextResponse.json({ ok: false }, { headers });
        if (!res.ok) throw new Error(`IFSC lookup answered ${res.status}`);

        const j = (await res.json()) as RazorpayIfsc;
        return NextResponse.json({
            ok: true,
            bank: (j.BANK ?? "").trim(),
            branch: properCase(j.BRANCH),
            address: (j.ADDRESS ?? "").trim(),
            district: properCase(j.DISTRICT),
            state: properCase(j.STATE),
        }, { headers });
    } catch (e) {
        return handleApiError(e, "IFSC lookup failed");
    }
}
