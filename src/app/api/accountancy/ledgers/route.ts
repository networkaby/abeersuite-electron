import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { parsePagination } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "@/modules/accountancy/lib/groupNature";
import { dateOnOrBefore, toDateOnly } from "@/shared/lib/format/formatDate";

type AccountWithGroup = Awaited<ReturnType<typeof prisma.account.findMany>>[number] & {
    group: { id: number; name: string; type: GroupTypeStr } | null;
};

function effectiveBalanceForList(a: AccountWithGroup): number {
    const nb = a.normalBalance
        ?? (a.group?.type ? defaultNormalBalanceForGroupType(a.group.type) : "DEBIT");
    let bal = toNumber(a.balance);
    if (a.openingBalance != null && a.openingBalanceType) {
        if (!a.openingBalanceDate || dateOnOrBefore(a.openingBalanceDate, new Date())) {
            bal += balanceDelta(nb, a.openingBalanceType, toNumber(a.openingBalance));
        }
    }
    return bal;
}

function serializeLedger<T extends AccountWithGroup>(a: T) {
    return {
        ...a,
        balance: effectiveBalanceForList(a),
        openingBalance: a.openingBalance != null ? toNumber(a.openingBalance) : null,
        openingBalanceDate: a.openingBalanceDate ? toDateOnly(a.openingBalanceDate) : null,
    };
}

// Bank-ledger particulars (ledgers under the Bank groups) — printed on the
// Contra deposit slip. All-blank → stored as null. (Kept local: route files
// may only export handlers; the [id] route carries its own copy, like lineSchema.)
const bankJsonSchema = z.object({
    bankName: z.string().trim().max(120).default(""),
    branch: z.string().trim().max(120).default(""),
    accountNumber: z.string().trim().max(40).default(""),
    ifsc: z.string().trim().max(20).default(""),
    beneficiary: z.string().trim().max(120).default(""),
});

const emptyBank = (b: z.infer<typeof bankJsonSchema>): boolean =>
    !b.bankName && !b.branch && !b.accountNumber && !b.ifsc && !b.beneficiary;

const createSchema = z.object({
    name: z.string().trim().min(1).max(200),
    groupId: z.number().int().positive(),
    code: z.string().trim().max(32).nullish(),
    description: z.string().trim().max(1000).nullish(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    bankJson: bankJsonSchema.nullish(),
    // Same master opening model used by Accountancy → Masters → Opening Balance.
    openingBalance: z.number().positive().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
    openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
}).superRefine((value, ctx) => {
    const hasAmount = value.openingBalance != null;
    const hasType = value.openingBalanceType != null;
    const hasDate = value.openingBalanceDate != null;
    if (hasAmount === hasType && hasAmount === hasDate) return;

    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Opening balance amount, Dr / Cr, and date must be provided together",
        path: ["openingBalance"],
    });
});

// GET /api/accountancy/ledgers
// Without groupId → pure GL accounts (no person/company), flat array (existing behaviour)
// With groupId    → ALL account types in that group, paginated: { items, total }
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get("groupId");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const search = searchParams.get("search")?.trim() ?? "";
    const { take: limit, page } = parsePagination(searchParams, { defaultLimit: 20, maxLimit: 100 });

    try {
        // ── Mode B: paginated drill-down for a specific group ──────────────────
        if (groupId) {
            const where = {
                groupId: Number(groupId),
                ...(activeOnly ? { isActive: true } : {}),
                ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
            };
            const [items, total] = await prisma.$transaction([
                prisma.account.findMany({
                    where,
                    orderBy: { name: "asc" },
                    skip: (page - 1) * limit,
                    take: limit,
                    include: {
                        group: { select: { id: true, name: true, type: true } },
                    },
                }),
                prisma.account.count({ where }),
            ]);
            return NextResponse.json({ items: items.map((i) => serializeLedger(i)), total });
        }

        // ── Mode A: pure GL accounts, flat array (original behaviour) ──────────
        const ledgers = await prisma.account.findMany({
            where: {
                personId: null,
                companyId: null,
                ...(activeOnly ? { isActive: true } : {}),
            },
            orderBy: [{ groupId: "asc" }, { name: "asc" }],
            include: {
                group: { select: { id: true, name: true, type: true } },
            },
        });
        return NextResponse.json(ledgers.map((l) => serializeLedger(l)));
    } catch (e) {
        return handleApiError(e, "Failed to fetch ledgers");
    }
}

// POST /api/accountancy/ledgers — create a new ledger account
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_CREATE);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    try {
        const account = await prisma.account.create({
            data: {
                name: body.name,
                groupId: body.groupId,
                code: body.code ?? null,
                description: body.description ?? null,
                normalBalance: body.normalBalance ?? null,
                openingBalance: body.openingBalance ?? null,
                openingBalanceType: body.openingBalanceType ?? null,
                openingBalanceDate: body.openingBalanceDate ? new Date(body.openingBalanceDate) : null,
                ...(body.bankJson && !emptyBank(body.bankJson) ? { bankJson: body.bankJson } : {}),
            },
        });
        if (body.openingBalance != null) await reconcileOpeningSuspense();
        return NextResponse.json(account, { status: 201 });
    } catch (e) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: `Code "${body.code}" already exists` }, { status: 409 });
        }
        return handleApiError(e, "Failed to create ledger");
    }
}
