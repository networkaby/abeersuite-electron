import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, generateNextOpaqueId } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { Prisma } from "@/generated/prisma/client";
import { isKnownTool } from "@/modules/repairing/lib/actionTools";

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
    groupIds: z.array(z.string().trim().min(1)).optional(),
    // Execution: "human" (default) or "auto" (an Action that runs a tool).
    kind: z.enum(["human", "auto"]).optional(),
    toolType: z.string().trim().optional().nullable(),
    toolConfig: z.record(z.string(), z.any()).optional().nullable(),
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
                groups: { include: { workGroup: { select: { id: true, label: true, color: true } } } },
            },
        });
        const shaped = works.map(({ groups, ...work }) => ({
            ...work,
            groups: groups.map((g) => g.workGroup),
            groupIds: groups.map((g) => g.workGroupId),
        }));
        return NextResponse.json(shaped);
    } catch (e) {
        return handleApiError(e, "Failed to fetch works");
    }
}

// POST /api/works
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { label, color, order, gated, successLabel, failLabel, prompt, startLabel, successPopup, failPopup, args, groupIds, kind, toolType, toolConfig } = data;
        const isAuto = kind === "auto";
        if (isAuto && toolType && !isKnownTool(toolType)) {
            return NextResponse.json({ error: `Unknown tool: ${toolType}` }, { status: 400 });
        }
        // Opaque, hidden id (W1, W2, …) like statuses (S#) / workers (SS#),
        // so the id never encodes the label and renames stay comfortable.
        const { id, n } = await generateNextOpaqueId(prisma.work, "W");
        const maxOrder = order ?? n;
        // Auto Works (Actions) are system-run — never gated by a human permission.
        const permissionId = gated && !isAuto ? await mintWorkPermission(id, label) : null;
        const work = await prisma.work.create({
            data: { id, label, color: color ?? "bg-gray-100 text-gray-600", order: maxOrder, permissionId, successLabel: successLabel || null, failLabel: failLabel || null, prompt: prompt || null, startLabel: startLabel || null, successPopup: successPopup ?? false, failPopup: failPopup ?? false, args: (args ?? []) as unknown as Prisma.InputJsonValue, groups: { create: (groupIds ?? []).map((workGroupId) => ({ workGroupId })) }, kind: kind ?? "human", toolType: isAuto ? (toolType || null) : null, toolConfig: (toolConfig ?? {}) as Prisma.InputJsonValue },
        });
        return NextResponse.json(work, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create work");
    }
}
