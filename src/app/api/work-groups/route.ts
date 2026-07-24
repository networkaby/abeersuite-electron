import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId, validateRequest, handleApiError } from "@/shared/lib/api";
import { z } from "zod";

const schema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    gated: z.boolean().optional(),
});

// A gated WorkGroup mints/links a `workgroup:<id>` permission so it shows up in the
// roles matrix for granting; ungated groups are visible to any staff in the Work
// Inbox. Mirrors `mintWorkPermission` in /api/works (same pattern, separate
// permission namespace — visibility, not action, gate).
async function mintGroupPermission(id: string, label: string): Promise<string> {
    const permissionId = `workgroup:${id}`;
    await prisma.permission.upsert({
        where:  { id: permissionId },
        update: { label: `Work Group: ${label}`, module: "tickets" },
        create: { id: permissionId, label: `Work Group: ${label}`, module: "tickets", description: `See ${label} tickets in the Work Inbox.` },
    });
    return permissionId;
}

// GET /api/work-groups — list groups + the works in each.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const groups = await prisma.workGroup.findMany({
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            // `works` is now the join table (WorkGroupWork), not Work directly (many-to-many
            // via an explicit join model) — reach through it to the actual Work row, but
            // keep the response shape identical to before (works: {id,label,color}[]).
            include: { works: { include: { work: { select: { id: true, label: true, color: true } } }, orderBy: { work: { order: "asc" } } } },
        });
        const shaped = groups.map(({ works, ...group }) => ({ ...group, works: works.map((w) => w.work) }));
        return NextResponse.json(shaped);
    } catch (e) {
        return handleApiError(e, "Failed to fetch work groups");
    }
}

// POST /api/work-groups
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const { id, n } = await generateNextOpaqueId(prisma.workGroup, "G");
        const permissionId = data.gated ? await mintGroupPermission(id, data.label) : null;
        const created = await prisma.workGroup.create({
            data: { id, label: data.label, color: data.color ?? "bg-gray-100 text-gray-600", order: data.order ?? n, permissionId },
        });
        return NextResponse.json(created, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create work group");
    }
}
