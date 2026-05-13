// /api/pos/shifts — shift lifecycle endpoints (list, open).
//
// GET   — list shifts (filterable). Default scope: active branch.
//         `branchId=all` requires pos:shift:view:org (or admin:bypass).
// POST  — open a new shift for the current user. Body: { openingFloatPaise }.
//         Resolves the user's tillAccountId and the branch's vaultAccountId,
//         then posts the opening Contra (Cr Vault, Dr Till) and writes the
//         PosShift row in one transaction.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postContra } from "@/modules/accountancy/lib/postContra";

const openSchema = z.object({
    openingFloatPaise: z.number().int().min(0),                                  // rupees * 100, can be 0
    notes:             z.string().trim().max(500).optional(),
});

// ── GET /api/pos/shifts?branchId=&userId=&status=&from=&to= ─────────────────
export async function GET(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_VIEW_BR);
    if (response) return response;

    try {
        const session = await auth();
        const { searchParams } = new URL(req.url);
        const branchParam = searchParams.get("branchId");
        const userIdParam = searchParams.get("userId");
        const statusParam = searchParams.get("status") as "OPEN" | "CLOSED" | null;
        const fromParam   = searchParams.get("from");
        const toParam     = searchParams.get("to");

        let branchFilter: { branchId?: string } = {};
        if (branchParam === "all") {
            const isOrg =
                user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS) ||
                user!.permissions.includes(PERMISSIONS.POS_SHIFT_VIEW_ORG);
            if (!isOrg) return NextResponse.json({ error: "Org-wide view not permitted" }, { status: 403 });
        } else if (branchParam) {
            branchFilter = { branchId: branchParam };
        } else {
            try { branchFilter = { branchId: resolveActiveBranchId(req, session) }; }
            catch (e) {
                if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
                throw e;
            }
        }

        const rows = await prisma.posShift.findMany({
            where: {
                ...branchFilter,
                ...(statusParam ? { status: statusParam } : {}),
                ...(userIdParam ? { userId: Number(userIdParam) } : {}),
                ...(fromParam || toParam ? {
                    openedAt: {
                        ...(fromParam ? { gte: new Date(fromParam) } : {}),
                        ...(toParam   ? { lte: (() => { const d = new Date(toParam); d.setHours(23, 59, 59, 999); return d; })() } : {}),
                    },
                } : {}),
            },
            orderBy: [{ openedAt: "desc" }],
            include: {
                user:        { select: { id: true, name: true, email: true } },
                branch:      { select: { id: true, name: true } },
                tillAccount: { select: { id: true, name: true } },
                openingContraVoucher: { select: { id: true, reference: true } },
                closingContraVoucher: { select: { id: true, reference: true } },
                _count: { select: { drops: true } },
            },
        });

        return NextResponse.json(rows.map((s) => ({
            ...s,
            openingFloatPaise: s.openingFloatPaise.toString(),
            declaredCashPaise: s.declaredCashPaise?.toString() ?? null,
            expectedCashPaise: s.expectedCashPaise?.toString() ?? null,
            variancePaise:     s.variancePaise?.toString() ?? null,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch shifts");
    }
}

// ── POST /api/pos/shifts ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const session = await auth();
    const { data, error } = await validateRequest(req, openSchema);
    if (error) return error;
    const body = data;

    let branchId: string;
    try { branchId = resolveActiveBranchId(req, session); }
    catch (e) {
        if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
    }

    // Resolve user's till + branch's vault before opening.
    const me = await prisma.user.findUnique({
        where:  { id: user!.id },
        select: { id: true, name: true, tillAccountId: true },
    });
    if (!me?.tillAccountId) {
        return NextResponse.json(
            { error: "You don't have a till account assigned. Ask admin to configure it on your user profile." },
            { status: 400 },
        );
    }
    const branch = await prisma.branch.findUnique({
        where:  { id: branchId },
        select: { id: true, name: true, vaultAccountId: true },
    });
    if (!branch?.vaultAccountId) {
        return NextResponse.json(
            { error: `Branch ${branch?.name ?? branchId} has no Vault account configured.` },
            { status: 400 },
        );
    }

    // Refuse if user already has an open shift in this branch (one at a time).
    const existing = await prisma.posShift.findFirst({
        where:  { userId: me.id, branchId, status: "OPEN" },
        select: { id: true },
    });
    if (existing) {
        return NextResponse.json({ error: "You already have an open shift in this branch.", shiftId: existing.id }, { status: 409 });
    }

    try {
        const shift = await prisma.$transaction(async (tx) => {
            // Post the opening-float Contra ONLY if there's actually a float.
            let openingContra: { voucherId: number } | null = null;
            if (body.openingFloatPaise > 0) {
                const rupees = body.openingFloatPaise / 100;
                openingContra = await postContra(tx, {
                    date:      new Date(),
                    narration: `Shift opening float — ${me.name} @ ${branch.name}`,
                    userId:    me.id,
                    lines: [
                        { accountId: me.tillAccountId!,      type: "DEBIT",  amount: rupees, description: "Opening float (in till)" },
                        { accountId: branch.vaultAccountId!, type: "CREDIT", amount: rupees, description: "Opening float (from vault)" },
                    ],
                });
            }

            return tx.posShift.create({
                data: {
                    userId:                 me.id,
                    branchId,
                    tillAccountId:          me.tillAccountId!,
                    openedById:             me.id,
                    openingFloatPaise:      BigInt(body.openingFloatPaise),
                    openingContraVoucherId: openingContra?.voucherId ?? null,
                    notes:                  body.notes ?? null,
                },
                include: {
                    tillAccount: { select: { id: true, name: true } },
                    branch:      { select: { id: true, name: true } },
                },
            });
        });

        return NextResponse.json({
            ...shift,
            openingFloatPaise: shift.openingFloatPaise.toString(),
            declaredCashPaise: null,
            expectedCashPaise: null,
            variancePaise:     null,
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to open shift");
    }
}
