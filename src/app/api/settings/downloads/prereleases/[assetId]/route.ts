import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

/**
 * Hands over one installer from the test release repo.
 *
 * The repo is private, so a plain `<a href>` to GitHub would 404 in the browser — the
 * download has to be authorised, and the token that authorises it must not leave the
 * server. GitHub answers an asset request with a redirect to a short-lived signed URL,
 * so this route asks for that redirect and passes the signed URL on. The file itself
 * never travels through this server, and the token never reaches the browser.
 *
 * See ../route.ts for why this uses its own read-only credentials.
 */
const REPO = process.env.GITHUB_TEST_DOWNLOAD_REPO;
const TOKEN = process.env.GITHUB_TEST_DOWNLOAD_PAT_TOKEN;

// GET /api/settings/downloads/prereleases/<assetId>
export async function GET(_req: Request, ctx: { params: Promise<{ assetId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    if (!REPO || !TOKEN) {
        return NextResponse.json({ error: "Test downloads are not configured on this server." }, { status: 404 });
    }

    const { assetId } = await ctx.params;
    // Digits only. This value is concatenated into a URL that carries our token, so a
    // path or a query fragment smuggled in here would aim that request somewhere else.
    if (!/^\d+$/.test(assetId)) {
        return NextResponse.json({ error: "Bad asset id." }, { status: 400 });
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${assetId}`, {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: "application/octet-stream",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            redirect: "manual",   // We want the signed URL, not the bytes.
            cache: "no-store",
        });

        const signed = res.headers.get("location");
        if (signed) return NextResponse.redirect(signed, 302);

        // No redirect means GitHub refused — a wrong id, or a token that lost its access.
        return NextResponse.json(
            { error: `GitHub did not hand over that file (${res.status}).` },
            { status: res.status === 404 ? 404 : 502 },
        );
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
}
