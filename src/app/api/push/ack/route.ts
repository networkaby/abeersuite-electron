import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest } from "@/shared/lib/api";

/**
 * POST /api/push/ack — the service worker (public/sw.js) reporting on one
 * notification: "shown" when the phone put it in the tray, "clicked" when the
 * customer tapped it. No sign-in: the service worker has no session, and the
 * message id (a cuid the phone only learns from the push itself) is the proof.
 * Only the first report of each kind is kept.
 */

const ackSchema = z.object({
    id: z.string().min(10).max(40),
    event: z.enum(["shown", "clicked"]),
});

export async function POST(req: Request) {
    const { data, error } = await validateRequest(req, ackSchema);
    if (error) return error;

    const now = new Date();
    // A tap proves it was shown too (some phones skip the "shown" call when
    // the worker is killed right after displaying).
    await prisma.pushMessage
        .updateMany({
            where: { id: data.id, shownAt: null },
            data: { shownAt: now },
        })
        .catch(() => null);
    if (data.event === "clicked") {
        await prisma.pushMessage
            .updateMany({ where: { id: data.id, clickedAt: null }, data: { clickedAt: now } })
            .catch(() => null);
    }
    return NextResponse.json({ ok: true });
}
