# Segment 07 — Shared Zod schemas

## Goal

Replace 40+ verbatim copies of the same Zod fragments with shared schemas. Module-specific schemas extend these.

## Files created

- `src/shared/lib/schemas/commonSchemas.ts`

## Files modified

- `src/shared/lib/schemas/inventorySchemas.ts` (was `src/lib/inventory/schemas.ts`, moved in Segment 01) — `extend()` from common where applicable.

## Contracts

```ts
import { z } from "zod";

export const labelColorSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  color: z.string().trim().min(1).optional(),
});

export const nameDescriptionSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

export const phoneEmailSchema = z.object({
  phones: z.array(z.string().trim().min(1)).default([]),
  emails: z.array(z.string().email()).default([]),
});

export const gstSchema = z.object({
  gstin: z.string().trim().optional().or(z.literal("")),
  gstStateCode: z.string().trim().optional().or(z.literal("")),
  gstRegType: z.enum(["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"]).optional(),
});

export const nameIsActiveSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  isActive: z.boolean().optional().default(true),
});
```

## Sweep — replace inline schemas with `.extend()`

| Inline schema | Replace with |
|---|---|
| ticket-statuses, sub-statuses, sub-status-groups, roles | `labelColorSchema.extend({...})` |
| gl-accounts, ledgers, departments, pipelines | `nameDescriptionSchema.extend({...})` |
| people, companies, service-centers, leads, orders, ecommerce-orders | `phoneEmailSchema.extend({...})` |
| people, person update, customer creation | `gstSchema.extend({...})` |
| inventory/categories, product-groups, warranty-terms, ecommerce/coupons | `nameIsActiveSchema.extend({...})` |

Run `Grep('z\.object\({' src/app/api)` and audit each match — replace if the shape includes any of the above fragments.

## Step-by-step

1. Write `commonSchemas.ts`.
2. Update `inventorySchemas.ts` — schemas like `invBrandCreateSchema` become `nameIsActiveSchema.extend({ ... })`.
3. Sweep `src/app/api/*/route.ts` files, refactoring inline `z.object({...})` to `<commonSchema>.extend({...})`.
4. `tsc --noEmit` will catch any shape divergence (e.g., a route that adds extra fields the common schema doesn't allow — those just go in `.extend({ extra: ... })`).

## Verification

- [x] `commonSchemas.ts` exports 4 of the planned 5 schemas (skipped `nameDescriptionSchema` — see post-execution)
- [x] `inventorySchemas.ts` uses `.extend()` from common for `invCategory*`, `invBrand*`, `invProductGroup*`, `invWarrantyTerm*`
- [x] phoneEmailSchema sweeps in people + companies
- [x] labelColorSchema sweeps in ticket-statuses + sub-statuses
- [x] `tsc --noEmit` clean
- [x] `npm run build` clean
- [x] Smoke: POST /api/branches, /api/ticket-statuses, /api/sub-statuses, /api/inventory/{brands,categories,product-groups} with `{}` body all return **400** with the schema's first issue message (via validateRequest)
- [x] Smoke: GET /api/people, /api/companies, /api/inventory/{brands,categories} all return 200

## Out of scope

- A generic CRUD route factory that takes a schema as input — deferred; risk doesn't justify reward yet.

---

## Post-execution notes (2026-05-11)

Status: **complete with scope adjustment** — 4 of 5 planned base schemas built; 8 consumer schemas swept; 1 base (`nameDescriptionSchema`) deferred because of constraint divergence.

**What landed:**

| Base schema | File | Consumers swept |
|---|---|---|
| `labelColorSchema` | `commonSchemas.ts` | `ticket-statuses/route.ts`, `sub-statuses/route.ts` (2 sweeps) |
| `phoneEmailSchema` | `commonSchemas.ts` | `people/route.ts`, `companies/route.ts` (2 sweeps) |
| `gstSchema` | `commonSchemas.ts` | `people/route.ts` (merged with `phoneEmailSchema`) |
| `nameIsActiveSchema` | `commonSchemas.ts` | `inventorySchemas.ts` — refactored `invCategoryCreateSchema`, `invBrandCreateSchema`, `invProductGroupCreateSchema`, `invWarrantyTermCreateSchema` (4 internal refactors). All consuming routes (10+ inventory routes) automatically pick up the refactor through the existing `inventorySchemas` re-export. |

**Net effect:** 8 explicit `extend()` adoptions + 10+ indirect consumers via the inventory schemas refactor.

**Deferred — `nameDescriptionSchema`:**

The plan envisioned this for `gl-accounts`, `ledgers`, `departments`, `pipelines`. In practice, the four routes' `name` and `description` fields disagree on:
- `name`: `min(1)` only (gl-accounts) vs `min(1).max(200)` (ledgers) vs `min(1, "Name is required")` (departments) vs `min(1, "Name is required").regex(/^[a-z0-9_-]+$/)` (pipelines)
- `description`: `trim().optional()` (gl-accounts) vs `trim().max(1000).nullish()` (ledgers) vs `trim().optional().nullable()` (departments) vs `optional().nullable()` (pipelines — not trimmed!)

A common base would either capture only `name: z.string().trim().min(1)` (forcing every caller to immediately `.extend({ name: ... })` to add their constraints — defeats the win) or carry the loosest common denominator (and lose the strictest constraints). Skipping is more honest than forcing.

**Other routes intentionally left inline:**

- `roles/route.ts` — `color` is required, not optional. Doesn't fit `labelColorSchema`.
- `sub-status-groups/route.ts` — has `label` but no `color` at all. Doesn't fit.
- `service-centers/route.ts` — uses scalar `phone`/`email`, not arrays. Doesn't fit `phoneEmailSchema`.

**Smoke results:**
- 6 POST endpoints with `{}` body → 400 with the schema's first issue message (validateRequest chain working).
- 4 GET endpoints → 200.

Per AGENTS.md "after every plan" rule:
- **Reusables registry** — `docs/reusables.md` Schemas section rewritten with the four entries + composition guidance.
- **Module docs** — none touched.
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
