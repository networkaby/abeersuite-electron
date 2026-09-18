import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { importStatement } from "@/modules/accountancy/lib/bankReconciliation";
import { accountIdOf, reconError } from "@/modules/accountancy/lib/bankReconRoute";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");
const money = z.number().finite().nonnegative().nullable();

// POST /api/accountancy/bank-reconciliation/[accountId]/imports
//
// The browser has already read the file and normalised the bank's layout into
// the one row shape; the server re-checks what must not be trusted from a
// browser — the ledger, the lock, the identity of the account, the running
// balance, and whether any of it was saved before. `dryRun: true` reports the
// counts and warnings without writing (the preview); the same body without it
// saves.
const schema = z.object({
    fileName: z.string().trim().min(1).max(200),
    fileHash: z.string().regex(/^[0-9a-f]{40}$/),
    profile: z.string().trim().min(1).max(40),
    meta: z.object({
        bankAccountNumber: z.string().max(40).nullable().optional(),
        ifsc: z.string().max(20).nullable().optional(),
        fromDate: iso.nullable().optional(),
        toDate: iso.nullable().optional(),
        openingBalance: z.number().finite().nullable().optional(),
    }).default({}),
    rows: z.array(z.object({
        date: iso,
        valueDate: iso.nullable().optional(),
        narration: z.string().max(1000),
        reference: z.string().max(120).nullable(),
        withdrawal: money,
        deposit: money,
        balance: z.number().finite().nullable(),
    })).max(20000),
    dryRun: z.boolean().default(false),
    force: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
    if (response) return response;
    const { id, error: idError } = accountIdOf(await params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const report = await importStatement(id, user!.id, {
            fileName: data.fileName,
            fileHash: data.fileHash,
            profile: data.profile,
            meta: data.meta,
            rows: data.rows.map((r) => ({ ...r, valueDate: r.valueDate ?? null })),
            dryRun: data.dryRun,
            force: data.force,
        });
        return NextResponse.json(report, { status: report.importId ? 201 : 200 });
    } catch (e) {
        return reconError(e, "Failed to import bank statement");
    }
}
