import { z } from "zod";
import { nameIsActiveSchema } from "./commonSchemas";

/** Empty / whitespace-only → null */
export const zOptStr = (maxLen: number) =>
    z
        .union([z.string(), z.null(), z.undefined()])
        .transform((v) => {
            // undefined = field ABSENT from the payload → keep it undefined so
            // partial-update routes (which gate on `!== undefined` or use
            // pickDefined) SKIP it and preserve the stored value. Previously this
            // returned null for undefined, so any PATCH that omitted an optional
            // string silently cleared it (e.g. editing a product's brand wiped
            // its namePart / shopSubheading / slug / hsnCode). null or "" remain
            // an explicit clear.
            if (v === undefined) return undefined;
            if (v === null) return null;
            const t = String(v).trim();
            return t === "" ? null : t.slice(0, maxLen);
        });

// Scannable product codes — barcode / EAN / UPC. Replaces the former
// barcode1-3 / ean1-3 / upc1-3 slot columns with a normalized array (one entry
// per code → InvProductCode rows). EAN/UPC keep their digit-length rules.
const PRODUCT_CODE_KINDS = ["BARCODE", "EAN", "UPC"] as const;
const productCodeSchema = z
    .object({
        kind: z.enum(PRODUCT_CODE_KINDS),
        value: z.string().trim().min(1).max(64),
    })
    .superRefine((c, ctx) => {
        if (c.kind === "EAN" && !/^\d{8,13}$/.test(c.value))
            ctx.addIssue({ code: "custom", message: "EAN must be 8–13 digits", path: ["value"] });
        if (c.kind === "UPC" && !/^\d{12}$/.test(c.value))
            ctx.addIssue({ code: "custom", message: "UPC must be 12 digits", path: ["value"] });
    });

export const invUnitCreateSchema = z.object({
    code: z.string().trim().min(1).max(32),
    label: z.string().trim().min(1).max(120),
    decimals: z.coerce.number().int().min(0).max(6).optional().default(0),
    isActive: z.boolean().optional().default(true),
});

export const invUnitUpdateSchema = invUnitCreateSchema.partial();

export const invCategoryCreateSchema = nameIsActiveSchema.extend({
    slug: zOptStr(120),
    parentId: z.number().int().positive().nullish(),
});

export const invCategoryUpdateSchema = invCategoryCreateSchema.partial();

const TAXABILITY = ["TAXABLE", "EXEMPT", "NIL_RATED", "NON_GST"] as const;

// Product / product-group fields the Tax Classification page's inline edits
// PATCH. A request touching ONLY these keys is a "tax-only" edit — gated by
// the narrower `compliance:tax:edit` permission instead of the full
// `inventory:manage` (see the two PATCH routes' isTaxOnlyPatch check).
export const TAX_CLASSIFICATION_FIELDS = ["gstRateId", "hsnCode", "taxability"] as const;

export const invProductGroupCreateSchema = nameIsActiveSchema.extend({
    parentId:   z.number().int().positive().nullish(),
    gstRateId:  z.number().int().positive().nullish(),
    hsnCode:    zOptStr(32),
    taxability: z.enum(TAXABILITY).nullish(),
});

export const invProductGroupUpdateSchema = invProductGroupCreateSchema.partial();

export const invBrandCreateSchema = nameIsActiveSchema;

export const invBrandUpdateSchema = invBrandCreateSchema.partial();

export const invWarrantyTermCreateSchema = nameIsActiveSchema.extend({
    description: zOptStr(2000),
    // Days, not months. Max 100y = 36500 days. 0 / null = no fixed duration.
    durationDays: z.number().int().min(0).max(36500).nullish(),
});

export const invWarrantyTermUpdateSchema = invWarrantyTermCreateSchema.partial();

const productIdentifiers = {
    modelNo: zOptStr(200),
    // Full replace-set of scannable codes. Omit (undefined) on update to leave
    // existing codes untouched; an empty array clears them.
    codes: z.array(productCodeSchema).max(30).optional(),
    notes: zOptStr(5000),
};

// All stored in paise (₹500.00 → 50000) — the form converts in the UI.
// costPaise was dropped in PR 3 of noble-boole; cost now derives from the
// ledger walk (opening rate is the synthetic first lot).
const productPricing = {
    effectiveSalePricePaise: z.number().int().nonnegative().nullish(),
    // Human SAVED sale price (barcode source). Edit Product / Item Import write
    // this; the recompute engine never overwrites it (unlike effectiveSalePricePaise).
    savedSalePricePaise: z.number().int().nonnegative().nullish(),
    mrpPaise:   z.number().int().nonnegative().nullish(),
};

// Books-beginning opening stock — written directly to the InvProduct row, no
// voucher in between. openingValue is computed server-side from qty × rate.
const productOpening = {
    openingStock:     z.number().nonnegative().nullish(),         // qty (Decimal in DB)
    openingRate:      z.number().nonnegative().nullish(),         // rupees (Decimal in DB)
    openingStockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
};

export const invProductCreateSchema = z.object({
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(500),
    /// Operator-curated free text rendered by the `userPart` token in the
    /// naming-convention template. Survives every name regeneration.
    namePart: zOptStr(500),
    unitId: z.coerce.number().int().positive(),
    categoryId: z.number().int().positive().nullish(),
    groupId: z.number().int().positive().nullish(),
    brandId: z.number().int().positive().nullish(),
    warrantyTermId: z.number().int().positive().nullish(),
    /// Cashier must fill the line note before selling this item in POS.
    requireSaleNote: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    // Auto-generated from masters via the naming-convention config; user can
    // override. Empty / whitespace → null.
    shopSubheading: zOptStr(500),
    slug: zOptStr(120),
    ...productIdentifiers,
    ...productPricing,
    ...productOpening,
    // Flat key→value bag for SEO naming tokens and extra product info.
    attrsJson: z.record(z.string(), z.string()).nullish(),
    // GST classification — all optional; null means "inherit via cascade".
    // No defaults; the product form must NOT prefill these.
    gstRateId:  z.number().int().positive().nullish(),
    hsnCode:    zOptStr(32),
    taxability: z.enum(TAXABILITY).nullish(),
});

export const invProductUpdateSchema = invProductCreateSchema.partial().extend({
    sku: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    unitId: z.coerce.number().int().positive().optional(),
    // Reorder inputs — edited inline on the Reorder page.
    /// Manual minimum-alert floor (see InvProduct.lowStockThreshold).
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    /// Per-product supplier lead time (days); null = org default.
    leadTimeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
});

// ── Naming convention (InvNamingConfig singleton) ──────────────────────────

// Must stay in step with `TokenKind` in modules/inventory/lib/productName.ts —
// that type is the source of truth for what a token can be.
const tokenKind = z.enum(["brand", "category", "group", "modelNo", "warranty", "unit", "literal", "attr", "userPart"]);

const namingTokenSchema = z.object({
    kind: tokenKind,
    enabled: z.boolean(),
    defaultValue: z.string().max(120).nullish(),
    literal: z.string().max(120).nullish(),
    attrKey: z.string().max(64).nullish(),
    prefix: z.string().max(32).nullish(),
    suffix: z.string().max(32).nullish(),
});

// Partial record — only the kinds the user configured need to appear.
// (Zod 4's `z.record(enum, ...)` enforces ALL enum keys, which we don't want.)
const fallbackMapSchema = z.record(z.string(), z.array(tokenKind).max(6));

export const invNamingConfigUpdateSchema = z.object({
    nameFields: z.array(namingTokenSchema).max(20),
    separator: z.string().max(8),
    onlineNameFields: z.array(namingTokenSchema).max(20),
    onlineSeparator: z.string().max(8),
    slugFields: z.array(namingTokenSchema).max(20),
    slugSeparator: z.string().min(1).max(4),
    slugEnabled: z.boolean(),
    slugMaxLength: z.number().int().min(0).max(255),
    fallbackFields: fallbackMapSchema,
});
