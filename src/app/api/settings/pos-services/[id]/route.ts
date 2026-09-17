import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";

const serviceInclude = {
    account: { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
} as const;

const updateSchema = z.object({
    name:              z.string().trim().min(1).max(120).optional(),
    accountId:         z.number().int().positive().optional(),
    gstRateId:         z.number().int().positive().nullable().optional(),
    defaultPricePaise: z.number().int().nonnegative().nullable().optional(),
    sortOrder:         z.number().int().optional(),
    isActive:          z.boolean().optional(),
});

// PATCH /api/settings/pos-services/[id] — update a service.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid service id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        if (data.accountId !== undefined) {
            const account = await prisma.account.findUnique({
                where:  { id: data.accountId },
                select: { group: { select: { type: true } } },
            });
            if (!account || account.group?.type !== "INCOME") {
                return NextResponse.json({ error: "Pick an income ledger for the service." }, { status: 422 });
            }
        }
        const row = await prisma.posService.update({
            where:   { id },
            data,
            include: serviceInclude,
        });
        return NextResponse.json(row);
    } catch (e) {
        const conflict = prismaUniqueError(e, "A service with that name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update POS service");
    }
}

// DELETE /api/settings/pos-services/[id] — remove a service. Posted sales are
// untouched (they reference ledgers, not this catalogue row), so a hard delete
// is safe; deactivating via PATCH is the soft alternative.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid service id" }, { status: 400 });
        }
        await prisma.posService.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete POS service");
    }
}
