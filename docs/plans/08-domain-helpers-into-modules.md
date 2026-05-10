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

---

## Post-execution notes (2026-05-11)

Status: **complete** — `tsc --noEmit` clean, `npm run build` clean, 8 GET endpoints across the moved helpers all return 200.

Scope adjustment: **7 files moved, not 6.** Between segments 01 and 08, an unrelated commit (`2137994 refactor(repair): implement repair pipeline integration`) added `src/shared/lib/format/repairPipeline.ts`. It fits the same boundary rule as the original six (single-module ownership: `repairing`), so it moved with them.

| From | To | Importers verified |
|---|---|---|
| `src/shared/lib/format/crmPipeline.ts` | `src/modules/customer/lib/crmPipeline.ts` | `/api/crm/*` + 3 office/crm pages |
| `src/shared/lib/format/companyContacts.ts` | `src/modules/customer/lib/companyContacts.ts` | `/api/companies/[id]` + customers/companies/[id] page |
| `src/shared/lib/format/contactWrite.ts` | `src/modules/customer/lib/contactWrite.ts` | 9 phone/email routes under `/api/people/[id]` + `/api/companies/[id]` + `/api/people` |
| `src/shared/lib/format/ticketScope.ts` | `src/modules/repairing/lib/ticketScope.ts` | `/api/tickets/*` + `/api/search-slno/*` |
| `src/shared/lib/format/ordersPipeline.ts` | `src/modules/ecommerce/lib/ordersPipeline.ts` | `/api/ecommerce/orders` + ecommerce/lib/order-status |
| `src/shared/lib/format/postInvoiceJe.ts` | `src/modules/accountancy/lib/postInvoiceJe.ts` | `/api/finance/invoices/*` + `/api/pos/sale` |
| `src/shared/lib/format/repairPipeline.ts` | `src/modules/repairing/lib/repairPipeline.ts` | `office/(repairing)/repairing/tickets/page.tsx` |

**Sweep:** one mechanical sed pass across `src/` and `prisma/` rewrote `@/shared/lib/format/<file>` → `@/modules/<m>/lib/<file>` for the seven names. Caught everything in `src/`; one residual in `prisma/smoke-test-people.ts` used a relative dynamic `import("../src/shared/lib/format/companyContacts")` which sed missed (different prefix); fixed manually in the same commit.

**`src/shared/lib/format/` now contains** only the genuinely cross-cutting formatters: `formatDate.ts`, `moneyInr.ts`, `timeAgo.ts`, `utils.ts`. The folder name still says "format" but at this point it could be renamed to `format-and-misc` — that's a Segment 10 (module standardisation) consideration, not this one.

Per AGENTS.md "after every plan" rule:
- **Reusables registry** — `docs/reusables.md` "Pipeline lookups" section rewritten as "Module-scoped helpers (NOT in `src/shared/`)" with the seven entries.
- **Module docs** — not touched in this commit; each module's `docs/modules/<m>.md` will document its own `lib/` entries when the per-module reusables tables are filled out in Segment 16.
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
