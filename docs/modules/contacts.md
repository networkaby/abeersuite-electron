# Contacts

> The CRM **Contacts** database = the existing **Customers** area (`Person` / `Company`). Relabelled "Contacts" in the sidebar and given big-list tooling: paginated/filterable list, multi-select bulk actions, CSV export, and per-contact CRM fields (lifecycle stage, owner seat, tags). Contacts are who you sell to; **Deals** ([deals.md](./deals.md)) are the opportunities, linked to a contact via `personId`/`companyId`. People are the primary contact entity here; Companies keep their own explorer.

## URLs

### UI pages
- `/office/customers` — **Contacts** workspace: paginated People table with a filter bar (search · lifecycle · owner · tag · has-deal · sort), multi-select **bulk bar**, and **CSV export**. (Replaced the old "coming soon" dashboard.)
- `/office/customers/person`, `/office/customers/companies`, `/office/customers/all` — the existing split-pane detail explorers (unchanged).

> Sidebar: the section is relabelled **"Contacts"** (`key: "customers"`); children **All Contacts** → `/office/customers`, **Person**, **Companies**.

### API routes
- `GET /api/contacts` — paginated People list. Params: `page`, `limit` (≤200, via `parsePagination`), `q` (name/phone/email), `lifecycleStage`, `ownerPositionId` (`none` = unowned), `tag`, `hasDeal` (`1`/`0`), `sort` (`recent`/`name`/`stage`), `inactive=1`. Returns `{ items, total, page, pageSize }`. Gate: any `customers:view*` (staff).
- `POST /api/contacts/bulk` — `{ ids:number[], action }` where action is `lifecycle` | `assignOwner` (positionId|null) | `addTag` | `removeTag` | `activate` | `deactivate`. Gate: `customers:edit:org`.
- `GET /api/person`, `/api/companies` — unchanged (lookup + explorer detail).

## Prisma models

CRM fields added to **both `Person` and `Company`** (`prisma/schema/base.prisma`):
- `lifecycleStage ContactLifecycle @default(LEAD)` — enum `LEAD | PROSPECT | CUSTOMER | INACTIVE` (HubSpot funnel).
- `ownerPositionId String?` + `owner Position?` — seat ownership (`Person`→`"PersonOwnerPosition"`, `Company`→`"CompanyOwnerPosition"`; back-relations `Position.ownedPersons`/`ownedCompanies`). Current holder resolved live via `UserPosition`, like Deals/Tasks.
- `tags String[] @default([])` — lightweight segmentation (filter `has`/`hasSome`; bulk add/remove).

## Key components / library

- `src/modules/customer/components/ContactsWorkspace.tsx` — client list: debounced search, filters, `PaginationBar`, checkbox multi-select (select-all-on-page), bulk bar, client-side CSV export (UTF-8 BOM).
- `src/modules/customer/lib/contactTypes.ts` — `ContactDto`, `ContactsResponse`, `ContactLifecycle`, `LIFECYCLE_META`, `ContactPositionOption`.
- Reused: `parsePagination`, `PaginationBar`, `UserAvatar`, `formatDate`, the existing Person/Company explorers + `CustomerImportPanel` (CSV import, phone/email dedup).

## Common workflows (wiring)

1. **Work a big list** — open `/office/customers`, filter (e.g. lifecycle = Lead, has-deal = No), page through; the API only returns one page (`page`/`limit`).
2. **Segment** — filter by lifecycle / owner / tag; sort by newest / name / stage.
3. **Bulk-act** — tick rows → set lifecycle, assign an owner seat, add/remove a tag, deactivate, or **Export CSV** (selection or current page).
4. **Import** — `/office/settings/customer-import` (CSV → map → dedup by phone/email → create). _Setting lifecycle/owner/tags on import is a planned extension._

## Recent decisions / gotchas

- **Contacts = People (primary)**; Companies have a separate explorer. `/api/contacts` queries `Person` only (clean single-table pagination).
- **Owner is a Position (seat)**, not a user — consistent with Deals/Tasks; transfers on staff change.
- **Bulk tag add/remove** uses parameterised raw SQL (`array_agg(DISTINCT …)` / `array_remove`) for atomic, de-duped array edits; other bulk actions use `updateMany`.
- **Demo scale** — `dummy-customers.ts` seeds 250 synthetic "Demo Contact N" people with a lifecycle/tag spread (guarded against re-run) so pagination/filtering are visible in dev.
- _Deferred:_ a **Deals tab** on the Person/Company detail pages (list a contact's deals + "New deal" pre-linked — the API already supports `/api/deals?personId=`/`companyId=`), and extending `CustomerImportPanel` to set lifecycle/owner/tags.

_Last updated: 2026-06-05 — Contacts (Customers relabelled) gains lifecycle/owner/tags, paginated `/api/contacts` + bulk actions, `ContactsWorkspace` list with filters + multi-select + CSV export; 250-row synthetic seed for the big-list demo._
