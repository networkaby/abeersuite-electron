import { z } from "zod";
import { nameIsActiveSchema } from "./commonSchemas";

/** Empty / whitespace-only → null */
export const zOptStr = (maxLen: number) =>
    z
        .union([z.string(), z.null(), z.undefined()])
        .transform((v) => {
            if (v === undefined || v === null) return null;
            const t = String(v).trim();
            if (t === "") return null;
            return t.slice(0, maxLen);
        });

const barcodeSlot = zOptStr(64);
const eanSlot = zOptStr(13).refine((s) => !s || (/^\d+$/.test(s) && s.length >= 8 && s.length <= 13), "EAN must be 8–13 digits");
const upcSlot = zOptStr(12).refine((s) => !s || (/^\d+$/.test(s) && s.length === 12), "UPC must be 12 digits");

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
    durationMonths: z.number().int().min(0).max(1200).nullish(),
});

export const invWarrantyTermUpdateSchema = invWarrantyTermCreateSchema.partial();

const productIdentifiers = {
    modelNo: zOptStr(200),
    barcode1: barcodeSlot,
    barcode2: barcodeSlot,
    barcode3: barcodeSlot,
    ean1: eanSlot,
    ean2: eanSlot,
    ean3: eanSlot,
    upc1: upcSlot,
    upc2: upcSlot,
    upc3: upcSlot,
    notes: zOptStr(5000),
};

// All three are stored in paise (₹500.00 → 50000) — the form converts in the UI.
const productPricing = {
    costPaise:  z.number().int().nonnegative().nullish(),
    pricePaise: z.number().int().nonnegative().nullish(),
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
    unitId: z.coerce.number().int().positive(),
    categoryId: z.number().int().positive().nullish(),
    groupId: z.number().int().positive().nullish(),
    brandId: z.number().int().positive().nullish(),
    warrantyTermId: z.number().int().positive().nullish(),
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
});

// ── Naming convention (InvNamingConfig singleton) ──────────────────────────

const tokenKind = z.enum(["brand", "category", "group", "modelNo", "warranty", "unit", "literal", "attr"]);

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
