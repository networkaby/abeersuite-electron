import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { runProductImport } from "@/shared/lib/import/productImport";

// `z.record(enum, ...)` in Zod 4 enforces every enum key — not what we want
// here since most CSV rows fill only a subset. Use plain string keys; the
// import lib reads only the known field names off the bag.
const rowSchema = z.object({
    rowIndex: z.number().int().min(0),
    values: z.record(z.string(), z.string()),
});

const commitSchema = z.object({
    rows: z.array(rowSchema).max(10000),
    mode: z.enum(["skip", "update", "patch"]),
    autoCreateMasters: z.boolean().optional().default(true),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/settings/item-import/commit — actually create/update products.
export async function POST(req: Request) {
    const { response } = await requireModuleAccess("inventory");
    if (response) return response;

    const { data, error } = await validateRequest(req, commitSchema);
    if (error) return error;

    try {
        const result = await runProductImport({
            rows: data.rows,
            mode: data.mode,
            dryRun: false,
            autoCreateMasters: data.autoCreateMasters,
        });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
