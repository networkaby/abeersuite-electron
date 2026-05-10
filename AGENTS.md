<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Before Any Change You must explain
use shadcn, zustand

# Module-specific maps

For module-specific URLs, permissions, models, and wiring, read `docs/modules/<module>.md` first. Each doc follows the same template — URLs (UI + API), Permissions, Prisma models, Key components, Common workflows, Gotchas. Cuts the "what does this module touch" question from N file globs to one file read. Index: [docs/modules/README.md](docs/modules/README.md).

# After every plan / segment completes — update three things in the same commit

Before declaring a plan or segment done, update **all three** of the following in the same commit. Skipping any of them creates drift that future contributors won't catch.

1. **Docs** — every doc the change touched. At minimum:
   - The relevant `docs/modules/<module>.md` (URLs, permissions, components, workflows, gotchas).
   - `docs/seeds.md` if seed scripts, fixture data, or `hard-clean.ts` changed.
   - `docs/plans/<NN>-<segment>.md` if the executed plan diverged from what was written there — record what actually happened.
   - Any other `docs/<file>.md` referenced by the change.
2. **Todo list** — mark every task `completed` (not batched at the end; mark as you finish each one). Remove tasks that were dropped, add follow-ups discovered during execution. The list should match what was actually done before the commit lands.
3. **Reusables registry** — if the change added or removed a helper / hook / schema / formatter / shared component, register or unregister it in:
   - `docs/reusables.md` (cross-cutting items in `src/shared/`).
   - The relevant `docs/modules/<m>.md` "Reusable helpers — DO NOT duplicate" table (module-scoped items).
   - If the symbol is renamed or moved, update both the old entry and the new one — leave no dangling reference.

If the change is a structural move (renames, file relocations) but adds no new symbols, only docs + todo updates are needed; the reusables registry is unchanged.

<!-- END:nextjs-agent-rules -->
