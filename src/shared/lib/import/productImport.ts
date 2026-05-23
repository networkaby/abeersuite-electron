import { prisma } from "@/shared/lib/prisma/prismaClient";
import { generateSku } from "@/modules/inventory/lib/sku";
import { productOpeningValue, syncProductCacheFromOpening } from "@/modules/inventory/lib/stockValue";
import { PRODUCT_IMPORT_FIELDS, type ProductImportField } from "./productImportFields";

export { PRODUCT_IMPORT_FIELDS };
export type { ProductImportField };

/**
 * Server-side validator / writer for the CSV product importer at
 * `/office/settings/item-import`. The client parses the CSV and maps each
 * source column to a `ProductImportField`, then sends an array of normalized
 * row objects to this lib (via the preview / commit API routes).
 *
 * `runProductImport({ dryRun: true })` returns counts + per-row results
 * without touching the DB. `dryRun: false` writes inside a single transaction
 * so a mid-batch failure rolls everything back.
 */

export interface ProductImportRowInput {
    /** Source row index in the original CSV (0-based, excluding header). */
    rowIndex: number;
    /** Mapped fields → value. Missing fields are treated as not provided. */
    values: Partial<Record<ProductImportField, string>>;
}

export type ImportMode = "skip" | "update";

export interface ProductImportRequest {
    rows: ProductImportRowInput[];
    mode: ImportMode;
    dryRun: boolean;
    /** Auto-create missing categories / groups / brands / warranty terms. */
    autoCreateMasters: boolean;
}

export interface RowResult {
    rowIndex: number;
    action: "create" | "update" | "skip" | "error";
    sku: string | null;
    name: string | null;
    errors: string[];
    /** Resolved master-data IDs etc., for display. */
    resolved?: {
        unitCode?: string | null;
        categoryName?: string | null;
        groupName?: string | null;
        brandName?: string | null;
        warrantyTermName?: string | null;
        gstRateLabel?: string | null;
    };
}

export interface ProductImportResult {
    willCreate: number;
    willUpdate: number;
    willSkip: number;
    errorCount: number;
    /** Distinct master names that will be / were auto-created. */
    mastersAutoCreated: {
        categories: string[];
        groups: string[];
        brands: string[];
        warrantyTerms: string[];
    };
    results: RowResult[];
}

const TAXABILITY_VALUES = ["TAXABLE", "EXEMPT", "NIL_RATED", "NON_GST"] as const;
type Taxability = (typeof TAXABILITY_VALUES)[number];

interface MasterMaps {
    units: Map<string, { id: number; code: string }>;
    categories: Map<string, { id: number; name: string }>;
    groups: Map<string, { id: number; name: string }>;
    brands: Map<string, { id: number; name: string }>;
    warrantyTerms: Map<string, { id: number; name: string }>;
    gstRates: Map<string, { id: number; rate: string | number; label: string }>;
}

function norm(s: string | null | undefined): string {
    return (s ?? "").trim().toLowerCase();
}

async function loadMasters(): Promise<MasterMaps> {
    const [units, categories, groups, brands, warrantyTerms, gstRates] = await Promise.all([
        prisma.invUnit.findMany({ select: { id: true, code: true, label: true } }),
        prisma.invCategory.findMany({ select: { id: true, name: true } }),
        prisma.invProductGroup.findMany({ select: { id: true, name: true } }),
        prisma.invBrand.findMany({ select: { id: true, name: true } }),
        prisma.invWarrantyTerm.findMany({ select: { id: true, name: true } }),
        prisma.gstRate.findMany({ select: { id: true, rate: true, label: true } }),
    ]);

    const unitMap = new Map<string, { id: number; code: string }>();
    for (const u of units) {
        unitMap.set(norm(u.code), { id: u.id, code: u.code });
        if (u.label) unitMap.set(norm(u.label), { id: u.id, code: u.code });
    }
    const catMap = new Map<string, { id: number; name: string }>();
    for (const c of categories) catMap.set(norm(c.name), { id: c.id, name: c.name });
    const grpMap = new Map<string, { id: number; name: string }>();
    for (const g of groups) grpMap.set(norm(g.name), { id: g.id, name: g.name });
    const brMap = new Map<string, { id: number; name: string }>();
    for (const b of brands) brMap.set(norm(b.name), { id: b.id, name: b.name });
    const wtMap = new Map<string, { id: number; name: string }>();
    for (const w of warrantyTerms) wtMap.set(norm(w.name), { id: w.id, name: w.name });

    const gstMap = new Map<string, { id: number; rate: string | number; label: string }>();
    for (const g of gstRates) {
        const rateStr = String(g.rate).replace(/\.?0+$/, "");
        gstMap.set(rateStr, g);
        gstMap.set(norm(g.label), g);
    }

    return { units: unitMap, categories: catMap, groups: grpMap, brands: brMap, warrantyTerms: wtMap, gstRates: gstMap };
}

function rupeesToPaise(raw: string | undefined): number | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const cleaned = raw.replace(/[,\s₹]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

function toNumber(raw: string | undefined): number | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const n = Number(raw.replace(/[,\s]/g, ""));
    if (!Number.isFinite(n)) return null;
    return n;
}

function toDate(raw: string | undefined): string | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const trimmed = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    return trimmed;
}

export async function runProductImport(req: ProductImportRequest): Promise<ProductImportResult> {
    let masters = await loadMasters();

    // Detect which categories / groups / brands / warranty terms are referenced
    // by CSV rows but absent from the masters. Used both for the preview summary
    // and (on commit) as the work list for the auto-create transaction.
    const missingCategories = new Map<string, string>();
    const missingGroups = new Map<string, string>();
    const missingBrands = new Map<string, string>();
    const missingWarrantyTerms = new Map<string, string>();
    if (req.autoCreateMasters) {
        for (const row of req.rows) {
            const v = row.values;
            if (v.category?.trim() && !masters.categories.has(norm(v.category)))
                missingCategories.set(norm(v.category), v.category.trim());
            if (v.group?.trim() && !masters.groups.has(norm(v.group)))
                missingGroups.set(norm(v.group), v.group.trim());
            if (v.brand?.trim() && !masters.brands.has(norm(v.brand)))
                missingBrands.set(norm(v.brand), v.brand.trim());
            if (v.warrantyTerm?.trim() && !masters.warrantyTerms.has(norm(v.warrantyTerm)))
                missingWarrantyTerms.set(norm(v.warrantyTerm), v.warrantyTerm.trim());
        }
    }

    // On commit, persist the missing masters BEFORE the product write pass so
    // FK resolution finds them. Their own small transaction so a later product
    // failure leaves the masters behind (acceptable: empty masters are easy to
    // clean up; partial product writes are not).
    if (!req.dryRun && req.autoCreateMasters) {
        await prisma.$transaction(async (tx) => {
            for (const name of missingCategories.values()) {
                await tx.invCategory.create({ data: { name } });
            }
            for (const name of missingGroups.values()) {
                await tx.invProductGroup.create({ data: { name } });
            }
            for (const name of missingBrands.values()) {
                await tx.invBrand.create({ data: { name } });
            }
            for (const name of missingWarrantyTerms.values()) {
                await tx.invWarrantyTerm.create({ data: { name } });
            }
        });
        masters = await loadMasters();
    }

    const pendingCategoryNames = req.autoCreateMasters && req.dryRun ? new Set(missingCategories.keys()) : new Set<string>();
    const pendingGroupNames = req.autoCreateMasters && req.dryRun ? new Set(missingGroups.keys()) : new Set<string>();
    const pendingBrandNames = req.autoCreateMasters && req.dryRun ? new Set(missingBrands.keys()) : new Set<string>();
    const pendingWarrantyNames = req.autoCreateMasters && req.dryRun ? new Set(missingWarrantyTerms.keys()) : new Set<string>();

    // Collect SKUs we'll need to check existence for.
    const skusFromInput = new Set<string>();
    for (const r of req.rows) {
        const sku = r.values.sku?.trim().toUpperCase();
        if (sku) skusFromInput.add(sku);
    }
    const existingBySku = new Map<string, { id: number }>();
    if (skusFromInput.size > 0) {
        const existing = await prisma.invProduct.findMany({
            where: { sku: { in: [...skusFromInput] } },
            select: { id: true, sku: true },
        });
        for (const e of existing) existingBySku.set(e.sku, { id: e.id });
    }

    const results: RowResult[] = [];
    const validRows: Array<{
        rowIndex: number;
        existingId: number | null;
        data: {
            sku: string;
            name: string;
            unitId: number;
            categoryId: number | null;
            groupId: number | null;
            brandId: number | null;
            warrantyTermId: number | null;
            modelNo: string | null;
            barcode1: string | null;
            hsnCode: string | null;
            gstRateId: number | null;
            taxability: Taxability | null;
            costPaise: number | null;
            pricePaise: number | null;
            mrpPaise: number | null;
            openingStock: number | null;
            openingRate: number | null;
            openingDate: string | null;
        };
    }> = [];

    for (const row of req.rows) {
        const errors: string[] = [];
        const v = row.values;

        const name = v.name?.trim();
        if (!name) errors.push("name is required");

        let unitId: number | null = null;
        const unitRaw = v.unit?.trim();
        if (!unitRaw) {
            errors.push("unit is required");
        } else {
            const u = masters.units.get(norm(unitRaw));
            if (!u) errors.push(`unit "${unitRaw}" not found in masters`);
            else unitId = u.id;
        }

        const skuRaw = v.sku?.trim().toUpperCase();
        const existing = skuRaw ? existingBySku.get(skuRaw) ?? null : null;

        let categoryId: number | null = null;
        if (v.category?.trim()) {
            const c = masters.categories.get(norm(v.category));
            if (c) categoryId = c.id;
            else if (!pendingCategoryNames.has(norm(v.category))) errors.push(`category "${v.category}" not found`);
        }
        let groupId: number | null = null;
        if (v.group?.trim()) {
            const g = masters.groups.get(norm(v.group));
            if (g) groupId = g.id;
            else if (!pendingGroupNames.has(norm(v.group))) errors.push(`group "${v.group}" not found`);
        }
        let brandId: number | null = null;
        if (v.brand?.trim()) {
            const b = masters.brands.get(norm(v.brand));
            if (b) brandId = b.id;
            else if (!pendingBrandNames.has(norm(v.brand))) errors.push(`brand "${v.brand}" not found`);
        }
        let warrantyTermId: number | null = null;
        if (v.warrantyTerm?.trim()) {
            const w = masters.warrantyTerms.get(norm(v.warrantyTerm));
            if (w) warrantyTermId = w.id;
            else if (!pendingWarrantyNames.has(norm(v.warrantyTerm))) errors.push(`warranty term "${v.warrantyTerm}" not found`);
        }

        let gstRateId: number | null = null;
        if (v.gstRate?.trim()) {
            const keyNum = norm(v.gstRate).replace(/%$/, "").replace(/\.?0+$/, "");
            const gr = masters.gstRates.get(keyNum) ?? masters.gstRates.get(norm(v.gstRate));
            if (!gr) errors.push(`gstRate "${v.gstRate}" not found in masters (try 0, 5, 12, 18, 28)`);
            else gstRateId = gr.id;
        }

        let taxability: Taxability | null = null;
        if (v.taxability?.trim()) {
            const t = v.taxability.trim().toUpperCase();
            if (!TAXABILITY_VALUES.includes(t as Taxability)) {
                errors.push(`taxability "${v.taxability}" must be one of ${TAXABILITY_VALUES.join(", ")}`);
            } else {
                taxability = t as Taxability;
            }
        }

        const costPaise = rupeesToPaise(v.costPrice);
        if (costPaise === null) errors.push(`costPrice "${v.costPrice}" is not a valid number`);
        const pricePaise = rupeesToPaise(v.salePrice);
        if (pricePaise === null) errors.push(`salePrice "${v.salePrice}" is not a valid number`);
        const mrpPaise = rupeesToPaise(v.mrp);
        if (mrpPaise === null) errors.push(`mrp "${v.mrp}" is not a valid number`);
        const openingStock = toNumber(v.openingStock);
        if (openingStock === null) errors.push(`openingStock "${v.openingStock}" is not a valid number`);
        const openingRate = toNumber(v.openingRate);
        if (openingRate === null) errors.push(`openingRate "${v.openingRate}" is not a valid number`);
        const openingDate = toDate(v.openingDate);
        if (openingDate === null) errors.push(`openingDate "${v.openingDate}" must be YYYY-MM-DD`);

        const resolved = {
            unitCode: unitId != null ? masters.units.get(norm(unitRaw ?? ""))?.code : null,
            categoryName: categoryId != null ? v.category?.trim() : null,
            groupName: groupId != null ? v.group?.trim() : null,
            brandName: brandId != null ? v.brand?.trim() : null,
            warrantyTermName: warrantyTermId != null ? v.warrantyTerm?.trim() : null,
            gstRateLabel: gstRateId != null
                ? masters.gstRates.get(norm(v.gstRate ?? ""))?.label ?? `${v.gstRate}%`
                : null,
        };

        if (errors.length > 0) {
            results.push({
                rowIndex: row.rowIndex,
                action: "error",
                sku: skuRaw ?? null,
                name: name ?? null,
                errors,
                resolved,
            });
            continue;
        }

        const willSkip = existing && req.mode === "skip";
        const action: RowResult["action"] = willSkip ? "skip" : existing ? "update" : "create";

        results.push({
            rowIndex: row.rowIndex,
            action,
            sku: skuRaw ?? null,
            name: name ?? null,
            errors: [],
            resolved,
        });

        if (willSkip || !name || unitId == null) continue;

        const finalSku = skuRaw && skuRaw.length > 0 ? skuRaw : generateSku();

        validRows.push({
            rowIndex: row.rowIndex,
            existingId: existing?.id ?? null,
            data: {
                sku: finalSku,
                name,
                unitId,
                categoryId,
                groupId,
                brandId,
                warrantyTermId,
                modelNo: v.modelNo?.trim() || null,
                barcode1: v.barcode1?.trim() || null,
                hsnCode: v.hsnCode?.trim() || null,
                gstRateId,
                taxability,
                costPaise: costPaise ?? null,
                pricePaise: pricePaise ?? null,
                mrpPaise: mrpPaise ?? null,
                openingStock: openingStock ?? null,
                openingRate: openingRate ?? null,
                openingDate: openingDate ?? null,
            },
        });
    }

    const willCreate = results.filter((r) => r.action === "create").length;
    const willUpdate = results.filter((r) => r.action === "update").length;
    const willSkip = results.filter((r) => r.action === "skip").length;
    const errorCount = results.filter((r) => r.action === "error").length;
    const mastersAutoCreated = {
        categories: [...missingCategories.values()],
        groups: [...missingGroups.values()],
        brands: [...missingBrands.values()],
        warrantyTerms: [...missingWarrantyTerms.values()],
    };

    if (req.dryRun || validRows.length === 0) {
        return { willCreate, willUpdate, willSkip, errorCount, mastersAutoCreated, results };
    }

    // Commit — wrapped in one transaction so a mid-batch failure rolls back.
    // Strategy: batch new rows through `createMany` (one round-trip per 500-row
    // chunk) and only fall back to per-row `update` for the rare update path.
    // Default Prisma tx timeout (5s) is far too low for thousand-row imports;
    // bump to 10 minutes.
    const buildPayload = (v: (typeof validRows)[number]) => {
        const opening = { openingStock: v.data.openingStock, openingRate: v.data.openingRate };
        const cachePatch = syncProductCacheFromOpening(opening);
        const openingValueComputed = productOpeningValue(opening);
        return {
            sku: v.data.sku,
            name: v.data.name,
            unitId: v.data.unitId,
            categoryId: v.data.categoryId,
            groupId: v.data.groupId,
            brandId: v.data.brandId,
            warrantyTermId: v.data.warrantyTermId,
            modelNo: v.data.modelNo,
            barcode1: v.data.barcode1,
            hsnCode: v.data.hsnCode,
            gstRateId: v.data.gstRateId,
            taxability: v.data.taxability,
            costPaise: v.data.costPaise,
            pricePaise: v.data.pricePaise,
            mrpPaise: v.data.mrpPaise,
            openingStock: v.data.openingStock,
            openingRate: v.data.openingRate,
            openingValue: openingValueComputed,
            openingStockDate: v.data.openingDate ? new Date(v.data.openingDate) : null,
            ...cachePatch,
        };
    };

    const newRows = validRows.filter((v) => v.existingId == null).map(buildPayload);
    const updateRows = validRows.filter((v) => v.existingId != null);

    const CHUNK = 500;
    await prisma.$transaction(
        async (tx) => {
            for (let i = 0; i < newRows.length; i += CHUNK) {
                await tx.invProduct.createMany({ data: newRows.slice(i, i + CHUNK) });
            }
            for (const v of updateRows) {
                await tx.invProduct.update({ where: { id: v.existingId! }, data: buildPayload(v) });
            }
        },
        { timeout: 10 * 60 * 1000, maxWait: 30_000 },
    );

    return { willCreate, willUpdate, willSkip, errorCount, mastersAutoCreated, results };
}
