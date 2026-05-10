import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";

const createSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    order: z.coerce.number().int().nonnegative().optional(),
});

// GET /api/sub-status-groups
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const groups = await prisma.subStatusGroup.findMany({ orderBy: { order: "asc" } });
        return NextResponse.json(groups);
    } catch {
        return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
    }
}

// POST /api/sub-status-groups
export async function POST(req: Request) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const { label, order } = parsed.data;
        const id = label.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

        const existing = await prisma.subStatusGroup.findUnique({ where: { id } });
        if (existing) {
            return NextResponse.json({ error: `A group with id "${id}" already exists.` }, { status: 409 });
        }

        const maxOrder = order ?? (await prisma.subStatusGroup.count());
        const group = await prisma.subStatusGroup.create({ data: { id, label, order: maxOrder } });
        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
    }
}
