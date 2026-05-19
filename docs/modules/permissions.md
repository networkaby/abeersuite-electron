# Permissions & Opaque IDs

> Single source of reference for the permission key catalogue and the opaque IDs (statuses, sub-statuses, roles, pipelines) that the seed bakes in. **The authoritative list lives in code** — this doc points at it and explains conventions.

## Authoritative sources

| What | File |
|---|---|
| Permission key constants | [`src/shared/lib/constants/permissions.ts`](../../src/shared/lib/constants/permissions.ts) |
| Permission row inserts + role grants | [`prisma/seeds/bootstrap-seed.ts`](../../prisma/seeds/bootstrap-seed.ts) |
| Scope-aware guards | [`src/shared/lib/auth/permissionScope.ts`](../../src/shared/lib/auth/permissionScope.ts), [`src/shared/lib/auth/permissions.ts`](../../src/shared/lib/auth/permissions.ts) |
| Route enforcement | `requirePermission(id)`, `requireAuth()`, `requirePortalAuth()` from `src/shared/lib/auth/` |

When in doubt, **`permissions.ts` is the registry**. The bootstrap seed mirrors it row-by-row.

## Naming convention

```
area:operation[:scope]
```

- **area** — module: `accountancy`, `assignments`, `companies`, `crm`, `customers`, `ecommerce`, `finance`, `inventory`, `pos`, `roles`, `settings`, `tickets`, `users`, `warranty`, `admin`.
- **operation** — verb: `view`, `create`, `edit`, `delete`, `manage` (= broad CRUD), `post`, `cancel`, `assign`, plus lifecycle (`hard-delete`) and specifics (`shift:open`, `voucher:post`, `opening-balance:manage`, `allocation:manage`).
- **scope** — visibility radius: `own`, `branch` / `br`, `department`, `org`. Higher scope subsumes lower (`org` sees everything `branch` and `own` can see).

> Some keys are unscoped (`tickets:create`, `ecommerce:manage`, `crm:view`) — they're either binary capabilities or already module-wide.

The constant name mirrors the string: `INVENTORY_VOUCHER_HARD_DELETE = "inventory:voucher:hard-delete"`.

## Special keys

| Key | Effect |
|---|---|
| `admin:bypass` | Master key. Holder passes every `requirePermission(*)` check. Routed to `AdminBriefing` on `/office` home regardless of department. Granted only to R1. |
| `accountancy:view:org` | Gates the entire Accountancy module — sidebar section hides for users without it, direct nav 403s. |
| `settings:manage` | Required for Branches / Departments / POS Counters admin pages. |
| `pos:shift:open` | Required to open a POS shift. Also the gate for the cashier-side return flow. |
| `pos:shift:manage` | Required for manager bypass on POS sale return (lost-invoice tab). |

## Scope hierarchy

`own < branch < department < org`. The scope-aware helpers (`permissionScope.ts`) walk this hierarchy. A user with `tickets:view:org` does NOT need `tickets:view:own`; the higher scope subsumes it.

`User.scope` (enum on the user row) sets the data-visibility ceiling: a user with `scope: BRANCH` sees only their branch's tickets even if they hold `tickets:view:org` (rare in practice — scope and permission usually agree).

`User.rank` (0–100 int) gates role assignment — a user can only assign roles ranked at or below their own rank. R1 = 100, R2 ≈ 70, R3 ≈ 40, R4 ≈ 20.

## Role catalogue (seeded by `bootstrap-seed.ts`)

| ID | Name | Rank | Typical permissions |
|---|---|---|---|
| `R1` | Admin / Owner | 100 | `admin:bypass` |
| `R2` | Technician | 70 | `tickets:*:own/branch`, `inventory:view:branch`, repair-side ops |
| `R3` | Front Desk | 40 | `tickets:create`, `customers:*`, `pos:shift:*`, `inventory:view:branch`, `inventory:edit:branch` |
| `R4` | Despatch | 20 | `tickets:edit:branch` (despatch sub-statuses), `pos:shift:open` |

> Read the actual `Role` + `RolePermission` rows in `bootstrap-seed.ts` (sections 2–3) for the canonical assignment matrix.

## Opaque IDs (seeded — do not rename in prod)

These string IDs are stable across the codebase. Renaming any of them is a breaking schema change.

| Domain | Pattern | Examples |
|---|---|---|
| Roles | `R1`–`R4` | `R1` Admin, `R2` Technician, `R3` Front Desk, `R4` Despatch |
| Priorities | `P1`–`P4` | `P1` Low, `P2` Normal, `P3` High, `P4` Urgent |
| Pipelines | `P-<AREA>` | `P-REPAIR`, `P-SALES`, plus seeded P2/P4/P6 for helpdesk/admin/CRM intake |
| Ticket statuses | `S1`–`S10` | `S1` Received, `S2` Diagnosing, … `S10` Returned |
| Sub-statuses | `SS1`–`SS37` | Per-pipeline handoff states |
| Departments | `DEP-<NAME>` | `DEP-REPAIR`, `DEP-SALES`, `DEP-DESK`, `DEP-FIN`, `DEP-IT`, `DEP-HR`, `DEP-DESP` |
| Branches | `BR-<NAME>` | `BR-HQ`, plus seeded regionals |

`bootstrap-seed.ts` is idempotent — re-running it never reassigns IDs. The seed is the spec for "which IDs exist on a fresh database."

## Adding a new permission — recipe

1. Add the constant to `src/shared/lib/constants/permissions.ts`.
2. Add the row insert in `prisma/seeds/bootstrap-seed.ts` (section 3 — Permissions).
3. Grant it to the relevant role(s) in the same seed file (section 4 — RolePermission).
4. Use `requirePermission(PERMISSIONS.YOUR_KEY)` (or `hasPermission` for client gates) in the route(s).
5. Re-seed the dev DB: `pnpm seed:hard-clean && pnpm prisma db seed`.
6. Add the gate row to the relevant module doc's "Permissions" section.

## Customer portal — no permission keys

Customers don't carry permission keys. Portal sessions are discriminated by `session.kind === "customer"` and routed through `requirePortalAuth()`. See [customer-portal.md](./customer-portal.md).

_Last updated: 2026-05-19 — initial extraction from `permissions.ts` + `bootstrap-seed.ts`._
