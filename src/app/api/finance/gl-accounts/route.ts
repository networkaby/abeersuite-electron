import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { effectiveLedgerBalance } from "@/modules/accountancy/lib/effectiveBalance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const createSchema = z.object({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    groupId: z.number().int().positive(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]),
    description: z.string().trim().optional(),
    parentId: z.number().int().positive().optional(),
    // Opening balance written straight to the Account row; reports pick it
    // up via loadMasterOpeningBalances() in aggregateLedger.ts.
    openingBalance:     z.number().nonnegative().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
    openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

// GET /api/finance/gl-accounts
// Returns only pure GL accounts (no person/company identity linkage).
// Optional `type` query param filters by the parent group's type
// (ASSET | LIABILITY | INCOME | EXPENSE).
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const activeOnly = searchParams.get("activeOnly") !== "false";

    try {
        const accounts = await prisma.account.findMany({
            where: {
                personId: null,
                companyId: null,
                ...(activeOnly ? { isActive: true } : {}),
                ...(type
                    ? { group: { type: type as "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" } }
                    : {}),
            },
            orderBy: [{ code: "asc" }],
            include: {
                parent: { select: { id: true, code: true, name: true } },
                group:  { select: { id: true, name: true, type: true } },
                _count: { select: { lines: true } },
            },
        });
        // Replace the raw `balance` (transactions only) with the effective
        // closing balance (running + opening) so every consumer — chart of
        // accounts, voucher dropdowns, party combobox — shows numbers that
        // reconcile with the Balance Sheet.
        const accountsWithEffective = accounts.map((a) => ({
            ...a,
            balance: effectiveLedgerBalance(a),
        }));
        return NextResponse.json(accountsWithEffective);
    } catch (e) {
        return handleApiError(e, "Failed to fetch GL accounts");
    }
}

// POST /api/finance/gl-accounts
// Account `type` is no longer stored on the row — it's derived from the parent
// group. Caller must pass `groupId`; `normalBalance` is required.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    try {
        const account = await prisma.account.create({
            data: {
                code: body.code,
                name: body.name,
                groupId: body.groupId,
                normalBalance: body.normalBalance,
                description: body.description ?? null,
                parentId: body.parentId ?? null,
                openingBalance:     body.openingBalance ?? null,
                openingBalanceType: body.openingBalanceType ?? null,
                openingBalanceDate: body.openingBalanceDate ? new Date(body.openingBalanceDate) : null,
            },
        });
        return NextResponse.json(account, { status: 201 });
    } catch (e) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: `Code "${body.code}" already exists` }, { status: 409 });
        }
        return handleApiError(e, "Failed to create GL account");
    }
}
