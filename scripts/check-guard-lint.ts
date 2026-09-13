import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const API_DIR = path.join(REPO, "src", "app", "api");
const SRC_DIR = path.join(REPO, "src");

// Public API segments are handled by external authentication mechanisms (OTP, Firebase, webhooks)
const PUBLIC_ALLOWLIST = new Set([
    "auth",
    "portal",
    "shop",
    "upload-signature",
    "legal",
]);

// Explicit exceptions for unauthenticated system endpoints
const EXCLUDED_OFFICE_ROUTES = new Set([
    "src/app/api/health/route.ts",
]);

const GUARD_PATTERNS = [
    /\brequireAuth\b/,
    /\brequireRole\b/,
    /\brequirePermission\b/,
    /\brequireAnyPermission\b/,
    /\brequireVoucherPermission\b/,
    /\brequireModuleAccess\b/,
    /\brequirePosVoucher\b/,
    /\brequireBranchAccess\b/,
    /\bauth\s*\(/,
    /\bverifyWebhookSignature\b/,
    /\bverifyRazorpaySignature\b/,
    // Vercel Cron endpoints: guarded by the Bearer <CRON_SECRET> header check, not by
    // a staff session — there is no user behind a scheduled call.
    /\bCRON_SECRET\b/,
];

function findRouteFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findRouteFiles(full, out);
        } else if (entry.isFile() && entry.name === "route.ts") {
            out.push(full);
        }
    }
    return out;
}


// ── Rule 2: one writer for Account.balance ───────────────────────────────────
//
// Every path that moves the cached `Account.balance` must go through
// `applyLineBalances` (balance.ts) or the engine, because those two resolve a
// ledger's nature the way it was resolved when the voucher was POSTED — with the
// account-group fallback. A hand-rolled loop reading bare `normalBalance` gets
// `null` for every party (AR/AP) ledger, and then either skips the line (leaving
// a stale cached balance) or, with a `!` assertion, feeds null into
// `balanceDelta` and applies the delta on the WRONG SIDE. Both shipped; see the
// journal-entry lifecycle routes before 2026-09-13.
//
// It also matters for the FY opening wall: the wall's dirty stamp lives inside
// these writers, so a fourth writer would silently serve a stale cached year.
//
// What this rule can NOT catch, on purpose: an ABSOLUTE write (`balance: <value>`)
// as used by the recompute-from-truth tooling — aggregateLedger.recomputeAccountBalances,
// the recompute-balances maintenance route and scripts/recompute-caches. Those are
// legitimate and are not deltas.
const BALANCE_WRITER_ALLOWLIST = new Set([
    "src/modules/accountancy/lib/balance.ts",          // applyLineBalances itself
    "src/modules/accountancy/lib/transactionEngine.ts", // the posting engine
    // openingBills builds ONE pre-aggregated delta per account from a signed
    // total and deliberately treats a null-group, null-nature ledger as CREDIT,
    // where applyLineBalances skips it. Converting it is a behaviour change, so
    // it stays out until that call is made deliberately.
    "src/modules/accountancy/lib/openingBills.ts",
]);

function findTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "generated" || entry.name === "node_modules") continue;
            findTsFiles(full, out);
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/** Hand-rolled `account.update({ ... balance: { increment|decrement } })` sites. */
function findBalanceWriters(): string[] {
    const offenders: string[] = [];
    for (const file of findTsFiles(SRC_DIR)) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        if (BALANCE_WRITER_ALLOWLIST.has(rel)) continue;
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (!/balance:\s*\{\s*(increment|decrement)/.test(lines[i])) continue;
            // Which model is being updated? Walk back to the nearest `.<model>.update(`
            // so GiftCard.balance / LoyaltyAccount.balance are not false positives.
            let model: string | null = null;
            for (let j = i; j >= Math.max(0, i - 8); j--) {
                const m = /\.(\w+)\.update(?:Many)?\s*\(/.exec(lines[j]);
                if (m) { model = m[1]; break; }
            }
            if (model === "account") offenders.push(`${rel}:${i + 1}`);
        }
    }
    return offenders;
}

function main() {
    console.log("[guard-lint] Checking staff/office API route auth guards...");

    const allRoutes = findRouteFiles(API_DIR);
    let officeCount = 0;
    const unguarded = [];

    for (const file of allRoutes) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        const segments = rel.replace("src/app/api/", "").split("/");
        const topSegment = segments[0];

        // Skip public allowlist
        if (PUBLIC_ALLOWLIST.has(topSegment)) continue;
        if (EXCLUDED_OFFICE_ROUTES.has(rel)) continue;

        officeCount++;
        const content = fs.readFileSync(file, "utf8");
        const hasGuard = GUARD_PATTERNS.some((pattern) => pattern.test(content));

        if (!hasGuard) {
            unguarded.push(rel);
        }
    }

    if (unguarded.length > 0) {
        console.error(`\n[guard-lint] ERROR: Found ${unguarded.length} unguarded office route(s):`);
        for (const file of unguarded) {
            console.error(`  - ${file}`);
        }
        process.exit(1);
    }

    const balanceOffenders = findBalanceWriters();
    if (balanceOffenders.length > 0) {
        console.error(`
[guard-lint] ERROR: ${balanceOffenders.length} hand-rolled Account.balance delta(s):`);
        for (const hit of balanceOffenders) console.error(`  - ${hit}`);
        console.error(`  Use applyLineBalances(tx, lines, "apply" | "reverse") from`);
        console.error(`  src/modules/accountancy/lib/balance.ts — it resolves ledger nature`);
        console.error(`  with the account-group fallback, as the posting engine does.`);
        process.exit(1);
    }

    console.log(`[guard-lint] PASS: All ${officeCount} office API route handlers enforce authentication.`);
    console.log(`[guard-lint] PASS: Account.balance deltas all go through the shared writer.`);
    process.exit(0);
}

main();
