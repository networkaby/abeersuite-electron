import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { runCustomerImport } from "@/shared/lib/import/customerImport";

// `z.record(enum, ...)` in Zod 4 enforces every enum key — not what we want
// here since most CSV rows fill only a subset. Use plain string keys; the
// import lib reads only the known field names off the bag.
const rowSchema = z.object({
    rowIndex: z.number().int().min(0),
    values: z.record(z.string(), z.string()),
});

const previewSchema = z.object({
    rows: z.array(rowSchema).max(10000),
    mode: z.enum(["skip", "update"]),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/customer-import/preview — validate without writing.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, previewSchema);
    if (error) return error;

    const result = await runCustomerImport({
        rows: data.rows,
        mode: data.mode,
        dryRun: true,
    });
    return NextResponse.json(result);
}
