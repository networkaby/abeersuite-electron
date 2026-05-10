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

- [ ] `commonSchemas.ts` exports the 5 schemas
- [ ] `inventorySchemas.ts` uses `.extend()` from common where applicable
- [ ] No remaining duplicate-shape `z.object({ phones: z.array(...), emails: z.array(...) })` literals
- [ ] No remaining duplicate-shape `z.object({ label: ..., color: ... })` literals
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Smoke: POST /api/people with valid payload — 200; with bad email — 400 with new schema's message; with duplicate phone — 409
- [ ] Smoke: POST /api/ticket-statuses with empty label — 400

## Out of scope

- A generic CRUD route factory that takes a schema as input — deferred; risk doesn't justify reward yet.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
