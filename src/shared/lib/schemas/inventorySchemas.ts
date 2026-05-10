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

export const invProductGroupCreateSchema = nameIsActiveSchema;

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
    ...productIdentifiers,
    ...productPricing,
    ...productOpening,
});

export const invProductUpdateSchema = invProductCreateSchema.partial().extend({
    sku: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    unitId: z.coerce.number().int().positive().optional(),
});
