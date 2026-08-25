import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "src", "app");
const API_DIR = path.join(APP_DIR, "api");

// Load local environment files if present (.env.local has priority over .env)
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });

/**
 * PUBLIC API ALLOWLIST
 *
 * WARNING: Adding a segment here publishes it to the internet on the public shop deployment!
 * Every segment omitted from this set is deleted before `next build` runs on Vercel.
 */
export const PUBLIC_API_ALLOWLIST = new Set([
    "auth",
    "portal",
    "shop",
    "upload-signature",
    "legal",
]);

/** Top-level app route directories that belong strictly to the office/staff build. */
const OFFICE_ROUTE_DIRS = [
    path.join(APP_DIR, "(protected)"),
    path.join(APP_DIR, "staff"),
    path.join(APP_DIR, "receipt"),
    path.join(APP_DIR, "shipping-label"),
    path.join(APP_DIR, "shipping-slip"),
];

function main() {
    if (process.env.APP_MODE !== "public") {
        console.log(`[strip-public-build] APP_MODE is '${process.env.APP_MODE || "office"}' (not 'public'). Skipping strip.`);
        process.exit(0);
    }

    console.log("[strip-public-build] Running public build pre-strip (APP_MODE=public)...");

    let strippedCount = 0;

    // 1. Strip office page directories
    for (const dir of OFFICE_ROUTE_DIRS) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            const rel = path.relative(ROOT, dir);
            console.log(`[strip-public-build] Stripped route directory: ${rel}`);
            strippedCount++;
        }
    }

    // 2. Strip non-allowlisted API routes (default-deny)
    const keptApis = [];
    if (fs.existsSync(API_DIR)) {
        const entries = fs.readdirSync(API_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const apiName = entry.name;
            const fullPath = path.join(API_DIR, apiName);

            if (PUBLIC_API_ALLOWLIST.has(apiName)) {
                keptApis.push(apiName);
                console.log(`[strip-public-build] Kept public API: src/app/api/${apiName}`);
            } else {
                fs.rmSync(fullPath, { recursive: true, force: true });
                console.log(`[strip-public-build] Stripped office API: src/app/api/${apiName}`);
                strippedCount++;
            }
        }
    }

    console.log(`[strip-public-build] Complete: stripped ${strippedCount} directories. Kept public API segments: [${keptApis.join(", ")}]`);
}

main();
