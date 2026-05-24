import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { runCustomerImport } from "@/shared/lib/import/customerImport";

const rowSchema = z.object({
    rowIndex: z.number().int().min(0),
    values: z.record(z.string(), z.string()),
});

const commitSchema = z.object({
    rows: z.array(rowSchema).max(10000),
    mode: z.enum(["skip", "update"]),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/settings/customer-import/commit — actually create/update people.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, commitSchema);
    if (error) return error;

    try {
        const result = await runCustomerImport({
            rows: data.rows,
            mode: data.mode,
            dryRun: false,
        });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
