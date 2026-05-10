# Segment 08 — Move domain helpers into their owning modules

## Goal

Six helpers currently in `src/shared/lib/format/` (parked there by Segment 01) are domain-specific, not cross-cutting. Move each to its owning module's `lib/` folder.

## Moves

| From | To |
|---|---|
| `src/shared/lib/format/crmPipeline.ts` | `src/modules/customer/lib/crmPipeline.ts` |
| `src/shared/lib/format/companyContacts.ts` | `src/modules/customer/lib/companyContacts.ts` |
| `src/shared/lib/format/contactWrite.ts` | `src/modules/customer/lib/contactWrite.ts` |
| `src/shared/lib/format/ticketScope.ts` | `src/modules/repairing/lib/ticketScope.ts` |
| `src/shared/lib/format/ordersPipeline.ts` | `src/modules/ecommerce/lib/ordersPipeline.ts` |
| `src/shared/lib/format/postInvoiceJe.ts` | `src/modules/accountancy/lib/postInvoiceJe.ts` |

## Step-by-step

1. Verify each file is genuinely single-domain (run `Grep('from "@/shared/lib/format/<file>"' src)` — all importers should be inside one module or its API routes).
2. `git mv` each file. Create `src/modules/customer/lib/`, `src/modules/repairing/lib/`, `src/modules/ecommerce/lib/` if missing.
3. Sweep imports:
   - `@/shared/lib/format/crmPipeline` → `@/modules/customer/lib/crmPipeline`
   - `@/shared/lib/format/companyContacts` → `@/modules/customer/lib/companyContacts`
   - `@/shared/lib/format/contactWrite` → `@/modules/customer/lib/contactWrite`
   - `@/shared/lib/format/ticketScope` → `@/modules/repairing/lib/ticketScope`
   - `@/shared/lib/format/ordersPipeline` → `@/modules/ecommerce/lib/ordersPipeline`
   - `@/shared/lib/format/postInvoiceJe` → `@/modules/accountancy/lib/postInvoiceJe`
4. `tsc --noEmit`, `npm run build`.

## Verification

- [ ] All 6 files exist at new paths; do not exist at old paths
- [ ] `Grep('@/shared/lib/format/(crm|company|contact|ticket|orders|post)')` returns 0 hits
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Smoke: CRM lead create/list, ticket create, ecommerce order, invoice posting all still work

## Why six and not more

These six are the only `src/lib/` files whose importers come from a single module. The others (`prismaClient`, `permissions`, `formatDate`, etc.) are genuinely cross-cutting and stay in `src/shared/`.

## Boundary rule (going forward)

> A helper goes in `src/shared/lib/` only if it has importers from **two or more modules** (or from `src/app/`). Single-module helpers live in `src/modules/<m>/lib/`.

This rule will be added to `AGENTS.md` in Segment 16.
