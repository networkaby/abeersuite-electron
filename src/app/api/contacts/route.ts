import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, parsePagination } from "@/shared/lib/api";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Paginated, filterable Contacts (People) list — the "big list" workspace.
 * Companies keep their own explorer; HubSpot-style Contacts = people.
 */
const CONTACT_SELECT = {
    id: true,
    name: true,
    lifecycleStage: true,
    ownerPositionId: true,
    tags: true,
    isActive: true,
    createdAt: true,
    owner: {
        select: {
            id: true,
            title: true,
            branch: { select: { name: true } },
            holders: { select: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } } },
        },
    },
    account: { select: { id: true } },
    phones: { select: { phone: true, isPrimary: true } },
    emails: { select: { email: true, isPrimary: true } },
    _count: { select: { dealTickets: true } },
} as const;

const LIFECYCLES = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"] as const;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const sp = new URL(req.url).searchParams;
        const { take, skip, page } = parsePagination(sp, { defaultLimit: 50, maxLimit: 200 });

        const q = sp.get("q")?.trim();
        const lifecycle = sp.get("lifecycleStage")?.trim();
        const ownerPositionId = sp.get("ownerPositionId")?.trim();
        const tag = sp.get("tag")?.trim();
        const hasDeal = sp.get("hasDeal"); // "1" | "0"
        const sort = sp.get("sort") ?? "recent";
        const includeInactive = sp.get("inactive") === "1";

        const where: Prisma.PersonWhereInput = {
            ...(includeInactive ? {} : { isActive: true }),
            ...(lifecycle && (LIFECYCLES as readonly string[]).includes(lifecycle)
                ? { lifecycleStage: lifecycle as (typeof LIFECYCLES)[number] }
                : {}),
            ...(ownerPositionId === "none"
                ? { ownerPositionId: null }
                : ownerPositionId
                    ? { ownerPositionId }
                    : {}),
            ...(tag ? { tags: { has: tag } } : {}),
            ...(hasDeal === "1" ? { dealTickets: { some: {} } } : hasDeal === "0" ? { dealTickets: { none: {} } } : {}),
            ...(q
                ? {
                      OR: [
                          { name: { contains: q, mode: "insensitive" as const } },
                          { phones: { some: { phone: { contains: q } } } },
                          { emails: { some: { email: { contains: q, mode: "insensitive" as const } } } },
                      ],
                  }
                : {}),
        };

        const orderBy: Prisma.PersonOrderByWithRelationInput =
            sort === "name" ? { name: "asc" } : sort === "stage" ? { lifecycleStage: "asc" } : { createdAt: "desc" };

        const [items, total] = await Promise.all([
            prisma.person.findMany({ where, orderBy, take, skip, select: CONTACT_SELECT }),
            prisma.person.count({ where }),
        ]);

        // Keep the old `_count.deals` shape for the contacts list badge.
        const shaped = items.map((i) => ({ ...i, _count: { deals: i._count.dealTickets } }));
        return NextResponse.json({ items: shaped, total, page, pageSize: take });
    } catch (e) {
        return handleApiError(e, "Failed to fetch contacts");
    }
}
