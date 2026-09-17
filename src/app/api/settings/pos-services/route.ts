import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";

// Settings → Services — the admin-defined catalogue of sellable/buyable services
// (income ledger + GST rate per service). POS reads the active rows via
// /api/pos/services; this route is the management CRUD.

const serviceInclude = {
    account: { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
} as const;

const createSchema = z.object({
    name:              z.string().trim().min(1).max(120),
    accountId:         z.number().int().positive(),
    gstRateId:         z.number().int().positive().nullable().optional(),
    defaultPricePaise: z.number().int().nonnegative().nullable().optional(),
    sortOrder:         z.number().int().optional(),
    isActive:          z.boolean().optional(),
});

// GET /api/settings/pos-services — full list (incl. inactive) for the settings page.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.posService.findMany({
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: serviceInclude,
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch POS services");
    }
}

// POST /api/settings/pos-services — create a service.
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        // The ledger must be an INCOME-group account — the service's net posts there.
        const account = await prisma.account.findUnique({
            where:  { id: data.accountId },
            select: { group: { select: { type: true } } },
        });
        if (!account || account.group?.type !== "INCOME") {
            return NextResponse.json({ error: "Pick an income ledger for the service." }, { status: 422 });
        }
        const row = await prisma.posService.create({
            data: {
                name:              data.name,
                accountId:         data.accountId,
                gstRateId:         data.gstRateId ?? null,
                defaultPricePaise: data.defaultPricePaise ?? null,
                sortOrder:         data.sortOrder ?? 0,
                isActive:          data.isActive ?? true,
            },
            include: serviceInclude,
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        const conflict = prismaUniqueError(e, "A service with that name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create POS service");
    }
}
