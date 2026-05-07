import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
});

// GET /api/finance/gl-accounts/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
        include: {
            parent: { select: { id: true, code: true, name: true } },
            children: { select: { id: true, code: true, name: true, balance: true } },
            _count: { select: { lines: true } },
        },
    });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(account);
}

// PATCH /api/finance/gl-accounts/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const updated = await prisma.account.update({
            where: { id: Number(id) },
            data: parsed.data,
        });
        return NextResponse.json(updated);
    } catch {
        return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }
}

// DELETE /api/finance/gl-accounts/[id] — soft delete
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const lineCount = await prisma.journalLine.count({ where: { accountId: Number(id) } });
    if (lineCount > 0) {
        return NextResponse.json({ error: "Cannot deactivate — account has posted journal lines" }, { status: 409 });
    }

    const updated = await prisma.account.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(updated);
}
