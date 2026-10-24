/**
 * Client-safe constants for the product CSV importer. Lives in its own file
 * (no Prisma / `pg` imports) so client components can import the field list
 * without pulling Node-only modules into the browser bundle.
 */

// `costPrice` is intentionally **excluded** from the importer. There is no saved
// cost to write: cost is worked out from the stock ledger's purchase lots
// (valuation.ts), with the imported `openingRate` as the first lot. A typed cost
// would disagree with the purchases and drift inventory valuation.
export const PRODUCT_IMPORT_FIELDS = [
    "name",
    "sku",
    "unit",
    "category",
    "group",
    "brand",
    "warrantyTerm",
    "modelNo",
    "barcode1",
    "hsnCode",
    "gstRate",
    "taxability",
    "salePrice",
    "mrp",
    "openingStock",
    "openingRate",
] as const;
export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];
