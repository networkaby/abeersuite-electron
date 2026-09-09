import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

/**
 * Test builds waiting in the test release repo.
 *
 * Releases are published to two repos (scripts/release-electron.ts): repo 1 is what the
 * counters actually update from, and repo 2 is the test channel a `-pre` version goes to
 * alone. A test build therefore never reaches a till by itself — which is the point, and
 * also the reason this endpoint exists: the only way onto a test build is to fetch it by
 * hand, and until now that meant opening GitHub.
 *
 * Both repos are private, so the browser cannot read either. The token stays here and
 * the page only ever sees names, dates and asset ids.
 *
 * Read-only credentials of its own, deliberately NOT the `GH_TOKEN_2` the publisher uses
 * — that one can create releases, and nothing behind a page needs to. This pair mirrors
 * `GITHUB_DOWNLOAD_UPDATE_REPO` / `GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN`, which does the same
 * job for the counters' own update feed.
 */
const REPO = process.env.GITHUB_TEST_DOWNLOAD_REPO;
const TOKEN = process.env.GITHUB_TEST_DOWNLOAD_PAT_TOKEN;

export interface PrereleaseAsset {
    id: number;
    name: string;
    size: number;
}

export interface PrereleaseInfo {
    tag: string;
    name: string;
    publishedAt: string | null;
    notes: string;
    prerelease: boolean;
    assets: PrereleaseAsset[];
}

// GET /api/settings/downloads/prereleases
// Newest first. An unconfigured repo answers 200 with `configured: false` rather than an
// error — the Downloads page then simply says so instead of showing a broken section.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    if (!REPO || !TOKEN) {
        return NextResponse.json({ configured: false, releases: [] as PrereleaseInfo[] });
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            // These change only when someone publishes, and the page is opened rarely.
            // A minute of cache keeps a reload off GitHub's rate limit.
            next: { revalidate: 60 },
        });
        if (!res.ok) {
            return NextResponse.json(
                { configured: true, error: `GitHub answered ${res.status}.`, releases: [] },
                { status: 502 },
            );
        }

        const raw = (await res.json()) as Array<{
            tag_name: string;
            name: string | null;
            published_at: string | null;
            body: string | null;
            prerelease: boolean;
            draft: boolean;
            assets: Array<{ id: number; name: string; size: number }>;
        }>;

        const releases: PrereleaseInfo[] = raw
            // A draft is not installable by anyone, so it has no business on this page.
            .filter((r) => !r.draft)
            .map((r) => ({
                tag: r.tag_name,
                name: r.name || r.tag_name,
                publishedAt: r.published_at,
                notes: r.body || "",
                prerelease: r.prerelease,
                // Only the installer is offered. The blockmap and latest.yml in the same
                // release are for the updater to read, and handing a cashier a latest.yml
                // to "install" is a support call waiting to happen.
                assets: r.assets.filter((a) => a.name.toLowerCase().endsWith(".exe")),
            }));

        return NextResponse.json({ configured: true, releases });
    } catch (e) {
        return NextResponse.json(
            { configured: true, error: (e as Error).message, releases: [] },
            { status: 502 },
        );
    }
}
