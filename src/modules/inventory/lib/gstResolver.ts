// Cascading GST / HSN / Taxability resolver.
//
// Rule: each tax field on InvProduct is OPTIONAL. When null on the product,
// we walk up the InvProductGroup parent chain (group → parent → grandparent …),
// then fall back to the OrgDefaults singleton. Each of the three fields
// resolves INDEPENDENTLY — GST can come from the product while HSN falls back
// to a grandparent.
//
// Voucher / invoice / POS lines snapshot the resolved value at entry time
// (see plan: Option B), so changing a product's GST later does NOT change
// past invoices.

import type { PrismaClient, Taxability } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/shared/lib/prisma/prismaClient";

const MAX_GROUP_DEPTH = 10;

export type TaxSource =
    | "product"
    | { kind: "group"; groupId: number; groupName: string }
    | "org-default"
    | null;

export interface ResolvedTax {
    /** Resolved GST rate (numeric, e.g. 18). null = no rate anywhere in the chain. */
    gstRate: number | null;
    gstRateId: number | null;
    gstRateLabel: string | null;
    gstSource: TaxSource;

    /** Resolved HSN/SAC code. null = no code anywhere in the chain. */
    hsnCode: string | null;
    hsnSource: TaxSource;

    /** Resolved taxability enum. null = unset anywhere in the chain. */
    taxability: Taxability | null;
    taxabilitySource: TaxSource;
}

interface GroupRow {
    id: number;
    name: string;
    parentId: number | null;
    gstRateId: number | null;
    gstRate: { id: number; rate: unknown; label: string } | null;
    hsnCode: string | null;
    taxability: Taxability | null;
}

const decimalToNumber = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
};

/** Walk InvProductGroup parent chain up to MAX_GROUP_DEPTH levels. */
async function loadGroupChain(
    client: PrismaClient,
    rootGroupId: number | null,
): Promise<GroupRow[]> {
    if (rootGroupId == null) return [];
    const chain: GroupRow[] = [];
    let nextId: number | null = rootGroupId;
    const seen = new Set<number>();
    for (let i = 0; i < MAX_GROUP_DEPTH && nextId != null; i++) {
        if (seen.has(nextId)) break; // defensive: cycle
        seen.add(nextId);
        const row: GroupRow | null = await client.invProductGroup.findUnique({
            where: { id: nextId },
            select: {
                id: true,
                name: true,
                parentId: true,
                gstRateId: true,
                gstRate: { select: { id: true, rate: true, label: true } },
                hsnCode: true,
                taxability: true,
            },
        });
        if (!row) break;
        chain.push(row);
        nextId = row.parentId;
    }
    return chain;
}

/**
 * Resolve the effective GST rate, HSN code, and Taxability for a product.
 * Each field cascades independently: product → group chain → OrgDefaults.
 */
export async function resolveProductTax(
    productId: number,
    client: PrismaClient = defaultPrisma,
): Promise<ResolvedTax> {
    const product = await client.invProduct.findUnique({
        where: { id: productId },
        select: {
            groupId: true,
            gstRateId: true,
            gstRate: { select: { id: true, rate: true, label: true } },
            hsnCode: true,
            taxability: true,
        },
    });

    let gstRateId: number | null = null;
    let gstRate: number | null = null;
    let gstRateLabel: string | null = null;
    let gstSource: TaxSource = null;

    let hsnCode: string | null = null;
    let hsnSource: TaxSource = null;

    let taxability: Taxability | null = null;
    let taxabilitySource: TaxSource = null;

    if (product?.gstRate) {
        gstRateId = product.gstRate.id;
        gstRate = decimalToNumber(product.gstRate.rate);
        gstRateLabel = product.gstRate.label;
        gstSource = "product";
    }
    if (product?.hsnCode != null && product.hsnCode !== "") {
        hsnCode = product.hsnCode;
        hsnSource = "product";
    }
    if (product?.taxability != null) {
        taxability = product.taxability;
        taxabilitySource = "product";
    }

    if (gstSource == null || hsnSource == null || taxabilitySource == null) {
        const chain = await loadGroupChain(client, product?.groupId ?? null);
        for (const g of chain) {
            if (gstSource == null && g.gstRate) {
                gstRateId = g.gstRate.id;
                gstRate = decimalToNumber(g.gstRate.rate);
                gstRateLabel = g.gstRate.label;
                gstSource = { kind: "group", groupId: g.id, groupName: g.name };
            }
            if (hsnSource == null && g.hsnCode != null && g.hsnCode !== "") {
                hsnCode = g.hsnCode;
                hsnSource = { kind: "group", groupId: g.id, groupName: g.name };
            }
            if (taxabilitySource == null && g.taxability != null) {
                taxability = g.taxability;
                taxabilitySource = { kind: "group", groupId: g.id, groupName: g.name };
            }
            if (gstSource != null && hsnSource != null && taxabilitySource != null) break;
        }
    }

    if (gstSource == null || hsnSource == null || taxabilitySource == null) {
        const org = await client.orgDefaults.findUnique({
            where: { id: 1 },
            select: {
                defaultGstRateId: true,
                defaultGstRate: { select: { id: true, rate: true, label: true } },
                defaultHsnCode: true,
                defaultTaxability: true,
            },
        });
        if (gstSource == null && org?.defaultGstRate) {
            gstRateId = org.defaultGstRate.id;
            gstRate = decimalToNumber(org.defaultGstRate.rate);
            gstRateLabel = org.defaultGstRate.label;
            gstSource = "org-default";
        }
        if (hsnSource == null && org?.defaultHsnCode != null && org.defaultHsnCode !== "") {
            hsnCode = org.defaultHsnCode;
            hsnSource = "org-default";
        }
        if (taxabilitySource == null && org?.defaultTaxability != null) {
            taxability = org.defaultTaxability;
            taxabilitySource = "org-default";
        }
    }

    return {
        gstRate, gstRateId, gstRateLabel, gstSource,
        hsnCode, hsnSource,
        taxability, taxabilitySource,
    };
}

// ── Batch resolvers ──────────────────────────────────────────────────────────
//
// Single-product `resolveProductTax` issues N+1 queries when used across the
// whole catalog (Tax Classification report, future bulk-resolve flows). The
// helpers below preload everything once and resolve in-memory.

type OrgDefaultsTaxRow = {
    defaultGstRateId: number | null;
    defaultGstRate: { id: number; rate: unknown; label: string } | null;
    defaultHsnCode: string | null;
    defaultTaxability: Taxability | null;
} | null;

/** Walk parent chain in-memory using a pre-loaded group map. Cycle-safe. */
function walkGroupChainInMemory(
    rootGroupId: number | null,
    byId: Map<number, GroupRow>,
): GroupRow[] {
    if (rootGroupId == null) return [];
    const chain: GroupRow[] = [];
    let nextId: number | null = rootGroupId;
    const seen = new Set<number>();
    for (let i = 0; i < MAX_GROUP_DEPTH && nextId != null; i++) {
        if (seen.has(nextId)) break;
        seen.add(nextId);
        const row = byId.get(nextId);
        if (!row) break;
        chain.push(row);
        nextId = row.parentId;
    }
    return chain;
}

/** Apply cascade for a single product given pre-loaded reference data. */
function resolveOne(
    product: {
        groupId: number | null;
        gstRate: { id: number; rate: unknown; label: string } | null;
        hsnCode: string | null;
        taxability: Taxability | null;
    },
    groupsById: Map<number, GroupRow>,
    org: OrgDefaultsTaxRow,
): ResolvedTax {
    let gstRateId: number | null = null;
    let gstRate: number | null = null;
    let gstRateLabel: string | null = null;
    let gstSource: TaxSource = null;

    let hsnCode: string | null = null;
    let hsnSource: TaxSource = null;

    let taxability: Taxability | null = null;
    let taxabilitySource: TaxSource = null;

    if (product.gstRate) {
        gstRateId = product.gstRate.id;
        gstRate = decimalToNumber(product.gstRate.rate);
        gstRateLabel = product.gstRate.label;
        gstSource = "product";
    }
    if (product.hsnCode != null && product.hsnCode !== "") {
        hsnCode = product.hsnCode;
        hsnSource = "product";
    }
    if (product.taxability != null) {
        taxability = product.taxability;
        taxabilitySource = "product";
    }

    if (gstSource == null || hsnSource == null || taxabilitySource == null) {
        const chain = walkGroupChainInMemory(product.groupId, groupsById);
        for (const g of chain) {
            if (gstSource == null && g.gstRate) {
                gstRateId = g.gstRate.id;
                gstRate = decimalToNumber(g.gstRate.rate);
                gstRateLabel = g.gstRate.label;
                gstSource = { kind: "group", groupId: g.id, groupName: g.name };
            }
            if (hsnSource == null && g.hsnCode != null && g.hsnCode !== "") {
                hsnCode = g.hsnCode;
                hsnSource = { kind: "group", groupId: g.id, groupName: g.name };
            }
            if (taxabilitySource == null && g.taxability != null) {
                taxability = g.taxability;
                taxabilitySource = { kind: "group", groupId: g.id, groupName: g.name };
            }
            if (gstSource != null && hsnSource != null && taxabilitySource != null) break;
        }
    }

    if (gstSource == null || hsnSource == null || taxabilitySource == null) {
        if (gstSource == null && org?.defaultGstRate) {
            gstRateId = org.defaultGstRate.id;
            gstRate = decimalToNumber(org.defaultGstRate.rate);
            gstRateLabel = org.defaultGstRate.label;
            gstSource = "org-default";
        }
        if (hsnSource == null && org?.defaultHsnCode != null && org.defaultHsnCode !== "") {
            hsnCode = org.defaultHsnCode;
            hsnSource = "org-default";
        }
        if (taxabilitySource == null && org?.defaultTaxability != null) {
            taxability = org.defaultTaxability;
            taxabilitySource = "org-default";
        }
    }

    return {
        gstRate, gstRateId, gstRateLabel, gstSource,
        hsnCode, hsnSource,
        taxability, taxabilitySource,
    };
}

/**
 * Resolve effective tax for many products in one round-trip.
 * Issues exactly 3 queries: products + groups + org-defaults; all cascade walks
 * happen in-memory afterwards. Use this in reports / bulk-resolve flows. Do
 * NOT loop `resolveProductTax` over a product list — it is N+1.
 *
 * Returns: { products: Map<productId, ResolvedTax>,
 *            groups:   Map<groupId,   ResolvedTax>,
 *            orgDefaults: ResolvedTax (kind=org-default if any field set) }
 */
export async function resolveProductTaxBatch(
    options: { productIds?: number[]; client?: PrismaClient } = {},
): Promise<{
    products: Map<number, ResolvedTax>;
    groups: Map<number, ResolvedTax>;
}> {
    const client = options.client ?? defaultPrisma;

    const [productRows, allGroups, org] = await Promise.all([
        client.invProduct.findMany({
            where: options.productIds ? { id: { in: options.productIds } } : undefined,
            select: {
                id: true,
                groupId: true,
                gstRateId: true,
                gstRate: { select: { id: true, rate: true, label: true } },
                hsnCode: true,
                taxability: true,
            },
        }),
        client.invProductGroup.findMany({
            select: {
                id: true,
                name: true,
                parentId: true,
                gstRateId: true,
                gstRate: { select: { id: true, rate: true, label: true } },
                hsnCode: true,
                taxability: true,
            },
        }),
        client.orgDefaults.findUnique({
            where: { id: 1 },
            select: {
                defaultGstRateId: true,
                defaultGstRate: { select: { id: true, rate: true, label: true } },
                defaultHsnCode: true,
                defaultTaxability: true,
            },
        }),
    ]);

    const groupsById = new Map<number, GroupRow>();
    for (const g of allGroups) groupsById.set(g.id, g);

    const productMap = new Map<number, ResolvedTax>();
    for (const p of productRows) {
        productMap.set(p.id, resolveOne(p, groupsById, org));
    }

    // Group cascade — pretend the group IS the "product" with no own fields,
    // start walk from this group itself so own fields are still picked up.
    const groupMap = new Map<number, ResolvedTax>();
    for (const g of allGroups) {
        const fakeProduct = {
            groupId: g.id,        // start walk at self
            gstRate: null,        // never claim "product" source on a group
            hsnCode: null,
            taxability: null,
        };
        groupMap.set(g.id, resolveOne(fakeProduct, groupsById, org));
    }

    return { products: productMap, groups: groupMap };
}
