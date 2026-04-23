import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

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
        const body = await req.json();
        if (!body.label || !body.color) {
            return NextResponse.json({ error: "label and color are required" }, { status: 400 });
        }
        // Auto-generate next role ID (R5, R6, ...)
        const existing = await prisma.role.findMany({ orderBy: { id: "asc" } });
        const maxNum = existing.reduce((max, r) => {
            const n = parseInt(r.id.replace("R", ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `R${maxNum + 1}`;
        const role = await prisma.role.create({
            data: { id: newId, label: body.label, color: body.color, isSystem: false },
        });
        return NextResponse.json(role);
    } catch {
        return NextResponse.json({ error: "Failed to create role" }, { status: 500 });
    }
}
