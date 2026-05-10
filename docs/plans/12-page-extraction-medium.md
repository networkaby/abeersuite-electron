# Segment 12 — Page extraction (medium 250–500 lines)

## Goal

Apply the Segment 11 pattern to the remaining 11 heavy pages. Each one becomes a ~30-line server wrapper.

Skip if Segment 11 didn't land — do not parallelise; the pattern must be settled first.

## Pages

| # | Source | Lines | Move to |
|---|---|---|---|
| 1 | `src/app/(protected)/office/(repairing)/repairing/page.tsx` | 477 | `src/modules/repairing/components/RepairingDashboardPage.tsx` |
| 2 | `src/app/(protected)/office/(customer)/customers/all/page.tsx` | 474 | `src/modules/customer/components/CustomersListPage.tsx` |
| 3 | `src/app/(protected)/office/(customer)/customers/people/page.tsx` | 458 | `src/modules/customer/components/PeopleListPage.tsx` |
| 4 | `src/app/(protected)/office/(customer)/customers/companies/page.tsx` | 453 | `src/modules/customer/components/CompaniesListPage.tsx` |
| 5 | `src/app/(protected)/office/(inventory)/inventory/sales/page.tsx` | 363 | `src/modules/inventory/components/InvSalesListPage.tsx` |
| 6 | `src/app/(protected)/office/accountancy/invoices/page.tsx` | 341 | `src/modules/accountancy/components/InvoicesListPage.tsx` |
| 7 | `src/app/(protected)/office/(admin)/pipelines/page.tsx` | 338 | `src/modules/repairing/components/PipelinesPage.tsx` |
| 8 | `src/app/(protected)/office/(inventory)/inventory/products/page.tsx` | 330 | `src/modules/inventory/components/ProductsListPage.tsx` |
| 9 | `src/app/(protected)/office/accountancy/sales/new/page.tsx` | 322 | `src/modules/accountancy/components/SalesVoucherForm.tsx` |
| 10 | `src/app/(protected)/office/(inventory)/inventory/purchases/page.tsx` | 321 | `src/modules/inventory/components/InvPurchasesListPage.tsx` |
| 11 | `src/app/(protected)/office/(admin)/users/page.tsx` | 320 | `src/modules/admin/components/UsersListPage.tsx` |

## Step-by-step

Repeat the Segment 11 pattern for each page:
1. Move body to module component.
2. Replace `page.tsx` with server wrapper.
3. Verify in browser.

Recommended commit cadence: **one commit per page**, easy to review and revert independently.

## Verification (per page)

Same checklist as Segment 11.

## Why split from Segment 11

These 11 are mostly mechanical copy-paste once the pattern is clear. Splitting keeps Segment 11 reviewable (6 pages, novel pattern) and Segment 12 a steady-state grind (11 pages, repeat).
