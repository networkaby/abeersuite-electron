import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import {
    aggregateClosingAsOf, loadNormalBalanceMap,
} from "@/modules/accountancy/lib/aggregateLedger";
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

// GET /api/accountancy/gl-accounts
// Returns only pure GL accounts (no person/company identity linkage) by default.
// Optional `type` query param filters by the parent group's type
// (ASSET | LIABILITY | INCOME | EXPENSE).
// `includeParties=true` also returns party ledgers (person/company-linked
// accounts) — used by Receipt / Payment voucher dialogs that need to credit /
// debit a party balance directly.
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const includeParties = searchParams.get("includeParties") === "true";

    try {
        const accounts = await prisma.account.findMany({
            where: {
                ...(includeParties ? {} : { personId: null, companyId: null }),
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
        // Truth-path closing from JournalLine (folds in master openings),
        // so the chart of accounts, voucher dropdowns and party combobox
        // all show numbers that match the Balance Sheet by construction.
        const nbMap = await loadNormalBalanceMap();
        const closingMap = await aggregateClosingAsOf(new Date(), nbMap);
        const accountsWithEffective = accounts.map((a) => ({
            ...a,
            balance: closingMap.get(a.id) ?? 0,
        }));
        return NextResponse.json(accountsWithEffective);
    } catch (e) {
        return handleApiError(e, "Failed to fetch GL accounts");
    }
}

// POST /api/accountancy/gl-accounts
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
