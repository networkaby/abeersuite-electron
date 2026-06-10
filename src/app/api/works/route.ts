import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const createSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    gated: z.boolean().optional(),
});

// A gated Work mints/links a `work:<id>` permission so it shows up in the roles
// matrix for granting; ungated Works are open to any staff (no permission).
async function mintWorkPermission(id: string, label: string): Promise<string> {
    const permissionId = `work:${id}`;
    await prisma.permission.upsert({
        where:  { id: permissionId },
        update: { label: `Work: ${label}`, module: "tickets" },
        create: { id: permissionId, label: `Work: ${label}`, module: "tickets", description: `Set ${label} statuses / sub-statuses on a ticket.` },
    });
    return permissionId;
}

// GET /api/works
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const works = await prisma.work.findMany({ orderBy: { order: "asc" } });
        return NextResponse.json(works);
    } catch (e) {
        return handleApiError(e, "Failed to fetch works");
    }
}

// POST /api/works
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { label, color, order, gated } = data;
        const id = label.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        if (!id) return NextResponse.json({ error: "Label must contain letters or numbers." }, { status: 400 });

        const existing = await prisma.work.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: `A work with id "${id}" already exists.` }, { status: 409 });

        const maxOrder = order ?? (await prisma.work.count());
        const permissionId = gated ? await mintWorkPermission(id, label) : null;
        const work = await prisma.work.create({
            data: { id, label, color: color ?? "bg-gray-100 text-gray-600", order: maxOrder, permissionId },
        });
        return NextResponse.json(work, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create work");
    }
}
