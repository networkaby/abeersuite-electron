import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { parseSince } from "@/shared/lib/prisma/counterMode";

/**
 * GET /api/parties/catalog?sync=1[&since=<iso>&count=<n>]
 *
 * The whole customer list, for every machine to hold and search in memory.
 *
 * This replaced a per-keystroke lookup endpoint, and the reason is the tiered
 * match: run-together splits, typos, letter-pair closeness — none of which can
 * be expressed as a SQL `contains`, and all of which the cashier needs while a
 * customer is standing there. It also replaced the guessing that came with a
 * partial pool: a search can only honestly say "nothing matched" over the whole
 * list. See shared/lib/parties/partyCatalog for the client half.
 *
 * Cheap to serve on both sides of the wire. On a counter every table below is in
 * the local replica (see prisma/sync-tables.json), so this is a local Postgres
 * read and not a bill from Supabase; on the web it is one full read per browser,
 * then deltas.
 *
 * Response, mirroring the product catalogue contract in
 * /api/inventory/products/lookup:
 *   { mode: "full",  parties, computedAt, count }
 *   { mode: "delta", changed, removedKeys, computedAt, count }
 *
 * `count` lets the client prove it has not silently missed a hard delete, which
 * no timestamp can report. `removedKeys` are "customer:12" / "company:4", since
 * Person and Company ids collide.
 */

/** Beyond this a delta is not worth trusting — the client refetches in full. */
const MAX_DELTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Primary first — every consumer shows `[0]` as the party's number. Only the
// value is selected: this ships ~3,500 parties on a first load, so a column
// nothing reads is a column not worth sending.
const phoneSelect = {
    select: { phone: true },
    orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }],
};
const emailSelect = {
    select: { email: true },
    orderBy: [{ isPrimary: "desc" as const }, { id: "asc" as const }],
};
const accountInclude = {
    account: {
        select: {
            id: true,
            group: { select: { name: true, type: true } },
            aliases: { select: { alias: true } },
        },
    },
};

/**
 * A delta asks one question: which parties moved since `since`?
 *
 * It is a question about `Person.updatedAt` / `Company.updatedAt` ONLY, which is
 * why `contactWrite.touchOwner` bumps the owning party on every phone and email
 * write. That is not a nicety: a phone is how a customer is FOUND, so a number
 * corrected without moving its owner is a correction that reaches no search box
 * anywhere. It also covers what nothing else can — a DELETED phone leaves no row
 * behind for any timestamp to report, so the parent moving is the only signal
 * there will ever be.
 */
type PartyWhere = { isActive?: boolean; updatedAt?: { gt: Date } };

async function loadParties(where: PartyWhere) {
    const [persons, companies] = await Promise.all([
        prisma.person.findMany({
            where,
            include: {
                ...accountInclude,
                phones: phoneSelect,
                emails: emailSelect,
                companies: {
                    where: { unlinkedAt: null },
                    include: { company: { select: { id: true, name: true, account: { select: { id: true } } } } },
                },
            },
        }),
        prisma.company.findMany({
            where,
            include: { ...accountInclude, phones: phoneSelect, emails: emailSelect },
        }),
    ]);

    const shape = (
        row: {
            id: number;
            name: string;
            address: string | null;
            isActive: boolean;
            phones: { phone: string }[];
            emails: { email: string }[];
            account: {
                id: number;
                group: { name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" } | null;
                aliases: { alias: string }[];
            } | null;
        },
        type: "customer" | "company",
        linkedCompanies: { id: number; name: string; accountId: number | null }[],
    ) => ({
        type,
        id: row.id,
        name: row.name,
        address: row.address,
        phones: row.phones.map((x) => x.phone),
        emails: row.emails.map((x) => x.email),
        accountId: row.account?.id ?? null,
        accountGroup: row.account?.group?.name ?? null,
        accountGroupType: row.account?.group?.type ?? null,
        aliases: row.account?.aliases.map((a) => a.alias) ?? [],
        linkedCompanies,
        isActive: row.isActive,
    });

    return [
        ...persons.map((p) =>
            shape(p, "customer", p.companies.map((lc) => ({
                id: lc.company.id,
                name: lc.company.name,
                accountId: lc.company.account?.id ?? null,
            }))),
        ),
        ...companies.map((c) => shape(c, "company", [])),
    ];
}

async function liveCount(): Promise<number> {
    const [p, c] = await Promise.all([
        prisma.person.count({ where: { isActive: true } }),
        prisma.company.count({ where: { isActive: true } }),
    ]);
    return p + c;
}

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const params = req.nextUrl.searchParams;
        // Captured BEFORE reading, so a party written mid-request still has an
        // `updatedAt` past it and lands in the next delta rather than being lost.
        const now = new Date();
        const since = parseSince(params.get("since"));
        const canDelta = since != null && now.getTime() - since.getTime() < MAX_DELTA_WINDOW_MS;

        if (canDelta) {
            // No `isActive` filter — a party just deactivated has to come back as
            // a removal, and only its bumped row can report that.
            const touched = await loadParties({ updatedAt: { gt: since! } });
            return NextResponse.json({
                mode: "delta",
                changed: touched.filter((p) => p.isActive).map(({ isActive: _drop, ...row }) => row),
                removedKeys: touched.filter((p) => !p.isActive).map((p) => `${p.type}:${p.id}`),
                computedAt: now.toISOString(),
                count: await liveCount(),
            });
        }

        const parties = await loadParties({ isActive: true });
        return NextResponse.json({
            mode: "full",
            parties: parties.map(({ isActive: _drop, ...row }) => row),
            computedAt: now.toISOString(),
            count: parties.length,
        });
    } catch (e) {
        return handleApiError(e, "Party catalogue failed");
    }
}
