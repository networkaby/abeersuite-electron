import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasPermission, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { partyBalances } from "@/modules/mobile/partyBalances";

const PAGE_SIZE = 30;

const phones = { select: { phone: true }, orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }], take: 1 };

// GET /api/mobile/parties?q=<name or phone>&page=<n>
//
// The phone app's party search: one page of party ledgers (Person / Company
// accounts) matching the name or a phone number, each with its balance summed
// from the ledger — a bounded set, so no reliance on the Account.balance cache.
//
// `balance` is signed the party's way round (see partyBalances). One party's
// balance and unpaid bills: /api/mobile/parties/[accountId].
//
// Suppliers are left out unless the person holds "Show suppliers (creditors)",
// the same rule the Contacts lists follow.
export async function GET(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.MOBILE_PARTIES_VIEW);
    if (response) return response;

    try {
        const params = req.nextUrl.searchParams;
        const q = (params.get("q") ?? "").trim();
        const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
        const digits = q.replace(/\D/g, "");
        const byPhone = digits.length >= 4 && digits.length === q.replace(/[\s+-]/g, "").length;

        const where: Prisma.AccountWhereInput = {
            isActive: true,
            OR: [{ personId: { not: null } }, { companyId: { not: null } }],
            AND: [
                ...(hasPermission(user, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS)
                    ? []
                    : [{ NOT: { group: { type: "LIABILITY" as const } } }]),
                ...(q === ""
                    ? []
                    : byPhone
                        ? [{
                            OR: [
                                { person: { phones: { some: { phone: { contains: digits } } } } },
                                { company: { phones: { some: { phone: { contains: digits } } } } },
                            ],
                        }]
                        : q.split(/\s+/).slice(0, 5).map((w) => ({
                            OR: [
                                { name: { contains: w, mode: "insensitive" as const } },
                                { aliases: { some: { alias: { contains: w, mode: "insensitive" as const } } } },
                            ],
                        }))),
            ],
        };

        const rows = await prisma.account.findMany({
            where,
            orderBy: { name: "asc" },
            skip: page * PAGE_SIZE,
            take: PAGE_SIZE + 1,
            select: {
                id: true,
                name: true,
                group: { select: { name: true } },
                person: { select: { phones } },
                company: { select: { phones } },
            },
        });

        const shown = rows.slice(0, PAGE_SIZE);
        const balances = await partyBalances(shown.map((r) => r.id));

        return NextResponse.json({
            items: shown.map((r) => ({
                accountId: r.id,
                name: r.name,
                group: r.group?.name ?? null,
                phone: r.person?.phones[0]?.phone ?? r.company?.phones[0]?.phone ?? null,
                balance: balances.get(r.id) ?? 0,
            })),
            hasMore: rows.length > PAGE_SIZE,
        });
    } catch (e) {
        return handleApiError(e, "Party search failed");
    }
}
