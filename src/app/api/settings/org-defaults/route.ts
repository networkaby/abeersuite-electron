import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { orgDefaultsUpdateSchema } from "@/shared/lib/schemas/orgDefaultsSchemas";

const orgDefaultsInclude = {
    defaultGstRate: { select: { id: true, rate: true, label: true } },
    shippingPoolGroup: { select: { id: true, name: true } },
} as const;

// GET /api/settings/org-defaults — singleton; auto-creates row if missing.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const row = await prisma.orgDefaults.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
        include: orgDefaultsInclude,
    });
    return NextResponse.json(row);
}

// PATCH /api/settings/org-defaults — update org-wide defaults.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, orgDefaultsUpdateSchema);
    if (error) return error;

    const row = await prisma.orgDefaults.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
        include: orgDefaultsInclude,
    });
    return NextResponse.json(row);
}
