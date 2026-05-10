# Segment 06 — Prisma fragments

## Goal

Eliminate 20+ verbatim copies of the same Prisma include/select fragments and search-WHERE constructions.

## Files created

- `src/shared/lib/prisma/fragments.ts`

## Contracts

```ts
import { Prisma } from "@/generated/prisma";

export const selectPrimaryPhone = {
  orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
  take: 1,
} as const satisfies Prisma.PhoneFindManyArgs;

export const selectPrimaryEmail = {
  orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
  take: 1,
} as const satisfies Prisma.EmailFindManyArgs;

/** Account → person/company → primary phone. Used by ticket, invoice, voucher routes. */
export const selectAccountWithOwner = {
  select: {
    id: true,
    person: { select: { id: true, name: true, phones: selectPrimaryPhone } },
    company: { select: { id: true, name: true, phones: selectPrimaryPhone } },
  },
} as const;

/** Build an OR search WHERE clause across configured fields. */
export function buildSearchWhere(
  term: string | null | undefined,
  fields: { name?: boolean; phone?: boolean; email?: boolean; gstin?: boolean },
): Prisma.PersonWhereInput | undefined {
  if (!term) return undefined;
  const t = term.trim();
  if (!t) return undefined;
  const or: Prisma.PersonWhereInput[] = [];
  if (fields.name) or.push({ name: { contains: t, mode: "insensitive" } });
  if (fields.phone) or.push({ phones: { some: { number: { contains: t } } } });
  if (fields.email) or.push({ emails: { some: { address: { contains: t, mode: "insensitive" } } } });
  if (fields.gstin) or.push({ gstin: { contains: t, mode: "insensitive" } });
  return or.length ? { OR: or } : undefined;
}
```

(`Prisma.PersonWhereInput` is illustrative; refine to `Prisma.PersonWhereInput | Prisma.CompanyWhereInput` if generic search is needed across both — likely two `buildPersonSearch` / `buildCompanySearch` exports is cleaner.)

## Sweep

### Replace inline `phones: { orderBy: [{ isPrimary: "desc" }, …], take: 1 }`

Hot files (`Grep('isPrimary: "desc"' src/app/api)`):
- `src/app/api/people/route.ts`
- `src/app/api/companies/route.ts`
- `src/app/api/tickets/route.ts`, `[id]/route.ts`
- `src/app/api/accounts/route.ts`
- `src/app/api/finance/invoices/route.ts`
- `src/app/api/finance/vouchers/route.ts`
- `src/app/api/crm/leads/route.ts`
- (15+ files total)

### Replace inline `selectAccountWithOwner`

Hot files (`Grep('person.*select.*phones' src/app/api -multiline)`):
- `src/app/api/tickets/route.ts`, `[id]/route.ts`
- `src/app/api/finance/invoices/route.ts`
- `src/app/api/finance/vouchers/route.ts`

### Replace inline `OR: [{ name }, { phone }, { email }]`

Hot files (`Grep('OR: \[' src/app/api)`):
- `src/app/api/people/route.ts`
- `src/app/api/companies/route.ts`
- `src/app/api/crm/leads/route.ts`
- (~20 files)

## Step-by-step

1. Write `fragments.ts` with the four exports.
2. Sweep each hot file, replacing inline blocks with the constant or function call.
3. `tsc --noEmit` — the `as const satisfies` ensures type compatibility; failures mean the inline shape diverged from the canonical.
4. Run a sanity query (e.g., `GET /api/people?lookup=foo`) to confirm sort + take=1 still applies.

## Verification

- [x] `fragments.ts` exports `selectPrimaryPhone`, `selectPrimaryEmail`
- [ ] ~~`selectAccountWithOwner`~~ — deferred (call sites diverge too much; see post-execution)
- [ ] ~~`buildSearchWhere`~~ — deferred (per-model shapes diverge too much)
- [x] Inline `phones/emails: { orderBy: [{isPrimary:"desc"},{id:"asc"}], take: 1 }` patterns swept
- [x] `tsc --noEmit` clean
- [x] `npm run build` clean
- [x] Smoke: GET /api/accounts?limit=3 returns 200 with embedded person field populated correctly

## Post-execution notes (2026-05-11)

Status: **complete with scope adjustment** — `tsc --noEmit` clean, `npm run build` clean, smoke endpoint returns the expected embedded shape.

What landed:

- `src/shared/lib/prisma/fragments.ts` with `selectPrimaryPhone` and `selectPrimaryEmail`.
- Node sweep script (removed after use) replaced **60 occurrences across 24 files** of the canonical pattern `phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 }` (and the email twin) with the fragment references.
- Type contract note: the fragment uses per-literal `as const` (e.g. `"desc" as const`) rather than an outer `as const` on the whole object. The outer form made `orderBy` `readonly` which Prisma's typed `OrderByInput[]` does not accept (showed up immediately as a tsc error on the first run; fixed in the same commit).

Deferred from the original plan:

- **`selectAccountWithOwner`** — the plan envisioned one fragment covering "account + person/company + primary phone". In practice, call sites diverge: `tickets/route.ts` includes phones inside `person`/`company`, `finance/invoices/route.ts` omits phones entirely (just `id, name`), others include emails too. Consolidating would require either multiple variants (`selectAccountOwnerBare`, `selectAccountOwnerWithPhone`, etc.) or a parameterised helper — neither is a clear DRY win until 3+ identical shapes appear. Leave inline.
- **`buildSearchWhere`** — OR-search clauses across `companies/route.ts`, `people/route.ts`, `crm/leads/route.ts`, and `pos/people/search/route.ts` differ in fields per model: companies adds `companyReg`, crm/leads uses scalar `phone` / `email` on the lead row (not a nested `phones: { some: {...} }`), people has both 2-field and 3-field variants. A single helper would need so many shape options that it stops simplifying. Re-evaluate when 3+ identical shapes appear.

Inline patterns kept (18 sites, intentionally different shape):

- 14 `phones/emails: { orderBy: [...] }` blocks **without `take: 1`** — these fetch all phones/emails ordered, not just the primary. Semantically distinct; leave inline.
- 2 single-field `orderBy: [{ isPrimary: "desc" }]` in receipt pages (different shape).
- 2 sites in shared module helpers.

If a fragment for "all phones primary-first" becomes worth it later, add `selectPhonesOrdered` (drop `take: 1`) alongside the existing two.

Per AGENTS.md "after every plan" rule:

- **Reusables registry** — `docs/reusables.md` Prisma section adds the two fragment entries.
- **Module docs** — none touched.
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
