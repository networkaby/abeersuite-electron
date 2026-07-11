import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";

type Params = { params: Promise<{ id: string }> };

// Only `creditLimit` is editable here for now. null = no credit (cash-only),
// 0 behaves identically, a positive value grants that much credit headroom.
const updateSchema = z.object({
    creditLimit: z.number().min(0).nullable(),
});

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

// PATCH /api/accounts/[id] — update the account's credit limit.
// People and companies share the Contacts (customers:*) permission set, so both
// person and company ledgers gate on customers:edit.
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

    try {
        const updated = await prisma.account.update({
            where: { id: accountId },
            data: { creditLimit: data.creditLimit },
            select: { id: true, creditLimit: true },
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update credit limit");
    }
}
