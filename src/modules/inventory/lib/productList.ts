// Products list (office/inventory/products) — server-side search, filter, sort
// and paging.
//
// The list used to ship every product to the browser, with live stock and the
// movement badge worked out for all of them, and the page searched / filtered /
// sorted the whole array itself. Now the server answers one page, but every
// search, filter and sort still covers ALL matching products. Two paths:
//
//   DB path    — plain column filters + a column sort. The database filters,
//                sorts, counts and cuts the page. Nothing else is read.
//   Light path — anything the database cannot answer the way the screen means
//                it:
//                  • search text: the shared smart matcher (`scoreSearchText` —
//                    typo tolerance, "papera4" → "paper a4") is not SQL, and a
//                    plain ILIKE would find less here than on POS / vouchers;
//                  • Stock filter or sort: live stock is opening + ledger, not a
//                    column (never the InvProduct.stock cache — see liveStock.ts);
//                  • Barcode sort: the primary barcode is derived from `codes`.
//                The DB still applies the column filters, then sends only the
//                small columns of what is left. Matching / stock / sort run
//                here, then the page's ids are read in full.
//
// The movement badge is only shown (no filter or sort on it), so it is worked
// out for the page rows alone.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { primaryBarcode, productMatchesSearch, searchableText } from "@/shared/lib/inventory";
import { classifyProducts } from "@/modules/inventory/lib/movementClass";
import { loadLiveStockMap } from "@/modules/inventory/lib/liveStock";

/** Office reads go to Supabase and are paid for; a counter reads its own
 *  replica, so a bigger page costs nothing and means fewer clicks. */
export const PRODUCT_PAGE_SIZE = IS_COUNTER_PC ? 500 : 50;

export const PRODUCT_SORT_FIELDS = [
    "sku", "name", "namePart", "categoryName", "brandName", "groupName",
    "warrantyName", "unitCode", "modelNo", "barcode1", "stock", "isActive",
] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

const ID_FILTERS = ["categoryId", "brandId", "groupId", "warrantyTermId", "unitId"] as const;
const BOOL_FILTERS = ["isActive", "requireSaleNote"] as const;

/** Value meaning "no relation" in an id filter. */
const NONE = "__none__";

export type StockBucket = "pos" | "zero" | "neg" | typeof NONE;

/** Stock filter bucket — numeric stock folded into the four states the
 *  operator filters by. */
export function stockBucket(v: number | null): StockBucket {
    if (v == null) return NONE;
    if (v === 0) return "zero";
    return v > 0 ? "pos" : "neg";
}

export type ProductListQuery = {
    q: string;
    sort: { field: ProductSortField; dir: "asc" | "desc" } | null;
    idFilters: Partial<Record<(typeof ID_FILTERS)[number], string[]>>;
    boolFilters: Partial<Record<(typeof BOOL_FILTERS)[number], boolean>>;
    stockBuckets: Set<string> | null;
    page: number;
    branchId: string | null;
};

const csv = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Read the list query off the URL. Unknown / empty values are ignored. */
export function parseProductListQuery(sp: URLSearchParams, branchId: string | null): ProductListQuery {
    const sortField = sp.get("sort") as ProductSortField | null;
    const sort = sortField && (PRODUCT_SORT_FIELDS as readonly string[]).includes(sortField)
        ? { field: sortField, dir: sp.get("dir") === "desc" ? "desc" as const : "asc" as const }
        : null;

    const idFilters: ProductListQuery["idFilters"] = {};
    for (const f of ID_FILTERS) {
        const vals = csv(sp.get(f));
        if (vals.length > 0) idFilters[f] = vals;
    }
    const boolFilters: ProductListQuery["boolFilters"] = {};
    for (const f of BOOL_FILTERS) {
        const vals = new Set(csv(sp.get(f)));
        // Both ticked (or neither) is no filter at all.
        if (vals.has("true") !== vals.has("false")) boolFilters[f] = vals.has("true");
    }
    const stock = csv(sp.get("stock"));
    const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));

    return {
        q: (sp.get("q") ?? "").trim(),
        sort,
        idFilters,
        boolFilters,
        stockBuckets: stock.length > 0 ? new Set(stock) : null,
        page,
        branchId,
    };
}

function buildWhere(query: ProductListQuery): Prisma.InvProductWhereInput {
    const and: Prisma.InvProductWhereInput[] = [];
    for (const [field, vals] of Object.entries(query.idFilters) as [(typeof ID_FILTERS)[number], string[]][]) {
        const ids = vals.filter((v) => v !== NONE).map(Number).filter(Number.isInteger);
        const or: Prisma.InvProductWhereInput[] = [];
        if (field === "categoryId") {
            // Collection = ANY of the product's collections, not only the main one.
            if (ids.length > 0) or.push({ collections: { some: { categoryId: { in: ids } } } });
            if (vals.includes(NONE)) or.push({ collections: { none: {} } });
        } else {
            if (ids.length > 0) or.push({ [field]: { in: ids } });
            if (vals.includes(NONE)) or.push({ [field]: null });
        }
        // Only junk values ticked — match nothing rather than everything.
        and.push(or.length > 0 ? { OR: or } : { id: { in: [] } });
    }
    for (const [field, value] of Object.entries(query.boolFilters)) {
        and.push({ [field]: value });
    }
    return and.length > 0 ? { AND: and } : {};
}

/** Column sorts the database can do. Ties break on SKU (unique) — the order
 *  the list always had for equal values — so a page boundary never shows a row
 *  twice or skips one. */
function dbOrderBy(sort: ProductListQuery["sort"]): Prisma.InvProductOrderByWithRelationInput[] {
    if (!sort) return [{ sku: "asc" }];
    const d = sort.dir;
    const key: Prisma.InvProductOrderByWithRelationInput = (() => {
        switch (sort.field) {
            case "categoryName": return { category: { name: d } };
            case "brandName": return { brand: { name: d } };
            case "groupName": return { group: { name: d } };
            case "warrantyName": return { warrantyTerm: { name: d } };
            case "unitCode": return { unit: { code: d } };
            case "sku": return { sku: d };
            case "name": return { name: d };
            case "namePart": return { namePart: d };
            case "modelNo": return { modelNo: d };
            case "isActive": return { isActive: d };
            // barcode1 / stock never reach here (light path).
            default: return { sku: d };
        }
    })();
    return [key, { sku: "asc" }];
}

/** Columns the light path needs to match, sort and compute stock — and what the
 *  page's edit grid needs for a row it has not loaded (select all filtered). */
const LIGHT_SELECT = {
    id: true, sku: true, name: true, namePart: true, modelNo: true,
    isActive: true, requireSaleNote: true,
    unitId: true, categoryId: true, groupId: true, brandId: true, warrantyTermId: true,
    openingStock: true, openingBranchId: true,
    codes: { select: { kind: true, value: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
    category: { select: { name: true } },
    brand: { select: { name: true } },
    group: { select: { name: true } },
    warrantyTerm: { select: { name: true } },
    unit: { select: { code: true } },
} as const satisfies Prisma.InvProductSelect;

type LightRow = Prisma.InvProductGetPayload<{ select: typeof LIGHT_SELECT }>;

/** The full row the list (and the create reply) returns. */
export const productInclude = {
    unit: { select: { id: true, code: true, label: true } },
    category: { select: { id: true, name: true } },
    group: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    warrantyTerm: { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
    codes: { select: { id: true, kind: true, value: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.InvProductInclude;

function needsLightPath(query: ProductListQuery): boolean {
    return query.q !== ""
        || query.stockBuckets !== null
        || query.sort?.field === "barcode1"
        || query.sort?.field === "stock";
}

/**
 * Same ordering the database gives the DB path: case-folded text, and a null
 * sorts as the largest value (last ascending, first descending — Postgres's
 * default). Stock is the exception the screen asks for: untracked (—) sorts
 * last in BOTH directions, never mixed in with a real −1.
 */
function lightSort(rows: LightRow[], sort: NonNullable<ProductListQuery["sort"]>, stock: Map<number, number | null>) {
    const mul = sort.dir === "asc" ? 1 : -1;
    const key = (r: LightRow): string | number | null => {
        switch (sort.field) {
            case "sku": return r.sku.toLowerCase();
            case "name": return r.name.toLowerCase();
            case "namePart": return r.namePart?.toLowerCase() ?? null;
            case "categoryName": return r.category?.name.toLowerCase() ?? null;
            case "brandName": return r.brand?.name.toLowerCase() ?? null;
            case "groupName": return r.group?.name.toLowerCase() ?? null;
            case "warrantyName": return r.warrantyTerm?.name.toLowerCase() ?? null;
            case "unitCode": return r.unit.code.toLowerCase();
            case "modelNo": return r.modelNo?.toLowerCase() ?? null;
            case "barcode1": return primaryBarcode(r.codes)?.toLowerCase() ?? null;
            case "stock": return stock.get(r.id) ?? null;
            case "isActive": return r.isActive ? 1 : 0;
        }
    };
    return [...rows].sort((a, b) => {
        const ka = key(a), kb = key(b);
        // Equal keys keep the input's SKU order (Array.sort is stable).
        if (ka === kb) return 0;
        if (ka == null) return sort.field === "stock" ? 1 : mul;
        if (kb == null) return sort.field === "stock" ? -1 : -mul;
        return (ka < kb ? -1 : 1) * mul;
    });
}

/** Every product matching the query, in display order, as light rows. */
async function matchLight(query: ProductListQuery): Promise<LightRow[]> {
    let rows = await prisma.invProduct.findMany({
        where: buildWhere(query),
        select: LIGHT_SELECT,
        orderBy: dbOrderBy(query.sort?.field === "barcode1" || query.sort?.field === "stock" ? null : query.sort),
    });

    if (query.q) {
        rows = rows.filter((r) => productMatchesSearch(r, query.q, {
            // Same searchable columns the page always used: name / sku plus
            // Custom, model no and every scannable code (not just barcode1).
            text: (x) => searchableText(x.sku, x.name, x.namePart, x.modelNo, ...x.codes.map((c) => c.value)),
        }));
    }

    const needStock = query.stockBuckets !== null || query.sort?.field === "stock";
    const stock = needStock ? await loadLiveStockMap(rows, query.branchId) : new Map<number, number | null>();
    if (query.stockBuckets) {
        const want = query.stockBuckets;
        rows = rows.filter((r) => want.has(stockBucket(stock.get(r.id) ?? null)));
    }
    // A plain column sort already came back ordered from the database.
    if (query.sort && (query.sort.field === "barcode1" || query.sort.field === "stock")) {
        rows = lightSort(rows, query.sort, stock);
    }
    return rows;
}

/** One page of the products list, with live stock and the movement badge for
 *  the page rows, plus the counts the footer shows. */
export async function loadProductPage(query: ProductListQuery) {
    const pageSize = PRODUCT_PAGE_SIZE;
    const where = buildWhere(query);

    let matched: number;
    let pageIds: number[] | null = null;
    let page = query.page;
    let rows: Prisma.InvProductGetPayload<{ include: typeof productInclude }>[];

    if (needsLightPath(query)) {
        const all = await matchLight(query);
        matched = all.length;
        page = Math.min(page, Math.max(1, Math.ceil(matched / pageSize)));
        pageIds = all.slice((page - 1) * pageSize, page * pageSize).map((r) => r.id);
        const found = await prisma.invProduct.findMany({ where: { id: { in: pageIds } }, include: productInclude });
        const byId = new Map(found.map((r) => [r.id, r]));
        // A row deleted between the two reads simply drops out of the page.
        rows = pageIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
    } else {
        matched = await prisma.invProduct.count({ where });
        page = Math.min(page, Math.max(1, Math.ceil(matched / pageSize)));
        rows = await prisma.invProduct.findMany({
            where,
            orderBy: dbOrderBy(query.sort),
            include: productInclude,
            skip: (page - 1) * pageSize,
            take: pageSize,
        });
    }

    // Live stock from the source of truth — NOT the InvProduct.stock /
    // InvProductBranch caches (they drift). liveStock.ts owns the formula.
    const [liveStock, movement, total] = await Promise.all([
        loadLiveStockMap(rows, query.branchId),
        // Movement class badge (Regular/New/Slow/Non-moving/Dead) — decision
        // support on the list; same engine as the Reorder page.
        classifyProducts(
            rows.map((r) => ({ id: r.id, groupId: r.groupId, categoryId: r.categoryId, createdAt: r.createdAt })),
            { branchId: query.branchId },
        ),
        prisma.invProduct.count(),
    ]);

    return {
        rows: rows.map((r) => {
            const m = movement.get(r.id);
            return {
                // null = "stock not tracked" (no opening AND no movements), shown as —.
                ...r, stock: liveStock.get(r.id) ?? null, barcode1: primaryBarcode(r.codes),
                movementClass: m?.movementClass ?? null,
                daysSinceLastSale: m?.daysSinceLastSale ?? null,
            };
        }),
        matched,
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(matched / pageSize)),
    };
}

/**
 * Every matching product, as the small row the edit grid needs to bulk-apply
 * to it — for "select all N filtered", which covers rows on other pages. No
 * stock, no badge: the grid edits classification fields only.
 */
export async function loadProductSelection(query: ProductListQuery) {
    const rows = await matchLight(query);
    return rows.map((r) => ({
        id: r.id, sku: r.sku, name: r.name, namePart: r.namePart, modelNo: r.modelNo,
        isActive: r.isActive, requireSaleNote: r.requireSaleNote,
        unitId: r.unitId, categoryId: r.categoryId, groupId: r.groupId,
        brandId: r.brandId, warrantyTermId: r.warrantyTermId,
        codes: r.codes,
    }));
}
