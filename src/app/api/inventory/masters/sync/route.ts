import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { parseSince } from "@/shared/lib/prisma/counterMode";

/**
 * GET /api/inventory/masters/sync[?since=<iso>]
 *
 * The four inventory lookup tables — brands, categories, product groups, units —
 * in ONE round trip, full or delta.
 *
 * These are the tables every voucher form, product dialog and picker fills its
 * dropdowns from: read on almost every page, changed a few times a year. Before
 * this they were four separate unconditional GETs per surface, re-sending the
 * whole list each time to discover nothing had moved. Now the browser holds them
 * (see `masterCatalog.ts`) and asks only what changed since it last looked, so
 * the everyday answer is four empty arrays.
 *
 * Deletes are physical here — a removed brand leaves no trace a timestamp could
 * match — so each table also reports its live `count`. A client whose merged
 * table disagrees knows it has silently diverged and refetches that table whole.
 * That is the same guard the product catalogue uses, and it is why `count` is
 * sent even on a delta.
 *
 * Response is always an envelope, never a bare array:
 *   { mode, computedAt, tables: { brands: {...}, … }, counts: { brands: n, … } }
 */

/** Past this a delta stops being cheaper than starting over. */
const MAX_DELTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MasterTable = "brands" | "categories" | "groups" | "units";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        // Captured BEFORE reading, so a row written mid-request still has an
        // `updatedAt` past it and is picked up by the next delta rather than lost.
        const now = new Date();
        const since = parseSince(req.nextUrl.searchParams.get("since"));

        const canDelta =
            since != null
            && now.getTime() - since.getTime() < MAX_DELTA_WINDOW_MS;

        const where = canDelta ? { updatedAt: { gt: since! } } : undefined;
        const byName = { name: "asc" } as const;

        const [brands, categories, groups, units, counts] = await Promise.all([
            prisma.invBrand.findMany({ where, orderBy: byName }),
            prisma.invCategory.findMany({ where, orderBy: byName }),
            prisma.invProductGroup.findMany({ where, orderBy: byName }),
            // InvUnit has no `name` — it is keyed by `code` ("KG") with a `label`.
            prisma.invUnit.findMany({ where, orderBy: { code: "asc" } }),
            Promise.all([
                prisma.invBrand.count(),
                prisma.invCategory.count(),
                prisma.invProductGroup.count(),
                prisma.invUnit.count(),
            ]),
        ]);

        return NextResponse.json({
            mode: canDelta ? "delta" : "full",
            computedAt: now.toISOString(),
            tables: { brands, categories, groups, units },
            counts: {
                brands:     counts[0],
                categories: counts[1],
                groups:     counts[2],
                units:      counts[3],
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to sync inventory masters");
    }
}
