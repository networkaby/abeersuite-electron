/**
 * Publishes an ALREADY-VERIFIED build to both repositories:
 * - `devloperakramul/abeersuite-networkservice-update` (update-only binary feed)
 * - `devloperakramul/abeersuite-electron` (main source repo release artifacts)
 *
 * It also ensures:
 * 1. The commit is tagged with `v<version>` matching `package.json`.
 * 2. The commit and tag are pushed to `origin` (`devloperakramul/abeersuite-electron`).
 * 3. Binaries and release notes are attached to the release in both repos.
 */
import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { spawnSync, execSync } from "child_process";

loadDotenv({ path: path.join(process.cwd(), ".env") });

if (!process.env.GH_TOKEN) {
    console.error(
        "[release-electron] FATAL: GH_TOKEN is not set in .env.\n" +
        "  Create a fine-grained PAT with Contents: Read and write scoped to BOTH:\n" +
        "  1) devloperakramul/abeersuite-networkservice-update\n" +
        "  2) devloperakramul/abeersuite-electron\n" +
        "  and add it to .env as GH_TOKEN=..."
    );
    process.exit(1);
}

const packageJsonPath = path.join(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const version = pkg.version;
const tagName = `v${version}`;

console.log(`[release-electron] Release target version: ${version} (${tagName})`);

const prepackaged = path.join(process.cwd(), "dist-app", "win-unpacked");
if (!fs.existsSync(path.join(prepackaged, "AbeerSuite.exe"))) {
    console.error(
        `[release-electron] FATAL: ${prepackaged} has no AbeerSuite.exe.\n` +
        "  Run via 'pnpm electron:release' (which runs electron:pack first) — never this script alone."
    );
    process.exit(1);
}

// 1. Generate release notes from git commits since previous tag
let releaseNotes = "";
try {
    const rawTags = execSync("git tag --sort=-creatordate", { encoding: "utf-8" })
        .split("\n")
        .map(t => t.trim())
        .filter(Boolean);

    // Find previous version tag if any
    const prevTag = rawTags.find(t => t !== tagName && /^v?\d+\.\d+/.test(t));
    const range = prevTag ? `${prevTag}..HEAD` : "-n 20";
    console.log(`[release-electron] Collecting commit log for release notes (${prevTag ? `commits since ${prevTag}` : "last 20 commits"})...`);

    const commitLog = execSync(`git log ${range} --pretty=format:"* %s (%h)"`, { encoding: "utf-8" }).trim();
    if (commitLog) {
        releaseNotes = `### What's Changed in ${tagName}\n\n${commitLog}\n\n**Full Changelog**: ${prevTag ? `https://github.com/devloperakramul/abeersuite-electron/compare/${prevTag}...${tagName}` : `https://github.com/devloperakramul/abeersuite-electron/commits/${tagName}`}`;
    }
} catch (e: any) {
    console.warn("[release-electron] Could not auto-generate release notes from git:", e?.message);
}

// 2. Tag and push to origin if not already tagged
try {
    const existingTags = execSync("git tag -l", { encoding: "utf-8" }).split("\n").map(t => t.trim());
    if (!existingTags.includes(tagName)) {
        console.log(`[release-electron] Creating git tag ${tagName}...`);
        execSync(`git tag -a ${tagName} -m "Release ${tagName}"`, { stdio: "inherit" });
    } else {
        console.log(`[release-electron] Git tag ${tagName} already exists locally.`);
    }

    console.log(`[release-electron] Pushing HEAD and tag ${tagName} to origin...`);
    execSync(`git push origin HEAD --tags`, { stdio: "inherit" });
} catch (err: any) {
    console.error(`[release-electron] Git tag/push failed:`, err?.message || err);
    console.error("[release-electron] Please resolve git status or push permissions before releasing.");
    process.exit(1);
}

// 3. Publish to GitHub
console.log("[release-electron] Publishing verified build in dist-app/win-unpacked to both repositories (abeersuite-networkservice-update & abeersuite-electron)...");

const builderArgs = ["--publish", "always", "--prepackaged", prepackaged];
if (releaseNotes) {
    builderArgs.push(`-c.releaseInfo.releaseNotes=${JSON.stringify(releaseNotes)}`);
}

const result = spawnSync("electron-builder", builderArgs, {
    stdio: "inherit",
    shell: true,
    env: process.env,
});

process.exit(result.status ?? 1);


