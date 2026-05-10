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

- [ ] `docs/modules/tally.md` is either deleted or a one-line redirect
- [ ] `docs/modules/core.md` exists and follows the template
- [ ] `docs/modules/pos.md` exists and follows the template
- [ ] All `tally` matches in source code reviewed; benign ones left, problematic ones flagged
- [ ] Docs index in `docs/modules/README.md` is up to date
