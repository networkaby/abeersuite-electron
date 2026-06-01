import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { expireLots } from "@/modules/loyalty/lib";

export const runtime = "nodejs";

// POST /api/loyalty/expire-points
//
// Scheduled sweep — expires all ACTIVE loyalty lots past their expiry and posts
// one EXPIRY ledger row per affected account. Token-guarded (NOT session-based)
// so it can be driven by a GitHub Actions cron, mirroring the backup workflow.
// Set LOYALTY_CRON_SECRET in the deployment env + GitHub Secrets.
export async function POST(req: Request) {
    const secret = (process.env.LOYALTY_CRON_SECRET ?? "").trim();
    if (!secret) {
        return NextResponse.json({ error: "LOYALTY_CRON_SECRET not configured." }, { status: 503 });
    }
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Attribute the run to the bootstrap admin (LoyaltyLedger.createdById is required).
        const actor = await prisma.user.findFirst({
            where: { email: "admin@networkservice.in" },
            select: { id: true },
        }) ?? await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
        if (!actor) return NextResponse.json({ error: "No user to attribute the sweep to." }, { status: 500 });

        const result = await prisma.$transaction(
            (tx) => expireLots(tx, { now: new Date(), createdById: actor.id }),
            { timeout: 60_000, maxWait: 10_000 },
        );
        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        return handleApiError(e, "Failed to expire loyalty points");
    }
}
