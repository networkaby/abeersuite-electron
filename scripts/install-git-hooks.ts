/**
 * Install repo-tracked git hooks into `.git/hooks/`.
 *
 * Usage: pnpm install:git-hooks
 *
 * Idempotent — re-running overwrites the hook with the latest version. Safe.
 * Skips silently if `.git/` doesn't exist (e.g. in a worktree or fresh clone
 * before `git init`).
 */

import { existsSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "..");
const HOOKS_DIR = path.join(REPO, ".git", "hooks");

if (!existsSync(path.join(REPO, ".git"))) {
    console.log("No .git/ directory — skipping hook install. Run `git init` first.");
    process.exit(0);
}

mkdirSync(HOOKS_DIR, { recursive: true });

const preCommit = `#!/bin/sh
# Auto-installed by \`pnpm install:git-hooks\`. To remove: rm .git/hooks/pre-commit
# Runs the mechanical doc-sync checker. Blocks commit on broken paths or
# permission-key mismatches; warns (but doesn't block) on narrative drift.
# To bypass intentionally: \`git commit --no-verify\`.

pnpm precommit
`;

const hookPath = path.join(HOOKS_DIR, "pre-commit");
writeFileSync(hookPath, preCommit, "utf8");
try {
    chmodSync(hookPath, 0o755);
} catch {
    // Windows ignores chmod; the hook will still run via Git for Windows' sh.
}

console.log(`✓ Installed .git/hooks/pre-commit → runs \`pnpm precommit\` on every commit.`);
console.log(`  Mechanical drift blocks the commit; narrative drift is a warning.`);
console.log(`  Bypass with \`git commit --no-verify\` when intentional.`);
