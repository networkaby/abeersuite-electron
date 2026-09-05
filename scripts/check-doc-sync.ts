/**
 * check-doc-sync.ts — detect (and optionally auto-fix) drift between docs and code.
 *
 * Modes:
 *   pnpm seed:check-docs          → report drift, exit 0 (informational).
 *   pnpm seed:fix-docs            → auto-apply mechanical fixes, exit 0.
 *   pnpm seed:check-docs --strict → fail (exit 1) on MECHANICAL drift only.
 *                                   Use as a git pre-commit hook so commits
 *                                   block on broken paths / permission-key
 *                                   mismatches but pass on narrative-only drift.
 *
 * What this checks (mechanical, no LLM needed):
 *   1. Permission-key parity — `permissions.ts` constants vs the `codeOwnedCatalog.ts` catalog.
 *   2. File-path validity — `src/...` / `prisma/...` paths cited in docs actually exist on disk.
 *   3. Module-doc freshness — each `docs/modules/<m>.md` vs the last commit touching the matching source folders.
 *
 * What this CAN'T do (needs the `sync-docs-with-code` Claude skill):
 *   • Update workflow prose when an API or component is renamed.
 *   • Add new "Recent decisions / gotchas" entries from recent commits.
 *   • Spot new routes / APIs / models that were never documented.
 *   • Update the `_Last updated:` footer with a meaningful one-line summary.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const FIX = ARGS.has("--fix");
const STRICT = ARGS.has("--strict");

const ANSI = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" };

function header(s: string) { console.log(`\n${ANSI.dim}━━━ ${s} ━━━${ANSI.reset}`); }
function warn(s: string) { console.log(`  ${ANSI.yellow}⚠${ANSI.reset}  ${s}`); }
function ok(s: string) { console.log(`  ${ANSI.green}✓${ANSI.reset}  ${s}`); }
function fixed(s: string) { console.log(`  ${ANSI.cyan}✎${ANSI.reset}  ${s}`); }
function read(rel: string): string { return readFileSync(path.join(REPO, rel), "utf8"); }
function write(rel: string, content: string): void { writeFileSync(path.join(REPO, rel), content, "utf8"); }

function listMarkdown(dirRel: string): string[] {
    const abs = path.join(REPO, dirRel);
    if (!existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(abs, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const parent = (entry as { parentPath?: string; path?: string }).parentPath
            ?? (entry as { path?: string }).path
            ?? abs;
        out.push(path.relative(REPO, path.join(parent, entry.name)));
    }
    return out;
}

let mechanicalDrift = 0;   // strict mode fails on these
let narrativeDrift = 0;    // strict mode allows these

// ─── 1. Permission key parity ───────────────────────────────────────────────
header("1. Permission keys: permissions.ts ↔ codeOwnedCatalog.ts");

const constantsRel = "src/shared/lib/constants/permissions.ts";
// The permission catalog moved out of bootstrap-seed.ts into the shared
// code-owned module (both bootstraps import it) — parse the catalog there.
const seedRel = "prisma/seeds/lib/codeOwnedCatalog.ts";
let constantsSrc = read(constantsRel);
const seedSrc = read(seedRel);

const constantsKeys = new Set(
    [...constantsSrc.matchAll(/"([a-z][a-z0-9_:-]+)"/g)]
        .map((m) => m[1])
        .filter((k) => k.includes(":")),
);

const seedKeys = new Set<string>();
const permRangeMatch = seedSrc.match(/const PERMISSION_CATALOG[\s\S]*?\n\];/);
if (permRangeMatch) {
    for (const m of permRangeMatch[0].matchAll(/id:\s*"([a-z][a-z0-9_:-]+)"/g)) {
        if (m[1].includes(":")) seedKeys.add(m[1]);
    }
}

const inConstantsOnly = [...constantsKeys].filter((k) => !seedKeys.has(k));
const inSeedOnly = [...seedKeys].filter((k) => !constantsKeys.has(k));

if (inConstantsOnly.length === 0 && inSeedOnly.length === 0) {
    ok(`${constantsKeys.size} permission keys match across both files.`);
} else {
    if (inConstantsOnly.length > 0) {
        warn(`${inConstantsOnly.length} keys in permissions.ts but NOT in codeOwnedCatalog.ts:`);
        inConstantsOnly.forEach((k) => console.log(`     - ${k}`));
        mechanicalDrift += inConstantsOnly.length;
    }
    if (inSeedOnly.length > 0) {
        if (FIX) {
            // Auto-add missing constants. Constant name derived from the key:
            // "service-centers:view:branch" → SERVICE_CENTERS_VIEW_BRANCH.
            const lines = constantsSrc.split("\n");
            const closingIdx = lines.findIndex((l) => l.trim() === "} as const;");
            if (closingIdx > 0) {
                const additions: string[] = ["", "    // Auto-added by check-doc-sync --fix:"];
                for (const key of inSeedOnly) {
                    const name = key.toUpperCase().replace(/[:-]/g, "_");
                    const pad = " ".repeat(Math.max(1, 36 - name.length));
                    additions.push(`    ${name}:${pad}"${key}",`);
                    fixed(`Added constant ${name} = "${key}" to permissions.ts`);
                }
                lines.splice(closingIdx, 0, ...additions);
                constantsSrc = lines.join("\n");
                write(constantsRel, constantsSrc);
            } else {
                warn(`Could not locate closing brace in permissions.ts — skipping --fix for permission keys.`);
                mechanicalDrift += inSeedOnly.length;
            }
        } else {
            warn(`${inSeedOnly.length} keys in codeOwnedCatalog.ts but NOT in permissions.ts:`);
            inSeedOnly.forEach((k) => console.log(`     - ${k}`));
            console.log(`     ${ANSI.dim}(run with --fix to add them to permissions.ts)${ANSI.reset}`);
            mechanicalDrift += inSeedOnly.length;
        }
    }
}

// ─── 2. File-path validity in docs ──────────────────────────────────────────
header("2. File paths cited in docs exist on disk");

const docFiles = listMarkdown("docs");
const INLINE_RE = /`((?:src|prisma|tools|scripts)\/[^`\n]+)`/g;

function findLinkPaths(text: string): string[] {
    const paths: string[] = [];
    const re = /\]\((src\/|prisma\/|tools\/|scripts\/)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const start = m.index + 2;
        let depth = 1;
        let i = start;
        while (i < text.length && depth > 0) {
            if (text[i] === "(") depth++;
            else if (text[i] === ")") {
                depth--;
                if (depth === 0) break;
            }
            i++;
        }
        if (depth === 0) paths.push(text.slice(start, i));
    }
    return paths;
}

// If a path is mentioned in the same sentence as "removed" / "deleted" / "gone"
// / "no longer exists" / "dropped", treat it as a historical reference, not
// a current claim, and skip.
const HISTORICAL_RE = /\b(removed|deleted|dropped|gone|no longer|never existed|legacy)\b/i;

// Some referenced paths intentionally live OUTSIDE this repo (e.g. the thermal /
// QR display relays in their own git repo). When the path is described as
// external / out-of-repo / a separate repo, it's a deliberate reference, not a
// broken path on disk — skip it.
const EXTERNAL_RE = /\b(external|out-of-repo|out of repo|separate (?:git )?repo|not under this app|own (?:git )?repo)\b/i;

// A citation may carry a line anchor — `push.ts:248-277`, `route.ts:36,106-110`,
// `local-schema.sql:5729-5765`. The FILE is the claim this check verifies; the lines
// are a pointer into it and move with every edit, so they are stripped before asking
// the disk. Without this every such citation was reported as a broken path, which is
// how `docs/audit-2026-09-05.md` alone put 24 false positives into `pnpm precommit`.
const LINE_ANCHOR_RE = /:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;

const broken: { doc: string; refPath: string }[] = [];

for (const docRel of docFiles) {
    const text = read(docRel);
    const lines = text.split(/\r?\n/);

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const context = `${lines[li - 1] ?? ""}\n${line}\n${lines[li + 1] ?? ""}`;
        const candidates: string[] = [];
        for (const m of line.matchAll(INLINE_RE)) candidates.push(m[1]);
        candidates.push(...findLinkPaths(line));

        for (const raw of candidates) {
            const ref = raw.split("#")[0].split("?")[0]
                .replace(/[.,;:!?]+$/, "")
                .replace(LINE_ANCHOR_RE, "");
            if (ref.includes("*") || /<[a-z]/i.test(ref) || ref.endsWith("/")) continue;
            const abs = path.join(REPO, ref);
            if (existsSync(abs)) continue;
            if (HISTORICAL_RE.test(context)) continue;   // skip "X was removed" mentions
            if (EXTERNAL_RE.test(context)) continue;     // skip intentional out-of-repo refs
            broken.push({ doc: docRel.replace(/\\/g, "/"), refPath: ref });
        }
    }
}

if (broken.length === 0) {
    ok(`Every code-path reference in docs resolves to a real file.`);
} else {
    warn(`${broken.length} broken file reference(s):`);
    broken.forEach((b) => console.log(`     ${b.doc} → ${b.refPath}`));
    mechanicalDrift += broken.length;
}

// ─── 3. Module-doc freshness ────────────────────────────────────────────────
header("3. Module docs vs last commit touching the module");

const MODULE_SOURCES: Record<string, string[]> = {
    accountancy: ["src/modules/accountancy", "src/app/(protected)/office/accountancy", "src/app/api/accountancy"],
    admin: ["src/modules/admin", "src/app/(protected)/office/admin"],
    core: ["src/modules/core", "src/app/(protected)/office/core"],
    "customer-portal": ["src/modules/external", "src/app/(external)", "src/app/api/portal", "src/app/api/shop"],
    home: ["src/modules/home", "src/app/(protected)/office/page.tsx", "src/app/api/quick-log"],
    inventory: ["src/modules/inventory", "src/app/(protected)/office/inventory", "src/app/api/inventory"],
    lab: ["src/modules/lab", "src/app/(protected)/lab"],
    messaging: ["src/modules/message", "src/app/(protected)/office/message", "src/app/api/inbox"],
    people: ["src/modules/customer", "src/app/(protected)/office/customers", "src/app/api/people", "src/app/api/companies"],
    permissions: ["src/shared/lib/constants/permissions.ts", "src/shared/lib/auth"],
    pos: ["src/modules/pos", "src/app/(protected)/office/pos", "src/app/(protected)/vouchers/pos", "src/app/api/pos"],
    repair: ["src/modules/repairing", "src/app/(protected)/office/repairing", "src/app/api/tickets"],
    sales: ["src/modules/ecommerce", "src/app/(protected)/office/ecommerce", "src/app/api/ecommerce"],
};

function lastCommitDate(rel: string): Date | null {
    try {
        const out = execSync(`git log -1 --format=%cI -- "${rel}"`, { cwd: REPO, encoding: "utf8" }).trim();
        return out ? new Date(out) : null;
    } catch {
        return null;
    }
}

let staleModules = 0;
for (const [mod, sources] of Object.entries(MODULE_SOURCES)) {
    const docPath = `docs/modules/${mod}.md`;
    if (!existsSync(path.join(REPO, docPath))) continue;
    const docDate = lastCommitDate(docPath);
    if (!docDate) continue;

    let latestSource: { path: string; date: Date } | null = null;
    for (const src of sources) {
        if (!existsSync(path.join(REPO, src))) continue;
        const d = lastCommitDate(src);
        if (d && (!latestSource || d > latestSource.date)) latestSource = { path: src, date: d };
    }
    if (latestSource) {
        const docDay = docDate.toISOString().slice(0, 10);
        const srcDay = latestSource.date.toISOString().slice(0, 10);
        if (srcDay > docDay) {
            const daysBehind = Math.floor((Date.parse(srcDay) - Date.parse(docDay)) / 86400000);
            warn(`${mod}.md is ${daysBehind} day(s) behind ${latestSource.path}`);
            console.log(`     doc last touched ${docDay}  •  source last touched ${srcDay}`);
            staleModules++;
        }
    }
}
if (staleModules === 0) ok(`All module docs are at least as recent as their source folders.`);
narrativeDrift += staleModules;

// ─── Summary ────────────────────────────────────────────────────────────────
console.log("");
const total = mechanicalDrift + narrativeDrift;
if (total === 0) {
    console.log(`${ANSI.green}✓ Docs in sync with code.${ANSI.reset}\n`);
    process.exit(0);
}

if (mechanicalDrift > 0) {
    console.log(`${ANSI.yellow}⚠ ${mechanicalDrift} mechanical drift issue(s)${ANSI.reset} — broken paths or permission-key mismatches.`);
    if (!FIX) console.log(`  Run ${ANSI.dim}pnpm seed:fix-docs${ANSI.reset} to auto-fix what's auto-fixable.`);
}
if (narrativeDrift > 0) {
    console.log(`${ANSI.yellow}⚠ ${narrativeDrift} narrative drift issue(s)${ANSI.reset} — module docs older than their source. Needs a human (or Claude) to read recent commits and update the prose.`);
    console.log(`  In Claude Code: invoke ${ANSI.dim}/sync-docs-with-code${ANSI.reset} before committing.`);
}
console.log("");

// In strict mode (e.g. pre-commit hook), fail on mechanical drift only.
// Narrative drift is informational because only an LLM can really fix it.
if (STRICT && mechanicalDrift > 0) process.exit(1);
process.exit(0);
