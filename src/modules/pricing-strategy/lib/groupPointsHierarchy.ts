// Pure helper — no prisma import — so it's safe to use from both the server
// pricing engine (additiveMargin.ts) and the client-side strategies preview.
//
// Group points CASCADE: a product's group contribution is its own group's
// points PLUS every ancestor group's points, walking up the InvProductGroup
// parent chain. This is the one place that walk happens — keep server and
// client in sync by importing this instead of re-deriving it.

/** Sum `ownPoints[groupId]` plus every ancestor's points, via `parentById`. */
export function sumGroupPointsWithAncestors(
    groupId: number,
    ownPoints: Record<string, number>,
    parentById: Record<string, number | null | undefined>,
): number {
    let total = 0;
    let cur: number | null = groupId;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
        seen.add(cur);
        total += ownPoints[String(cur)] ?? 0;
        cur = parentById[String(cur)] ?? null;
    }
    return total;
}
