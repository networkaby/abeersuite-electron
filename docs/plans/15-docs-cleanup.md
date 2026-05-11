# Segment 15 — Docs cleanup

## Goal

Remove stale docs, add missing module docs. Pure documentation work; zero code risk.

## Actions

### Delete or redirect

- `docs/modules/tally.md` — references the historical name. Two options:
  - **Delete** outright (the module is `accountancy.md`).
  - **Convert to redirect**: replace contents with a single line: `> Renamed. See [accountancy.md](accountancy.md).`
  - Recommendation: **redirect** — keeps internal links working.

### Add (using `docs/modules/README.md` template)

- `docs/modules/core.md` — covers `src/modules/core/`. Document any business logic / components there. If `src/modules/core/` is essentially empty, document that and link to where its functionality lives.
- `docs/modules/pos.md` — covers `src/modules/pos/PosScreen.tsx`. Document URLs, permissions, key components, the snapshot endpoint (`/api/pos/account-snapshot/{id}`), and the create-customer flow.
- `docs/modules/external.md` (optional) — only if `customer-portal.md` doesn't already cover all three of `external/shop/`, `external/portal/`, `external/store/`. Verify first.

### Sweep `tally` references in code & docs

Run `Grep('tally' src docs prisma -i)`. For each match, decide: rename to `accountancy` or leave (if it's a real, intentional reference).

Likely hits:
- Stale comments
- Old route references
- Maybe a permission ID like `tally:view` (would need a coordinated rename in `prisma/seeds/new-seed.ts` + DB seeded data) — **flag this and DO NOT rename without explicit user sign-off**, since it would invalidate seeded permissions.

## Verification

- [x] `docs/modules/tally.md` doesn't exist (was never present) — no redirect needed
- [x] `docs/modules/core.md` exists and follows the template
- [x] `docs/modules/pos.md` exists and follows the template
- [x] All `tally` matches in source code reviewed — every remaining hit is legitimate historical reference (migration commentary, deferred-rewrite notes)
- [x] Docs index in `docs/modules/README.md` is up to date (added core + pos entries)

## Post-execution notes (2026-05-11)

Status: **complete** — smaller scope than the plan envisioned because `tally.md` never existed and remaining `tally` source-code references are deliberate historical commentary, not stale code.

What landed:

- Created `docs/modules/core.md` — covers `/office/core/{assignments, call-log, accounts, search-slno}` URLs, the `/api/accounts`, `/api/call-logs`, `/api/search-slno` API surfaces, related Prisma models, and common workflows. Notes the 2026-05-11 route-group promotion.
- Created `docs/modules/pos.md` — covers `/office/pos` single-screen module, `/api/pos/*` endpoints, the `PosScreen.tsx` component breakdown, and the planned Segment 09c refactor (with PosScreen UX-byte-identical guarantee).
- Updated `docs/modules/README.md` index to list both.

Reviewed `tally` references — all kept:
- `docs/modules/accountancy.md`, `docs/modules/inventory.md`, `docs/seeds.md`, `ARCHITECTURE.md`, `PROJECT_BRAIN.md` — describe the historic `tally` → `accountancy` rename, the legacy URL redirects, and Tally-style domain modeling. These are accurate historical documentation.
- `src/modules/accountancy/lib/postInvVoucher.ts` and similar — comments about "Tally-style" posting math. Domain language, not a stale rename.
- 10+ source files reference Tally semantics in comments — all describe the accounting domain model (groups + ledgers + voucher posting) which is intentionally Tally-aligned for shop-owner familiarity. Not stale.

Not done:
- Splitting `customer-portal.md` into a separate `external.md` was floated in the plan as optional. Skipped — `customer-portal.md` already covers shop + portal + store homepage adequately. Re-evaluate if `(external)/` grows.

Per AGENTS.md "after every plan" rule:
- **Reusables registry** — no new symbols touched.
- **Module docs** — 2 new docs added (core, pos).
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
