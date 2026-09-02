// POST /api/pos/counters/[id]/claim-number
//
// First-launch counter setup calls this once: it BINDS this PC to the chosen counter
// and returns the counter's reserved offline id-range block so the caller can apply it.
//
// The name is historical. It used to mint a counterNumber for a counter that had none,
// but counterNumber is now permanent config, required at creation and NOT NULL (see
// POST /api/pos/counters) — there is no such thing as an unnumbered counter to claim.
// What a fresh machine actually needs is the device lock, which nothing wrote here
// before: only shift-open did, so a machine that completed setup but had not yet opened
// a shift reconciled as "released" and was sent straight back to /setup/counter.
// Setup and binding are one action now.
//
// Deliberately `requireAuth()` only — no admin permission — because this runs the first
// time ANY staff member logs in on a freshly-installed machine. Safe to leave broad: it
// can only bind a counter that is unbound (or already bound to this same PC); it can
// never steal one from another device. The one unbind it does is of THIS device's own
// previous counter, so a PC is never two counters. Anything else is released only from
// /office/admin/counters.

import { NextResponse } from "next/server";
import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { blockStartFor, MAX_COUNTER_NUMBER } from "@/shared/lib/counter/idRange";
import { z } from "zod";

// Identity is resolved in the renderer (Electron installation id, with the old
// bridge-minted id alongside it for counters bound under the previous scheme) —
// see shared/lib/counter/identity.ts. Same shape POST /api/pos/shifts accepts.
const claimSchema = z.object({
    deviceId: z.string().min(1, "Device id is required to bind this counter"),
    legacyDeviceId: z.string().min(1).nullish(),
    deviceLabel: z.string().nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const counterId = Number(id);
    if (!Number.isInteger(counterId)) {
        return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });
    }

    const { data, error } = await validateRequest(req, claimSchema);
    if (error) return error;

    try {
        // Authoritative: this decides ALREADY_BOUND just below. Read from the replica
        // and it could still show a binding an admin released on live minutes ago,
        // refusing a setup that is in fact allowed — and there is no way for the
        // technician standing at the counter to tell that apart from a real conflict.
        const counter = await prismaAuthoritative.posCounter.findUnique({
            where: { id: counterId },
            select: { id: true, counterNumber: true, idRangeStart: true, boundDeviceId: true },
        });
        if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        // Re-running setup on the SAME machine is fine (and is how a counter recovers
        // after its local counter.json is lost). Only another PC's binding blocks it.
        const boundElsewhere =
            counter.boundDeviceId !== null &&
            counter.boundDeviceId !== data.deviceId &&
            counter.boundDeviceId !== data.legacyDeviceId;
        if (boundElsewhere) {
            return NextResponse.json(
                { error: "This counter is already in use by another PC — an admin must release it first.", code: "ALREADY_BOUND" },
                { status: 409 },
            );
        }

        // The offline id-range block is derived from counterNumber, so it is knowable
        // here without storing anything new. blockStartFor caps at MAX_COUNTER_NUMBER;
        // a counter numbered above that can still bill online, it just cannot reserve a
        // block, so say so plainly rather than failing with a RangeError.
        if (counter.counterNumber > MAX_COUNTER_NUMBER) {
            return NextResponse.json(
                { error: `Counter number ${counter.counterNumber} is above ${MAX_COUNTER_NUMBER}, so no offline id range can be reserved for it. Renumber the counter in counter settings.` },
                { status: 400 },
            );
        }
        const idRangeStart = blockStartFor(counter.counterNumber);

        // Authoritative, like the read above and like release-mine: a device lock is
        // decided in the DB or not at all. Written through `prisma` this went into the
        // replica and out through the outbox — and on a PC that holds no counter the
        // replica is empty (replicaWipe.ts), so there is no row there to update. The
        // replica receives the binding through the first pull once the worker starts.
        //
        // One PC is one counter. A device the DB still binds to some OTHER counter
        // (its old one, when the cashier picks a different row in the wizard) is
        // released from it in the same transaction — otherwise this machine would be
        // two counters at once, and its own self-check could no longer tell which.
        const ids = [data.deviceId, data.legacyDeviceId].filter((v): v is string => !!v);
        const updated = await prismaAuthoritative.$transaction(async (tx) => {
            await tx.posCounter.updateMany({
                where: { id: { not: counterId }, boundDeviceId: { in: ids } },
                data:  { boundDeviceId: null, boundDeviceLabel: null, boundAt: null, releasedAt: new Date() },
            });
            return tx.posCounter.update({
                where: { id: counterId },
                data: {
                    boundDeviceId: data.deviceId,
                    boundDeviceLabel: data.deviceLabel ?? null,
                    boundAt: new Date(),
                    releasedAt: null,
                    ...(idRangeStart !== counter.idRangeStart ? { idRangeStart } : {}),
                },
                select: { id: true, counterNumber: true, idRangeStart: true },
            });
        });

        return NextResponse.json(updated);
    } catch (e: unknown) {
        return handleApiError(e, "Failed to bind this PC to the counter");
    }
}
