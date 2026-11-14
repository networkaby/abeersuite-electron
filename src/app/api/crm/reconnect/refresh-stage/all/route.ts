import { CUSTOMER_SALE_VOUCHER_TYPES } from "@/shared/lib/constants/accounting";
import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

const SALE_TYPES = CUSTOMER_SALE_VOUCHER_TYPES;

// POST /api/crm/reconnect/refresh-stage/all
// Bulk version of refresh-stage — rechecks EVERY Lead/Prospect customer's real
// record (any posted sale or repair) and bumps the ones that qualify straight to
// Customer. Never downgrades, never touches Inactive. Two batched "who has
// transacted" queries + two updateMany calls — no per-customer round trips, so
// it completes in one request even across the whole customer base.
export async function POST() {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;
    try {
        const [persons, companies] = await Promise.all([
            prisma.person.findMany({
                where: { isActive: true, lifecycleStage: { in: ["LEAD", "PROSPECT"] } },
                select: { id: true, account: { select: { id: true } } },
            }),
            prisma.company.findMany({
                where: { isActive: true, lifecycleStage: { in: ["LEAD", "PROSPECT"] } },
                select: { id: true, account: { select: { id: true } } },
            }),
        ]);

        const accountIds = [
            ...persons.map((p) => p.account?.id),
            ...companies.map((c) => c.account?.id),
        ].filter((x): x is number => x != null);

        const transacted = new Set<number>();
        if (accountIds.length) {
            const [sales, repairs] = await Promise.all([
                prisma.universalVoucher.findMany({
                    where: { partyAccountId: { in: accountIds }, status: "POSTED", type: { in: [...SALE_TYPES] } },
                    select: { partyAccountId: true },
                    distinct: ["partyAccountId"],
                }),
                prisma.ticket.findMany({
                    where: { accountId: { in: accountIds }, repair: { isNot: null } },
                    select: { accountId: true },
                    distinct: ["accountId"],
                }),
            ]);
            for (const s of sales) if (s.partyAccountId != null) transacted.add(s.partyAccountId);
            for (const t of repairs) if (t.accountId != null) transacted.add(t.accountId);
        }

        const personIds = persons.filter((p) => p.account?.id != null && transacted.has(p.account.id)).map((p) => p.id);
        const companyIds = companies.filter((c) => c.account?.id != null && transacted.has(c.account.id)).map((c) => c.id);

        const [personRes, companyRes] = await Promise.all([
            personIds.length
                ? prisma.person.updateMany({ where: { id: { in: personIds } }, data: { lifecycleStage: "CUSTOMER" } })
                : Promise.resolve({ count: 0 }),
            companyIds.length
                ? prisma.company.updateMany({ where: { id: { in: companyIds } }, data: { lifecycleStage: "CUSTOMER" } })
                : Promise.resolve({ count: 0 }),
        ]);

        return NextResponse.json({ checked: persons.length + companies.length, updated: personRes.count + companyRes.count });
    } catch (e) {
        return handleApiError(e, "Failed to refresh stages");
    }
}
