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
- `/office/customers/leads` — CRM leads (was `/office/crm`, redirected)

Compatibility redirects: `/office/companies/*` → `/office/customers/companies/*`.

### API routes
- `/api/people[/[id]]` — CRUD with party-picker support; create body accepts `phones: string[]`, `emails: string[]`.
- `/api/people/[id]/phones[/[phoneId]]` — add/update/delete a person's phone rows.
- `/api/people/[id]/emails[/[emailId]]` — same for emails.
- `/api/people/[id]/portal-password` — emergency portal password reset.
- `/api/companies[/[id]]` — CRUD; GET returns own + linked-person-derived contacts.
- `/api/companies/[id]/phones[/[phoneId]]` and `/api/companies/[id]/emails[/[emailId]]` — company-owned contact rows.
- `/api/companies/[id]/links` — many-to-many junction (`PersonCompany`); body uses `personId`.
- `/api/crm/leads[/[id]]` — leads (CrmLead model). Body uses `personId` (was `customerId`).
- `/api/accounts[/[id]]` — paginated account ledger; accepts both `personId` and legacy alias `customerId` filters.
- `/api/pos/people/search`, `/api/pos/person-snapshot/[id]` — POS lookup helpers (was `/api/pos/customers/*`).

## Permissions (gate keys, unchanged)

- `customers:view:own/branch/org`, `customers:create`, `customers:edit:*`, `customers:delete:*` — full CRUD matrix.
- `companies:create`, `companies:edit:org`, `companies:delete:org`.
- `crm:view`, `crm:manage`.

The `customers:*` umbrella still gates Person and Company UI even though the model is now `Person`, since both remain "customers" semantically.

## Prisma models (file: `prisma/schema/base.prisma`)

- `Person` (formerly `Customer`) — individual contact, identity (gstin, gstStateCode, gstRegType).
- `Company` — organisation customers, GST fields too.
- `PersonCompany` (formerly `CustomerCompany`) — many-to-many junction between Persons and Companies (a person can be a contact at multiple companies).
- `Phone` — `phone @unique` globally; exactly one of `personId`/`companyId` set per row.
- `Email` — same shape, for emails.
- `Account` — dual GL / party ledger; `glAccountType` enum (ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE) is set for pure GL accounts, blank for party ledgers. Has new optional `creditLimit Decimal? @db.Decimal(14, 2)` (dormant; future use).
- `PersonPortalCredential` (formerly `CustomerPortalCredential`) — phone/email-normalised B2C login.
- `CrmLead` (in `prisma/schema/crm.prisma`) — sales leads, device-less. Reuses `Pipeline` + `TicketStatus` machinery; FK is `personId`.

## Key components / library

- `src/modules/customer/components/` — `CustomerLinkPanel` (links a person to companies), `CompanyLinkPanel` (links a company to persons), `CustomerEmergencyPasswordResetCard`.
- `src/modules/shared/components/CreatePersonDialog.tsx` — small inline create dialog (POSTs to `/api/people`).
- `src/modules/shared/components/PartyPicker/` — searches `/api/people?phone=`; can create either a person (POST `/api/people`) or company (POST `/api/companies`).
- `src/modules/accountancy/components/PartyCombobox.tsx` — accountancy-side picker; creates persons under "Sundry Debtors" or "Sundry Creditors" by default.
- `src/lib/account-ledger.ts` — helpers for account-vs-ledger distinction.
- `src/lib/contact-write.ts` — shared XOR-validating insert/update/delete helpers, translates Prisma `P2002` into a clean 409.
- `src/lib/company-contacts.ts` — `getCompanyContacts(companyId)` returns `{ phones, emails, derivedPhones, derivedEmails, primaryContactName }`.

## Common workflows (wiring)

1. **Create person + auto-account** — `POST /api/people` with `{ name, phones, emails, ... }` → creates `Person` + N `Phone` + N `Email` + `Account` (with `glAccountType=null`) in a transaction.
2. **Create company + auto-account** — `POST /api/companies` mirrors the above; company-owned phone/email rows are created in the same transaction.
3. **Add a phone/email to an existing party** — `POST /api/{people|companies}/[id]/{phones|emails}`. Returns 409 if the value is already used by anyone (including a different party type).
4. **Person detail balance** — `/office/customers/people/[id]` → reads `/api/accounts/[id]/ledger` (the same endpoint chart-of-accounts uses for any account).
5. **Company contact display** — `GET /api/companies/[id]` returns `phones` (own) and `derivedPhones` (union of linked persons' phones). The detail page shows them in two sections.
6. **CRM lead → won → person** — `/office/customers/leads/[id]` → "Convert to customer" → POST `/api/people` linking back to the lead via metadata.
7. **Phone auth for customer portal** — phone+password against `PersonPortalCredential`; lookup is via the normalised phone column on the credential table (no schema change to that column).

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
- **CrmLead reuses TicketStatus** — same status model, different consumer. Leads have no device, no `TicketLog`, no sub-statuses.
- **GST drift** — `gstin`, `gstStateCode`, `gstRegType` were originally added via `db push`; same caveat as inventory GST fields.
- **XOR CHECK constraint** — Prisma DSL can't express XOR; the constraint is added by `prisma/add-contact-xor-check.ts` (idempotent) which runs after `prisma db push` / migrations.

## Out of scope / deferred

- Per-customer pricing tiers — see [inventory.md](./inventory.md) (no schema fields yet).
- Per-customer credit limit enforcement — schema field exists (`Account.creditLimit`) but no checks at write time yet.

_Last updated: 2026-05-08._
