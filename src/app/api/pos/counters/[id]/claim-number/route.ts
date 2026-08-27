// POST /api/pos/counters/[id]/claim-number
//
// First-launch counter setup calls this once, before the counter can bill anything
// prefixed or write offline. Deliberately `requireAuth()` only — no admin permission
// — because this runs the first time ANY staff member logs in on a freshly-installed
// machine, before that machine has been configured at all. Safe to leave broad: it
// can only SET counterNumber when the counter has none yet; it can never overwrite
// or clear one. Only /office/admin/counters (the "release" action) can clear it.

import { NextResponse } from "next/server";
import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { blockStartFor, MAX_COUNTER_NUMBER } from "@/shared/lib/counter/idRange";
import { z } from "zod";

// Optional: when the counter's epbxExtension is already a clean 1–99 number,
// the caller doesn't need to send one — it's derived below. Only counters
// whose extension isn't a clean number need to send this.
const claimSchema = z.object({
    counterNumber: z.number().int().min(1).max(MAX_COUNTER_NUMBER).optional(),
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
        // Authoritative: this decides ALREADY_CONFIGURED just below. Read from the
        // replica it could still show a counterNumber an admin cleared on live minutes
        // ago, refusing a setup that is in fact allowed — and there is no way for the
        // technician standing at the counter to tell that apart from a real conflict.
        const counter = await prismaAuthoritative.posCounter.findUnique({
            where:  { id: counterId },
            select: { id: true, counterNumber: true, idRangeStart: true, epbxExtension: true },
        });
        if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        if (counter.counterNumber !== null) {
            return NextResponse.json(
                { error: "This counter is already configured — an admin must release it before it can be reconfigured.", code: "ALREADY_CONFIGURED" },
                { status: 409 },
            );
        }

        // Prefer the counter's own epbxExtension when it's already a clean 1–99
        // number — avoids asking the same number twice at first-launch setup.
        // Falls back to whatever the caller sent when the extension isn't a
        // clean number (blank, non-numeric, out of range).
        const extNumber = Number(counter.epbxExtension);
        const autoNumber = Number.isInteger(extNumber) && extNumber >= 1 && extNumber <= MAX_COUNTER_NUMBER
            ? extNumber
            : null;
        const counterNumber = autoNumber ?? data.counterNumber;
        if (counterNumber === undefined) {
            return NextResponse.json({ error: `Enter a counter number from 1 to ${MAX_COUNTER_NUMBER}` }, { status: 400 });
        }

        const idRangeStart = blockStartFor(counterNumber);

        const updated = await prisma.posCounter.update({
            where: { id: counterId },
            data:  { counterNumber, idRangeStart },
            select: { id: true, counterNumber: true, idRangeStart: true },
        });

        return NextResponse.json(updated);
    } catch (e: unknown) {
        // Prisma unique-constraint violation on counterNumber — another counter
        // claimed it between this request's read and write (or a race between two
        // machines setting up at once). The DB constraint is the real backstop;
        // this just turns it into a message a technician can act on.
        if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
            return NextResponse.json(
                { error: `Counter number ${data.counterNumber} is already taken by another counter.`, code: "NUMBER_TAKEN" },
                { status: 409 },
            );
        }
        return handleApiError(e, "Failed to claim counter number");
    }
}
