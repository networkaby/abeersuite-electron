import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const updateSchema = z.object({
    restartMonth: z.number().int().min(1).max(12).optional(),
    restartDay:   z.number().int().min(1).max(31).optional(),
});

// GET /api/finance/books-config — singleton; auto-creates row if missing.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const config = await prisma.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });
    return NextResponse.json(config);
}

// PATCH /api/finance/books-config — update restart month/day.
export async function PATCH(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    const config = await prisma.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...parsed.data },
        update: parsed.data,
    });
    return NextResponse.json(config);
}
