import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { parsePagination } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { effectiveAccountBalance, toNumber } from "@/modules/accountancy/lib/balance";
import { type GroupTypeStr } from "@/modules/accountancy/lib/groupNature";
import { toDateOnly } from "@/shared/lib/format/formatDate";

type AccountWithGroup = Awaited<ReturnType<typeof prisma.account.findMany>>[number] & {
    group: { id: number; name: string; type: GroupTypeStr } | null;
};

function serializeLedger<T extends AccountWithGroup>(a: T) {
    return {
        ...a,
        balance: effectiveAccountBalance(a),
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
    // Bank OD A/c only — sanctioned overdraft ceiling. See facilityLimit.ts.
    limit: z.string().trim().max(20).default(""),
    // Usable Fund tier override — "" reads as INSTANT. See bankParticulars.ts.
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
});

const emptyBank = (b: z.infer<typeof bankJsonSchema>): boolean =>
    !b.bankName && !b.branch && !b.accountNumber && !b.ifsc && !b.beneficiary && !b.limit && !b.fundTier;

// Loan-ledger particulars (Loans (Liability) / Secured Loans / Unsecured Loans).
const loanJsonSchema = z.object({
    lender: z.string().trim().max(120).default(""),
    loanAccountNumber: z.string().trim().max(40).default(""),
    principalAmount: z.string().trim().max(20).default(""),
    interestRate: z.string().trim().max(10).default(""),
    tenureMonths: z.string().trim().max(10).default(""),
    emiAmount: z.string().trim().max(20).default(""),
});

const emptyLoan = (l: z.infer<typeof loanJsonSchema>): boolean =>
    !l.lender && !l.loanAccountNumber && !l.principalAmount && !l.interestRate && !l.tenureMonths && !l.emiAmount;

// Credit-card-ledger particulars (Credit Card group).
const creditCardJsonSchema = z.object({
    bankName: z.string().trim().max(120).default(""),
    cardNetwork: z.string().trim().max(40).default(""),
    cardNumber: z.string().trim().max(20).default(""),
    billingDay: z.string().trim().max(10).default(""),
    dueDay: z.string().trim().max(10).default(""),
    limit: z.string().trim().max(20).default(""),
    // Usable Fund fields — "" reads as OTHER / CONVERTIBLE. See creditCardParticulars.ts.
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
    // Set when this card shares its limit with another card. See creditCardParticulars.ts.
    sharedLimitKey: z.string().trim().max(60).default(""),
});

const emptyCreditCard = (c: z.infer<typeof creditCardJsonSchema>): boolean =>
    !c.bankName && !c.cardNetwork && !c.cardNumber && !c.billingDay && !c.dueDay && !c.limit
    && !c.fundTier && !c.convertibility && !c.feePct && !c.sharedLimitKey;

// BNPL-ledger particulars (BNPL A/c group).
const bnplJsonSchema = z.object({
    provider: z.string().trim().max(120).default(""),
    // Sanctioned facility limit. See facilityLimit.ts.
    limit: z.string().trim().max(20).default(""),
    // Repayment window per purchase, in days — not a fixed monthly due date.
    // See bnplParticulars.ts.
    creditDays: z.string().trim().max(10).default(""),
    // Usable Fund fields — "" reads as OTHER / RESTRICTED. See bnplParticulars.ts.
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
});

const emptyBnpl = (b: z.infer<typeof bnplJsonSchema>): boolean =>
    !b.provider && !b.limit && !b.creditDays && !b.fundTier && !b.convertibility && !b.feePct;

// Wallet-ledger particulars (Wallets group). No limit — a prepaid balance,
// not a credit facility.
const walletJsonSchema = z.object({
    provider: z.string().trim().max(120).default(""),
    // Usable Fund fields — "" reads as OTHER / CONVERTIBLE. See walletParticulars.ts.
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
});

const emptyWallet = (w: z.infer<typeof walletJsonSchema>): boolean =>
    !w.provider && !w.fundTier && !w.convertibility && !w.feePct;

// Payment-gateway-ledger particulars (Payment Gateway group — already live
// as a real-config group, see personal.local.json).
const gatewayJsonSchema = z.object({
    provider: z.string().trim().max(120).default(""),
    // Usable Fund fields — "" reads as OTHER / CONVERTIBLE. See gatewayParticulars.ts.
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
});

const emptyGateway = (g: z.infer<typeof gatewayJsonSchema>): boolean =>
    !g.provider && !g.fundTier && !g.convertibility && !g.feePct;

const createSchema = z.object({
    name: z.string().trim().min(1).max(200),
    groupId: z.number().int().positive(),
    code: z.string().trim().max(32).nullish(),
    description: z.string().trim().max(1000).nullish(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    bankJson: bankJsonSchema.nullish(),
    loanJson: loanJsonSchema.nullish(),
    creditCardJson: creditCardJsonSchema.nullish(),
    bnplJson: bnplJsonSchema.nullish(),
    walletJson: walletJsonSchema.nullish(),
    gatewayJson: gatewayJsonSchema.nullish(),
    // Same master opening model used by Accountancy → Masters → Opening Balance.
    // Universal opening — no per-ledger date; always effective from the start
    // of the books, whether imported or created fresh.
    openingBalance: z.number().positive().nullish(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullish(),
}).superRefine((value, ctx) => {
    const hasAmount = value.openingBalance != null;
    const hasType = value.openingBalanceType != null;
    if (hasAmount === hasType) return;

    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Opening balance amount and Dr / Cr must be provided together",
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
                openingBalanceDate: null,
                ...(body.bankJson && !emptyBank(body.bankJson) ? { bankJson: body.bankJson } : {}),
                ...(body.loanJson && !emptyLoan(body.loanJson) ? { loanJson: body.loanJson } : {}),
                ...(body.creditCardJson && !emptyCreditCard(body.creditCardJson) ? { creditCardJson: body.creditCardJson } : {}),
                ...(body.bnplJson && !emptyBnpl(body.bnplJson) ? { bnplJson: body.bnplJson } : {}),
                ...(body.walletJson && !emptyWallet(body.walletJson) ? { walletJson: body.walletJson } : {}),
                ...(body.gatewayJson && !emptyGateway(body.gatewayJson) ? { gatewayJson: body.gatewayJson } : {}),
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
