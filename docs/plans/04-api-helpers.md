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
