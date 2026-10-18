import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { AI_COPY_TEST_ENTITY } from "@/shared/lib/constants/ai";

// Temporary A/B log for the AI search trial (2026-10-19). Staff pick version A
// (photo only) or B (with search), or keep the only version; each pick lands in AuditLog under
// AI_COPY_TEST_ENTITY — no migration for a trial. Delete those rows and this
// route once the owner settles on one search mode.
//
// POST { productId, ref, picked, mode, search, verifiedFacts, tokens, ms } → log one pick
// GET  → every pick, newest first, for the Test log tab

const pickSchema = z.object({
    productId: z.number().int().positive(),
    ref: z.string().trim().max(200),
    // "only" = search added nothing, so there was a single version to keep.
    picked: z.enum(["A", "B", "only"]),
    mode: z.enum(["off", "auto", "always"]),
    search: z.string().max(20),
    verifiedFacts: z.number().int().min(0),
    tokens: z.object({ draft: z.number().min(0), search: z.number().min(0), polish: z.number().min(0) }),
    draftKey: z.string().max(60),
    ms: z.number().min(0),
});

export async function POST(req: Request) {
    const { user, response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, pickSchema);
    if (error) return error;
    try {
        const { productId, ref, picked, ...snapshot } = data;
        await prisma.auditLog.create({
            data: {
                entityType: AI_COPY_TEST_ENTITY,
                originalId: productId,
                originalRef: ref,
                action: picked,
                snapshot,
                actorId: user.id,
            },
        });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Could not log the pick");
    }
}

export async function GET() {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    try {
        const rows = await prisma.auditLog.findMany({
            where: { entityType: AI_COPY_TEST_ENTITY },
            orderBy: { createdAt: "desc" },
            take: 500,
            select: { id: true, originalId: true, originalRef: true, action: true, snapshot: true, createdAt: true },
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Could not load the test log");
    }
}
