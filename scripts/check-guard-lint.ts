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
    // A counter's settings and secrets, asked at start before anyone can sign in. Guarded by the
    // Install <COUNTER_INSTALL_SECRET> header, and shut on a till and when the secret is unset.
    "src/app/api/counter/config/route.ts",
    // Staff forgot-password: nobody is signed in yet by definition; sends and code guesses are throttled per address.
    "src/app/api/staff/password-reset/route.ts",
    // Public realtime project pair for supabaseClient.ts (DB1 / DB2 toggle + publishable key on counter PCs)
    "src/app/api/realtime/project/route.ts",
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
    // Campaigns: named requireAnyPermission(sidebar link) helpers — campaignAccess.ts.
    /\brequireCampaignsPage\b/,
    /\brequirePostsPage\b/,
    /\brequireScheduledPage\b/,
    /\brequireDueRemindersPage\b/,
    /\brequireConsentPage\b/,
    /\brequireConsentEdit\b/,
    /\brequireGoogleStatus\b/,
    /\brequireGoogleConnect\b/,
    /\brequireFacebookStatus\b/,
    /\brequireFacebookConnect\b/,
    // Reviews: named helpers — reviewsAccess.ts.
    /\brequireReviewsPage\b/,
    /\brequireReviewsReply\b/,
    // NOT a bare `auth()`: it answers "is anyone signed in", portal customers
    // included, and skips the released-counter stop. Staff routes use requireAuth().
    /\bverifyWebhookSignature\b/,
    /\bverifyRazorpaySignature\b/,
    // Vercel Cron endpoints: guarded by the Bearer <CRON_SECRET> header check, not by
    // a staff session — there is no user behind a scheduled call.
    /\bCRON_SECRET\b/,
    // The call-log feed from the phone system: a shared x-api-key header, same idea.
    /\bCALLS_API_KEY\b/,
    // Meta's WhatsApp webhook: GET answers only the verify token typed into Meta's
    // form; POST is gated by verifyWebhookSignature (X-Hub-Signature-256).
    /\bMETA_WA_VERIFY_TOKEN\b/,
    // Settings → Incoming API (incomingApi.ts): the same shared keys, read from the
    // page with the old env vars still accepted — cron, call log, Shiprocket, the
    // WhatsApp verify token, and the Cowork agent's /api/agent/* doors.
    /\brequireIncomingKey\b/,
    /\bincomingSecret\b/,
    // Counter relay / notify auth: authenticated via counter key + acting staff user header.
    /\bauthenticateCounterRequest\b/,
];

const HANDLER_START = /^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm;
const LOCAL_FN_START = /^(?:async\s+)?function\s+(\w+)\s*[(<]|^const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm;

/**
 * Source from `from` up to its closing line — the first line that starts with `}` (a
 * function) or `);` (an arrow helper). Not a bare `)`: that is the `) {` ending a
 * multi-line parameter list.
 */
function blockFrom(content: string, from: number): string {
    const close = /^(?:\}|\);)/m;
    const rest = content.slice(from);
    const firstNewline = rest.indexOf("\n");
    if (firstNewline < 0) return rest;
    const m = close.exec(rest.slice(firstNewline + 1));
    return m ? rest.slice(0, firstNewline + 1 + m.index + 1) : rest;
}

/**
 * Every exported HTTP handler in a route file that does not guard itself. The check is
 * per handler, not per file: one guarded POST used to vouch for an open GET beside it.
 * A handler also counts as guarded when it calls a function defined in the same file
 * whose own body is guarded (e.g. a shared `target()` or `requireXAccess()` helper).
 */
function unguardedHandlers(content: string): string[] {
    const isGuarded = (text: string) => GUARD_PATTERNS.some((p) => p.test(text));
    const guardedHelpers: string[] = [];
    for (const m of content.matchAll(LOCAL_FN_START)) {
        const name = m[1] ?? m[2];
        if (isGuarded(blockFrom(content, m.index))) guardedHelpers.push(name);
    }
    const callsGuardedHelper = (text: string) =>
        guardedHelpers.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(text));

    const open: string[] = [];
    for (const m of content.matchAll(HANDLER_START)) {
        const body = blockFrom(content, m.index);
        if (!isGuarded(body) && !callsGuardedHelper(body)) open.push(m[1]);
    }
    return open;
}

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

// ── Rule 2: un-posting is an office-only move ────────────────────────────────
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


// ── Rule 3: recycling voucher-line ids is an announced move ──────────────────
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
    const unguarded: string[] = [];

    for (const file of allRoutes) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        const segments = rel.replace("src/app/api/", "").split("/");
        const topSegment = segments[0];

        // Skip public allowlist
        if (PUBLIC_ALLOWLIST.has(topSegment)) continue;
        if (EXCLUDED_OFFICE_ROUTES.has(rel)) continue;

        officeCount++;
        const content = fs.readFileSync(file, "utf8");
        for (const method of unguardedHandlers(content)) unguarded.push(`${rel} ${method}`);
    }

    if (unguarded.length > 0) {
        console.error(`\n[guard-lint] ERROR: Found ${unguarded.length} unguarded office route handler(s):`);
        for (const hit of unguarded) {
            console.error(`  - ${hit}`);
        }
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
    console.log(`[guard-lint] PASS: un-posting stays on the authoritative database.`);
    console.log(`[guard-lint] PASS: every voucher-line recycler is announced.`);
    process.exit(0);
}

main();
