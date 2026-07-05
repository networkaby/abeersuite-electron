// POST /api/pos/counters/release-mine
//   Self-service device-lock release from the PC that holds the lock.
//   Body: { deviceId }. Clears the lock on any counter bound to this deviceId.
//   Keyed by the caller's own bridge deviceId (a random per-PC UUID), so plain
//   auth is enough — no counter-manage permission needed. Admins can also release
//   any counter centrally via PATCH /api/pos/counters/[id] { releaseLock: true }.

import { prisma } from "@/shared/lib/prisma/prismaClient";
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

        const { count } = await prisma.posCounter.updateMany({
            where: { boundDeviceId: data.deviceId },
            data:  { boundDeviceId: null, boundDeviceLabel: null, boundAt: null },
        });
        return NextResponse.json({ released: count });
    } catch (e) {
        return handleApiError(e, "Failed to release counter lock");
    }
}
