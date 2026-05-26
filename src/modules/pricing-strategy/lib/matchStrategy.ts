// Multi-condition PricingStrategy matcher.
//
// A strategy AND-matches each condition that is specified. Empty/null
// conditions are "any" — they don't gate the match. A strategy with no
// conditions at all matches every product (the org-wide fallback).
//
// Among strategies that match, the highest `priority` wins (ties broken by
// createdAt ASC for stability). A future conflict report will surface
// products where multiple equal-priority strategies match.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { PricingStrategy } from "@/generated/prisma/client";
import type {
    AttrFilterEntry, AttrFilters,
} from "@/shared/lib/schemas/pricingSchemas";

// ── Product shape consumed by the matcher ──────────────────────────────────

export interface MatcherProduct {
    id:         number;
    brandId:    number | null;
    groupId:    number | null;
    categoryId: number | null;
    /** Last-purchase snapshot in paise — used for cost-range filters. We use
     *  this (not resolvedCostPaise) to avoid a circular dependency between
     *  cost-method-resolution and the matcher. */
    costPaise:  number | null;
    /** Running stock cache. null = stock not tracked (e.g. services). */
    stock:      number | null;
    /** Attribute key/value bag — see InvProduct.attrsJson. */
    attrsJson:  Record<string, unknown> | null;
}

// ── Context built ahead of matching (batched lookups) ─────────────────────

export interface MatchContext {
    /** productId → days since last SALE/POS-kind voucher (null = never sold). */
    lastSaleAgeDays:     Map<number, number | null>;
    /** rootGroupId → set of descendant ids (incl. root). */
    groupDescendants:    Map<number, Set<number>>;
    /** rootCategoryId → set of descendant ids (incl. root). */
    categoryDescendants: Map<number, Set<number>>;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Pick the highest-priority strategy that AND-matches every specified
 * condition. Returns null when no strategy matches (shouldn't happen if at
 * least one all-empty fallback strategy exists).
 */
export function pickStrategy(
    product:    MatcherProduct,
    strategies: PricingStrategy[],
    ctx:        MatchContext,
): PricingStrategy | null {
    let best: PricingStrategy | null = null;
    for (const s of strategies) {
        if (!s.isActive) continue;
        if (!matches(s, product, ctx)) continue;
        if (best === null || beats(s, best)) best = s;
    }
    return best;
}

/** True if every condition on `s` is satisfied by `p`. Empty conditions don't gate. */
export function matches(
    s:   PricingStrategy,
    p:   MatcherProduct,
    ctx: MatchContext,
): boolean {
    // Brand — exact membership.
    if (s.brandIds.length > 0) {
        if (p.brandId == null || !s.brandIds.includes(p.brandId)) return false;
    }

    // Group — root + descendants membership.
    if (s.groupIds.length > 0) {
        if (p.groupId == null) return false;
        const allowed = collectDescendants(s.groupIds, ctx.groupDescendants);
        if (!allowed.has(p.groupId)) return false;
    }

    // Category — root + descendants membership.
    if (s.categoryIds.length > 0) {
        if (p.categoryId == null) return false;
        const allowed = collectDescendants(s.categoryIds, ctx.categoryDescendants);
        if (!allowed.has(p.categoryId)) return false;
    }

    // Attribute filters — every key must be present on the product AND
    // satisfy its op/value comparison.
    if (s.attrFilters != null) {
        const filters = s.attrFilters as unknown as AttrFilters;
        const attrs   = p.attrsJson ?? {};
        for (const [key, entry] of Object.entries(filters)) {
            const v = attrs[key];
            if (v === undefined || v === null) return false;
            if (!attrMatch(v, entry)) return false;
        }
    }

    // Cost range — applied to last-purchase snapshot.
    if (s.minCostPaise != null || s.maxCostPaise != null) {
        if (p.costPaise == null) return false;
        if (s.minCostPaise != null && p.costPaise < s.minCostPaise) return false;
        if (s.maxCostPaise != null && p.costPaise > s.maxCostPaise) return false;
    }

    // Stock range.
    if (s.minStock != null || s.maxStock != null) {
        if (p.stock == null) return false;
        if (s.minStock != null && p.stock < s.minStock) return false;
        if (s.maxStock != null && p.stock > s.maxStock) return false;
    }

    // Stale-after-days — "no sale in N days". Never-sold matches.
    if (s.staleAfterDays != null) {
        const ageDays = ctx.lastSaleAgeDays.get(p.id);
        if (ageDays != null && ageDays < s.staleAfterDays) return false;
    }

    return true;
}

// ── Tiebreak ──────────────────────────────────────────────────────────────

function beats(a: PricingStrategy, b: PricingStrategy): boolean {
    if (a.priority !== b.priority) return a.priority > b.priority;
    return a.createdAt < b.createdAt;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function collectDescendants(
    rootIds: number[],
    table:   Map<number, Set<number>>,
): Set<number> {
    const out = new Set<number>();
    for (const id of rootIds) {
        out.add(id);
        const d = table.get(id);
        if (d) for (const x of d) out.add(x);
    }
    return out;
}

function attrMatch(productValue: unknown, entry: AttrFilterEntry): boolean {
    const v = productValue;
    switch (entry.op) {
        case "eq":
            return String(v) === String(entry.value);
        case "in": {
            const arr = Array.isArray(entry.value) ? entry.value : [entry.value];
            return arr.some((x) => String(x) === String(v));
        }
        case "gte": {
            const n = toNumber(v);
            const t = toNumber(entry.value);
            return n != null && t != null && n >= t;
        }
        case "lte": {
            const n = toNumber(v);
            const t = toNumber(entry.value);
            return n != null && t != null && n <= t;
        }
        case "between": {
            const range = Array.isArray(entry.value) ? entry.value : [];
            if (range.length !== 2) return false;
            const n  = toNumber(v);
            const lo = toNumber(range[0]);
            const hi = toNumber(range[1]);
            return n != null && lo != null && hi != null && n >= lo && n <= hi;
        }
    }
}

function toNumber(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

// ── Batchers (one DB round-trip per concept) ──────────────────────────────

/** rootId → set of descendant group ids (root included). */
export async function loadGroupDescendants(): Promise<Map<number, Set<number>>> {
    const rows = await prisma.invProductGroup.findMany({
        select: { id: true, parentId: true },
    });
    return buildDescendantTable(rows);
}

/** rootId → set of descendant category ids (root included). */
export async function loadCategoryDescendants(): Promise<Map<number, Set<number>>> {
    const rows = await prisma.invCategory.findMany({
        select: { id: true, parentId: true },
    });
    return buildDescendantTable(rows);
}

function buildDescendantTable(
    rows: { id: number; parentId: number | null }[],
): Map<number, Set<number>> {
    const children = new Map<number, number[]>();
    for (const r of rows) {
        if (r.parentId != null) {
            const arr = children.get(r.parentId);
            if (arr) arr.push(r.id); else children.set(r.parentId, [r.id]);
        }
    }
    const out = new Map<number, Set<number>>();
    for (const r of rows) {
        const set = new Set<number>([r.id]);
        const stack: number[] = [r.id];
        while (stack.length) {
            const cur = stack.pop()!;
            const kids = children.get(cur);
            if (!kids) continue;
            for (const k of kids) {
                if (!set.has(k)) { set.add(k); stack.push(k); }
            }
        }
        out.set(r.id, set);
    }
    return out;
}

/**
 * productId → days since last SALE/POS voucher line (null = never sold).
 * Uses InvStockLedger.outQty > 0 + posted SALE/POS voucher.
 */
export async function loadLastSaleAgeDays(
    productIds: number[],
    now:        Date = new Date(),
): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
    for (const id of productIds) out.set(id, null);
    if (productIds.length === 0) return out;

    const rows = await prisma.invStockLedger.groupBy({
        by:    ["productId"],
        where: {
            productId: { in: productIds },
            outQty:    { gt: 0 },
            voucher:   {
                status: "POSTED",
                type:   { in: ["SALE", "POS"] },
            },
        },
        _max: { date: true },
    });

    const today = startOfDay(now).getTime();
    for (const r of rows) {
        if (r._max.date == null) continue;
        const ms   = today - startOfDay(r._max.date).getTime();
        const days = Math.max(0, Math.floor(ms / 86_400_000));
        out.set(r.productId, days);
    }
    return out;
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Build the full match context in parallel — call once per request, then
 * feed into pickStrategy().
 *
 * `productIdsForStaleness` is the set of products that need lastSaleAge.
 * Pass an empty array (or undefined) when no active strategy uses
 * staleAfterDays — skips the ledger groupBy.
 */
export async function buildMatchContext(opts: {
    productIdsForStaleness?: number[];
} = {}): Promise<MatchContext> {
    const [groupDescendants, categoryDescendants, lastSaleAgeDays] = await Promise.all([
        loadGroupDescendants(),
        loadCategoryDescendants(),
        opts.productIdsForStaleness && opts.productIdsForStaleness.length > 0
            ? loadLastSaleAgeDays(opts.productIdsForStaleness)
            : Promise.resolve(new Map<number, number | null>()),
    ]);
    return { groupDescendants, categoryDescendants, lastSaleAgeDays };
}
