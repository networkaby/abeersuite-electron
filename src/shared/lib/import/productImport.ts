import { prisma } from "@/shared/lib/prisma/prismaClient";
import { productOpeningValue, syncProductCacheFromOpening } from "@/modules/inventory/lib/stockValue";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { syncMainCollections } from "@/modules/inventory/lib/productCollections";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { rebaseBarcodeGap, saveAutoBarcodes } from "@/modules/pricing-strategy/lib/barcodeStore";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
import * as Sentry from "@sentry/nextjs";
import { PRODUCT_IMPORT_FIELDS, type ProductImportField } from "./productImportFields";
import { parseWarrantyValue, WARRANTY_TYPE_LABEL } from "@/shared/lib/warranty/warrantyTerms";

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

/// A row is matched to an existing product by the mapped `sku` column: our own
/// `InvProduct.sku` first, then any scannable `InvProductCode.value` (barcode /
/// EAN / UPC) — the same order the POS scanner resolves a scan in. That second
/// step is what lets a supplier price list match, when their part no was kept as
/// the item's barcode and we generated our own SKU. A row matched that way never
/// writes the `sku` column.
///
/// Three behaviours when a row matches an existing product:
///   • "skip"   — leave the existing product untouched
///   • "update" — full-row replace (writes every mapped column, NULLs columns
///                that aren't in the CSV — the legacy behaviour, useful when
///                the CSV is a full snapshot)
///   • "patch"  — write only the columns present in the CSV, leave the rest
///                bit-identical. Use when uploading partial updates like
///                `sku,openingStock,openingRate` to refresh stock counts
///                without touching brand/category/etc.
///
/// `patch` mode skips the name+unit required-field checks (only SKU is
/// required) and emits a Prisma-partial update payload so unmapped columns
/// never get NULLed.
export type ImportMode = "skip" | "update" | "patch";

export interface ProductImportRequest {
    rows: ProductImportRowInput[];
    mode: ImportMode;
    dryRun: boolean;
    /** Auto-create missing categories / groups / brands / warranty terms. */
    autoCreateMasters: boolean;
    /**
     * STOCK LOCATION for the opening quantity — one branch for the whole file,
     * chosen in the UI, deliberately NOT a CSV column. A file is one physical
     * stock-take at one place; making it per-row would invite a spreadsheet to
     * scatter a count across branches by typo.
     *
     * Only meaningful when `openingStock` is mapped, and only written when an
     * opening field is actually being written (see buildPatchPayload — opening
     * fields move as a group). null / undefined means Head Office — an opening
     * is never saved without a branch (see liveStock.ts).
     */
    openingBranchId?: string | null;
}

export interface RowResult {
    rowIndex: number;
    action: "create" | "update" | "skip" | "error";
    sku: string | null;
    /** How the row found its existing product — by `sku`, or by a scannable
     *  code (barcode / EAN / UPC). `null` when nothing matched (a create, or
     *  an error). Shown in the preview so the operator can see which rows came
     *  in through the supplier's own part no rather than our SKU. */
    matchedBy: "sku" | "code" | null;
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
    /** Keyed by name AND by "name · type". A name two terms share maps to
     *  `ambiguous` — the row must then say the type. */
    warrantyTerms: Map<string, { id: number; name: string } | "ambiguous">;
    // `rate` is dropped from the map value — only used inline to build the
    // numeric lookup key. Downstream code reads only `id` / `label`.
    gstRates: Map<string, { id: number; label: string }>;
}

function norm(s: string | null | undefined): string {
    return (s ?? "").trim().toLowerCase();
}

/** The lookup key of a typed warranty value: "1 Year - seller" → "1 year · seller". */
function warrantyKey(raw: string): string {
    const { name, warrantyType } = parseWarrantyValue(raw);
    return norm(warrantyType ? `${name} · ${WARRANTY_TYPE_LABEL[warrantyType]}` : name);
}

async function loadMasters(): Promise<MasterMaps> {
    const [units, categories, groups, brands, warrantyTerms, gstRates] = await Promise.all([
        prisma.invUnit.findMany({ select: { id: true, code: true, label: true } }),
        prisma.invCategory.findMany({ select: { id: true, name: true } }),
        prisma.invProductGroup.findMany({ select: { id: true, name: true } }),
        prisma.invBrand.findMany({ select: { id: true, name: true } }),
        prisma.invWarrantyTerm.findMany({ select: { id: true, name: true, warrantyType: true, sellerDays: true, durationDays: true } }),
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
    const wtMap: MasterMaps["warrantyTerms"] = new Map();
    // A key two terms share (same name, or even same name and type) is ambiguous.
    const putTerm = (k: string, v: { id: number; name: string }) => wtMap.set(k, wtMap.has(k) ? "ambiguous" : v);
    for (const w of warrantyTerms) {
        putTerm(norm(w.name), { id: w.id, name: w.name });
        putTerm(norm(`${w.name} · ${WARRANTY_TYPE_LABEL[w.warrantyType]}`), { id: w.id, name: w.name });
    }

    const gstMap = new Map<string, { id: number; label: string }>();
    for (const g of gstRates) {
        const rateStr = String(g.rate).replace(/\.?0+$/, "");
        const value = { id: g.id, label: g.label };
        gstMap.set(rateStr, value);
        gstMap.set(norm(g.label), value);
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

export async function runProductImport(req: ProductImportRequest): Promise<ProductImportResult> {
    // Fail the whole file, not each row, on a bad stock location. It is one
    // value for the whole import, so a wrong one is a wrong import — and on
    // commit it would otherwise surface as a raw FK violation halfway through
    // the write pass, after some products had already landed.
    if (req.openingBranchId) {
        const branch = await prisma.branch.findUnique({
            where: { id: req.openingBranchId },
            select: { id: true },
        });
        if (!branch) throw new Error(`Stock location "${req.openingBranchId}" is not a branch.`);
    }
    // Every opening sits at a branch. A caller that names none (an old client, a
    // script) gets Head Office — the same answer liveStock.ts gives an old row
    // that has none. Looked up only when the file carries an opening quantity.
    const openingBranchId = req.openingBranchId
        ?? (req.rows.some((r) => r.values.openingStock?.trim()) ? await systemBranchId(prisma) : null);

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
            if (v.warrantyTerm?.trim() && !masters.warrantyTerms.has(warrantyKey(v.warrantyTerm)))
                missingWarrantyTerms.set(warrantyKey(v.warrantyTerm), v.warrantyTerm.trim());
        }
    }

    // On commit, persist the missing masters BEFORE the product write pass so
    // FK resolution finds them. Their own small transaction so a later product
    // failure leaves the masters behind (acceptable: empty masters are easy to
    // clean up; partial product writes are not).
    //
    // Use `createMany` (one query per master type) instead of looping individual
    // `create` calls — a CSV that introduces 80+ new groups would otherwise
    // exceed the default 5s interactive-tx timeout (~60ms per round-trip to
    // Supabase × 80 = ~5s). `skipDuplicates: true` keeps re-runs idempotent if
    // a sibling row created the master between loadMasters() and now.
    if (!req.dryRun && req.autoCreateMasters) {
        await prisma.$transaction(
            async (tx) => {
                if (missingCategories.size > 0) {
                    await tx.invCategory.createMany({
                        data: [...missingCategories.values()].map((name) => ({ name })),
                        skipDuplicates: true,
                    });
                }
                if (missingGroups.size > 0) {
                    await tx.invProductGroup.createMany({
                        data: [...missingGroups.values()].map((name) => ({ name })),
                        skipDuplicates: true,
                    });
                }
                if (missingBrands.size > 0) {
                    await tx.invBrand.createMany({
                        data: [...missingBrands.values()].map((name) => ({ name })),
                        skipDuplicates: true,
                    });
                }
                if (missingWarrantyTerms.size > 0) {
                    await tx.invWarrantyTerm.createMany({
                        // "1 Year · Seller" → a term named "1 Year" of type Seller;
                        // no type given → the default (Manufacturer).
                        data: [...missingWarrantyTerms.values()].map((raw) => {
                            const { name, warrantyType } = parseWarrantyValue(raw);
                            return warrantyType ? { name, warrantyType } : { name };
                        }),
                        skipDuplicates: true,
                    });
                }
            },
            { timeout: 60_000, maxWait: 30_000 },
        );
        masters = await loadMasters();
    }

    const pendingCategoryNames = req.autoCreateMasters && req.dryRun ? new Set(missingCategories.keys()) : new Set<string>();
    const pendingGroupNames = req.autoCreateMasters && req.dryRun ? new Set(missingGroups.keys()) : new Set<string>();
    const pendingBrandNames = req.autoCreateMasters && req.dryRun ? new Set(missingBrands.keys()) : new Set<string>();
    const pendingWarrantyNames = req.autoCreateMasters && req.dryRun ? new Set(missingWarrantyTerms.keys()) : new Set<string>();

    // Collect the match keys we'll need to check existence for. The mapped
    // `sku` column is really "SKU or any scannable code": a supplier file
    // carries THEIR part no, which for many products is stored here as a
    // barcode/EAN/UPC while our own generated SKU sits in `sku`.
    const skusFromInput = new Set<string>();
    const codesFromInput = new Set<string>();
    for (const r of req.rows) {
        const raw = r.values.sku?.trim();
        if (!raw) continue;
        skusFromInput.add(raw.toUpperCase());
        // Codes are compared exactly (InvProductCode.value has no case-folded
        // index), so try the three spellings that actually occur in supplier
        // files. Dashes/spaces are still significant.
        codesFromInput.add(raw);
        codesFromInput.add(raw.toUpperCase());
        codesFromInput.add(raw.toLowerCase());
    }
    const existingBySku = new Map<string, { id: number }>();
    if (skusFromInput.size > 0) {
        const existing = await prisma.invProduct.findMany({
            where: { sku: { in: [...skusFromInput] } },
            select: { id: true, sku: true },
        });
        for (const e of existing) existingBySku.set(e.sku, { id: e.id });
    }

    // Second pass: resolve the rows that missed on SKU against the scannable
    // code space. Same order the POS scanner uses (see the products/lookup
    // route): an exact SKU wins, a code is the fallback. `InvProductCode.value`
    // is globally unique and the write-time collision guard keeps the two
    // namespaces disjoint, so a code match is never ambiguous.
    const existingByCode = new Map<string, { id: number }>();
    const unresolvedCodes = [...codesFromInput].filter((c) => !existingBySku.has(c.toUpperCase()));
    if (unresolvedCodes.length > 0) {
        const hits = await prisma.invProductCode.findMany({
            where: { value: { in: unresolvedCodes } },
            select: { productId: true, value: true },
        });
        for (const h of hits) existingByCode.set(h.value, { id: h.productId });
    }

    /// Resolve one CSV match key to an existing product. Returns how it matched
    /// so the caller can (a) show it in the preview and (b) refuse to overwrite
    /// our generated SKU with the supplier's code on a code match.
    const resolveExisting = (raw: string): { id: number; matchedBy: "sku" | "code" } | null => {
        const bySku = existingBySku.get(raw.toUpperCase());
        if (bySku) return { id: bySku.id, matchedBy: "sku" };
        const byCode =
            existingByCode.get(raw)
            ?? existingByCode.get(raw.toUpperCase())
            ?? existingByCode.get(raw.toLowerCase());
        return byCode ? { id: byCode.id, matchedBy: "code" } : null;
    };

    const results: RowResult[] = [];
    const validRows: Array<{
        rowIndex: number;
        existingId: number | null;
        /// Matched through a scannable code, not the SKU column — the value in
        /// the CSV is the supplier's part no, so `sku` must never be written.
        matchedByCode: boolean;
        /// CSV columns this row carried a non-empty value for. Used by
        /// buildPatchPayload to write only the touched columns.
        present: Set<ProductImportField>;
        data: {
            sku: string;
            // Patch rows may have these unset; non-patch rows always do.
            name: string | null;
            unitId: number | null;
            categoryId: number | null;
            groupId: number | null;
            brandId: number | null;
            warrantyTermId: number | null;
            modelNo: string | null;
            barcode1: string | null;
            hsnCode: string | null;
            gstRateId: number | null;
            taxability: Taxability | null;
            savedSalePricePaise: number | null;
            mrpPaise: number | null;
            openingStock: number | null;
            openingRate: number | null;
        };
    }> = [];

    /// Returns the set of CSV columns that carried a non-empty value for this
    /// row. Patch mode uses this to write only those columns and leave the
    /// rest of the product untouched. For non-patch modes it's ignored.
    const presentIn = (vals: Partial<Record<ProductImportField, string>>): Set<ProductImportField> => {
        const s = new Set<ProductImportField>();
        for (const k of Object.keys(vals) as ProductImportField[]) {
            const v = vals[k];
            if (typeof v === "string" && v.trim() !== "") s.add(k);
        }
        return s;
    };

    for (const row of req.rows) {
        const errors: string[] = [];
        const v = row.values;
        const present = presentIn(v);
        const isPatch = req.mode === "patch";

        const name = v.name?.trim();
        // In patch mode, name is optional — only required for creates (which
        // patch mode disallows; see existence check below). Other modes still
        // require it because they perform a full-row write.
        if (!name && !isPatch) errors.push("name is required");

        let unitId: number | null = null;
        const unitRaw = v.unit?.trim();
        if (!unitRaw) {
            // Same logic — only the full-write modes need a unit.
            if (!isPatch) errors.push("unit is required");
        } else {
            const u = masters.units.get(norm(unitRaw));
            if (!u) errors.push(`unit "${unitRaw}" not found in masters`);
            else unitId = u.id;
        }

        // The incoming match key, kept in BOTH spellings: upper-cased for the
        // SKU namespace (that's how SKUs are stored/created), verbatim for the
        // code namespace (a part no can be mixed case).
        const matchKey = v.sku?.trim();
        const skuRaw = matchKey?.toUpperCase();
        if (!skuRaw) errors.push("SKU is required — auto-SKU generation is disabled on bulk import");
        const existing = matchKey ? resolveExisting(matchKey) : null;
        // A code match means our own generated SKU lives in `sku` and the value
        // in the CSV is the supplier's code — writing it into `sku` would clobber
        // our convention and break the SKU/code disjointness guard.
        const matchedByCode = existing?.matchedBy === "code";
        // Patch mode targets existing products only — creating from a partial
        // CSV would produce broken rows (no name / no unit).
        if (isPatch && skuRaw && !existing) {
            errors.push(
                `"${matchKey}" matched no product SKU and no scannable code (barcode / EAN / UPC) — patch mode only updates existing products`,
            );
        }

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
            const w = masters.warrantyTerms.get(warrantyKey(v.warrantyTerm));
            if (w === "ambiguous") errors.push(`warranty term "${v.warrantyTerm}" matches more than one term — add the type, e.g. "${v.warrantyTerm.trim()} · Manufacturer" or "${v.warrantyTerm.trim()} · Seller"`);
            else if (w) warrantyTermId = w.id;
            else if (!pendingWarrantyNames.has(warrantyKey(v.warrantyTerm))) errors.push(`warranty term "${v.warrantyTerm}" not found`);
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

        // costPrice is intentionally not importable — see productImportFields.ts.
        // There is no saved cost: it is worked out from the stock ledger's
        // purchase lots (valuation.ts), with `openingRate` as the first lot.
        //
        // In patch mode, only validate a numeric cell when it was actually
        // provided. The existing `toNumber` already returns null for both
        // "field absent" and "field present but unparseable" — we distinguish
        // via the `present` set so an absent column never errors.
        const savedSalePricePaise = rupeesToPaise(v.salePrice);
        if (savedSalePricePaise === null && present.has("salePrice")) errors.push(`salePrice "${v.salePrice}" is not a valid number`);
        const mrpPaise = rupeesToPaise(v.mrp);
        if (mrpPaise === null && present.has("mrp")) errors.push(`mrp "${v.mrp}" is not a valid number`);
        const openingStock = toNumber(v.openingStock);
        if (openingStock === null && present.has("openingStock")) errors.push(`openingStock "${v.openingStock}" is not a valid number`);
        const openingRate = toNumber(v.openingRate);
        if (openingRate === null && present.has("openingRate")) errors.push(`openingRate "${v.openingRate}" is not a valid number`);

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
                matchedBy: existing?.matchedBy ?? null,
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
            matchedBy: existing?.matchedBy ?? null,
            name: name ?? null,
            errors: [],
            resolved,
        });

        if (willSkip || !skuRaw) continue;
        // Patch mode permits null name+unit (they're left untouched on the
        // existing row); other modes already errored above if either was
        // missing.
        if (!isPatch && (!name || unitId == null)) continue;

        // SKU is now required (validated above) — drop the auto-generate fallback.
        // Operators must supply SKU explicitly so imports cannot create phantom
        // random codes that drift from the supplier's catalog.
        const finalSku = skuRaw;

        validRows.push({
            rowIndex: row.rowIndex,
            existingId: existing?.id ?? null,
            matchedByCode,
            present,
            data: {
                sku: finalSku,
                name: name ?? null,
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
                savedSalePricePaise: savedSalePricePaise ?? null,
                mrpPaise: mrpPaise ?? null,
                openingStock: openingStock ?? null,
                openingRate: openingRate ?? null,
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
    //
    // The barcode date (salePriceFrozenAt) is stamped after the write, by
    // saveAutoBarcodes, for new products only.
    const buildPayload = (v: (typeof validRows)[number]) => {
        const opening = { openingStock: v.data.openingStock, openingRate: v.data.openingRate };
        const cachePatch = syncProductCacheFromOpening(opening);
        const openingValueComputed = productOpeningValue(opening);
        return {
            sku: v.data.sku,
            name: v.data.name!,
            // The imported name is also stored as the custom name part
            // (userPart token) so a later regenerate rebuilds `name` around it
            // instead of wiping it. At import there is no brand/group applied
            // yet, so name === namePart here; regenerate updates name once
            // masters are set. See InvProduct.namePart.
            namePart: v.data.name!,
            unitId: v.data.unitId!,
            categoryId: v.data.categoryId,
            groupId: v.data.groupId,
            brandId: v.data.brandId,
            warrantyTermId: v.data.warrantyTermId,
            modelNo: v.data.modelNo,
            // Codes can't ride createMany (no nested writes) — attached after
            // insert from v.data.barcode1, keyed by SKU. See the tx block below.
            hsnCode: v.data.hsnCode,
            gstRateId: v.data.gstRateId,
            taxability: v.data.taxability,
            savedSalePricePaise: v.data.savedSalePricePaise,
            // An imported Sale Price becomes the product's price: source = SAVED
            // so the recompute (below) materializes it as effectiveSalePricePaise
            // (POS + barcode), instead of the STRATEGY markup engine. No Sale
            // Price → keep the STRATEGY default. Mirrors the Update & Print
            // Labels "Sale Price" save.
            effectiveSalePriceSource: v.data.savedSalePricePaise != null ? ("SAVED" as const) : ("STRATEGY" as const),
            mrpPaise: v.data.mrpPaise,
            openingStock: v.data.openingStock,
            openingRate: v.data.openingRate,
            openingValue: openingValueComputed,
            // Stock location of that opening quantity. Only stamped when there
            // IS an opening quantity — a branch on a product that opened with
            // nothing would be a lie the branch screens then have to explain.
            openingBranchId: v.data.openingStock != null ? openingBranchId : null,
            // `cachePatch` is the saved stock total = the opening — right for a NEW
            // row only (no movement yet). An existing row drops it and is rebuilt
            // from the ledger after the write (buildUpdatePayload).
            ...cachePatch,
        };
    };

    /// Partial update payload — only the columns the operator brought in the
    /// CSV. Empty cells stay untouched on the existing product row. Opening-
    /// related derivatives (openingValue) are re-computed only when an opening
    /// field was provided; the saved stock total is rebuilt from the ledger after
    /// the write.
    const buildPatchPayload = (v: (typeof validRows)[number]) => {
        const p = v.present;
        const out: Record<string, unknown> = {};
        if (p.has("name") && v.data.name) {
            out.name = v.data.name;
            // Keep the custom name part in step with a patched name (see
            // buildPayload) so regenerate stays lossless.
            out.namePart = v.data.name;
        }
        // Only when the row was found BY its SKU. On a code match the CSV value
        // is the supplier's part no and `sku` holds our own generated code —
        // writing it would clobber our convention and collide with the code.
        if (p.has("sku") && !v.matchedByCode) out.sku = v.data.sku;
        if (p.has("unit") && v.data.unitId != null) out.unitId = v.data.unitId;
        if (p.has("category")) out.categoryId = v.data.categoryId;
        if (p.has("group")) out.groupId = v.data.groupId;
        if (p.has("brand")) out.brandId = v.data.brandId;
        if (p.has("warrantyTerm")) out.warrantyTermId = v.data.warrantyTermId;
        if (p.has("modelNo")) out.modelNo = v.data.modelNo;
        if (p.has("barcode1")) {
            // Replace the primary barcode code (keeps the column-style single-code
            // import semantics). Blank value clears it.
            const bc = v.data.barcode1?.trim();
            out.codes = bc
                ? { deleteMany: {}, create: [{ kind: "BARCODE", value: bc, sortOrder: 0 }] }
                : { deleteMany: {} };
        }
        if (p.has("hsnCode")) out.hsnCode = v.data.hsnCode;
        if (p.has("gstRate")) out.gstRateId = v.data.gstRateId;
        if (p.has("taxability")) out.taxability = v.data.taxability;
        if (p.has("salePrice")) {
            // Patching a Sale Price makes it the product's price (source = SAVED),
            // same as buildPayload / the labels page. `present` only holds
            // non-empty cells, so savedSalePricePaise is non-null here.
            out.savedSalePricePaise = v.data.savedSalePricePaise;
            out.effectiveSalePriceSource = "SAVED";
            // The barcode price / date are not touched on an existing product;
            // only its gap is re-measured after the recompute (barcodeStore.ts).
        }
        if (p.has("mrp")) out.mrpPaise = v.data.mrpPaise;
        // Opening fields move as a group — if any are touched, recompute the
        // derived openingValue + cache columns. Untouched openings stay null
        // here (not written) so the existing stored values survive.
        const openingTouched = p.has("openingStock") || p.has("openingRate");
        if (openingTouched) {
            if (p.has("openingStock")) out.openingStock = v.data.openingStock;
            if (p.has("openingRate"))  out.openingRate  = v.data.openingRate;
            // The stock location moves with the quantity, and only with the
            // quantity: an operator refreshing counts for one branch is saying
            // where those counts are. A rate-only patch leaves the existing
            // location alone — it is not restating where anything is lying.
            if (p.has("openingStock") && v.data.openingStock != null) {
                out.openingBranchId = openingBranchId;
            }
            // Recompute openingValue only when we have BOTH opening stock and
            // opening rate in this row. The saved stock total is rebuilt from
            // the ledger after the write, like a full-replace update.
            if (v.data.openingStock != null && v.data.openingRate != null) {
                const opening = { openingStock: v.data.openingStock, openingRate: v.data.openingRate };
                out.openingValue = productOpeningValue(opening);
            }
        }
        return out;
    };

    const newRows = validRows.filter((v) => v.existingId == null).map(buildPayload);
    const updateRows = validRows.filter((v) => v.existingId != null);
    /// Full-replace payload for an EXISTING row. A code-matched row keeps the
    /// SKU it already has: the CSV carried the supplier's part no, not ours.
    /// (Creates go through buildPayload directly and always need their SKU, so
    /// the drop lives here rather than inside buildPayload.)
    const buildUpdatePayload = (v: (typeof validRows)[number]) => {
        // `stock` is dropped: on a product that has moved, the opening alone is
        // not its stock (opening 10, +50, −30 = 30, not 10). Rebuilt below.
        const { stock: _rebuiltFromLedger, ...payload } = buildPayload(v);
        if (!v.matchedByCode) return payload;
        const { sku: _keepExisting, ...rest } = payload;
        return rest;
    };

    const writeOne = req.mode === "patch" ? buildPatchPayload : buildUpdatePayload;

    const CHUNK = 500;
    await prisma.$transaction(
        async (tx) => {
            for (let i = 0; i < newRows.length; i += CHUNK) {
                await tx.invProduct.createMany({ data: newRows.slice(i, i + CHUNK) });
            }
            // Attach barcodes for create-mode rows: createMany can't write nested
            // InvProductCode rows, so resolve the new ids by (unique) SKU and bulk
            // -insert the codes. skipDuplicates tolerates a code already in use.
            const codeRows = validRows.filter((v) => v.existingId == null && v.data.barcode1?.trim());
            if (codeRows.length > 0) {
                const skuToId = new Map(
                    (await tx.invProduct.findMany({
                        where: { sku: { in: codeRows.map((v) => v.data.sku) } },
                        select: { id: true, sku: true },
                    })).map((p) => [p.sku, p.id] as const),
                );
                const codeData = codeRows
                    .map((v) => {
                        const productId = skuToId.get(v.data.sku);
                        return productId != null
                            ? { productId, kind: "BARCODE" as const, value: v.data.barcode1!.trim(), sortOrder: 0 }
                            : null;
                    })
                    .filter((c): c is NonNullable<typeof c> => c != null);
                // Cross-namespace guard: a barcode that collides with an existing
                // SKU would make scans ambiguous — drop it (like a duplicate code).
                const skuClashes = new Set(
                    (await tx.invProduct.findMany({
                        where: { sku: { in: [...new Set(codeData.map((c) => c.value))] } },
                        select: { sku: true },
                    })).map((p) => p.sku),
                );
                const safeCodeData = codeData.filter((c) => !skuClashes.has(c.value));
                for (let i = 0; i < safeCodeData.length; i += CHUNK) {
                    await tx.invProductCode.createMany({ data: safeCodeData.slice(i, i + CHUNK), skipDuplicates: true });
                }
            }
            for (const v of updateRows) {
                await tx.invProduct.update({ where: { id: v.existingId! }, data: writeOne(v) });
            }
            // Saved stock totals of every updated row = opening + ledger, in one
            // batched rebuild (a no-op on rows already right).
            await recomputeProductStock(tx, updateRows.map((v) => v.existingId!));
            // categoryId was written directly (createMany) — keep the collection
            // list's main row in step (productCollections.ts).
            const catUpdatedIds = updateRows.filter((v) => v.present.has("category")).map((v) => v.existingId!);
            const catNewSkus = validRows.filter((v) => v.existingId == null && v.data.categoryId != null).map((v) => v.data.sku);
            const catCreatedIds = catNewSkus.length
                ? (await tx.invProduct.findMany({ where: { sku: { in: catNewSkus } }, select: { id: true } })).map((p) => p.id)
                : [];
            await syncMainCollections(tx, [...catUpdatedIds, ...catCreatedIds]);
        },
        { timeout: 10 * 60 * 1000, maxWait: 30_000 },
    );

    // Materialize effectiveSalePricePaise for every touched product so imported
    // rows are sellable in POS without a manual "Apply all". createMany returns
    // no ids, so resolve created rows by their (unique) SKU. Recompute in small
    // chunks — the engine's per-call transaction has a 5s limit. Best-effort:
    // a recompute failure never fails the import.
    try {
        const updatedIds = updateRows.map((v) => v.existingId!);
        const newSkus = validRows.filter((v) => v.existingId == null).map((v) => v.data.sku);
        const createdIds = newSkus.length
            ? (await prisma.invProduct.findMany({ where: { sku: { in: newSkus } }, select: { id: true } })).map((p) => p.id)
            : [];
        const touchedIds = [...new Set([...updatedIds, ...createdIds])];
        const CHUNK_RECOMPUTE = 100;
        for (let i = 0; i < touchedIds.length; i += CHUNK_RECOMPUTE) {
            await recomputePricesForProducts(touchedIds.slice(i, i + CHUNK_RECOMPUTE));
        }
        // New products with a Sale Price get their barcode saved; an existing
        // product whose Sale Price was patched (now the selling price) only has its
        // barcode gap re-measured — its barcode price and date stay.
        await saveAutoBarcodes(createdIds, { onlyMissing: true });
        await rebaseBarcodeGap(updateRows.filter((v) => v.present.has("salePrice")).map((v) => v.existingId!));
    } catch (err: unknown) {
        Sentry.captureException(err, { tags: { source: "price-recompute", context: "product-import" } });
        console.error("[price-recompute] failed after product import", err);
    }

    return { willCreate, willUpdate, willSkip, errorCount, mastersAutoCreated, results };
}
