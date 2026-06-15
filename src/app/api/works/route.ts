import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, generateNextOpaqueId } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { Prisma } from "@/generated/prisma/client";

const argSchema = z.array(z.object({
    key: z.string().trim().optional(),
    label: z.string().trim().min(1),
    source: z.string().trim().min(1),
    kind: z.enum(["text", "number"]).optional(),
    on: z.enum(["success", "fail", "always", "entry"]).optional(),
    required: z.boolean().optional(),
})).optional();

const createSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
    gated: z.boolean().optional(),
    successLabel: z.string().trim().optional().nullable(),
    failLabel: z.string().trim().optional().nullable(),
    prompt: z.string().trim().optional().nullable(),
    startLabel: z.string().trim().optional().nullable(),
    successPopup: z.boolean().optional(),
    failPopup: z.boolean().optional(),
    args: argSchema,
    groupId: z.string().trim().optional().nullable(),
});

// A gated Work mints/links a `work:<id>` permission so it shows up in the roles
// matrix for granting; ungated Works are open to any staff (no permission).
async function mintWorkPermission(id: string, label: string): Promise<string> {
    const permissionId = `work:${id}`;
    await prisma.permission.upsert({
        where:  { id: permissionId },
        update: { label: `Work: ${label}`, module: "tickets" },
        create: { id: permissionId, label: `Work: ${label}`, module: "tickets", description: `Set ${label} statuses / workers on a ticket.` },
    });
    return permissionId;
}

// GET /api/works
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const works = await prisma.work.findMany({
            orderBy: { order: "asc" },
            include: {
                statuses: { select: { id: true, label: true, color: true, pipelineId: true }, orderBy: { order: "asc" } },
                workers: { select: { id: true, label: true, color: true, pipelineId: true }, orderBy: { order: "asc" } },
            },
        });
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
        const { label, color, order, gated, successLabel, failLabel, prompt, startLabel, successPopup, failPopup, args, groupId } = data;
        // Opaque, hidden id (W1, W2, …) like statuses (S#) / workers (SS#),
        // so the id never encodes the label and renames stay comfortable.
        const { id, n } = await generateNextOpaqueId(prisma.work, "W");
        const maxOrder = order ?? n;
        const permissionId = gated ? await mintWorkPermission(id, label) : null;
        const work = await prisma.work.create({
            data: { id, label, color: color ?? "bg-gray-100 text-gray-600", order: maxOrder, permissionId, successLabel: successLabel || null, failLabel: failLabel || null, prompt: prompt || null, startLabel: startLabel || null, successPopup: successPopup ?? false, failPopup: failPopup ?? false, args: (args ?? []) as unknown as Prisma.InputJsonValue, groupId: groupId || null },
        });
        return NextResponse.json(work, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create work");
    }
}
