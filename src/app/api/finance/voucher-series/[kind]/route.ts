import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    label:           z.string().trim().min(1).max(50).optional(),
    fyStartYear:     z.number().int().min(1900).max(9999).nullable().optional(),
    typeEnabled:     z.boolean().optional(),
    typeValue:       z.string().max(10).optional(),
    userEnabled:     z.boolean().optional(),
    userMaxWidth:    z.number().int().min(1).max(10).optional(),
    yearEnabled:     z.boolean().optional(),
    yearFormat:      z.enum(["CALENDAR", "CALENDAR_SHORT", "FY_SHORT", "FY_LONG"]).optional(),
    startFrom:       z.number().int().min(1).optional(),
    padWidth:        z.number().int().min(1).max(10).optional(),
    // CSV of reserved tokens (type/user/year/number) and arbitrary literals
    // (e.g. "/", "-", "india"). Anything not a reserved token is taken as-is.
    partOrder:       z.string().min(1).max(200).optional(),
});

// PATCH /api/finance/voucher-series/[kind]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ kind: string }> },
) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const { kind } = await params;

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;

    try {
        const series = await prisma.voucherSeries.update({
            where: { kind },
            data: data,
        });
        return NextResponse.json(series);
    } catch {
        return NextResponse.json({ error: "Voucher series not found" }, { status: 404 });
    }
}
