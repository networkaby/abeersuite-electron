# Permissions & Opaque IDs

> Single source of reference for the permission key catalogue and the opaque IDs (statuses, workers, roles, pipelines) that the seed bakes in. **The authoritative list lives in code** — this doc points at it and explains conventions.

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

## Role catalogue (seeded by `bootstrap-seed.ts`)

| ID | Name | Rank | Typical permissions |
|---|---|---|---|
| `R1` | Admin / Owner | 100 | Every non-`systemOnly` permission (~111 keys). `admin:bypass` is **not** in this set — see Env super admin below. |
| `R2` | Technician | 70 | `tickets:*:own/branch`, `inventory:view:branch`, repair-side ops |
| `R3` | Front Desk | 40 | `tickets:create`, `customers:*`, `pos:shift:*`, `inventory:view:branch`, `inventory:edit:branch` |
| `R4` | Despatch | 20 | `tickets:edit:branch` (despatch workers), `pos:shift:open` |

> Read the actual `Role` + `RolePermission` rows in `bootstrap-seed.ts` (sections 2–3) for the canonical assignment matrix.

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
| Roles | `R1`–`R4` | `R1` Admin, `R2` Technician, `R3` Front Desk, `R4` Despatch |
| Priorities | `P1`–`P4` | `P1` Low, `P2` Normal, `P3` High, `P4` Urgent |
| Pipelines | `P-<AREA>` | `P-REPAIR`, `P-SALES`, plus seeded P2/P4/P6 for helpdesk/admin/CRM intake |
| Ticket statuses | `S1`–`S10` | `S1` Received, `S2` Diagnosing, … `S10` Returned |
| Workers | `SS1`–`SS37` | Per-pipeline handoff states |
| Departments | `DEP-<NAME>` | `DEP-REPAIR`, `DEP-SALES`, `DEP-DESK`, `DEP-FIN`, `DEP-IT`, `DEP-HR`, `DEP-DESP` |
| Branches | `BR-<NAME>` | `BR-HQ`, plus seeded regionals |

`bootstrap-seed.ts` is idempotent — re-running it never reassigns IDs. The seed is the spec for "which IDs exist on a fresh database."

## Adding a new permission — recipe

1. Add the constant to `src/shared/lib/constants/permissions.ts`.
2. Add the row insert in `prisma/seeds/bootstrap-seed.ts` (section 3 — Permissions). If it should never be UI-grantable (e.g. another sentinel like `admin:bypass`), include `systemOnly: true` on the row.
3. Grant it to the relevant role(s) in the same seed file (section 4 — RolePermission). System-only keys are auto-excluded from R1's union.
4. Use `requirePermission(PERMISSIONS.YOUR_KEY)` (or `hasPermission` for client gates) in the route(s).
5. Re-seed the dev DB: `pnpm seed:hard-clean && pnpm prisma db seed`.
6. Add the gate row to the relevant module doc's "Permissions" section.

## Customer portal — no permission keys

Customers don't carry permission keys. Portal sessions are discriminated by `session.kind === "customer"` and routed through `requirePortalAuth()`. See [customer-portal.md](./customer-portal.md).

_Last updated: 2026-05-25 — Added `customers:hard-delete` for the Trash view on `/office/settings/customer-tools` (not granted to any role by default; env super admin holds it implicitly). Previously (2026-05-20): `admin:bypass` reclassified as `systemOnly` (never auto-granted to R1, removed from Role Matrix UI); env super admin (`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`) added as the only entity that can hold the bypass at runtime._
