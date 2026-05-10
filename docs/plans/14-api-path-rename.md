# Segment 14 — API path rename: `/api/finance/*` → `/api/accountancy/*`

## Goal

Standardise on **accountancy** everywhere — the route group is `office/accountancy/`, the module is `src/modules/accountancy/`, the docs are `docs/modules/accountancy.md`. Only `/api/finance/*` is the outlier. Rename via re-export shim, sweep callers, deprecate old path in a follow-up release.

## Approach (two-phase rollout)

### Phase A — this PR

1. **Add new routes** at `src/app/api/accountancy/**` that re-export the existing handlers:
   ```ts
   // src/app/api/accountancy/invoices/route.ts
   export { GET, POST } from "../../finance/invoices/route";
   ```
2. **Sweep callers** — find every `fetch("/api/finance/...")` or `axios.get("/api/finance/...")` in `src/`, replace with `/api/accountancy/...`.
3. **Add a deprecation log** to old `/api/finance/*` route handlers:
   ```ts
   console.warn("[deprecated] /api/finance/* — use /api/accountancy/*");
   ```
   (Only on first hit per process; gate with a Set to avoid log spam.)
4. Old paths still work (clients that haven't deployed yet keep working).

### Phase B — next release

5. Remove `src/app/api/finance/**` entirely. (Out of scope for this PR.)

## Routes to mirror

Run `Glob('src/app/api/finance/**/route.ts')` and create a sibling under `src/app/api/accountancy/...` for each:

- `accountancy/invoices/route.ts` + `[id]/route.ts` + `[id]/{cancel,delete,restore,hard-delete}/route.ts`
- `accountancy/vouchers/route.ts` + `[id]/route.ts` + lifecycle routes
- `accountancy/journal-entries/route.ts` + `[id]/route.ts` + lifecycle routes
- `accountancy/gl-accounts/route.ts` + `[id]/route.ts`
- `accountancy/account-groups/route.ts` + `[id]/route.ts`
- `accountancy/ledgers/route.ts` + `[id]/route.ts`
- `accountancy/reports/{receivables,payables,trial-balance,balance-sheet,profit-loss,ledger-outstandings,ratio-analysis,day-book,cash-bank,gst}/route.ts`
- (audit complete list with Glob)

## Sweep — caller updates

Run `Grep('"/api/finance/' src)`. Hot files include:
- `src/modules/accountancy/components/*` (VoucherForm, VoucherDetail, etc.)
- `src/app/(protected)/office/accountancy/**/*` (after Segments 11/12 these are module components)
- Any Server Component fetch under accountancy routes

## Step-by-step

1. Generate the re-export shims under `src/app/api/accountancy/`.
2. Add deprecation log to `src/shared/lib/api/handleApiError.ts` or per-route preamble (decide one place).
3. Sweep callers in one commit.
4. Browser verify all accountancy flows: invoice create, voucher create/cancel/restore, GL list, reports.
5. `tsc --noEmit`, `npm run build`.

## Verification

- [ ] Every route under `src/app/api/finance/**` has a sibling at `src/app/api/accountancy/**`
- [ ] No `"/api/finance/"` literals in `src/modules/` or `src/app/(protected)/office/accountancy/`
- [ ] Old paths still respond (test one with curl) and emit deprecation log
- [ ] New paths respond identically (test one with curl, compare body)
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser: full accountancy walkthrough — invoices, vouchers, journal entries, all reports

## Risks

- Re-export shims create circular-import risk if the shimmed route does `export { GET, POST }`. If Next.js disallows pure re-export for route handlers, fall back to manual: `export async function GET(...) { return (await import("../../finance/invoices/route")).GET(...) }`. Test with one route before sweeping all.
- External integrations (webhooks, Razorpay callbacks) may hit `/api/finance/*` directly — list these explicitly and decide whether to proxy or migrate.

## Rollback

Phase A is fully additive. Revert the call-site sweep + delete `src/app/api/accountancy/`. No data, no schema changes.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
