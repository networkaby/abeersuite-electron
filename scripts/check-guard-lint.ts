import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const API_DIR = path.join(REPO, "src", "app", "api");

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

    console.log(`[guard-lint] PASS: All ${officeCount} office API route handlers enforce authentication.`);
    process.exit(0);
}

main();
