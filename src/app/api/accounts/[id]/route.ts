import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { z } from "zod";
import { validateRequest, handleApiError, pickDefined } from "@/shared/lib/api";

type Params = { params: Promise<{ id: string }> };

// Party-ledger edits reachable from the Contacts profile. `creditLimit`:
// null = no credit (cash-only), 0 behaves identically, a positive value grants
// that much credit headroom. `accountGroup` flips the ledger between Sundry
// Debtors (customer) and Sundry Creditors (supplier) — resolved to a groupId
// server-side so the client never needs the group's primary key. The three
// `opening*` fields mirror the Accountancy Masters opening-balance editor —
// same columns, just reachable at customers:edit instead of
// accountancy-masters:edit so front-desk staff can set it while onboarding
// a customer. Pass a null amount to clear.
const updateSchema = z.object({
    creditLimit: z.number().min(0).nullable().optional(),
    accountGroup: z
        .enum([ACCOUNT_GROUPS.SUNDRY_DEBTORS, ACCOUNT_GROUPS.SUNDRY_CREDITORS])
        .optional(),
    openingBalance:     z.number().nullable().optional(),
    openingBalanceType: z.enum(["DEBIT", "CREDIT"]).nullable().optional(),
    openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).refine(
    (d) => d.creditLimit !== undefined || d.accountGroup !== undefined || d.openingBalance !== undefined,
    { message: "Nothing to update" },
);

// GET /api/accounts/[id] — single ledger account
export async function GET(_: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
        include: {
            person: {
                select: {
                    id: true,
                    name: true,
                    phones: selectPrimaryPhone,
                },
            },
            company: {
                select: {
                    id: true,
                    name: true,
                    phones: selectPrimaryPhone,
                },
            },
        },
    });

    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
        ...account,
        person: account.person ? {
            id: account.person.id,
            name: account.person.name,
            phone: account.person.phones[0]?.phone ?? null,
        } : null,
        company: account.company ? {
            id: account.company.id,
            name: account.company.name,
            phone: account.company.phones[0]?.phone ?? null,
        } : null,
    });
}

// PATCH /api/accounts/[id] — update the account's credit limit, group, and/or
// opening balance. People and companies share the Contacts (customers:*)
// permission set, so both person and company ledgers gate on customers:edit.
export async function PATCH(req: Request, { params }: Params) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const accountId = Number(id);

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, personId: true, companyId: true },
    });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // A bare GL account (no party) has no customer-facing credit limit to set.
    if (!account.personId && !account.companyId) {
        return NextResponse.json(
            { error: "Credit limit only applies to a customer or company ledger." },
            { status: 400 },
        );
    }

    if (!hasPermission(user, PERMISSIONS.CUSTOMERS_EDIT)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await validateRequest(req, updateSchema);
    if (error) return error;

    // Resolve the group name → id when the caller is reclassifying the party.
    let groupId: number | undefined;
    if (data.accountGroup !== undefined) {
        const group = await prisma.accountGroup.findFirst({
            where: { name: data.accountGroup },
            select: { id: true },
        });
        if (!group) {
            return NextResponse.json(
                { error: `Group "${data.accountGroup}" not found` },
                { status: 400 },
            );
        }
        groupId = group.id;
    }

    // Opening balance is a Dr/Cr trio — setting an amount requires the type
    // alongside it, a null amount clears all three at once.
    let openingPatch: {
        openingBalance: number | null;
        openingBalanceType: "DEBIT" | "CREDIT" | null;
        openingBalanceDate: Date | null;
    } | undefined;
    if (data.openingBalance !== undefined) {
        if (data.openingBalance !== null && !data.openingBalanceType) {
            return NextResponse.json({ error: "openingBalanceType is required when setting an opening balance" }, { status: 400 });
        }
        openingPatch = {
            openingBalance:     data.openingBalance,
            openingBalanceType: data.openingBalance === null ? null : data.openingBalanceType!,
            openingBalanceDate: data.openingBalance === null ? null : (data.openingBalanceDate ? new Date(data.openingBalanceDate) : null),
        };
    }

    try {
        const updated = await prisma.account.update({
            where: { id: accountId },
            data: pickDefined({ creditLimit: data.creditLimit, groupId, ...openingPatch }),
            select: { id: true, creditLimit: true, groupId: true, openingBalance: true, openingBalanceType: true, openingBalanceDate: true },
        });
        if (openingPatch) await reconcileOpeningSuspense();
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update account");
    }
}
