/**
 * Publishes an ALREADY-VERIFIED build to every repo listed in .env via
 * GITHUB_UPDATE_REPO_1, GITHUB_UPDATE_REPO_2, ... (each paired with its own
 * GH_TOKEN_1, GH_TOKEN_2, ...).
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

const packageJsonPath = path.join(process.cwd(), "package.json");
const originalPackageJsonText = fs.readFileSync(packageJsonPath, "utf-8");
const pkg = JSON.parse(originalPackageJsonText);
const version = pkg.version;
const tagName = `v${version}`;

interface PublishTarget {
    provider: string;
    owner: string;
    repo: string;
    private?: boolean;
    releaseType?: string;
    tokenEnv: string;
}

// Each release repo can sit under a DIFFERENT GitHub account, so a single
// GH_TOKEN can't authenticate against both — electron-publish's GitHubPublisher
// only ever reads process.env.GH_TOKEN (or a literal `token` in the publish
// config, which we deliberately never write to package.json). Targets come
// from GITHUB_UPDATE_REPO_1="owner/repo", GITHUB_UPDATE_REPO_2=..., each paired
// with its OWN token GH_TOKEN_1, GH_TOKEN_2, ... — scanned until a gap, so
// adding a repo is just a new numbered pair in .env, no code change needed.
let publishTargets: PublishTarget[] = [];
for (let n = 1; process.env[`GITHUB_UPDATE_REPO_${n}`]; n++) {
    const [owner, repo] = (process.env[`GITHUB_UPDATE_REPO_${n}`] || "").split("/");
    if (!owner || !repo) {
        console.error(`[release-electron] FATAL: GITHUB_UPDATE_REPO_${n} must be "owner/repo", got "${process.env[`GITHUB_UPDATE_REPO_${n}`]}".`);
        process.exit(1);
    }
    publishTargets.push({ provider: "github", owner, repo, private: true, releaseType: "release", tokenEnv: `GH_TOKEN_${n}` });
}

if (publishTargets.length === 0) {
    console.error("[release-electron] FATAL: no GITHUB_UPDATE_REPO_N vars set in .env (need at least GITHUB_UPDATE_REPO_1 + GH_TOKEN_1).");
    process.exit(1);
}

// Retry a single target that failed (e.g. a bad token) without re-publishing a
// repo that already succeeded: RELEASE_ONLY_REPO=abeersuite-electron pnpm ...
if (process.env.RELEASE_ONLY_REPO) {
    const only = publishTargets.filter(t => t.repo === process.env.RELEASE_ONLY_REPO);
    if (only.length === 0) {
        console.error(
            `[release-electron] FATAL: RELEASE_ONLY_REPO="${process.env.RELEASE_ONLY_REPO}" matches no target in package.json build.publish.\n` +
            `  Known repos: ${publishTargets.map(t => t.repo).join(", ")}`
        );
        process.exit(1);
    }
    publishTargets = only;
    console.log(`[release-electron] RELEASE_ONLY_REPO set — publishing only to ${publishTargets[0].owner}/${publishTargets[0].repo}.`);
}

for (const target of publishTargets) {
    const envVar = target.tokenEnv;
    if (!envVar) {
        console.error(
            `[release-electron] FATAL: no token env mapped for publish target "${target.repo}".\n` +
            "  Add a matching GITHUB_UPDATE_REPO_N / GH_TOKEN_N pair to .env."
        );
        process.exit(1);
    }
    if (!process.env[envVar]) {
        console.error(
            `[release-electron] FATAL: ${envVar} is not set in .env.\n` +
            `  Create a fine-grained PAT with Contents: Read and write scoped to ${target.owner}/${target.repo}\n` +
            `  (it can belong to a different GitHub account than the other repo's token)\n` +
            `  and add it to .env as ${envVar}=...`
        );
        process.exit(1);
    }
}

console.log(`[release-electron] Release target version: ${version} (${tagName})`);

const prepackaged = path.join(process.cwd(), "dist-app", "win-unpacked");
if (!fs.existsSync(path.join(prepackaged, "AbeerSuite.exe"))) {
    console.error(
        `[release-electron] FATAL: ${prepackaged} has no AbeerSuite.exe.\n` +
        "  Run via 'pnpm electron:release' (which runs electron:pack first) — never this script alone."
    );
    process.exit(1);
}

// 1. Release notes are two parts: our own hand-written summary (RELEASE_NOTES.md,
// human-readable — edit it before releasing) followed by the auto-generated raw
// commit log (mechanical, exhaustive, but not something a customer wants to read
// on its own). Auto-generated always goes AFTER the hand-written part.
const releaseNotesPath = path.join(process.cwd(), "RELEASE_NOTES.md");
let humanNotes = "";
if (fs.existsSync(releaseNotesPath)) {
    humanNotes = fs.readFileSync(releaseNotesPath, "utf-8").trim();
}

let autoNotes = "";
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
        const sourceRepo = process.env.GITHUB_REPO || "devloperakramul/abeersuite-electron";
        autoNotes = `### What's Changed in ${tagName}\n\n${commitLog}\n\n**Full Changelog**: ${prevTag ? `https://github.com/${sourceRepo}/compare/${prevTag}...${tagName}` : `https://github.com/${sourceRepo}/commits/${tagName}`}`;
    }
} catch (e: unknown) {
    console.warn("[release-electron] Could not auto-generate release notes from git:", (e as Error)?.message);
}

const releaseNotes = [humanNotes, autoNotes].filter(Boolean).join("\n\n---\n\n");

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
} catch (err: unknown) {
    console.error(`[release-electron] Git tag/push failed:`, (err as Error)?.message || err);
    console.error("[release-electron] Please resolve git status or push permissions before releasing.");
    process.exit(1);
}

// 3. Publish to GitHub — one electron-builder invocation PER target. Each repo
// can belong to a different GitHub account, and GitHubPublisher only reads a
// single process.env.GH_TOKEN, so we can't publish to both repos in one run
// with two different tokens. Instead, for each target we temporarily narrow
// package.json's build.publish down to just that one repo, run the build with
// GH_TOKEN set to THAT repo's token, then restore package.json — same
// rename-and-restore pattern counter-build.ts uses for excluded routes.
console.log("[release-electron] Publishing verified build in dist-app/win-unpacked...");

const builderArgs = ["--publish", "always", "--prepackaged", prepackaged];
if (releaseNotes) {
    builderArgs.push(`-c.releaseInfo.releaseNotes=${JSON.stringify(releaseNotes)}`);
}

let exitCode = 0;
for (const target of publishTargets) {
    console.log(`[release-electron] → Publishing to ${target.owner}/${target.repo}...`);
    const { tokenEnv, ...builderTarget } = target;
    pkg.build.publish = [builderTarget];
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
    try {
        const result = spawnSync("electron-builder", builderArgs, {
            stdio: "inherit",
            shell: true,
            env: { ...process.env, GH_TOKEN: process.env[tokenEnv] },
        });
        exitCode = result.status ?? 1;
    } finally {
        fs.writeFileSync(packageJsonPath, originalPackageJsonText);
    }
    if (exitCode !== 0) {
        console.error(`[release-electron] FATAL: publish to ${target.owner}/${target.repo} failed (exit ${exitCode}).`);
        break;
    }
}

process.exit(exitCode);


