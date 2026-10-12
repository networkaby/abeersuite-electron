import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { resetReconciliationOnOpening } from "@/modules/accountancy/lib/reconciliation";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";
import { toDateOnly } from "@/shared/lib/format/formatDate";
import { ALIAS_MAX_LENGTH, aliasRows } from "@/modules/accountancy/lib/accountAlias";

// Bank-ledger particulars — same shape as the create route (kept local: route
// files may only export handlers). All-blank or null clears the stored value.
const bankJsonSchema = z.object({
    bankName: z.string().trim().max(120).default(""),
    branch: z.string().trim().max(120).default(""),
    accountNumber: z.string().trim().max(40).default(""),
    ifsc: z.string().trim().max(20).default(""),
    beneficiary: z.string().trim().max(120).default(""),
    limit: z.string().trim().max(20).default(""),
    // Usable Fund tier override — "" reads as INSTANT. See bankParticulars.ts.
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
});

const emptyBank = (b: z.infer<typeof bankJsonSchema>): boolean =>
    !b.bankName && !b.branch && !b.accountNumber && !b.ifsc && !b.beneficiary && !b.limit && !b.fundTier;

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

const bnplJsonSchema = z.object({
    provider: z.string().trim().max(120).default(""),
    limit: z.string().trim().max(20).default(""),
    // Repayment window per purchase, in days — not a fixed monthly due date.
    // See bnplParticulars.ts.
    creditDays: z.string().trim().max(10).default(""),
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
});

const emptyBnpl = (b: z.infer<typeof bnplJsonSchema>): boolean =>
    !b.provider && !b.limit && !b.creditDays && !b.fundTier && !b.convertibility && !b.feePct;

const walletJsonSchema = z.object({
    provider: z.string().trim().max(120).default(""),
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
});

const emptyWallet = (w: z.infer<typeof walletJsonSchema>): boolean =>
    !w.provider && !w.fundTier && !w.convertibility && !w.feePct;

const gatewayJsonSchema = z.object({
    provider: z.string().trim().max(120).default(""),
    fundTier: z.enum(["", "INSTANT", "OTHER"]).default(""),
    convertibility: z.enum(["", "CONVERTIBLE", "RESTRICTED", "UNAVAILABLE"]).default(""),
    feePct: z.string().trim().max(10).default(""),
});

const emptyGateway = (g: z.infer<typeof gatewayJsonSchema>): boolean =>
    !g.provider && !g.fundTier && !g.convertibility && !g.feePct;

const updateSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    groupId: z.number().int().positive().nullable().optional(),
    // Full replacement set — omit to leave aliases untouched, [] to clear them.
    aliases: z.array(z.string().trim().max(ALIAS_MAX_LENGTH)).max(20).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
    bankJson: bankJsonSchema.nullable().optional(),
    loanJson: loanJsonSchema.nullable().optional(),
    creditCardJson: creditCardJsonSchema.nullable().optional(),
    bnplJson: bnplJsonSchema.nullable().optional(),
    walletJson: walletJsonSchema.nullable().optional(),
    gatewayJson: gatewayJsonSchema.nullable().optional(),
    openingBalance: z.number().nullable().optional(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.openingBalance === undefined) return;
    const hasAmount = value.openingBalance != null;
    const hasType = value.openingBalanceType != null;
    if (hasAmount === hasType) return;
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Opening balance amount and Dr / Cr must be provided together",
        path: ["openingBalance"],
    });
});

// PATCH /api/accountancy/ledgers/[id]
// requireAuth, not requirePermission: the ledger master-data dialogs stay
// gated by ACCOUNTANCY_MASTERS_EDIT in the UI, but this same route also
// saves the alias/keyword field from the customer profile page — permissions
// are UI-only here (see AGENTS.md), so the API stays open to any signed-in user.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;
    const body = data;

    if (body.groupId) {
        const group = await prisma.accountGroup.findUnique({ where: { id: body.groupId } });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
    }

    try {
        // A new opening reaches every day the ledger has — its lock starts over.
        if (body.openingBalance !== undefined) {
            await resetReconciliationOnOpening(prisma, id, { amount: body.openingBalance, type: body.openingBalanceType ?? null });
        }
        const account = await prisma.account.update({
            where: { id },
            data: {
                ...pickDefined({
                    name: body.name,
                    groupId: body.groupId,
                    description: body.description,
                    isActive: body.isActive,
                }),
                // undefined = untouched; null / all-blank clears the stored value.
                ...(body.bankJson !== undefined
                    ? { bankJson: body.bankJson && !emptyBank(body.bankJson) ? body.bankJson : Prisma.DbNull }
                    : {}),
                ...(body.loanJson !== undefined
                    ? { loanJson: body.loanJson && !emptyLoan(body.loanJson) ? body.loanJson : Prisma.DbNull }
                    : {}),
                ...(body.creditCardJson !== undefined
                    ? { creditCardJson: body.creditCardJson && !emptyCreditCard(body.creditCardJson) ? body.creditCardJson : Prisma.DbNull }
                    : {}),
                ...(body.bnplJson !== undefined
                    ? { bnplJson: body.bnplJson && !emptyBnpl(body.bnplJson) ? body.bnplJson : Prisma.DbNull }
                    : {}),
                ...(body.walletJson !== undefined
                    ? { walletJson: body.walletJson && !emptyWallet(body.walletJson) ? body.walletJson : Prisma.DbNull }
                    : {}),
                ...(body.gatewayJson !== undefined
                    ? { gatewayJson: body.gatewayJson && !emptyGateway(body.gatewayJson) ? body.gatewayJson : Prisma.DbNull }
                    : {}),
                ...(body.openingBalance !== undefined
                    ? {
                        openingBalance: body.openingBalance,
                        openingBalanceType: body.openingBalanceType,
                        // Universal opening — no per-ledger date, always from the start of the books.
                        openingBalanceDate: null,
                    }
                    : {}),
                // Replacement set: wipe the old rows and write the new ones in the
                // same statement, so freeing an alias and re-using it on this same
                // ledger never trips the unique index.
                ...(body.aliases !== undefined
                    ? { aliases: { deleteMany: {}, create: aliasRows(body.aliases) } }
                    : {}),
            },
            include: {
                group: { select: { id: true, name: true, type: true } },
                aliases: { select: { alias: true }, orderBy: { id: "asc" } },
            },
        });
        if (body.openingBalance !== undefined) await reconcileOpeningSuspense();
        const balances = await closingForAccounts(null, [account.id]);
        return NextResponse.json({
            ...account,
            aliases: account.aliases.map((x) => x.alias),
            balance: balances.get(account.id) ?? 0,
            openingBalance: account.openingBalance != null ? toNumber(account.openingBalance) : null,
            openingBalanceDate: account.openingBalanceDate ? toDateOnly(account.openingBalanceDate) : null,
        });
    } catch (e) {
        return handleApiError(e, "Failed to update ledger");
    }
}

// DELETE /api/accountancy/ledgers/[id] — hard delete, gated on data integrity
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_DELETE);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const account = await prisma.account.findUnique({
        where: { id },
        select: {
            id: true, personId: true, companyId: true,
            staffLedgerOf: { select: { user: { select: { name: true } } } },
            _count: { select: { children: true } },
        },
    });
    if (!account) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    // Identity ledgers belong to a customer/company — remove the contact instead.
    if (account.personId !== null || account.companyId !== null) {
        return NextResponse.json(
            { error: "This ledger belongs to a customer/company — delete the contact instead" },
            { status: 409 },
        );
    }
    // A staff member's salary ledger is HR's, opened with their profile. Even an
    // empty one is not free to go: a draft payroll run has already frozen its id,
    // and posting that run would credit a ledger that no longer exists.
    if (account.staffLedgerOf) {
        return NextResponse.json(
            { error: `This is ${account.staffLedgerOf.user.name}'s salary ledger — it belongs to their staff profile and cannot be deleted` },
            { status: 409 },
        );
    }
    // Never orphan posted ledger entries — trial balance must stay intact.
    const lineCount = await prisma.voucherGlLine.count({ where: { accountId: id } });
    if (lineCount > 0) {
        return NextResponse.json({ error: "Cannot delete — ledger has posted entries" }, { status: 409 });
    }
    if (account._count.children > 0) {
        return NextResponse.json({ error: "Cannot delete — ledger has sub-accounts" }, { status: 409 });
    }

    try {
        await prisma.account.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        // Any remaining FK reference (branch vault, counter till, loyalty, coupon…).
        if (e && typeof e === "object" && "code" in e && e.code === "P2003") {
            return NextResponse.json({ error: "Cannot delete — ledger is in use elsewhere" }, { status: 409 });
        }
        return handleApiError(e, "Failed to delete ledger");
    }
}
