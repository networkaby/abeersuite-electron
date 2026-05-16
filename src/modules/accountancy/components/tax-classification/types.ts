// Wire types for the Tax Classification page. Mirror the payload returned by
// GET /api/accountancy/reports/gst-classification.

import type { ResolvedTax } from "@/modules/inventory/lib/gstResolver";

export type OwnTax = {
    gstRateId: number | null;
    gstRateLabel: string | null;
    gstRate: number | null;
    hsnCode: string | null;
    taxability: string | null;
};

export type RateBucket = {
    id: number;
    rate: number;
    label: string;
    isActive: boolean;
    productCount: number;
};

export type GroupRow = {
    id: number;
    name: string;
    parentId: number | null;
    isActive: boolean;
    own: OwnTax;
    resolved: ResolvedTax;
    directProductCount: number;
};

export type ProductRow = {
    id: number;
    sku: string;
    name: string;
    isActive: boolean;
    group: { id: number; name: string } | null;
    own: OwnTax;
    resolved: ResolvedTax;
};

export type OrgDefaultsRow = {
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
