// POST /api/pos/counters/release-mine
//   Self-service device-lock release from the PC that holds the lock.
//   Body: { deviceId }. Clears the lock on any counter bound to this deviceId.
//   Keyed by the caller's own bridge deviceId (a random per-PC UUID), so plain
//   auth is enough — no counter-manage permission needed. Admins can also release
//   any counter centrally via PATCH /api/pos/counters/[id] { releaseLock: true }.

import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";

const schema = z.object({
    deviceId: z.string().trim().min(1).max(100),
});

export async function POST(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;

        // Authoritative, not `prisma`. On a counter PC `prisma` is the replica, and a
        // release written there is undone on the way up: the push sees the server still
        // naming a device and restores its binding (reconcileCounterBinding). The PC
        // would believe it had let the counter go while the DB never agreed. A release
        // reaches the DB or it does not happen — if Supabase is unreachable the caller
        // gets the error rather than a local write that will be reverted.
        const { count } = await prismaAuthoritative.posCounter.updateMany({
            where: { boundDeviceId: data.deviceId },
            data:  { boundDeviceId: null, boundDeviceLabel: null, boundAt: null, releasedAt: new Date() },
        });
        return NextResponse.json({ released: count });
    } catch (e) {
        return handleApiError(e, "Failed to release counter lock");
    }
}
