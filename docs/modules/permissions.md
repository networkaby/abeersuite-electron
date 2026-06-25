# Permissions & Opaque IDs

> Single source of reference for the permission key catalogue and the opaque IDs (statuses, workers, roles, pipelines) that the seed bakes in. **The authoritative list lives in code** — this doc points at it and explains conventions.

## Authoritative sources

| What | File |
|---|---|
| Permission key constants | [`src/shared/lib/constants/permissions.ts`](../../src/shared/lib/constants/permissions.ts) |
| Permission row inserts + role grants | [`prisma/seeds/bootstrap-seed.ts`](../../prisma/seeds/bootstrap-seed.ts) |
| Scope-aware guards | [`src/shared/lib/auth/permissionScope.ts`](../../src/shared/lib/auth/permissionScope.ts), [`src/shared/lib/auth/permissions.ts`](../../src/shared/lib/auth/permissions.ts) |
| Department permission pools (authoring lens) | [`src/shared/lib/auth/departmentPool.ts`](../../src/shared/lib/auth/departmentPool.ts), API `GET`/`PUT /api/departments/[id]/permissions` |
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

### Exception — per-kind GL voucher keys (`finance:voucher:<action>:<kind>`)

GL voucher permissions are split **by voucher kind**, not by scope — `finance:voucher:cancel:payment`, `finance:voucher:delete:journal`, etc. The trailing segment is the `VoucherType` (kebab-case), a deliberate exception to `area:operation:scope` (like `work:<id>`), so a department's accounting tools can be split per voucher type. Four actions per kind (kinds: `payment`, `receipt`, `contra`, `credit-note`, `debit-note`, `journal`):

| Action | Covers |
|---|---|
| `create:<kind>` | create the voucher |
| `post:<kind>` | DRAFT → POSTED (applies GL) |
| `cancel:<kind>` | **cancel + edit + (future) convert-to-draft** — one eligibility |
| `delete:<kind>` | the **single removal** — soft-delete was retired (2026-06-09), so the former "hard-delete" is now just "delete" (recoverable from the Recycle Bin via the audit snapshot) |

Single source of truth for the kind↔permission map: [`src/shared/lib/auth/voucherMatrix.ts`](../../src/shared/lib/auth/voucherMatrix.ts). The route guards (`requireVoucherPermission` / `userCanVoucher` in `auth/permissions.ts`) accept the per-kind key **OR** the generic `finance:voucher:<action>` key (additive fallback, so legacy grants keep working). The generic `finance:voucher:hard-delete` survives as a *separate* capability gating the **Recycle Bin + audit restore** — it is no longer a per-kind matrix action. Edited in the Role Matrix's "GL voucher eligibility" matrix (rows = kinds, columns = the 4 actions), filtered to the role's department pool.

## Special keys

| Key | Effect |
|---|---|
| `admin:bypass` | Master key. Holder passes every `requirePermission(*)` check. Routed to `AdminBriefing` on `/office` home regardless of department. **Code-only sentinel** — marked `systemOnly: true` in the seed, never auto-granted to any role, removed from the Role Matrix UI. The only entity that ever holds it is the env super admin (see below). The legacy warning banner on the Role Matrix still fires if a historical role somehow has it pre-reseed. |
| `accountancy:view:org` | Gates the entire Accountancy module — sidebar section hides for users without it, direct nav 403s. |
| `settings:manage` | Required for Branches / Departments / POS Counters admin pages. |
| `pos:shift:open` | Required to open a POS shift. Also the gate for the cashier-side return flow. |
| `pos:shift:manage` | Required for manager bypass on POS sale return (lost-invoice tab). |
| `customers:hard-delete` | Required to hard-delete a converted-or-merged Person / Company tombstone from the Trash view at `/office/settings/customer-tools`. **Not granted to any role by default** — only the env super admin (`admin:bypass`) holds it implicitly; an admin must explicitly grant it via the Role Matrix. |

## Scope hierarchy

`own < branch < department < org`. The scope-aware helpers (`permissionScope.ts`) walk this hierarchy. A user with `tickets:view:org` does NOT need `tickets:view:own`; the higher scope subsumes it.

`User.scope` (enum on the user row) sets the data-visibility ceiling: a user with `scope: BRANCH` sees only their branch's tickets even if they hold `tickets:view:org` (rare in practice — scope and permission usually agree).

`User.rank` (0–100 int) gates role assignment — a user can only assign roles ranked at or below their own rank. R1 = 100, R2 ≈ 70, R3 ≈ 40, R4 ≈ 20.

## Role catalogue

`bootstrap-seed.ts` seeds **only `R1`** — the one role universal to every trade. It is the lone `isSystem: true` role (locked: cannot be deleted, see [admin.md](./admin.md)). Every other role is trade-specific and varies per business, so it is **not** in bootstrap.

| ID | Name | Rank | `isSystem` | Source | Typical permissions |
|---|---|---|---|---|---|
| `R1` | Admin / Owner | 100 | ✅ | `bootstrap-seed.ts` | Every non-`systemOnly` permission. `admin:bypass` is **not** in this set — see Env super admin below. |

**Starter roles** (`R2`–`R7`) are a trade-specific helper set — created as **non-system** (`isSystem: false`, admin-editable) by `prisma/seeds/helper-roles.ts` (run `pnpm seed:helper-roles` after `pnpm prisma db seed`):

| ID | Name | Rank | Home dept | Typical permissions |
|---|---|---|---|---|
| `R5` | Branch Manager | 80 | `DEP-ADMIN` (all-access) | full branch authority across tickets / finance / inventory / POS; no global settings or roles. Cross-functional, so homed in the all-access dept — see note below |
| `R2` | Service Engineer | 70 | `DEP-REPAIR` | `tickets:*:own/branch`, `work:W1`–`W4`, repair-side ops |
| `R6` | Accountant | 60 | `DEP-FIN` | `finance:*`, `accountancy:*`, vouchers + reconciliation; no admin/POS/tickets |
| `R7` | Sales Executive | 50 | `DEP-SALES` | `customers:*`, `deals:*`, `ecommerce:manage`, counter sales |
| `R3` | Counter / Cashier | 30 | `DEP-DESK` | `tickets:create`, `customers:*`, `pos:shift:*`, `inventory:view/edit:branch` |
| `R4` | Stores & Despatch | 30 | `DEP-DESP` | `tickets:substatus:set`, `inventory:*:branch`, `pos:shift:*` |

Admins create or edit roles freely from the Role Matrix UI as the business needs — the starter set is just a head start, not a fixed catalogue. A different trade would ship its own `helper-roles.ts`.

> Read the actual `Role` + `RolePermission` rows in `bootstrap-seed.ts` (R1) and `helper-roles.ts` (R2–R7) for the canonical assignment matrix.

## Department-wise roles & permission pools

Every `Role` carries a required **home department** (`Role.departmentId`). This is an **authoring lens, not a data scope** — it controls *which permissions the Role Matrix offers* when editing the role, nothing about runtime visibility (scope is still `User.scope` + the `:own/:branch/:org` suffix, resolved in `authorizeStaff.ts`). The department pool **never participates in runtime permission checks.**

- **Department pool** (`DepartmentPermission` join, edited on the Departments page, `PUT /api/departments/[id]/permissions`). The curated set of permissions a department surfaces. A permission can sit in several pools (e.g. `finance:invoice:*` in both Sales and Accounts). A role homed in the department may only be granted permissions from its pool — the role editor filters the matrix + additional-permission chips to the pool.
- **All-access department** (`Department.isAllAccess`, seeded `DEP-ADMIN`). Carries **no** `DepartmentPermission` rows — its pool is *every permission*, computed live, so new permissions are auto-grantable to admin roles. `R1` is homed here, which is why its editor shows the full list.
- **Cross-cutting access** is modelled two ways, never via a null department: (a) a role homed in the all-access dept (admin/super-user), or (b) a **multi-position holder** — e.g. a branch manager holding one position per department, effective permissions = union, `scope = BRANCH`. (`R5` is a legacy single mega-role kept in `DEP-ADMIN`; the intended end-state is the multi-position pattern.)
- **Pool removal cascades.** Removing a permission from a pool strips it from every role homed in that department (the API returns how many grants changed — never silent). Moving a role to another department strips grants outside the new pool.
- **Positions derive their department from their role** (`Role.departmentId`); the position editor shows it read-only. Only a role-less seat may pick a department manually. See [admin.md](./admin.md).
- `null` `User.role` / no position = a user created but not yet appointed → no permissions.

## Env super admin (emergency bypass)

A hardcoded super admin can sign in even when the DB is empty / wiped / locked-out. Configured via `.env`:

```
SUPER_ADMIN_EMAIL="superadmin@networkservice.in"
SUPER_ADMIN_PASSWORD="<strong-random-secret>"
```

Leave either blank → feature disabled. Implementation in [`src/shared/lib/auth/authorizeStaff.ts`](../../src/shared/lib/auth/authorizeStaff.ts) (`checkSuperAdminEnv`):

- Checked **before** the staff email domain allowlist and any DB query — works on a fresh / broken DB.
- Synthetic session: `id: "0"` (never clashes with auto-increment), `role: "R1"`, `rank: 9999`, `scope: "ORG"`, `permissions: ["admin:bypass"]`.
- Timing-safe comparison with 256-byte padded buffers via `crypto.timingSafeEqual` — no length leak, no user-enumeration via response time.

**Production checklist:** rotate `SUPER_ADMIN_PASSWORD` to a strong random value (`openssl rand -base64 32`). The default placeholder in `.env` is dev-only.

## System-only permissions (`systemOnly: true`)

Permissions in the seed marked `systemOnly: true` are never auto-granted to any role and are excluded from the Role Matrix UI. They exist in the DB `Permission` table only so FK lookups don't break. Currently the only one is `admin:bypass`.

R1's grant in `bootstrap-seed.ts` filters them out:
```ts
R1: PERMISSIONS.filter(p => !p.systemOnly).map(p => p.id),
```

## Opaque IDs (seeded — do not rename in prod)

These string IDs are stable across the codebase. Renaming any of them is a breaking schema change.

| Domain | Pattern | Examples |
|---|---|---|
| Roles | `R1` (bootstrap) + `R2`–`R7` (helper / admin-created) | `R1` Admin, `R2` Service Engineer, `R3` Counter/Cashier, `R4` Stores & Despatch, `R5` Branch Manager, `R6` Accountant, `R7` Sales Executive |
| Priorities | `P1`–`P4` | `P1` Low, `P2` Normal, `P3` High, `P4` Urgent |
| Pipelines | `P-<AREA>` | `P-REPAIR`, `P-SALES`, plus seeded P2/P4/P6 for helpdesk/admin/CRM intake |
| Ticket statuses | `S1`–`S10` | `S1` Received, `S2` Diagnosing, … `S10` Returned |
| Workers | `SS1`–`SS37` | Per-pipeline handoff states |
| Departments | `DEP-<NAME>` | `DEP-ADMIN` (all-access), `DEP-REPAIR`, `DEP-SALES`, `DEP-DESK`, `DEP-FIN`, `DEP-IT`, `DEP-HR`, `DEP-DESP` |
| Branches | `BR-<NAME>` | `BR-HQ`, plus seeded regionals |

`bootstrap-seed.ts` is idempotent — re-running it never reassigns IDs. The seed is the spec for "which IDs exist on a fresh database."

## Adding a new permission — recipe

1. Add the constant to `src/shared/lib/constants/permissions.ts`.
2. Add the row insert in `prisma/seeds/bootstrap-seed.ts` (section 3 — Permissions). If it should never be UI-grantable (e.g. another sentinel like `admin:bypass`), include `systemOnly: true` on the row.
3. Grant it to the relevant role(s) in the same seed file (section 4 — RolePermission). System-only keys are auto-excluded from R1's union.
4. Use `requirePermission(PERMISSIONS.YOUR_KEY)` (or `hasPermission` for client gates) in the route(s).
5. Re-seed the dev DB: `pnpm seed:hard-clean && pnpm prisma db seed`.
6. Add the gate row to the relevant module doc's "Permissions" section.
7. To make the new key grantable to a **functional-department** role, add it to that department's pool (Departments page, or the pool seed in `helper-roles.ts`). Admin (all-access) roles get it automatically.

## Customer portal — no permission keys

Customers don't carry permission keys. Portal sessions are discriminated by `session.kind === "customer"` and routed through `requirePortalAuth()`. See [customer-portal.md](./customer-portal.md).

_Last updated: 2026-06-25 — **Per-kind GL voucher permissions.** 24 new `finance:voucher:<action>:<kind>` keys (4 actions × 6 kinds) drive a per-voucher-kind matrix in the Role editor and a "what this dept works with" voucher toggle list on the Departments page. CANCEL covers cancel+edit+convert-to-draft; DELETE is the single removal (soft-delete retired 2026-06-09; generic `finance:voucher:hard-delete` kept only as the Recycle Bin / audit-restore gate). Guards accept per-kind OR generic. Reports + Inventory voucher kinds deferred to later phases. Previously (2026-06-24): department-wise roles & permission pools (`Role.departmentId`, `DepartmentPermission`, `Department.isAllAccess`). Previously (2026-06-23): bootstrap seeds only `R1`; `R2`–`R7` moved to `helper-roles.ts`. Previously (2026-05-20): `admin:bypass` reclassified `systemOnly`; env super admin added._
