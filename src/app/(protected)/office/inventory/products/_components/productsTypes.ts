// Types and constants of the products grid (office → Inventory → Products).
// Moved out of page.tsx unchanged.

import { type ProductCode } from "@/shared/lib/inventory";
import type { Topic } from "@/shared/lib/realtime/topics";

export type Opt = { id: number; name?: string; code?: string; label?: string };
export type GstRateOpt = { id: number; rate: string | number; label: string; isActive?: boolean };

/// The fields the edit grid reads and writes. A row on another page (reached
/// through "select all filtered") arrives as just this, so bulk-apply can
/// still rebuild its name.
export type EditRow = {
    id: number;
    sku: string;
    name: string;
    namePart: string | null;
    /** Attribute bag — feeds the Attributes token when the name is rebuilt. */
    attrsJson?: Record<string, string> | null;
    isActive: boolean;
    /** Cashier must fill the POS line note before selling this item. */
    requireSaleNote: boolean;
    modelNo: string | null;
    /** Full scannable code set — the source of truth for inline barcode edits. */
    codes: ProductCode[];
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
};

export type Row = EditRow & {
    stock: number | null;
    lowStockThreshold: number;
    /** Movement class (Reorder/Stock Health engine) — decision-help badge. */
    movementClass: "NEW" | "REGULAR" | "SLOW" | "NON_MOVING" | "DEAD" | null;
    daysSinceLastSale: number | null;
    /** Derived primary barcode (first BARCODE code) — for display/search/sort. */
    barcode1: string | null;
    unit: { code: string; label?: string };
    category: { name: string } | null;
    brand: { name: string } | null;
    group?: { name: string } | null;
    warrantyTerm?: { name: string } | null;
};

/// Patch payload — only the fields the editable grid touches.
export type Patch = Partial<{
    name: string;
    namePart: string | null;
    modelNo: string | null;
    codes: ProductCode[];
    isActive: boolean;
    requireSaleNote: boolean;
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
}>;

export type Mode = "view" | "edit";

export type SortField =
    | "sku" | "name" | "namePart" | "categoryName" | "brandName" | "groupName"
    | "warrantyName" | "unitCode" | "modelNo" | "barcode1" | "stock" | "isActive";

export type FilterField = "categoryId" | "brandId" | "groupId" | "warrantyTermId" | "unitId" | "isActive" | "stock" | "requireSaleNote";

/// Toggleable data columns (structural columns — row #, select box, actions —
/// are always shown and not listed here). Order matches the render order.
export type ColId =
    | "sku" | "name" | "namePart" | "category" | "brand" | "group"
    | "warranty" | "unit" | "modelNo" | "barcode" | "stock" | "isActive" | "requireSaleNote";

export const COLUMNS: { id: ColId; label: string }[] = [
    { id: "sku", label: "SKU" },
    { id: "name", label: "Name" },
    { id: "namePart", label: "Custom" },
    { id: "category", label: "Collection" },
    { id: "brand", label: "Brand" },
    { id: "group", label: "Group" },
    { id: "warranty", label: "Warranty" },
    { id: "unit", label: "Unit" },
    { id: "modelNo", label: "Model No" },
    { id: "barcode", label: "Barcode" },
    { id: "stock", label: "Stock" },
    { id: "isActive", label: "Active" },
    { id: "requireSaleNote", label: "Req. note" },
];
export const ALL_COL_IDS = COLUMNS.map((c) => c.id);
export const COLS_STORAGE_KEY = "inv-products-visible-cols";

/// One page of the list. Search, filters, sort and the counts are all worked
/// out on the server over every product (modules/inventory/lib/productList.ts);
/// the server also picks the page size (50 office, 500 counter).
export type ProductPage = {
    rows: Row[];
    matched: number;
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
};

export const NO_ROWS: Row[] = [];
export const LIVE_TOPICS: readonly Topic[] = ["stock", "catalogue"];
export const NO_TOPICS: readonly Topic[] = [];
/// Bulk save sends one PATCH per row — at most this many at once, so "select
/// all filtered" over a big list cannot open hundreds of requests together.
export const SAVE_CONCURRENCY = 6;

/// Same value, compared by content — a barcode typed back to what it was is
/// not a pending change.
export function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
        const codes = (x: unknown[]) => (x as ProductCode[]).map((c) => `${c.kind}\u0000${c.value}`).join("\u0001");
        return codes(a) === codes(b);
    }
    return a === b;
}

/// Stock column filter — the server folds live stock into these buckets.
export const STOCK_FILTER_ITEMS: { key: string; label: string }[] = [
    { key: "pos", label: "In stock (> 0)" },
    { key: "zero", label: "Out of stock (0)" },
    { key: "neg", label: "Negative (< 0)" },
    { key: "__none__", label: "Untracked (—)" },
];

export function optLabel(o: Opt | undefined | null): string {
    if (!o) return "—";
    if (o.name) return o.name;
    const composed = `${o.code ?? ""} ${o.label ?? ""}`.trim();
    return composed || "—";
}

/// Fixed pixel widths of the frozen left columns, used to compute each one's
/// `left` offset. Must match the w-* classes on the matching <TableHead>.
export const FROZEN_W = { select: 40, index: 40, sku: 112 } as const;
