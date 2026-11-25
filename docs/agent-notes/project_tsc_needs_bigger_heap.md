---
name: project_tsc_needs_bigger_heap
description: "`npx tsc --noEmit` OOMs on this repo in any checkout, main included — always run it with NODE_OPTIONS=--max-old-space-size=8192."
metadata: 
  type: project
  modified: 2026-09-15T19:04:30.858Z
---

`npx tsc --noEmit -p tsconfig.json` runs out of V8 heap on this repo and dies with
`FATAL ERROR: Ineffective mark-compacts near heap limit`, **exit 134**, after ~5 minutes.
This is not worktree-specific — it happens on the main checkout too, and it is more likely
when the dev server and browser pane are also running.

Always run it as:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
```

**Why:** an OOM is not a type error, but it is also not a pass. Reporting "tsc clean" off a
crashed run means shipping unchecked types. It bit once already: the same command had passed
earlier in the same session, so the later crash looked like a fluke rather than a limit.

**How to apply:** use the bigger heap from the first run, not as a retry. And watch the exit
code reporting — a pipeline like `npx tsc … | tail -30; echo "exit: $?"` reports the exit of
`tail`/`echo`, so the background-task notification says **"completed (exit code 0)"** while
tsc actually died. Use `${PIPESTATUS[0]}` and read the captured output, never trust the
notification's exit code for a piped command.

Filed separately from [project_fresh_worktree_precommit_setup](project_fresh_worktree_precommit_setup.md), which lists the same fix
but only in a fresh-worktree context — that framing is what caused it to be skipped on main.
