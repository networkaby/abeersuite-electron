import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { creditLimitConfigUpdateSchema } from "@/shared/lib/schemas/creditLimitSchemas";

// GET /api/settings/credit-limit — singleton; auto-creates row id=1 if missing.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const row = await prisma.creditLimitConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    return NextResponse.json(row);
}

// PATCH /api/settings/credit-limit — edit the auto credit-limit calculator.
// Settings pages are sidebar-gated; the write API stays open to any staff.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, creditLimitConfigUpdateSchema);
    if (error) return error;

    try {
        const row = await prisma.creditLimitConfig.upsert({
            where:  { id: 1 },
            create: { id: 1, ...data },
            update: data,
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update credit-limit config");
    }
}
