---
name: project_vyapar_migration
description: "Vyapar → AbeerSuite migration for the owner's own business (Network Service); clean-room rebuild in abeersuite_migrate-v1 is the trusted base, opening done, transactions next."
metadata:
  type: project
  modified: 2026-09-11T17:17:21.565Z
---

Network Service — the Vyapar business being migrated — **is the owner's own shop**, not a
third-party client ("its our personalised work"). Vyapar's last entry day was **10-Sep-2026**;
AbeerSuite takes over from 11-Sep-2026 and nobody is entering into it until this lands.

Source of truth: `D:\AbeerSuite\11-09-2026_05.55.41_Network_Service_VypBackup.vyb` plus the
owner's own Vyapar exports (Balance Sheet + Trial Balance at 31-Mar-2026 and 11-Sep-2026).

## The rule that governs everything: READ, never derive

Reconstructing Vyapar's figures from its internal tables was wrong on 8 of 10 money ledgers
and invented ₹2,23,790 that does not exist. The check passed because it compared our figure
against the same derivation that produced it. Every opening now comes from a number Vyapar
printed, transcribed into `prisma/seeds/data/vyapar-opening-31mar2026.json` and
`vyapar-party-opening-31mar2026.json` — the party file self-checks because its two totals must
reproduce Vyapar's ₹26,678 / ₹2,54,303.20.

## Two databases — v1 is the trusted one for openings

- **`abeersuite_migrate-v1`** — CLEAN ROOM, built from empty. **Owner's decision: trust this
  for opening balances.** Opening is complete and matches every Vyapar line except GST (nil by
  choice) and ₹14,396 of stock valuation basis.
- **`abeersuite_migrate`** — the older patch-onto-live route. Closings verified 100%, but its
  openings hold ₹1,00,244 of residue and **four party ledgers carry a fabricated history**
  (e.g. one party: opening ₹2,000 + movement −₹2,000 = closing ₹0, when the party had no
  pre-April transactions at all). Its one advantage: **452 hand-corrected product names** the
  clean room lost by taking Vyapar's raw names.

**Why `closing = opening + movement` proves nothing** when both halves come from one rollback:
an error in either is cancelled by the other. That is how the fabricated ledgers survived every
check. Any future check must compare against an independently published figure.

## Build the clean room

`.env.local` → `abeersuite_migrate-v1`, then: `prisma db push` → `prisma/seeds/bootstrap-seed.ts`
→ legacy `prisma/seeds/personal-bootstrap.ts` (retired) → `pnpm vyapar:opening -- --apply`. Both seeds need
`COUNTER_PC= LOCAL_DATABASE_URL=` prefixed — `.env` marks this machine a counter PC and they
refuse otherwise. See [project_fresh_worktree_precommit_setup](project_fresh_worktree_precommit_setup.md).

## Still open

Owner owes: a **31-Mar stock summary** (closes the ₹14,396), **unpaid GST** from the last
return, **opening capital** (the ₹3,33,699.54 plug), real phone numbers for **two parties** (they share one in Vyapar), and a check of the **fixed-asset grouping**
(total exact, the shelf each item lands on is a guess).

Known Vyapar data errors to expect on replay: **one party** loses ₹250 between March and
September with nothing posted, so it will NOT close to zero — correctly surfacing as a
difference rather than being absorbed.

See [project_vyapar_file_format](project_vyapar_file_format.md).
