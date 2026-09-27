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
    // Asked by the counter's sign-in shell BEFORE anyone is signed in — there is no
    // session to require. It is gated instead by `thisCounterId()`: off a counter it
    // answers "no PIN" and nothing else, so it does not exist on the web deployment.
    "src/app/api/counter-pin/status/route.ts",
    // "Whose drawer is on this counter?", for the lock screen with nobody signed in
    // — the next cashier checks it before taking the drawer over. Fenced the same
    // way: `thisCounterId()` only, so it does not exist on the web deployment, and
    // it only ever describes the drawer standing in front of the asking PC.
    "src/app/api/counter/shift/route.ts",
    // The duty card of whoever last ran a shift on this counter, for the lock
    // screen after a restart. Same fence as counter/shift. Owner, 2026-09-25:
    // the card shows always, not only straight after a sign-out.
    "src/app/api/counter/day/route.ts",
    // "When does the shop open next?", asked by the sign-in screen with nobody
    // signed in. Every fact it returns is the sort a shop paints on its own door —
    // opening and closing times, the days it is shut, the names of holidays. It
    // takes no input, names no person, and reveals nothing about who works when:
    // the SHOP's weekly off is a shop fact, while a person's own weekly off lives
    // on StaffProfile and never reaches this route.
    "src/app/api/office-hours/next/route.ts",
    // Staff forgot-password: nobody is signed in yet by definition; sends and code guesses are throttled per address.
    "src/app/api/staff/password-reset/route.ts",
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


// ── Rule 3: un-posting is an office-only move ────────────────────────────────
//
// `parkVoucherAsDraftInTx` turns a POSTED voucher back into a DRAFT, and its two
// companions DELETE rows (the old GL lines on a repost, the whole draft on a
// discard). Two separate things depend on that never happening against a
// counter's replica:
//
//   • the replica write guard refuses EVERY delete, so a re-close of a reopened
//     shift on a till writing locally throws from inside its transaction and the
//     cashier cannot close (fixed 2026-09-13 by refusing up front);
//   • the sync push guard `voucherWouldUnpost` drops an incoming DRAFT for a
//     REGULAR voucher the cloud has POSTED. That is only correct while no
//     legitimate un-post can reach the outbox — i.e. while these calls stay on
//     the authoritative database. Move one onto the mode-routed `prisma` without
//     a guard and the push would start silently eating real un-posts.
//
// So: a file that calls any of them must also name `prismaAuthoritative` (it
// writes upstream) or `shouldWriteLocal` (it checks first and refuses).
const PARK_FNS = ["parkVoucherAsDraftInTx", "repostParkedVoucherInTx", "discardParkedDraftInTx"];
const PARK_MODULE = "src/modules/accountancy/lib/parkVoucherInTx.ts";

function findUnguardedParkCallers(): string[] {
    const offenders: string[] = [];
    for (const file of findTsFiles(SRC_DIR)) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        if (rel === PARK_MODULE) continue;   // the definitions themselves
        const content = fs.readFileSync(file, "utf8");
        const calls = PARK_FNS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(content));
        if (calls.length === 0) continue;
        if (/\bprismaAuthoritative\b/.test(content) || /\bshouldWriteLocal\b/.test(content)) continue;
        offenders.push(`${rel} (calls ${calls.join(", ")})`);
    }
    return offenders;
}


// ── Rule 4: recycling voucher-line ids is an announced move ──────────────────
//
// `VoucherGlLine` and `VoucherInventoryLine` carry no `updatedAt` and no
// `createdAt`, so the sync push has no timestamp to arbitrate them with and every
// push of one is an unconditional upsert. What keeps that safe is a guard in
// `push.ts` (`parentLinesWereRewritten`): a line whose parent voucher already
// carries a CLOUD-RANGE line has been superseded by the office, because a counter
// cannot mint an id in the cloud's range, and it is dropped instead of resurrected.
//
// That guard reads the id range as a proxy for "the office rewrote this line set",
// which holds only while the office is the one doing the rewriting. Each of the
// routes below deletes a voucher's lines and re-creates them with FRESH ids — the
// move that strands a counter's unpushed row in the first place. A NEW one is not
// forbidden; it just has to be seen, because two things must be re-checked when it
// appears: that it runs upstream (a counter's replica refuses deletes outright), and
// that it does not introduce the one case the guard cannot tell from a stale replay —
// a counter writing lines onto a voucher the office authored.
//
// What this rule does NOT catch, on purpose: `updateMany` repointing of existing
// lines (convertParty's account merge). That keeps the ids, so nothing is stranded.
const LINE_RECYCLER_ALLOWLIST = new Set([
    "src/app/api/accountancy/vouchers/[id]/route.ts",       // office voucher PATCH
    "src/app/api/accountancy/journal-entries/[id]/route.ts", // office JE PATCH
    "src/app/api/inventory/vouchers/[id]/route.ts",          // office inventory PATCH + delete
    "src/app/api/orders/[source]/[id]/route.ts",             // order line rewrite
    "src/modules/accountancy/lib/openingBills.ts",           // opening-bill rewrite
    "src/modules/accountancy/lib/reapplyTradingVoucher.ts",  // in-place re-apply
    "src/modules/accountancy/lib/parkVoucherInTx.ts",        // shift repost (office-only, rule 3)
]);

const RECYCLED_LINE_MODELS = ["voucherGlLine", "voucherInventoryLine"];

/** `voucherGlLine.deleteMany(` / `voucherInventoryLine.deleteMany(` outside the allowlist. */
function findLineRecyclers(): string[] {
    const offenders: string[] = [];
    for (const file of findTsFiles(SRC_DIR)) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        if (LINE_RECYCLER_ALLOWLIST.has(rel)) continue;
        if (rel.startsWith("src/scripts/")) continue;   // verification tooling, never shipped
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            for (const model of RECYCLED_LINE_MODELS) {
                if (new RegExp(`\\.${model}\\.delete(?:Many)?\\s*\\(`).test(lines[i])) {
                    offenders.push(`${rel}:${i + 1} (${model})`);
                }
            }
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

    const parkOffenders = findUnguardedParkCallers();
    if (parkOffenders.length > 0) {
        console.error(`
[guard-lint] ERROR: ${parkOffenders.length} un-post caller(s) with no authoritative client and no offline check:`);
        for (const hit of parkOffenders) console.error(`  - ${hit}`);
        console.error(`  These delete rows, which a counter's replica refuses, and the sync`);
        console.error(`  push guard assumes an un-post can never reach the outbox. Use`);
        console.error(`  prismaAuthoritative, or check shouldWriteLocal() and refuse first.`);
        process.exit(1);
    }

    const recyclerOffenders = findLineRecyclers();
    if (recyclerOffenders.length > 0) {
        console.error(`
[guard-lint] ERROR: ${recyclerOffenders.length} unannounced voucher-line recycler(s):`);
        for (const hit of recyclerOffenders) console.error(`  - ${hit}`);
        console.error(`  Deleting a voucher's lines strands any unpushed copy on a counter.`);
        console.error(`  Read parentLinesWereRewritten in src/shared/lib/sync/push.ts, confirm`);
        console.error(`  this runs upstream, then add the file to LINE_RECYCLER_ALLOWLIST here.`);
        process.exit(1);
    }

    console.log(`[guard-lint] PASS: All ${officeCount} office API route handlers enforce authentication.`);
    console.log(`[guard-lint] PASS: Account.balance deltas all go through the shared writer.`);
    console.log(`[guard-lint] PASS: un-posting stays on the authoritative database.`);
    console.log(`[guard-lint] PASS: every voucher-line recycler is announced.`);
    process.exit(0);
}

main();
