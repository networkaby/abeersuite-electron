import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

/**
 * GET /api/parties/sync[?since=<iso>]
 *
 * Every customer and company as one flat "party" list, full or delta — the
 * server half of the browser's party replica (`partyCatalog.ts`).
 *
 * Why a replica at all: party lookup is the single most-repeated read in the
 * app. `/api/person?lookup=` fires on EVERY KEYSTROKE at the till, in Quick
 * Ticket, in every voucher's party picker — a database round trip per character
 * typed, to search a list that changes a few times a day. Holding the list makes
 * that search local and instant, and reduces the server's job to "anything new?"
 *
 * The row shape is dictated by what the live search can currently match on, so
 * that searching the replica returns the SAME parties as searching the server
 * (see `lookupAccounts` in /api/person):
 *
 *   • `name`, and EVERY `phone` — not just the primary one, because the live
 *     query is `phones: { some: … }`.
 *   • `aliases` — the ledger's alternate names, also matched today.
 *   • `address` + every `email` — only matched in `wide` mode, carried anyway so
 *     the Front Office helper search can run locally too.
 *   • `accountGroup` — what the Sundry Debtors / Sundry Creditors filter narrows
 *     by, so a Credit Note can still offer customers only.
 *   • `linkedCompanies` — a person's employers, offered as billing targets.
 *
 * INACTIVE ROWS ARE SENT, not filtered. A party that was just deactivated has to
 * reach the client so it can drop it; filtering here would leave it in the
 * replica forever, since a row that stops matching is indistinguishable from a
 * row that did not change. `counts` is of ACTIVE rows only, which is what the
 * client's merged table should equal — and the only way to notice a hard delete,
 * which no timestamp can report.
 */

/** Past this a delta stops being cheaper than starting over. */
const MAX_DELTA_WINDOW_MS = 24 * 60 * 60 * 1000;

const PARTY_INCLUDE = {
    account: {
        select: {
            id: true,
            group:   { select: { name: true } },
            aliases: { select: { alias: true } },
        },
    },
    phones: { select: { phone: true, isPrimary: true } },
    emails: { select: { email: true, isPrimary: true } },
} as const;

/** Primary first, then insertion order — the same precedence `selectPrimaryPhone`
 *  encodes, so the displayed contact matches what the live lookup would show. */
function ordered<T extends { isPrimary: boolean }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        // Captured BEFORE reading, so a row written mid-request still has an
        // `updatedAt` past it and is caught by the next delta rather than lost.
        const now = new Date();
        const sinceParam = req.nextUrl.searchParams.get("since");
        const since = sinceParam ? new Date(sinceParam) : null;

        const canDelta =
            since != null
            && !Number.isNaN(since.getTime())
            && now.getTime() - since.getTime() < MAX_DELTA_WINDOW_MS;

        const where = canDelta ? { updatedAt: { gt: since! } } : undefined;

        const [persons, companies, activePersons, activeCompanies] = await Promise.all([
            prisma.person.findMany({
                where,
                include: {
                    ...PARTY_INCLUDE,
                    companies: {
                        where: { unlinkedAt: null },
                        select: {
                            company: { select: { id: true, name: true, account: { select: { id: true } } } },
                        },
                    },
                },
                orderBy: { name: "asc" },
            }),
            prisma.company.findMany({ where, include: PARTY_INCLUDE, orderBy: { name: "asc" } }),
            prisma.person.count({ where: { isActive: true } }),
            prisma.company.count({ where: { isActive: true } }),
        ]);

        const parties = [
            ...persons.map((p) => ({
                // "customer" (not "person") matches the discriminator every
                // existing consumer already branches on.
                type: "customer" as const,
                id: p.id,
                name: p.name,
                isActive: p.isActive,
                address: p.address ?? null,
                phones: ordered(p.phones).map((x) => x.phone),
                emails: ordered(p.emails).map((x) => x.email),
                accountId: p.account?.id ?? null,
                accountGroup: p.account?.group?.name ?? null,
                aliases: p.account?.aliases.map((a) => a.alias) ?? [],
                linkedCompanies: p.companies.map((lc) => ({
                    id: lc.company.id,
                    name: lc.company.name,
                    accountId: lc.company.account?.id ?? null,
                })),
                updatedAt: p.updatedAt.toISOString(),
            })),
            ...companies.map((c) => ({
                type: "company" as const,
                id: c.id,
                name: c.name,
                isActive: c.isActive,
                address: c.address ?? null,
                phones: ordered(c.phones).map((x) => x.phone),
                emails: ordered(c.emails).map((x) => x.email),
                accountId: c.account?.id ?? null,
                accountGroup: c.account?.group?.name ?? null,
                aliases: c.account?.aliases.map((a) => a.alias) ?? [],
                linkedCompanies: [] as { id: number; name: string; accountId: number | null }[],
                updatedAt: c.updatedAt.toISOString(),
            })),
        ];

        return NextResponse.json({
            mode: canDelta ? "delta" : "full",
            computedAt: now.toISOString(),
            parties,
            counts: { customer: activePersons, company: activeCompanies },
        });
    } catch (e) {
        return handleApiError(e, "Failed to sync parties");
    }
}
