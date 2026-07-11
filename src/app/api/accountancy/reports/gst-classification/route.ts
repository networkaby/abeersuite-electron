import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    resolveProductTaxBatch,
    type ResolvedTax,
    type TaxSource,
} from "@/modules/inventory/lib/gstResolver";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/accountancy/reports/gst-classification
//
// Master-data view (not transaction-derived). Returns:
//   • All GST rates with a count of products that resolve to each rate
//   • All product groups with own + cascaded effective tax
//   • All products with own + cascaded effective tax
//   • Org defaults (the final fallback)
//   • Summary counts for the header strip
//
// Single round-trip — uses resolveProductTaxBatch so the catalog is resolved
// in-memory after only three queries (products, groups, OrgDefaults).
//
// Permission: accountancy:view (same as other accountancy reports).
// ─────────────────────────────────────────────────────────────────────────────

const decimalToNumber = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
};

type OwnTax = {
    gstRateId: number | null;
    gstRateLabel: string | null;
    gstRate: number | null;
    hsnCode: string | null;
    taxability: string | null;
};

type RateBucket = {
    id: number;
    rate: number;
    label: string;
    isActive: boolean;
    productCount: number;
};

type GroupRow = {
    id: number;
    name: string;
    parentId: number | null;
    isActive: boolean;
    own: OwnTax;
    resolved: ResolvedTax;
    directProductCount: number;
};

type ProductRow = {
    id: number;
    sku: string;
    name: string;
    isActive: boolean;
    group: { id: number; name: string } | null;
    own: OwnTax;
    resolved: ResolvedTax;
};

type OrgDefaultsRow = {
    defaultGstRateId: number | null;
    defaultGstRate: { id: number; rate: number; label: string } | null;
    defaultHsnCode: string | null;
    defaultTaxability: string | null;
};

export type GstClassificationPayload = {
    rates: RateBucket[];
    groups: GroupRow[];
    products: ProductRow[];
    orgDefaults: OrgDefaultsRow;
    summary: {
        totalProducts: number;
        activeProducts: number;
        productsWithOwnGst: number;
        productsResolvedFromGroup: number;
        productsResolvedFromOrgDefault: number;
        productsUnresolved: number;
        productsWithHsn: number;
        groupsWithOwnGst: number;
    };
};

function sourceKind(s: TaxSource): "product" | "group" | "org-default" | null {
    if (s == null) return null;
    if (s === "product") return "product";
    if (s === "org-default") return "org-default";
    return "group";
}

export async function GET() {
    const { response } = await requireModuleAccess("accountancy", PERMISSIONS.ACCOUNTANCY_VIEW);
    if (response) return response;
    try {
        const [products, groups, rates, org] = await Promise.all([
            prisma.invProduct.findMany({
                orderBy: { sku: "asc" },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    isActive: true,
                    groupId: true,
                    group: { select: { id: true, name: true } },
                    gstRateId: true,
                    gstRate: { select: { id: true, rate: true, label: true } },
                    hsnCode: true,
                    taxability: true,
                },
            }),
            prisma.invProductGroup.findMany({
                orderBy: { name: "asc" },
                select: {
                    id: true,
                    name: true,
                    isActive: true,
                    parentId: true,
                    gstRateId: true,
                    gstRate: { select: { id: true, rate: true, label: true } },
                    hsnCode: true,
                    taxability: true,
                },
            }),
            prisma.gstRate.findMany({ orderBy: { rate: "asc" } }),
            prisma.orgDefaults.findUnique({
                where: { id: 1 },
                select: {
                    defaultGstRateId: true,
                    defaultGstRate: { select: { id: true, rate: true, label: true } },
                    defaultHsnCode: true,
                    defaultTaxability: true,
                },
            }),
        ]);

        const { products: productResolvedById, groups: groupResolvedById } =
            await resolveProductTaxBatch();

        // ── Build products payload ────────────────────────────────────────────
        const productsOut: ProductRow[] = products.map((p) => {
            const resolved =
                productResolvedById.get(p.id) ?? {
                    gstRate: null, gstRateId: null, gstRateLabel: null, gstSource: null,
                    hsnCode: null, hsnSource: null,
                    taxability: null, taxabilitySource: null,
                };
            return {
                id: p.id,
                sku: p.sku,
                name: p.name,
                isActive: p.isActive,
                group: p.group ? { id: p.group.id, name: p.group.name } : null,
                own: {
                    gstRateId: p.gstRate?.id ?? null,
                    gstRateLabel: p.gstRate?.label ?? null,
                    gstRate: p.gstRate ? decimalToNumber(p.gstRate.rate) : null,
                    hsnCode: p.hsnCode ?? null,
                    taxability: p.taxability ?? null,
                },
                resolved,
            };
        });

        // ── Build groups payload ──────────────────────────────────────────────
        const directCountByGroup = new Map<number, number>();
        for (const p of products) {
            if (p.groupId != null) {
                directCountByGroup.set(p.groupId, (directCountByGroup.get(p.groupId) ?? 0) + 1);
            }
        }

        const groupsOut: GroupRow[] = groups.map((g) => {
            const resolved =
                groupResolvedById.get(g.id) ?? {
                    gstRate: null, gstRateId: null, gstRateLabel: null, gstSource: null,
                    hsnCode: null, hsnSource: null,
                    taxability: null, taxabilitySource: null,
                };
            return {
                id: g.id,
                name: g.name,
                parentId: g.parentId,
                isActive: g.isActive,
                own: {
                    gstRateId: g.gstRate?.id ?? null,
                    gstRateLabel: g.gstRate?.label ?? null,
                    gstRate: g.gstRate ? decimalToNumber(g.gstRate.rate) : null,
                    hsnCode: g.hsnCode ?? null,
                    taxability: g.taxability ?? null,
                },
                resolved,
                directProductCount: directCountByGroup.get(g.id) ?? 0,
            };
        });

        // ── Rate buckets (count products resolved to each rate) ───────────────
        const countByRateId = new Map<number, number>();
        for (const p of productsOut) {
            if (p.resolved.gstRateId == null) {
                continue;
            }
            countByRateId.set(
                p.resolved.gstRateId,
                (countByRateId.get(p.resolved.gstRateId) ?? 0) + 1,
            );
        }
        const ratesOut: RateBucket[] = rates.map((r) => ({
            id: r.id,
            rate: Number(decimalToNumber(r.rate) ?? 0),
            label: r.label,
            isActive: r.isActive,
            productCount: countByRateId.get(r.id) ?? 0,
        }));

        // ── Summary ───────────────────────────────────────────────────────────
        let productsWithOwnGst = 0;
        let productsResolvedFromGroup = 0;
        let productsResolvedFromOrgDefault = 0;
        let productsUnresolved = 0;
        let productsWithHsn = 0;
        for (const p of productsOut) {
            const kind = sourceKind(p.resolved.gstSource);
            if (kind === "product") productsWithOwnGst += 1;
            else if (kind === "group") productsResolvedFromGroup += 1;
            else if (kind === "org-default") productsResolvedFromOrgDefault += 1;
            else productsUnresolved += 1;
            if (p.resolved.hsnCode != null && p.resolved.hsnCode !== "") productsWithHsn += 1;
        }

        let groupsWithOwnGst = 0;
        for (const g of groupsOut) if (g.own.gstRateId != null) groupsWithOwnGst += 1;

        const payload: GstClassificationPayload = {
            rates: ratesOut,
            groups: groupsOut,
            products: productsOut,
            orgDefaults: {
                defaultGstRateId: org?.defaultGstRateId ?? null,
                defaultGstRate: org?.defaultGstRate
                    ? {
                          id: org.defaultGstRate.id,
                          rate: decimalToNumber(org.defaultGstRate.rate) ?? 0,
                          label: org.defaultGstRate.label,
                      }
                    : null,
                defaultHsnCode: org?.defaultHsnCode ?? null,
                defaultTaxability: org?.defaultTaxability ?? null,
            },
            summary: {
                totalProducts: productsOut.length,
                activeProducts: productsOut.filter((p) => p.isActive).length,
                productsWithOwnGst,
                productsResolvedFromGroup,
                productsResolvedFromOrgDefault,
                productsUnresolved,
                productsWithHsn,
                groupsWithOwnGst,
            },
        };

        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to load GST classification");
    }
}
