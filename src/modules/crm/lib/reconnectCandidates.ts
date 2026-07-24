import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { ContactLifecycle, Prisma } from "@/generated/prisma/client";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { loadMarginLines } from "@/modules/bi/lib/marginEngine";
import type { ReconnectFilterInput } from "@/shared/lib/schemas/reconnectSchema";

/**
 * Reconnect — candidate finder.
 *
 * Surfaces customers (Person + Company) worth reaching out to, ranked so the
 * quietest float to the top. The filter is a flat, open-ended catalog (see
 * reconnectFilterSchema) grouped as activity · purchase · value · segment.
 *
 * Pipeline:
 *   1. Cheap DB filters (stage/group/owner/type/name) → the universe.
 *   2. Restrictions → keep-sets: account-keyed (purchased / not / warranty /
 *      revenue / profit) and customer-keyed (has/hasn't an activity type). Each
 *      active filter intersects; the universe is trimmed to the survivors.
 *   3. Fan-out last-activity across every source → dormancy + ranking.
 *   4. Apply activity-mode + dormancy, rank quietest-first, page.
 *
 * Heavy per-account queries run ONLY when their filter is active, so an unticked
 * filter costs nothing. Dormancy is computed in memory over the (capped) universe.
 */

/** Itemised customer sales — the revenue / purchase / warranty basis. */
const SALE_TYPES = ["SALE", "POS", "ONLINE_INVOICE"] as const;
/** Safety ceiling on the universe (internal tool; businesses are far under this). */
const MAX_UNIVERSE = 5000;
const DAY = 86_400_000;

export interface ReconnectCandidate {
    kind: "person" | "company";
    id: number;
    name: string;
    phone: string | null;
    lifecycleStage: ContactLifecycle;
    ownerPositionId: string | null;
    lastActivityAt: string | null;
    /** Whole days since lastActivityAt; null = never any activity. */
    dormantDays: number | null;
}

export interface ReconnectResult {
    candidates: ReconnectCandidate[];
    total: number;
    nextCursor: number | null;
    /** True when the cheap-filtered universe hit MAX_UNIVERSE (dormancy may be partial). */
    truncated: boolean;
}

type Loaded = {
    kind: "person" | "company";
    id: number;
    name: string;
    phone: string | null;
    lifecycleStage: ContactLifecycle;
    ownerPositionId: string | null;
    accountId: number | null;
};

/** Reverse indexes over the current universe, rebuilt whenever `loaded` shrinks. */
interface UniverseIndex {
    accountToKey: Map<number, string>;
    personIds: number[];
    companyIds: number[];
    accountIds: number[];
}

const keyOf = (kind: "person" | "company", id: number) => `${kind}:${id}`;

function daysSince(iso: string): number {
    return Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
}

/** Fold a candidate date into the running max map (keeps the latest). */
function bump(map: Map<string, number>, key: string, at: Date | null | undefined) {
    if (!at) return;
    const t = at.getTime();
    const prev = map.get(key);
    if (prev == null || t > prev) map.set(key, t);
}

function buildIndex(loaded: Loaded[]): UniverseIndex {
    const accountToKey = new Map<number, string>();
    const personIds: number[] = [];
    const companyIds: number[] = [];
    const accountIds: number[] = [];
    for (const c of loaded) {
        if (c.accountId != null) { accountToKey.set(c.accountId, keyOf(c.kind, c.id)); accountIds.push(c.accountId); }
        if (c.kind === "person") personIds.push(c.id); else companyIds.push(c.id);
    }
    return { accountToKey, personIds, companyIds, accountIds };
}

export async function findReconnectCandidates(filter: ReconnectFilterInput): Promise<ReconnectResult> {
    const { activity, stage, groupId, ownerPositionId, kind, q, take, cursor } = filter;

    // ── 1. Cheap-filter the universe (Person + Company), skipping dead rows ──────
    const nameFilter: Prisma.StringFilter | undefined = q ? { contains: q, mode: "insensitive" } : undefined;
    const personWhere: Prisma.PersonWhereInput = {
        isActive: true, mergedIntoPersonId: null, convertedToCompanyId: null,
        ...(stage ? { lifecycleStage: stage } : {}),
        ...(groupId ? { customerGroupId: groupId } : {}),
        ...(ownerPositionId ? { ownerPositionId } : {}),
        ...(nameFilter ? { name: nameFilter } : {}),
    };
    const companyWhere: Prisma.CompanyWhereInput = {
        isActive: true, mergedIntoCompanyId: null, convertedToPersonId: null,
        ...(stage ? { lifecycleStage: stage } : {}),
        ...(groupId ? { customerGroupId: groupId } : {}),
        ...(ownerPositionId ? { ownerPositionId } : {}),
        ...(nameFilter ? { name: nameFilter } : {}),
    };
    const wantPerson = kind === "person" || kind === "all";
    const wantCompany = kind === "company" || kind === "all";

    const [persons, companies] = await Promise.all([
        wantPerson
            ? prisma.person.findMany({
                where: personWhere, take: MAX_UNIVERSE,
                select: { id: true, name: true, lifecycleStage: true, ownerPositionId: true, account: { select: { id: true } }, phones: { ...selectPrimaryPhone, select: { phone: true } } },
            })
            : Promise.resolve([]),
        wantCompany
            ? prisma.company.findMany({
                where: companyWhere, take: MAX_UNIVERSE,
                select: { id: true, name: true, lifecycleStage: true, ownerPositionId: true, account: { select: { id: true } }, phones: { ...selectPrimaryPhone, select: { phone: true } } },
            })
            : Promise.resolve([]),
    ]);

    let loaded: Loaded[] = [
        ...persons.map((p) => ({ kind: "person" as const, id: p.id, name: p.name, phone: p.phones[0]?.phone ?? null, lifecycleStage: p.lifecycleStage, ownerPositionId: p.ownerPositionId, accountId: p.account?.id ?? null })),
        ...companies.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, phone: c.phones[0]?.phone ?? null, lifecycleStage: c.lifecycleStage, ownerPositionId: c.ownerPositionId, accountId: c.account?.id ?? null })),
    ];
    const truncated = persons.length >= MAX_UNIVERSE || companies.length >= MAX_UNIVERSE;

    // ── 2. Restrictions → intersect keep-sets, then trim the universe ────────────
    let idx = buildIndex(loaded);
    const { accountKeep, keyKeep } = await computeRestrictions(idx, loaded, filter);
    if (accountKeep != null || keyKeep != null) {
        loaded = loaded.filter((c) =>
            (accountKeep == null || (c.accountId != null && accountKeep.has(c.accountId))) &&
            (keyKeep == null || keyKeep.has(keyOf(c.kind, c.id))));
        idx = buildIndex(loaded);
    }

    // ── 3. Last-activity across every source, scoped to the trimmed universe ─────
    const lastAt = new Map<string, number>();
    if (loaded.length > 0) {
        const { accountToKey, personIds, companyIds, accountIds } = idx;
        const [saleMax, ticketMax, deals, helps, personLogs, companyLogs] = await Promise.all([
            accountIds.length ? prisma.universalVoucher.groupBy({ by: ["partyAccountId"], where: { partyAccountId: { in: accountIds }, status: "POSTED", deletedAt: null }, _max: { date: true } }) : Promise.resolve([]),
            accountIds.length ? prisma.ticket.groupBy({ by: ["accountId"], where: { accountId: { in: accountIds } }, _max: { createdAt: true } }) : Promise.resolve([]),
            personIds.length || companyIds.length ? prisma.ticketDeal.findMany({ where: { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }] }, select: { personId: true, companyId: true, ticket: { select: { createdAt: true } } } }) : Promise.resolve([]),
            personIds.length || companyIds.length ? prisma.ticketHelp.findMany({ where: { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }] }, select: { personId: true, companyId: true, ticket: { select: { createdAt: true } } } }) : Promise.resolve([]),
            personIds.length ? prisma.ticketLog.groupBy({ by: ["personId"], where: { personId: { in: personIds } }, _max: { createdAt: true } }) : Promise.resolve([]),
            companyIds.length ? prisma.ticketLog.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _max: { createdAt: true } }) : Promise.resolve([]),
        ]);
        for (const r of saleMax) { const k = r.partyAccountId != null ? accountToKey.get(r.partyAccountId) : undefined; if (k) bump(lastAt, k, r._max.date); }
        for (const r of ticketMax) { const k = r.accountId != null ? accountToKey.get(r.accountId) : undefined; if (k) bump(lastAt, k, r._max.createdAt); }
        for (const d of deals) { if (d.personId) bump(lastAt, keyOf("person", d.personId), d.ticket.createdAt); else if (d.companyId) bump(lastAt, keyOf("company", d.companyId), d.ticket.createdAt); }
        for (const h of helps) { if (h.personId) bump(lastAt, keyOf("person", h.personId), h.ticket.createdAt); else if (h.companyId) bump(lastAt, keyOf("company", h.companyId), h.ticket.createdAt); }
        for (const l of personLogs) if (l.personId) bump(lastAt, keyOf("person", l.personId), l._max.createdAt);
        for (const l of companyLogs) if (l.companyId) bump(lastAt, keyOf("company", l.companyId), l._max.createdAt);
    }

    // ── 4. Assemble, apply activity mode + dormancy, rank, page ──────────────────
    let rows: ReconnectCandidate[] = loaded.map((c) => {
        const t = lastAt.get(keyOf(c.kind, c.id));
        const iso = t != null ? new Date(t).toISOString() : null;
        return { kind: c.kind, id: c.id, name: c.name, phone: c.phone, lifecycleStage: c.lifecycleStage, ownerPositionId: c.ownerPositionId, lastActivityAt: iso, dormantDays: iso ? daysSince(iso) : null };
    });

    if (activity === "quiet") rows = rows.filter((r) => r.lastActivityAt != null);
    else if (activity === "never") rows = rows.filter((r) => r.lastActivityAt == null);

    rows.sort((a, b) => {
        if (a.lastActivityAt == null && b.lastActivityAt == null) return a.name.localeCompare(b.name);
        if (a.lastActivityAt == null) return -1;
        if (b.lastActivityAt == null) return 1;
        return a.lastActivityAt < b.lastActivityAt ? -1 : a.lastActivityAt > b.lastActivityAt ? 1 : 0;
    });

    const total = rows.length;
    const offset = cursor ?? 0;
    const page = rows.slice(offset, offset + take);
    const nextCursor = offset + take < total ? offset + take : null;
    return { candidates: page, total, nextCursor, truncated };
}

// ── Restriction resolvers ───────────────────────────────────────────────────────

/**
 * Run every active restriction and intersect its keep-set. Returns two optional
 * sets: account-keyed (purchase / warranty / value) and customer-keyed (activity
 * type). null = that dimension imposes no constraint.
 */
async function computeRestrictions(
    idx: UniverseIndex, loaded: Loaded[], filter: ReconnectFilterInput,
): Promise<{ accountKeep: Set<number> | null; keyKeep: Set<string> | null }> {
    const {
        activityType, activityPresence, activityFromDays, activityToDays,
        soldCategoryId, soldProductQ, soldFromDays, soldToDays,
        notSoldCategoryId, notSoldProductQ, notSoldFromDays, notSoldToDays,
        warrantyEndingDays, warrantyTermIds,
        revenueMin, revenueMax, revenueFromDays, revenueToDays,
        profitMin, profitMax, profitFromDays, profitToDays,
    } = filter;

    let accountKeep: Set<number> | null = null;
    let keyKeep: Set<string> | null = null;
    const andAccounts = (s: Set<number>) => { accountKeep = accountKeep == null ? s : new Set([...accountKeep].filter((x) => s.has(x))); };
    const andKeys = (s: Set<string>) => { keyKeep = keyKeep == null ? s : new Set([...keyKeep].filter((x) => s.has(x))); };

    if (idx.accountIds.length === 0 && (accountFilterActive(filter))) andAccounts(new Set());

    const universeAccounts = () => new Set(idx.accountIds);
    const universeKeys = () => new Set(loaded.map((c) => keyOf(c.kind, c.id)));

    // Sold (include) / not-sold (exclude) — a category/product we sold them, in a window.
    if (soldCategoryId != null || soldProductQ?.trim()) {
        andAccounts(await soldAccounts(idx.accountIds, soldCategoryId, soldProductQ, daysWindow(soldFromDays, soldToDays)));
    }
    if (notSoldCategoryId != null || notSoldProductQ?.trim()) {
        const sold = await soldAccounts(idx.accountIds, notSoldCategoryId, notSoldProductQ, daysWindow(notSoldFromDays, notSoldToDays));
        andAccounts(new Set([...universeAccounts()].filter((a) => !sold.has(a))));
    }
    // Warranty ending, restricted to the chosen terms.
    if (warrantyEndingDays != null) {
        andAccounts(await warrantyAccounts(idx.accountIds, warrantyEndingDays, warrantyTermIds));
    }
    // Revenue (turnover) over the window.
    if (revenueMin != null || revenueMax != null) {
        andAccounts(await revenueAccounts(idx.accountIds, revenueMin, revenueMax, valueWindow(revenueFromDays, revenueToDays)));
    }
    // Profit (derived margin) over the window.
    if (profitMin != null || profitMax != null) {
        andAccounts(await profitAccounts(idx.accountIds, profitMin, profitMax, valueWindow(profitFromDays, profitToDays)));
    }
    // Has / doesn't have an interaction of a given type, over a window.
    if (activityType) {
        const withType = await activityTypeKeys(idx, activityType, daysWindow(activityFromDays, activityToDays));
        andKeys(activityPresence === "not" ? new Set([...universeKeys()].filter((k) => !withType.has(k))) : withType);
    }

    return { accountKeep, keyKeep };
}

function accountFilterActive(f: ReconnectFilterInput): boolean {
    return (
        f.soldCategoryId != null || !!f.soldProductQ?.trim() ||
        f.notSoldCategoryId != null || !!f.notSoldProductQ?.trim() ||
        f.warrantyEndingDays != null ||
        f.revenueMin != null || f.revenueMax != null ||
        f.profitMin != null || f.profitMax != null
    );
}

/** A "days ago" window → optional {from, to} Date bounds (omit a bound = open-ended). */
function daysWindow(fromDays: number | undefined, toDays: number | undefined): { from?: Date; to?: Date } {
    const now = Date.now();
    const win: { from?: Date; to?: Date } = {};
    if (fromDays != null) win.from = new Date(now - fromDays * DAY);
    if (toDays != null) win.to = new Date(now - toDays * DAY);
    return win;
}

function valueWindow(fromDays: number | undefined, toDays: number | undefined): { from: Date; to: Date } {
    const now = Date.now();
    return { from: fromDays != null ? new Date(now - fromDays * DAY) : new Date(0), to: toDays != null ? new Date(now - toDays * DAY) : new Date(now) };
}

/** Accounts we sold ≥1 line matching category/name to, inside the window. */
async function soldAccounts(accountIds: number[], categoryId: number | undefined, productQ: string | undefined, win: { from?: Date; to?: Date }): Promise<Set<number>> {
    if (accountIds.length === 0) return new Set();
    const dateFilter = win.from || win.to ? { date: { ...(win.from ? { gte: win.from } : {}), ...(win.to ? { lte: win.to } : {}) } } : {};
    const lines = await prisma.voucherInventoryLine.findMany({
        where: {
            universalVoucher: { partyAccountId: { in: accountIds }, status: "POSTED", deletedAt: null, type: { in: [...SALE_TYPES] }, ...dateFilter },
            product: { ...(categoryId != null ? { categoryId } : {}), ...(productQ?.trim() ? { name: { contains: productQ.trim(), mode: "insensitive" } } : {}) },
        },
        select: { universalVoucher: { select: { partyAccountId: true } } },
    });
    return new Set(lines.map((l) => l.universalVoucher.partyAccountId).filter((x): x is number => x != null));
}

/** Accounts owning an item whose warranty (purchase + term.durationDays) lapses within N days. */
async function warrantyAccounts(accountIds: number[], endingDays: number, termIds: number[] | undefined): Promise<Set<number>> {
    if (accountIds.length === 0) return new Set();
    const now = Date.now();
    const horizon = now + endingDays * DAY;
    const lines = await prisma.voucherInventoryLine.findMany({
        where: {
            universalVoucher: { partyAccountId: { in: accountIds }, status: "POSTED", deletedAt: null, type: { in: [...SALE_TYPES] } },
            product: { warrantyTerm: { durationDays: { gt: 0 }, ...(termIds?.length ? { id: { in: termIds } } : {}) } },
        },
        select: { universalVoucher: { select: { partyAccountId: true, date: true } }, product: { select: { warrantyTerm: { select: { durationDays: true } } } } },
    });
    const acc = new Set<number>();
    for (const l of lines) {
        const dur = l.product.warrantyTerm?.durationDays;
        const pa = l.universalVoucher.partyAccountId;
        if (!dur || pa == null) continue;
        const end = l.universalVoucher.date.getTime() + dur * DAY;
        if (end >= now && end <= horizon) acc.add(pa);
    }
    return acc;
}

/** Accounts whose posted-sale turnover in the window falls inside [min, max]. */
async function revenueAccounts(accountIds: number[], min: number | undefined, max: number | undefined, win: { from: Date; to: Date }): Promise<Set<number>> {
    if (accountIds.length === 0) return new Set();
    const rows = await prisma.voucherDetail.findMany({
        where: { universalVoucher: { partyAccountId: { in: accountIds }, status: "POSTED", deletedAt: null, type: { in: [...SALE_TYPES] }, date: { gte: win.from, lte: win.to } } },
        select: { totalAmount: true, universalVoucher: { select: { partyAccountId: true } } },
    });
    const sum = new Map<number, number>();
    for (const r of rows) { const a = r.universalVoucher?.partyAccountId; if (a == null) continue; sum.set(a, (sum.get(a) ?? 0) + Number(r.totalAmount)); }
    return rangeSet(accountIds, sum, min, max);
}

/** Accounts whose derived margin (bi/marginEngine) in the window falls inside [min, max]. */
async function profitAccounts(accountIds: number[], min: number | undefined, max: number | undefined, win: { from: Date; to: Date }): Promise<Set<number>> {
    if (accountIds.length === 0) return new Set();
    const { lines } = await loadMarginLines({ from: win.from, to: win.to });
    const sum = new Map<number, number>();
    for (const l of lines) { if (l.accountId == null) continue; sum.set(l.accountId, (sum.get(l.accountId) ?? 0) + l.profit); }
    return rangeSet(accountIds, sum, min, max);
}

/** Keep accounts (incl. those with no rows → 0) whose summed value is in [min, max]. */
function rangeSet(accountIds: number[], sum: Map<number, number>, min: number | undefined, max: number | undefined): Set<number> {
    const out = new Set<number>();
    for (const a of accountIds) {
        const v = sum.get(a) ?? 0;
        if ((min == null || v >= min) && (max == null || v <= max)) out.add(a);
    }
    return out;
}

const CONCRETE_ACTIVITY_TYPES = ["sale", "repair", "inquiry", "deal", "note"] as const;
type ConcreteActivityType = typeof CONCRETE_ACTIVITY_TYPES[number];

/** Customer keys with ≥1 interaction of the given type ("any" = any type), inside the window. */
async function activityTypeKeys(idx: UniverseIndex, type: "any" | ConcreteActivityType, win: { from?: Date; to?: Date }): Promise<Set<string>> {
    if (type === "any") {
        const sets = await Promise.all(CONCRETE_ACTIVITY_TYPES.map((t) => oneTypeKeys(idx, t, win)));
        const keys = new Set<string>();
        for (const s of sets) for (const k of s) keys.add(k);
        return keys;
    }
    return oneTypeKeys(idx, type, win);
}

/** A "days ago" window → a Prisma date filter object, or undefined (= ever). */
function dateRange(win: { from?: Date; to?: Date }): { gte?: Date; lte?: Date } | undefined {
    if (!win.from && !win.to) return undefined;
    return { ...(win.from ? { gte: win.from } : {}), ...(win.to ? { lte: win.to } : {}) };
}

/** Customer keys with ≥1 interaction of one concrete type inside the window. */
async function oneTypeKeys(idx: UniverseIndex, type: ConcreteActivityType, win: { from?: Date; to?: Date }): Promise<Set<string>> {
    const keys = new Set<string>();
    const { accountToKey, accountIds, personIds, companyIds } = idx;
    const dr = dateRange(win);

    if (type === "sale") {
        if (!accountIds.length) return keys;
        const rows = await prisma.universalVoucher.findMany({ where: { partyAccountId: { in: accountIds }, status: "POSTED", deletedAt: null, type: { in: [...SALE_TYPES] }, ...(dr ? { date: dr } : {}) }, select: { partyAccountId: true }, distinct: ["partyAccountId"] });
        for (const r of rows) { const k = r.partyAccountId != null ? accountToKey.get(r.partyAccountId) : undefined; if (k) keys.add(k); }
    } else if (type === "repair") {
        if (!accountIds.length) return keys;
        const rows = await prisma.ticket.findMany({ where: { accountId: { in: accountIds }, repair: { isNot: null }, ...(dr ? { createdAt: dr } : {}) }, select: { accountId: true }, distinct: ["accountId"] });
        for (const r of rows) { const k = r.accountId != null ? accountToKey.get(r.accountId) : undefined; if (k) keys.add(k); }
    } else if (type === "inquiry") {
        const rows = await prisma.ticketHelp.findMany({ where: { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }], ...(dr ? { ticket: { createdAt: dr } } : {}) }, select: { personId: true, companyId: true } });
        for (const r of rows) { if (r.personId) keys.add(keyOf("person", r.personId)); else if (r.companyId) keys.add(keyOf("company", r.companyId)); }
    } else if (type === "deal") {
        const rows = await prisma.ticketDeal.findMany({ where: { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }], ...(dr ? { ticket: { createdAt: dr } } : {}) }, select: { personId: true, companyId: true } });
        for (const r of rows) { if (r.personId) keys.add(keyOf("person", r.personId)); else if (r.companyId) keys.add(keyOf("company", r.companyId)); }
    } else if (type === "note") {
        const rows = await prisma.ticketLog.findMany({ where: { OR: [{ personId: { in: personIds } }, { companyId: { in: companyIds } }], ...(dr ? { createdAt: dr } : {}) }, select: { personId: true, companyId: true } });
        for (const r of rows) { if (r.personId) keys.add(keyOf("person", r.personId)); else if (r.companyId) keys.add(keyOf("company", r.companyId)); }
    }
    return keys;
}
