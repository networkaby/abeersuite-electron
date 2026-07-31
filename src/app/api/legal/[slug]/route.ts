import { NextResponse } from "next/server";
import { LEGAL_DOCS } from "@/shared/lib/legal/legalContent";
import { LEGAL_SLUGS, type LegalSlug } from "@/shared/lib/legal/legalPaths";

/**
 * The policy documents, as data.
 *
 * The company site and the store are one business on two deployments, and the
 * policies must be identical on both — so this app owns the prose
 * (`legalContent.ts`) and the company site renders it in its own design rather
 * than keeping a second copy that silently drifts.
 *
 * Deliberately anonymous: Razorpay activation and Google OAuth verification
 * fetch the policies without signing in, and so does the company site's build.
 * The proxy matcher already skips `/api`, so nothing gates this.
 */

// Policies change when someone edits the constant and redeploys, so let the
// CDN hold them for an hour and serve stale while it refreshes.
const CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

function corsHeaders(): Record<string, string> {
    return {
        // The prose is public on both hostnames anyway — there is nothing here
        // that a wildcard could leak.
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": CACHE,
    };
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params;

    if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) {
        return NextResponse.json(
            { error: "No such policy document.", available: LEGAL_SLUGS },
            { status: 404 },
        );
    }

    const doc = LEGAL_DOCS.find((d) => d.slug === (slug as LegalSlug));
    if (!doc) {
        return NextResponse.json({ error: "No such policy document." }, { status: 404 });
    }

    return NextResponse.json(doc, { headers: corsHeaders() });
}
