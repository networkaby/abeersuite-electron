import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { organisationUpdateSchema } from "@/shared/lib/schemas/organisationSchemas";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";

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

    // GSTIN ↔ state-code/state-name integrity guard. Only fires when the
    // PATCH touches any of those three fields — otherwise the singleton's
    // stored values stay untouched (PATCH semantics).
    if (patch.gstin !== undefined || patch.gstStateCode !== undefined || patch.state !== undefined) {
        // Load whatever's currently stored so we can validate the merged
        // intent rather than just the patched-in fields. Example: user
        // changes only `state` text → we still want to ensure it matches
        // the existing GSTIN.
        const current = await prisma.organisation.findUnique({ where: { id: 1 } });
        const integrity = normaliseGstinState({
            gstin:        patch.gstin        ?? current?.gstin        ?? "",
            gstStateCode: patch.gstStateCode ?? current?.gstStateCode ?? "",
            state:        patch.state        ?? current?.state        ?? "",
        });
        if (!integrity.ok) {
            return NextResponse.json({ error: integrity.error }, { status: 400 });
        }
        // Force the canonical values back into the patch so the row never
        // persists a mismatch even if the client tried to.
        patch.gstin        = integrity.value.gstin;
        patch.gstStateCode = integrity.value.gstStateCode;
        if (patch.state !== undefined) patch.state = integrity.value.state;
    }

    const row = await prisma.organisation.upsert({
        where:  { id: 1 },
        create: { id: 1, ...patch, updatedById: user.id || null },
        update: { ...patch,        updatedById: user.id || null },
    });
    return NextResponse.json(row);
}
