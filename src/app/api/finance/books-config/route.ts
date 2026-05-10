import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;

    const config = await prisma.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
    });
    return NextResponse.json(config);
}
