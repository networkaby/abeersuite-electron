---
name: sync-docs-with-code
description: Update docs to match recent code changes before committing. Use when the user runs `pnpm seed:check-docs` and sees narrative drift, when they say "sync docs", "update docs from code", "check docs match code", or after a multi-commit feature batch that didn't touch the affected module doc. Combines a mechanical auto-fixer (`pnpm seed:fix-docs`) with narrative updates the script can't do.
---

# Sync docs with code

Use this skill when docs are suspected to be out of sync with the actual codebase — usually after a seed run, a schema change, or a multi-commit feature batch.

## The two layers of drift

| Layer | What it is | Who fixes it |
|---|---|---|
| **Mechanical** | Broken file paths in docs, permission keys in `bootstrap-seed.ts` but not `permissions.ts` | `pnpm seed:fix-docs` (the script) |
| **Narrative** | Module docs older than the code they document — missing new routes / APIs / components / gotchas in the prose | You (Claude). The script can only detect, not write prose. |

## Workflow

### Step 1 — Run the mechanical fixer

```
pnpm seed:fix-docs
```

This auto-applies fixes the script can do safely:
- Adds missing permission constants to `src/shared/lib/constants/permissions.ts` when `bootstrap-seed.ts` references keys the constants file is missing.
- Filters historical false positives (paths flagged as broken but mentioned alongside "removed" / "deleted" / "legacy" — those are correct historical references).

After this runs, only **narrative drift** should remain in the report.

### Step 2 — Narrative drift: read recent commits, update prose

For each `docs/modules/<m>.md` flagged as "N days behind <source>":

1. `git log --since=<doc's last-updated date> --oneline -- <source folders>` to see what shipped since the doc was last touched.
2. For each commit, read the diff and identify what the doc would need to mention:
   - New routes → add to the URLs section.
   - New API endpoints → add to the API routes section.
   - New Prisma models / fields → add to the Prisma models section.
   - New components → add to the Key components section.
   - New decisions / gotchas → add to the Recent decisions section.
   - Renamed concepts → search-replace in the doc's prose.
3. Update the `_Last updated:` footer with a one-line summary citing the most material change.

### Step 3 — Re-verify

```
pnpm seed:check-docs
```

Should report `✓ Docs in sync with code.` or only have legitimate narrative drift that you've explicitly chosen not to address.

## Operating rules

- **Never block on broken refs to historical state.** If a doc says "X was removed in commit Y" and X no longer exists, that's a CORRECT historical reference — leave it alone. The `--fix` flag already filters these via the `removed|deleted|dropped|gone|legacy` heuristic.
- **Module docs are reference-only.** Don't add "shipped on YYYY-MM-DD" markers — that status belongs in `PROJECT_BRAIN.md`. Module docs describe what's there now, not history.
- **The user owns `PROJECT_BRAIN.md` and `docs/completed-and-protected.md`.** Do not modify them in this skill — flag findings for the user instead.
- **Mechanical fixes are safe.** Narrative additions need full file context — read the relevant source before writing the doc update.
- **One last-updated date per doc.** Update it when you make changes in the same commit.

## Pre-commit hook (optional)

If installed via `pnpm install:git-hooks`, every `git commit` runs `pnpm precommit` first. The hook blocks the commit on **mechanical** drift (broken paths, permission-key mismatches) but allows narrative drift through (since only an LLM can fix that). To bypass intentionally: `git commit --no-verify`.

## When NOT to use

- A single-file change with no schema, seed, route, or API touched — the docs are unlikely to be affected.
- The user already updated the relevant module doc in the same response.
- The user says "just commit" or "leave docs alone."

## Related files

- `scripts/check-doc-sync.ts` — the detector + mechanical fixer.
- `scripts/install-git-hooks.ts` — installs `.git/hooks/pre-commit`.
- `AGENTS.md` §6, §7 — status-in-one-place rule + doc-sync workflow.
- `docs/modules/*.md` — the docs to sync.
- `prisma/seeds/bootstrap-seed.ts` — the implicit spec for permission keys, statuses, opaque IDs.
- `src/shared/lib/constants/permissions.ts` — the permission-key constants.
