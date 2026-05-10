import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const updateSchema = z.object({
    name:        z.string().trim().min(1).max(200).optional(),
    groupId:     z.number().int().positive().nullable().optional(),
    code:        z.string().trim().max(32).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isActive:    z.boolean().optional(),
});

// PATCH /api/finance/ledgers/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;
    const body = data;

    if (body.groupId) {
        const group = await prisma.accountGroup.findUnique({ where: { id: body.groupId } });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
    }

    try {
        const account = await prisma.account.update({
            where: { id },
            data: {
                ...(body.name        !== undefined ? { name:        body.name }        : {}),
                ...(body.groupId     !== undefined ? { groupId:     body.groupId }     : {}),
                ...(body.code        !== undefined ? { code:        body.code }        : {}),
                ...(body.description !== undefined ? { description: body.description } : {}),
                ...(body.isActive    !== undefined ? { isActive:    body.isActive }    : {}),
            },
            include: { group: { select: { id: true, name: true } } },
        });
        return NextResponse.json(account);
    } catch (e) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: `Code "${body.code}" already exists` }, { status: 409 });
        }
        return handleApiError(e, "Failed to update ledger");
    }
}
