/**
 * Client-safe constants for the Customer (Person + Company) CSV importer.
 * Lives in its own file (no Prisma / `pg` imports) so client components can
 * import the field list without pulling Node-only modules into the browser.
 *
 * Defaults that hold when the column is absent or blank:
 *   • `kind` → person      (override per-row: person/individual or company/firm)
 *   • `accountGroup` → debtor  (override per-row: debtor/customer or creditor/supplier)
 *
 * Opening balance — accepts either shape, never both:
 *   • Two columns — `receivableBalance` (positive ₹) and `payableBalance`
 *     (positive ₹), mutually exclusive on a single row.
 *   • One column — `openingBalance` carrying a signed number.
 *
 * Side convention (independent of `accountGroup`):
 *   `receivableBalance` value → DEBIT
 *   `payableBalance`    value → CREDIT
 *   signed `openingBalance` > 0 → DEBIT, < 0 → CREDIT
 *
 * So a Sundry Debtor with a CREDIT opening (customer who paid in advance) and
 * a Sundry Creditor with a DEBIT opening (supplier you overpaid) are both
 * expressible — `accountGroup` and balance-side are decided independently.
 */

export const CUSTOMER_IMPORT_FIELDS = [
    "name",
    "kind",
    "accountGroup",
    "address",
    "agreedToTerms",
    "phone1",
    "phone2",
    "phone3",
    "email1",
    "email2",
    "email3",
    "gstin",
    "gstStateCode",
    "gstRegType",
    "shippingStateCode",
    "companyReg",
    "taxId",
    "receivableBalance",
    "payableBalance",
    "openingBalance",
    "creditLimit",
] as const;
export type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number];
