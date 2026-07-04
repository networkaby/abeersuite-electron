import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";

const branchTextField = z.string().trim().optional().nullable();

const createSchema = z.object({
    id:       z.string().trim().min(1, "ID is required").toUpperCase(),
    name:     z.string().trim().min(1, "Name is required"),
    // Legacy single-line summary — kept for back-compat. Structured fields below
    // are the canonical identity used by invoice printing.
    address:  branchTextField,
    phone:    branchTextField,
    // Structured address (Indian-business convention)
    addressLine1: branchTextField,
    addressLine2: branchTextField,
    city:         branchTextField,
    state:        branchTextField,
    pinCode:      branchTextField,
    country:      branchTextField,
    // Contact + tax
    email:        branchTextField,
    gstin:        z.string().trim().max(15).optional().nullable(),
    gstStateCode: z.string().trim().max(2).optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // Users belong to a branch via Position appointments
        // (UserPosition → Position.branchId). Departments referenced at this
        // branch include both Department.branchId (direct) and Position
        // → Department links.
        const branches = await prisma.branch.findMany({
            orderBy: { name: "asc" },
            include: {
                _count: { select: { departments: true } },
                positions: {
                    select: {
                        departmentId: true,
                        holders:      { select: { userId: true } },
                    },
                },
            },
        });

        const shaped = branches.map(b => {
            const userIds = new Set<number>();
            const deptIds = new Set<string>();
            for (const p of b.positions) {
                for (const h of p.holders) userIds.add(h.userId);
                if (p.departmentId) deptIds.add(p.departmentId);
            }
            const deptCount = deptIds.size > 0 ? deptIds.size : b._count.departments;

            const { positions: _positions, _count: _legacy, ...rest } = b;
            void _positions; void _legacy;
            return { ...rest, _count: { users: userIds.size, positions: b.positions.length, departments: deptCount } };
        });

        return NextResponse.json(shaped);
    } catch (e) {
        return handleApiError(e, "Failed to fetch branches");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.BRANCHES_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id } = data;
        const existing = await prisma.branch.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Branch ID already exists" }, { status: 409 });

        // GSTIN ↔ state-code/state-name integrity guard. Cross-checks all three
        // and rejects mismatches with a clear error.
        const integrity = normaliseGstinState({
            gstin:        data.gstin ?? "",
            gstStateCode: data.gstStateCode ?? "",
            state:        data.state ?? "",
        });
        if (!integrity.ok) {
            return NextResponse.json({ error: integrity.error }, { status: 400 });
        }

        const payload = {
            ...data,
            gstin:        integrity.value.gstin        || null,
            gstStateCode: integrity.value.gstStateCode || null,
            state:        integrity.value.state        || data.state,
        };

        const branch = await prisma.branch.create({
            data: { ...payload, isActive: payload.isActive ?? true },
        });
        return NextResponse.json(branch, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create branch");
    }
}
