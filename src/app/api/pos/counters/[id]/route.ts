// PATCH  /api/pos/counters/[id]  — rename or toggle active
// DELETE /api/pos/counters/[id]  — only allowed when no shifts have ever used this counter

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    name:     z.string().trim().min(1).max(60).optional(),
    isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    try {
        const { id: idStr } = await params;
        const id = Number(idStr);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });

        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;

        const existing = await prisma.posCounter.findUnique({ where: { id }, include: { tillAccount: true, branch: { select: { name: true } } } });
        if (!existing) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        // If renaming, ensure no other counter in the same branch has that name.
        if (data.name && data.name !== existing.name) {
            const dup = await prisma.posCounter.findFirst({ where: { branchId: existing.branchId, name: data.name, NOT: { id } } });
            if (dup) return NextResponse.json({ error: `Counter "${data.name}" already exists in this branch` }, { status: 409 });
        }

        // Block deactivation while a shift is OPEN or AWAITING_HANDOVER.
        if (data.isActive === false) {
            const active = await prisma.posShift.findFirst({
                where: { counterId: id, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                select: { id: true },
            });
            if (active) return NextResponse.json({ error: "Cannot deactivate counter with an active shift" }, { status: 400 });
        }

        const updated = await prisma.$transaction(async (tx) => {
            // Keep the till account name in sync if the counter is renamed.
            if (data.name && data.name !== existing.name) {
                const newTillName = `Cash – ${data.name} – ${existing.branch.name}`;
                await tx.account.update({ where: { id: existing.tillAccountId }, data: { name: newTillName } });
            }
            return tx.posCounter.update({
                where: { id },
                data: {
                    ...(data.name     !== undefined && { name: data.name }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                },
                include: {
                    tillAccount: { select: { id: true, name: true, balance: true } },
                    branch:      { select: { id: true, name: true } },
                },
            });
        });

        return NextResponse.json({
            id:       updated.id,
            name:     updated.name,
            branchId: updated.branchId,
            branch:   updated.branch,
            isActive: updated.isActive,
            tillAccount: {
                id:      updated.tillAccount.id,
                name:    updated.tillAccount.name,
                balance: updated.tillAccount.balance.toString(),
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to update counter");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    try {
        const { id: idStr } = await params;
        const id = Number(idStr);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid counter id" }, { status: 400 });

        const counter = await prisma.posCounter.findUnique({
            where: { id },
            include: { _count: { select: { shifts: true } }, tillAccount: { select: { id: true, balance: true } } },
        });
        if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });

        if (counter._count.shifts > 0) {
            return NextResponse.json(
                { error: `Cannot delete: this counter has ${counter._count.shifts} shift(s) in history. Deactivate instead.` },
                { status: 400 },
            );
        }
        if (Number(counter.tillAccount.balance) !== 0) {
            return NextResponse.json(
                { error: "Cannot delete: till account has a non-zero balance. Sweep to vault first." },
                { status: 400 },
            );
        }

        await prisma.posCounter.delete({ where: { id } });
        // We intentionally KEEP the till GL account (audit trail) — just unlinked from the counter now.
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete counter");
    }
}
