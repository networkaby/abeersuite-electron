import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { offlinePolicyUpdateSchema } from "@/shared/lib/schemas/offlinePolicySchemas";
import { mergeOfflinePolicies } from "@/shared/lib/accountancy/offlineVoucherSafety";
import { invalidateOfflinePolicyCache } from "@/shared/lib/accountancy/offlinePoliciesServer";

// The org's offline policies live in ONE row and are answered here already merged
// over the code defaults, so no caller has to know the row is stored partially.

// GET /api/settings/offline-policies — singleton, READ-ONLY.
//
// Deliberately not the usual auto-creating upsert. A counter may not write this table
// at all (the replica guard refuses it), so an upsert here would turn simply OPENING
// the settings page on a counter into a 503. No row just means nobody has decided
// yet, which is exactly what the defaults are for; the row is created by the first
// PATCH, from an office machine.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const row = await prisma.offlinePolicy.findUnique({ where: { id: 1 } });
    return NextResponse.json({
        policies:  mergeOfflinePolicies(row?.policies),
        updatedAt: row?.updatedAt ?? null,
    });
}

// PATCH /api/settings/offline-policies — flip one or more toggles.
// Settings pages are sidebar-gated; the write API stays open to any staff.
//
// A counter cannot reach this successfully while it is offline: the replica guard in
// prismaClient.ts refuses every OfflinePolicy write, so the request comes back as the
// usual 503 OFFLINE_READ_ONLY. That is deliberate — the machine being restrained does
// not get to loosen its own restraints.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, offlinePolicyUpdateSchema);
    if (error) return error;

    try {
        // Merge over what is stored rather than replacing it, so a PATCH carrying one
        // toggle does not silently reset the other forty.
        const current = await prisma.offlinePolicy.findUnique({ where: { id: 1 }, select: { policies: true } });
        const policies = { ...mergeOfflinePolicies(current?.policies), ...data };

        const row = await prisma.offlinePolicy.upsert({
            where:  { id: 1 },
            create: { id: 1, policies },
            update: { policies },
        });
        invalidateOfflinePolicyCache();
        return NextResponse.json({ policies: mergeOfflinePolicies(row.policies), updatedAt: row.updatedAt });
    } catch (e) {
        return handleApiError(e, "Failed to update offline policies");
    }
}
