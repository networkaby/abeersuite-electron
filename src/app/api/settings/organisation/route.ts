import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { organisationUpdateSchema } from "@/shared/lib/schemas/organisationSchemas";

/**
 * Returns the raw Organisation row (id=1). Auto-upserts on first read so the
 * settings form always has something to bind to. Available to any signed-in
 * staff user — the data is non-sensitive and appears on every receipt.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1 },
        update: {},
    });
    return NextResponse.json(row);
}

/**
 * PATCH /api/settings/organisation — partial update of the singleton.
 * Gated by `settings:manage` (same as the other organisation-shape settings).
 * GSTIN entered by the admin auto-populates `gstStateCode` from the first
 * two digits so place-of-supply logic doesn't drift out of sync.
 */
export async function PATCH(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, organisationUpdateSchema);
    if (error) return error;

    const patch = { ...data };

    // Keep gstStateCode in lockstep with the first 2 chars of GSTIN when the
    // admin updates GSTIN without manually setting the code. If they sent
    // both, trust what they sent.
    if (patch.gstin !== undefined && patch.gstStateCode === undefined) {
        patch.gstStateCode = patch.gstin.length >= 2 ? patch.gstin.slice(0, 2) : "";
    }

    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1, ...patch, updatedById: user.id || null },
        update: { ...patch,        updatedById: user.id || null },
    });
    return NextResponse.json(row);
}
