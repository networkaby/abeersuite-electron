import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { defaultNormalBalanceForGroupType } from "@/modules/accountancy/lib/groupNature";
import { dateOnOrBefore, toDateOnly } from "@/shared/lib/format/formatDate";

// Bank-ledger particulars — same shape as the create route (kept local: route
// files may only export handlers). All-blank or null clears the stored value.
const bankJsonSchema = z.object({
    bankName: z.string().trim().max(120).default(""),
    branch: z.string().trim().max(120).default(""),
    accountNumber: z.string().trim().max(40).default(""),
    ifsc: z.string().trim().max(20).default(""),
    beneficiary: z.string().trim().max(120).default(""),
});

const emptyBank = (b: z.infer<typeof bankJsonSchema>): boolean =>
    !b.bankName && !b.branch && !b.accountNumber && !b.ifsc && !b.beneficiary;

const updateSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    groupId: z.number().int().positive().nullable().optional(),
    code: z.string().trim().max(32).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
    bankJson: bankJsonSchema.nullable().optional(),
    openingBalance: z.number().nullable().optional(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullable().optional(),
    openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.openingBalance === undefined) return;
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

// PATCH /api/accountancy/ledgers/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_MASTERS_EDIT);
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
        const account = await prisma.account.update({
            where: { id },
            data: {
                ...pickDefined({
                    name: body.name,
                    groupId: body.groupId,
                    code: body.code,
                    description: body.description,
                    isActive: body.isActive,
                }),
                // undefined = untouched; null / all-blank clears the stored value.
                ...(body.bankJson !== undefined
                    ? { bankJson: body.bankJson && !emptyBank(body.bankJson) ? body.bankJson : Prisma.DbNull }
                    : {}),
                ...(body.openingBalance !== undefined
                    ? {
                        openingBalance: body.openingBalance,
                        openingBalanceType: body.openingBalanceType,
                        openingBalanceDate: body.openingBalanceDate ? new Date(body.openingBalanceDate) : null,
                    }
                    : {}),
            },
            include: { group: { select: { id: true, name: true, type: true } } },
        });
        if (body.openingBalance !== undefined) await reconcileOpeningSuspense();
        const nb = account.normalBalance
            ?? (account.group?.type ? defaultNormalBalanceForGroupType(account.group.type) : "DEBIT");
        let effectiveBal = toNumber(account.balance);
        if (account.openingBalance != null && account.openingBalanceType) {
            if (!account.openingBalanceDate || dateOnOrBefore(account.openingBalanceDate, new Date())) {
                effectiveBal += balanceDelta(nb, account.openingBalanceType, toNumber(account.openingBalance));
            }
        }
        return NextResponse.json({
            ...account,
            balance: effectiveBal,
            openingBalance: account.openingBalance != null ? toNumber(account.openingBalance) : null,
            openingBalanceDate: account.openingBalanceDate ? toDateOnly(account.openingBalanceDate) : null,
        });
    } catch (e) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: `Code "${body.code}" already exists` }, { status: 409 });
        }
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
        select: { id: true, personId: true, companyId: true, _count: { select: { children: true } } },
    });
    if (!account) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    // Identity ledgers belong to a customer/company — remove the contact instead.
    if (account.personId !== null || account.companyId !== null) {
        return NextResponse.json(
            { error: "This ledger belongs to a customer/company — delete the contact instead" },
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
