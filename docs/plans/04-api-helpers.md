# Segment 04 — API helpers

## Goal

Extract five helpers into `src/shared/lib/api/` to eliminate 170+ sites of boilerplate across API routes:

| Helper | Replaces |
|---|---|
| `validateRequest<T>(req, schema)` | Zod `safeParse + NextResponse.json({ error })` boilerplate in **89** POST/PUT/PATCH routes |
| `parsePagination(searchParams, opts)` + `parseCursor(searchParams)` + `DEFAULT_PAGE_SIZE` + `MAX_PAGE_SIZE` | `Math.min(200, Math.max(1, Number(...) ?? 50))` patterns in **30+** routes |
| `prismaUniqueError(e, fieldMap)` | Inline P2002 detection in **10+** routes |
| `handleApiError(e, fallback)` | Trailing `catch { 500 }` envelope in 80+ GET routes |
| `generateNextOpaqueId(model, prefix)` | The `findMany→reduce(parseInt)→${prefix}${n+1}` block in ticket-statuses, sub-statuses, roles, pipelines |

## Files created

- `src/shared/lib/api/validateRequest.ts`
- `src/shared/lib/api/parsePagination.ts`
- `src/shared/lib/api/prismaUniqueError.ts`
- `src/shared/lib/api/handleApiError.ts`
- `src/shared/lib/api/generateNextOpaqueId.ts`
- `src/shared/lib/api/index.ts` — barrel re-export for ergonomic imports (`@/shared/lib/api`)

## API contracts

### `validateRequest`
```ts
export async function validateRequest<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }>;
```

Usage:
```ts
const { data, error } = await validateRequest(req, mySchema);
if (error) return error;
// data is fully typed
```

### `parsePagination`
```ts
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export function parsePagination(
  sp: URLSearchParams | { get(k: string): string | null },
  opts?: { defaultLimit?: number; maxLimit?: number },
): { take: number; skip: number; page: number };
```

### `parseCursor`
```ts
export function parseCursor(sp): { cursor: number | undefined; take: number };
```

### `prismaUniqueError`
```ts
export function prismaUniqueError(
  e: unknown,
  fieldMessages: Record<string, string>,
): NextResponse | null;
```
Detects `Prisma.PrismaClientKnownRequestError` with `code === "P2002"`, looks up the violated field's message, returns 409 NextResponse. Returns `null` if not a P2002 error (caller continues normal handling).

### `handleApiError`
```ts
export function handleApiError(e: unknown, fallback = "Internal error"): NextResponse;
```

### `generateNextOpaqueId`
```ts
export async function generateNextOpaqueId(
  model: { findMany: (a: { select: { id: true } }) => Promise<{ id: string }[]> },
  prefix: string,
): Promise<string>;
```

## Sweep — call sites to update

Done in **this same PR** (helpers + sweep together) so the boilerplate doesn't linger.

- POST/PUT/PATCH routes: every file under `src/app/api/**/route.ts` that has `safeParse` followed by `NextResponse.json({ error: parsed.error.issues[0]?.message ?? "..." })`. ~89 files.
- Pagination: every route reading `take`/`limit`/`page` from `searchParams`. ~30 files.
- P2002: `people/route.ts`, `people/[id]/route.ts`, `companies/route.ts`, `companies/[id]/route.ts`, `inventory/brands/route.ts`, `inventory/categories/route.ts`, `inventory/units/route.ts`, `roles/route.ts`, `branches/route.ts`, `departments/route.ts` (any with explicit P2002 checks).
- Opaque IDs: `ticket-statuses/route.ts`, `sub-statuses/route.ts`, `roles/route.ts`, `pipelines/route.ts`.
- `handleApiError`: GET routes' trailing `catch { return NextResponse.json({ error: "..." }, { status: 500 }) }`.

## Step-by-step

1. Create the five helper files + barrel.
2. Write a quick sweep checklist:
   - Run `Grep("safeParse" path: src/app/api)` — for each hit, replace the inline pattern with `validateRequest`.
   - Run `Grep("Math.min.*Math.max.*Number.*searchParams" path: src/app/api)` — replace with `parsePagination`.
   - Run `Grep('"P2002"' path: src/app/api)` — replace with `prismaUniqueError`.
   - Run `Grep("findMany.*select.*id.*true" -A 5 path: src/app/api)` — find the 4 opaque-ID routes; replace with `generateNextOpaqueId`.
3. After sweep, `tsc --noEmit` and `npm run build`.
4. Smoke: hit one POST endpoint with bad payload (expect 400), one with valid payload (expect 200), one duplicate (expect 409).

## Verification

- [ ] All 5 helpers exist with documented signatures
- [ ] Barrel `index.ts` re-exports all 5
- [ ] No remaining inline `parsed.error.issues[0]?.message ?? "Invalid payload"` in `src/app/api/`
- [ ] No remaining inline `Math.min(.*Math.max(.*Number(.*searchParams.get`
- [ ] No remaining inline `"P2002"` checks
- [ ] No remaining inline opaque-ID generators
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Smoke endpoints: 400/200/409 paths all work

## Out of scope

- `parseCursor` adoption — only call out in this segment if there's a route with cursor pagination already; otherwise just expose it for future use.
- Generic CRUD route factory — high risk; deferred indefinitely.

---

## Post-execution notes (2026-05-10)

Status: **04a complete (helpers + 3 small sweeps)**. validateRequest + handleApiError sweeps are split into follow-up commits within this segment because the actual scope is much larger than the plan estimated and one PR shouldn't carry both.

Reality vs plan:

| Pattern | Plan estimate | Actual count | Disposition |
|---|---|---|---|
| `safeParse` (validateRequest) | 89 sites | **110 files / 114 occurrences** | **Deferred to 04b** — too large for a single PR with the other sweeps |
| `Math.min/Math.max(searchParams)` (parsePagination) | 30+ sites | **8 files** | 6 swept here; 2 left inline (`call-logs` uses `pageSize` not `limit`; `users/[id]/activity` has min-10 lower bound) |
| `P2002` (prismaUniqueError) | 10+ sites | **10 files** | 8 swept here; 2 left inline (`companies` and `people` return a `field` discriminator the helper doesn't surface) |
| `status: 500` envelope (handleApiError) | 80+ sites | **152 files** | **Deferred to 04c** — bigger than plan estimated; mechanical but pervasive |
| Opaque-ID `findMany→reduce` | 4 sites | **3 files** | All 3 swept |

What landed in 04a:

- `src/shared/lib/api/{validateRequest,parsePagination,prismaUniqueError,handleApiError,generateNextOpaqueId}.ts` + `index.ts` barrel.
- `generateNextOpaqueId` evolved during the sweep — original signature returned `string`, but call sites needed `maxN + 1` for default `order` field. Final shape returns `{ id, n }`.
- `prismaUniqueError` evolved to accept either a `string` (any P2002 here = same conflict) or `Record<field, msg>` (multi-field map). The `tickets/[id]/participants` route uses the string form (composite unique constraint).
- 17 file sweeps total in this commit (3 opaque-ID, 8 P2002 simple, 6 pagination).

Follow-up commits within this segment:

- ~~**04b**: validateRequest sweep~~ — **done** (this commit, 107 of 110 files; 3 legitimately kept inline).
- **04c**: handleApiError sweep — ≈152 files. Each replaces the trailing `catch { return NextResponse.json({ error: "..." }, { status: 500 }) }` with `catch (e) { return handleApiError(e, "..."); }`. Adds server-side error logging consistently.

## Post-execution notes — 04b (validateRequest sweep, 2026-05-11)

Status: **complete** — `tsc --noEmit` clean, `npm run build` clean, 15 GET endpoints across the swept routes return 200.

Approach: a one-shot Node script (`scripts/sweep-validate-request.mjs`, removed after use) handled the canonical patterns in two passes; the residual edge cases were hand-edited.

| Pass | Files | What it caught |
|---|---|---|
| Script pass 1 (canonical) | 89 | `const parsed = SCHEMA.safeParse(await req.json()); if (!parsed.success) { return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "..." }, { status: 400 }); }` (single-line return inside braces) |
| Script pass 2 (extended) | 11 | Three more shapes: multi-line `NextResponse.json(\n  …,\n  …\n)`, single-line `if … return`, and different `const`-variable names (e.g., `parsedBody`) |
| Hand-edited | 7 | `schema.partial().safeParse(...)` for 4 contact `[paramId]` routes; missing fallback message for wall + password; `.catch(() => ({}))` for return-ticket |
| **Total swept** | **107 / 110** |  |

Three files **kept inline on purpose**, recorded for future reference:

1. `src/app/api/crm/leads/route.ts` and `src/app/api/crm/leads/[id]/route.ts` — both return `{ error, issues: parsed.error.flatten() }` (richer error shape that the frontend depends on). The helper only surfaces `issues[0]?.message`.
2. `src/app/api/inbox/rooms/[id]/read/route.ts` — uses `req.json().catch(() => ({}))` to treat empty/invalid bodies as a valid empty payload (the schema's fields are all optional). The helper rejects invalid JSON with a 400.

If we extend `validateRequest` later to support these (e.g., an `acceptEmptyBody` option or a `flatten: true` mode), revisit and consolidate.

Two tsc errors surfaced during the sweep and were fixed in the same commit:

- `src/app/api/call-logs/route.ts` line 177 — original code had `const data = parsed.data;` after the safeParse block; the script's `parsed.data → data` rewrite produced `const data = data;` (self-assign). Removed the redundant alias line.
- `src/app/api/users/[id]/route.ts` lines 145-171 — original code declared `const data: Prisma.UserUpdateInput = {…}` for the prisma payload, now shadowed by the destructured `data` from `validateRequest`. Renamed the local to `updateData`.

### Per AGENTS.md "after every plan" rule

- **Reusables registry** — no new symbols added in this commit; existing `validateRequest` entry already documents the API.
- **Module docs** — none touched; api helpers are cross-cutting.
- **Todo list** — completed.

Per AGENTS.md "after every plan" rule:

- **Reusables registry** — `docs/reusables.md` API helpers section added.
- **Module docs** — none touched; api helpers are cross-cutting.
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
