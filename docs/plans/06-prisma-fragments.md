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

- [ ] `fragments.ts` exports `selectPrimaryPhone`, `selectPrimaryEmail`, `selectAccountWithOwner`, `buildSearchWhere`
- [ ] Inline `isPrimary: "desc"` count in `src/app/api` drops to 0 (only in fragments.ts)
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Smoke: GET /api/people?lookup=test — primary phone still first, only one returned per record
- [ ] Smoke: GET /api/tickets/{id} — account.person/company shape unchanged
