import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { commissionOverrideSchema } from "@/shared/lib/schemas/hrSchema";
import { ensureStaffProfile } from "@/modules/hr/lib/staffProfileServer";

// PUT /api/hr/commission/overrides — one person's say over one head: their own
// rate or bonus (null = back to the head's), or the head off for them. An
// upsert: a row that says nothing (no figure, not off) is deleted rather than
// kept, so the table only ever holds real exceptions.
export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const { data: body, error } = await validateRequest(req, commissionOverrideSchema);
    if (error) return error;
    try {
        const [user, head] = await Promise.all([
            prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true } }),
            prisma.commissionHead.findUnique({ where: { id: body.headId }, select: { id: true, kind: true } }),
        ]);
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (!head) return NextResponse.json({ error: "Head not found" }, { status: 404 });

        const share = head.kind === "PERCENT" || head.kind === "ABOVE_TARGET";
        const bonus = head.kind === "BONUS";
        const row = await prisma.$transaction(async (tx) => {
            await ensureStaffProfile(tx, user);
            const cur = await tx.commissionOverride.findUnique({ where: { userId_headId: { userId: body.userId, headId: body.headId } } });
            const next = {
                // A figure only makes sense for the kind that has one; anything else is dropped.
                rateBp: share ? (body.rateBp === undefined ? (cur?.rateBp ?? null) : body.rateBp) : null,
                bonusPaise: bonus ? (body.bonusPaise === undefined ? (cur?.bonusPaise ?? null) : body.bonusPaise) : null,
                off: body.off ?? cur?.off ?? false,
            };
            if (next.rateBp == null && next.bonusPaise == null && !next.off) {
                if (cur) await tx.commissionOverride.delete({ where: { id: cur.id } });
                return null;
            }
            return tx.commissionOverride.upsert({
                where: { userId_headId: { userId: body.userId, headId: body.headId } },
                create: { userId: body.userId, headId: body.headId, ...next },
                update: next,
                select: { userId: true, headId: true, rateBp: true, bonusPaise: true, off: true },
            });
        });
        return NextResponse.json(row ?? { userId: body.userId, headId: body.headId, rateBp: null, bonusPaise: null, off: false });
    } catch (e) {
        return handleApiError(e, "Failed to save the override");
    }
}
