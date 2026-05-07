# Customers

> People + organisations the business sells to / services. Each `Customer` and `Company` automatically owns an `Account` row that doubles as their GL ledger — same table is used for chart-of-accounts entries (with `glAccountType` set) and for customer/company ledgers (with `glAccountType` blank).

## URLs

### UI pages (`src/app/(protected)/office/(customer)/customers/`)
- `/office/customers` — customer list (search, filter)
- `/office/customers/[id]` — detail (orders, tickets, balance, GL ledger view)
- `/office/customers/companies` — companies list
- `/office/customers/companies/[id]` — company detail
- `/office/customers/leads` — CRM leads (was `/office/crm`, redirected)

Compatibility redirects: `/office/companies/*` → `/office/customers/companies/*`.

### API routes
- `/api/customers[/[id]]` — CRUD with party-picker support.
- `/api/companies[/[id]]` — CRUD.
- `/api/customers/[id]/companies` — many-to-many junction.
- `/api/crm/leads[/[id]]` — leads (CrmLead model).
- `/api/accounts[/[id]]` — paginated account ledger (returns customer + company + GL accounts).

## Permissions (gate keys)

- `customers:view:own/branch/org`, `customers:create`, `customers:edit:*`, `customers:delete:*` — full CRUD matrix.
- `companies:create`, `companies:edit:org`, `companies:delete:org`.
- `crm:view`, `crm:manage`.

## Prisma models (file: `prisma/schema/customers.prisma`)

- `Customer` — contact, identity (gstin, gstStateCode, gstRegType added via `db push`).
- `Company` — organisation customers, GST fields too.
- `CustomerCompany` — many-to-many junction between Customers and Companies (a person can be a contact at multiple companies).
- `Account` — dual GL / customer-ledger; `glAccountType` enum (ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE) is set for pure GL accounts, blank for customer/company ledgers.
- `CrmLead` (in `prisma/schema/crm.prisma`) — sales leads, device-less. Reuses `Pipeline` + `TicketStatus` machinery.

## Key components / library

- `src/modules/customers/components/` — `CustomerList`, `CustomerDetail`, `CompanyDetail`, `PartyPicker`.
- `src/modules/crm/` — lead UI.
- `src/lib/account-ledger.ts` — helpers for account-vs-ledger distinction.

## Common workflows (wiring)

1. **Create customer + auto-account** — POST `/api/customers` → creates `Customer` + `Account` (with `glAccountType=null`) in a transaction.
2. **Customer detail balance** — `/office/customers/[id]` → reads `/api/accounts/[id]/ledger` (the same endpoint chart-of-accounts uses for any account).
3. **CRM lead → won → customer** — `/office/customers/leads/[id]` → "Convert to customer" → POST `/api/customers` linking back to the lead via metadata.
4. **Phone auth for customer portal** — separate auth path; `Customer.phone` + bcrypt password.

## Recent decisions / gotchas

- **Account is one table, two roles** — chart-of-accounts entries and customer ledgers share the same table. The `glAccountType` enum distinguishes.
- **CrmLead reuses TicketStatus** — same status model, different consumer. Leads have no device, no `TicketLog`, no sub-statuses.
- **GST drift** — `gstin`, `gstStateCode`, `gstRegType` were added via `db push` not migration; same caveat as inventory GST fields.

## Out of scope / deferred

- Per-customer pricing tiers — see [inventory.md](./inventory.md) (no schema fields yet).
- Per-customer credit limits — not enforced.

_Last updated: 2026-05-07._
