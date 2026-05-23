/**
 * Client-safe constants for the product CSV importer. Lives in its own file
 * (no Prisma / `pg` imports) so client components can import the field list
 * without pulling Node-only modules into the browser bundle.
 */

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
    "costPrice",
    "salePrice",
    "mrp",
    "openingStock",
    "openingRate",
    "openingDate",
] as const;
export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];
