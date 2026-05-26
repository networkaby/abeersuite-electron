/**
 * Client-safe constants for the product CSV importer. Lives in its own file
 * (no Prisma / `pg` imports) so client components can import the field list
 * without pulling Node-only modules into the browser bundle.
 */

// `costPrice` (running cost cache) is intentionally **excluded** from the
// importer. Cost is derived from `openingRate` at books-beginning by the
// import (via syncProductCacheFromOpening) and updated thereafter by Purchase
// voucher posts (weighted-avg method). Letting the operator overwrite cost
// via CSV would bypass that flow and silently drift inventory valuation.
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
    "openingDate",
] as const;
export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];
