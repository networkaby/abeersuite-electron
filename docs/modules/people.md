# Customers (People & Companies)

> Both `Person` (formerly `Customer`) and `Company` are kinds of *customer*. Each owns one `Account` row that doubles as their GL ledger — the same Account table holds chart-of-accounts entries (with `glAccountType` set) and party ledgers (with `glAccountType` blank).
>
> Phones and emails live in shared polymorphic child tables (`Phone`, `Email`). Each row is owned by exactly one of Person or Company (XOR enforced both at the app layer and via a Postgres `CHECK` constraint). Phone and email values are globally unique across all parties.

## URLs

### UI pages (`src/app/(protected)/office/(customer)/customers/`)
- `/office/customers` — combined dashboard
- `/office/customers/people` — people list (search, filter)
- `/office/customers/people/[id]` — person detail (orders, tickets, balance, GL ledger view, multi-phone & email)
- `/office/customers/companies` — companies list
- `/office/customers/companies/[id]` — company detail (own contacts + derived contacts from linked people)
- `/office/customers/all` — combined view of people + companies
- `/office/customers/leads` — CRM leads (was `/office/deals`, redirected)
- `/office/settings/customer-tools` — convert a Person ↔ Company while keeping the same Account row; lists soft-deleted tombstones in a Trash section for admins.

Compatibility redirects: `/office/companies/*` → `/office/customers/companies/*`.

### API routes
- `/api/people[/[id]]` — CRUD with party-picker support; create body accepts `phones: string[]`, `emails: string[]`.
- `/api/people/[id]/phones[/[phoneId]]` — add/update/delete a person's phone rows.
- `/api/people/[id]/emails[/[emailId]]` — same for emails.
- `/api/people/[id]/portal-password` — emergency portal password reset.
- `/api/companies[/[id]]` — CRUD; GET returns own + linked-person-derived contacts.
- `/api/companies/[id]/phones[/[phoneId]]` and `/api/companies/[id]/emails[/[emailId]]` — company-owned contact rows.
- `/api/companies/[id]/links` — many-to-many junction (`PersonCompany`); body uses `personId`.
- `/api/deals[/[id]]` — leads (Deal model). Body uses `personId` (was `customerId`).
- `/api/accounts[/[id]]` — paginated account ledger; accepts both `personId` and legacy alias `customerId` filters. `PATCH /api/accounts/[id]` sets the account's `creditLimit` (gated by `customers:edit:org` for a person ledger, `companies:edit:org` for a company).
- `/api/pos/people/search`, `/api/pos/person-snapshot/[id]` — POS lookup helpers (was `/api/pos/customers/*`).
- `/api/customer-tools/convert/preview` (GET) — returns mappable/lost fields, counts that will move, and any blockers (open shop orders, already-converted, etc.).
- `/api/customer-tools/convert` (POST) — runs the conversion in a single `$transaction`; flips `Account.personId ↔ Account.companyId` and re-points `Phone` / `Email` / `Deal` / `ShopOrder.personId` rows onto the new row, drops `PersonCompany` links and `PersonPortalCredential`, soft-deletes the source with a `convertedTo*Id` back-link.
- `/api/customer-tools/merge/preview` (GET) — returns Account-FK ref counts (JournalLine / VoucherLine / InvVoucher{,Charge,Tender} / Voucher.partyAccount / Ticket.billingAccount / Device / ShopOrder), party-FK ref counts (Phone / Email / Deal / PersonCompany), and blockers (loser's Account wired into Branch.vaultAccount or PosCounter.*Account, loser's Account is a chart-of-accounts parent, already-tombstoned, etc.).
- `/api/customer-tools/merge` (POST) — merges two same-type customers in one `$transaction`: re-points every Account FK from loser's Account onto winner's Account, sums cached balances, moves Phone / Email / Deal / PersonCompany / ShopOrder.personId from loser party to winner party, drops loser's `PersonPortalCredential`, deletes the loser Account, and soft-deletes the loser party with a `mergedInto*Id` back-link.
- `/api/customer-tools/trash` (GET) — lists soft-deleted tombstones (both convert and merge) for the Trash view. Env super-admin or `customers:hard-delete` required.
- `/api/customer-tools/trash/[type]/[id]` (DELETE) — hard-deletes a tombstone of either kind. Defensive residual-FK check returns 409 if any live reference still points at the row.

## Permissions (gate keys, unchanged)

- `customers:view:own/branch/org`, `customers:create`, `customers:edit:*`, `customers:delete:*` — full CRUD matrix.
- `companies:create`, `companies:edit:org`, `companies:delete:org`.
- `deals:view`, `deals:manage`.
- `customers:manage` + `companies:manage` — both required to use the Person ↔ Company converter **and** the duplicate-customer merger at `/office/settings/customer-tools`.
- `customers:hard-delete` — required (alongside env super-admin / `admin:bypass`) to hard-delete tombstone rows from the Trash view. Not granted to any role by default.

The `customers:*` umbrella still gates Person and Company UI even though the model is now `Person`, since both remain "customers" semantically.

## Prisma models (file: `prisma/schema/base.prisma`)

- `Person` (formerly `Customer`) — individual contact, identity (gstin, gstStateCode, gstRegType).
- `Company` — organisation customers, GST fields too.
- `PersonCompany` (formerly `CustomerCompany`) — many-to-many junction between Persons and Companies (a person can be a contact at multiple companies).
- `Phone` — `phone @unique` globally; exactly one of `personId`/`companyId` set per row.
- `Email` — same shape, for emails.
- `Account` — dual GL / party ledger; `glAccountType` enum (ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE) is set for pure GL accounts, blank for party ledgers. Optional `creditLimit Decimal? @db.Decimal(14, 2)` — deny-by-default (`null`/`0` = cash-only, only a positive value grants credit); enforced at sale time by `checkCreditLimit` and editable from the party Profile tab via `PATCH /api/accounts/[id]`.
- `PersonPortalCredential` (formerly `CustomerPortalCredential`) — phone/email-normalised B2C login.
- `Deal` (in `prisma/schema/deals.prisma`) — sales leads, device-less. Reuses `Pipeline` + `TicketStatus` machinery; FK is `personId`.
- Person / Company conversion fields — `Person.convertedToCompanyId` (+ `convertedAt`) and the mirror on `Company`. Set when the row was soft-deleted via the converter; null on a live row. Pure audit trail (nullable, not unique, no `onDelete`).
- Person / Company merge fields — `Person.mergedIntoPersonId` (+ `mergedAt`) and `Company.mergedIntoCompanyId` (+ `mergedAt`). Same audit semantics; set when the row was soft-deleted as a duplicate via the merge tool.

## Key components / library

- `src/modules/customer/components/` — `CustomerLinkPanel` (links a person to companies), `CompanyLinkPanel` (links a company to persons), `CustomerEmergencyPasswordResetCard`.
- `src/shared/components/CreatePersonDialog.tsx` — small inline create dialog (POSTs to `/api/people`).
- `src/shared/components/PartyPicker/` — searches `/api/people?phone=`; can create either a person (POST `/api/people`) or company (POST `/api/companies`).
- `src/modules/accountancy/components/PartyCombobox.tsx` — accountancy-side picker; creates persons under "Sundry Debtors" or "Sundry Creditors" by default.
- `src/modules/customer/lib/contactWrite.ts` — XOR-validating insert/update/delete helpers for `Phone`/`Email` rows; translates Prisma `P2002` into a clean 409.
- `src/modules/customer/lib/companyContacts.ts` — `getCompanyContacts(companyId)` returns `{ phones, emails, derivedPhones, derivedEmails, primaryContactName }`.
- `src/modules/deals/lib/dealsPipeline.ts` — name-based CRM-leads pipeline resolver and status validator.

## Common workflows (wiring)

1. **Create person + auto-account** — `POST /api/people` with `{ name, phones, emails, ... }` → creates `Person` + N `Phone` + N `Email` + `Account` (with `glAccountType=null`) in a transaction.
2. **Create company + auto-account** — `POST /api/companies` mirrors the above; company-owned phone/email rows are created in the same transaction.
3. **Add a phone/email to an existing party** — `POST /api/{people|companies}/[id]/{phones|emails}`. Returns 409 if the value is already used by anyone (including a different party type).
4. **Person detail balance** — `/office/customers/people/[id]` → reads `/api/accounts/[id]/ledger` (the same endpoint chart-of-accounts uses for any account).
5. **Company contact display** — `GET /api/companies/[id]` returns `phones` (own) and `derivedPhones` (union of linked persons' phones). The detail page shows them in two sections.
6. **Transactions tab** — both `/office/customers/people/[id]` and `/office/customers/companies/[id]` carry a Transactions tab that lists the party's posted vouchers via `GET /api/accounts/[id]/ledger` (Invoice/Payment rows merged into InvVoucher in the Layer 1–5 consolidation). Backfilled for legacy parties via `a687684`. Reference click drills via the shared `editFormUrl(type, id)` helper (`src/modules/inventory/components/VoucherActionsMenu.tsx`) — SALE / PURCHASE / SALE_RETURN / PURCHASE_RETURN open in the editable full-page form, matching the convention used by every other voucher surface.
7. **CRM lead → won → person** — `/office/customers/leads/[id]` → "Convert to customer" → POST `/api/people` linking back to the lead via metadata.
8. **Phone auth for customer portal** — phone+password against `PersonPortalCredential`; lookup is via the normalised phone column on the credential table (no schema change to that column).

## Uniqueness rules (recap)

The user-facing rules from the rename plan:

- Two persons can't share a phone → enforced by `Phone.phone @unique` globally. ✅
- Two companies can't share a phone → same global unique. ✅
- A company can't have the phone of an unrelated person/company → impossible by construction; the company has no place to put a duplicate row. ✅
- A company can use the phone of a related person → the row stays on the *Person*; the Company *displays* it via the `PersonCompany` join (`derivedPhones` in the API response). ✅
- A company with no linked person can still own its own phone/email rows. ✅

Same rules apply to emails.

## Recent decisions / gotchas

- **Account is one table, two roles** — chart-of-accounts entries and party ledgers share the same table. The `glAccountType` enum distinguishes.
- **Customer portal session shape** — the session token still uses `kind: "customer"` and `customerId: string` for back-compat with existing portal code; only the underlying Prisma model name changed.
- **Deal reuses TicketStatus** — same status model, different consumer. Leads have no device, no `TicketLog`, no sub-statuses.
- **GST drift** — `gstin`, `gstStateCode`, `gstRegType` were originally added via `db push`; same caveat as inventory GST fields.
- **XOR CHECK constraint** — Prisma DSL can't express XOR; the constraint is applied via raw SQL inside `prisma/seeds/bootstrap-seed.ts` (Section 6 — DB constraints), which is idempotent and re-runs after every `prisma db seed`.

## Out of scope / deferred

- Per-customer pricing tiers — see [inventory.md](./inventory.md) (no schema fields yet).

## Reusable helpers — DO NOT duplicate

These are module-scoped (consumed only by `customer/` routes + components). Don't import them across module boundaries; talk to the customer module via its API instead.

| Symbol | File | Purpose |
|---|---|---|
| `getCrmPipeline(prisma)`, `assertCrmStatus(prisma, pipelineId, status)`, `CRM_PIPELINE_NAME` | `src/modules/deals/lib/dealsPipeline.ts` | Name-based resolver for the seeded CRM-leads pipeline + status validator. Use these instead of hardcoding pipeline IDs (`P6` etc.). |
| `getCompanyContacts(companyId)` | `src/modules/customer/lib/companyContacts.ts` | Returns the company's own phones/emails + derived contacts from linked persons. |
| `ContactConflictError`, `contactValueSchema`, `createPhone`, `updatePhone`, `deletePhone`, `createEmail`, `updateEmail`, `deleteEmail` | `src/modules/customer/lib/contactWrite.ts` | All write paths for the `Phone` / `Email` polymorphic-owner rows. Centralises uniqueness checking, isPrimary toggling, and the `ContactConflictError` shape that routes catch + map to a 409 with `{ error, field }`. |
| `previewConvert`, `convertParty`, `ConvertBlockedError`, `previewMerge`, `mergeParty`, `MergeBlockedError`, `hardDeleteTombstone`, `TombstoneStillReferencedError`, `listTombstones` | `src/modules/customer/lib/convertParty.ts` | Person ↔ Company conversion **and** duplicate-customer merge, both with tombstone hard-delete. Convert keeps the same `Account.id` (flips `personId`↔`companyId`). Merge dissolves the loser's Account: re-points every JournalLine / VoucherLine / InvVoucher{,Charge,Tender} / Voucher.partyAccountId / Ticket.billingAccountId / Device / ShopOrder.accountId onto the winner's Account, sums cached balances, moves party-side rows (Phone / Email / Deal / PersonCompany / ShopOrder.personId), drops loser's `PersonPortalCredential`, then deletes the loser Account and soft-deletes the loser party. Hard-delete works for either tombstone kind and guards against residual FKs with a 409. |

_Last updated: 2026-06-03 — Credit-limit edit UI: `PATCH /api/accounts/[id]` now writes `Account.creditLimit` (gated by the matching party edit permission), surfaced as an `AccountCreditLimitCard` on the Person and Company Profile tabs. `GET /api/person/[id]` and `GET /api/companies/[id]` now expose `creditLimit`. The field is no longer "dormant" — it is enforced at sale time and editable. Previously (2026-05-25): Added duplicate-customer merge tool to `/office/settings/customer-tools` plus `/api/customer-tools/merge*` routes. Schema: `Person.mergedIntoPersonId` (self-FK) + `Company.mergedIntoCompanyId` + `mergedAt` on both. Trash view now lists merge tombstones alongside convert tombstones (new `reason` column). Earlier today: added Person ↔ Company converter + `customers:hard-delete` permission + `/api/customer-tools/convert*` and `/api/customer-tools/trash*` routes. `/office/customers/[id]` redirects via whichever side of the Account is currently set, so old account URLs survive conversion intact. Previously (2026-05-24): `GET /api/companies/[id]/transactions` + `/api/persons/[id]/transactions` migrated off the legacy `Invoice.amountReceived` field (Layer 3b / Layer 7g) — both endpoints derive everything from InvVoucher rows. Earlier (2026-05-23): Transactions tab now opens voucher refs in the editable form via the shared `editFormUrl` helper (commit `4c2654e`); local `INV_VOUCHER_URLS` map deleted (AGENTS.md §2)._
