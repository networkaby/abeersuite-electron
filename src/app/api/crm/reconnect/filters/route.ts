import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { savedFilterCreateSchema } from "@/shared/lib/schemas/reconnectSchema";

const SURFACE = "reconnect";

// GET /api/crm/reconnect/filters — my saved filters + any shared with the team.
export async function GET() {
    const { user, response } = await requireModuleAccess("crm");
    if (response) return response;
    const meId = Number(user.id);
    try {
        const rows = await prisma.savedFilter.findMany({
            where: { surface: SURFACE, OR: [{ ownerUserId: meId }, { isShared: true }] },
            orderBy: [{ name: "asc" }],
            select: { id: true, name: true, isShared: true, payload: true, ownerUserId: true, owner: { select: { name: true } } },
        });
        return NextResponse.json(rows.map((r) => ({
            id: r.id, name: r.name, isShared: r.isShared, payload: r.payload,
            mine: r.ownerUserId === meId, ownerName: r.owner.name,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to load saved filters");
    }
}

// POST /api/crm/reconnect/filters — save the current filter under a name.
export async function POST(req: Request) {
    const { user, response } = await requireModuleAccess("crm");
    if (response) return response;
    const { data, error } = await validateRequest(req, savedFilterCreateSchema);
    if (error) return error;
    try {
        const row = await prisma.savedFilter.create({
            data: { surface: SURFACE, name: data.name, isShared: data.isShared, payload: data.payload as Prisma.InputJsonValue, ownerUserId: Number(user.id) },
            select: { id: true, name: true, isShared: true, payload: true },
        });
        return NextResponse.json({ ...row, mine: true }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save filter");
    }
}
