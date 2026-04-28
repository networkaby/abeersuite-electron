import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const createRoleSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().min(1, "Color is required"),
    rank:  z.coerce.number().int().min(0).max(100).optional(),
});

export async function GET() {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const roles = await prisma.role.findMany({
            orderBy: { id: "asc" },
            include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
        });
        return NextResponse.json(roles);
    } catch {
        return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("roles:manage");
    if (response) return response;
    try {
        const parsed = createRoleSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid role payload" }, { status: 400 });
        }
        const body = parsed.data;
        // Auto-generate next role ID (R5, R6, ...)
        const existing = await prisma.role.findMany({ orderBy: { id: "asc" } });
        const maxNum = existing.reduce((max, r) => {
            const n = parseInt(r.id.replace("R", ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `R${maxNum + 1}`;
        const role = await prisma.role.create({
            data: { id: newId, label: body.label, color: body.color, rank: body.rank ?? 0, isSystem: false },
        });
        return NextResponse.json(role);
    } catch {
        return NextResponse.json({ error: "Failed to create role" }, { status: 500 });
    }
}
