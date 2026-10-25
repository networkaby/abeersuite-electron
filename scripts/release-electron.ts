/**
 * Publishes an ALREADY-VERIFIED build to every repo listed in .env via
 * GITHUB_UPDATE_REPO_1, GITHUB_UPDATE_REPO_2, ... (each paired with its own
 * GH_TOKEN_1, GH_TOKEN_2, ...).
 *
 * It also ensures:
 * 1. The commit is tagged with `v<version>` matching `package.json`.
 * 2. The commit and tag are pushed to `origin` (`devloperakramul/abeersuite-electron`),
 *    and the tag to every other release repo's remote, before anything is published.
 * 3. Binaries and release notes are attached to the release in both repos.
 */
import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { spawnSync, execSync, execFileSync } from "child_process";

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
    /** Which GITHUB_UPDATE_REPO_N this came from. Slot 2 is the test channel. */
    slot: number;
}

/**
 * A version carrying a prerelease part — `1.3.1-pre.1` — is a test build.
 *
 * Semver's own rule: anything after the first `-`. Nothing here inspects the word
 * itself, so `-pre.1`, `-rc.2` and `-beta` all behave the same way.
 */
const isPrerelease = /-/.test(version);

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
    publishTargets.push({ provider: "github", owner, repo, private: true, releaseType: "release", tokenEnv: `GH_TOKEN_${n}`, slot: n });
}

if (publishTargets.length === 0) {
    console.error("[release-electron] FATAL: no GITHUB_UPDATE_REPO_N vars set in .env (need at least GITHUB_UPDATE_REPO_1 + GH_TOKEN_1).");
    process.exit(1);
}

// ── Test builds go to the test repo, and only there ──────────────────────────
// Slot 1 is what the counters actually update from — GITHUB_DOWNLOAD_UPDATE_REPO
// points at it (electron/updateManager.ts), so anything published there is a real
// release to real tills. Slot 2 is the test channel. A `-pre` version belongs in
// slot 2 alone, marked as a GitHub prerelease so it never shows as "Latest".
//
// This is a gate, not a convenience: RELEASE_ONLY_REPO exists for retrying a repo
// that failed, and the runbook calls it "retry path only, never the normal path".
// Shipping a test build must not depend on someone remembering to set it.
if (isPrerelease) {
    const testChannel = publishTargets.filter(t => t.slot === 2);
    if (testChannel.length === 0) {
        console.error(
            `[release-electron] FATAL: version ${version} is a prerelease, which publishes to the test repo only,\n` +
            "  but no GITHUB_UPDATE_REPO_2 / GH_TOKEN_2 pair is set in .env.\n" +
            "  Either add that pair, or release a version with no \"-\" in it to publish to every repo."
        );
        process.exit(1);
    }
    for (const t of testChannel) t.releaseType = "prerelease";
    publishTargets = testChannel;
    console.log(
        `[release-electron] ${version} is a PRERELEASE — publishing to ${testChannel[0].owner}/${testChannel[0].repo} only, ` +
        "marked as a GitHub prerelease. Counters update from repo 1 and will not see it."
    );
} else {
    console.log(
        `[release-electron] ${version} is a full release — publishing to all ${publishTargets.length} repo(s): ` +
        publishTargets.map(t => `${t.owner}/${t.repo}`).join(", ")
    );
}

// Retry a single target that failed (e.g. a bad token) without re-publishing a
// repo that already succeeded: RELEASE_ONLY_REPO=owner/abeersuite-electron pnpm ...
if (process.env.RELEASE_ONLY_REPO) {
    // Accepts either the bare repo name or the full "owner/repo". The full form is
    // the only one that works when two targets share a repo name - as ours do,
    // akramuljakir/abeersuite-electron and devloperakramul/abeersuite-electron.
    // Matching on the bare name there kept BOTH targets while the log claimed it
    // was publishing to one, so a retry silently re-published the repo that had
    // already succeeded.
    const wanted = process.env.RELEASE_ONLY_REPO;
    const only = publishTargets.filter(t => (wanted.includes("/") ? `${t.owner}/${t.repo}` : t.repo) === wanted);
    if (only.length === 0) {
        console.error(
            `[release-electron] FATAL: RELEASE_ONLY_REPO="${wanted}" matches no target in package.json build.publish.\n` +
            `  Known repos: ${publishTargets.map(t => `${t.owner}/${t.repo}`).join(", ")}`
        );
        process.exit(1);
    }
    if (only.length > 1) {
        console.error(
            `[release-electron] FATAL: RELEASE_ONLY_REPO="${wanted}" matches ${only.length} targets: ` +
            `${only.map(t => `${t.owner}/${t.repo}`).join(", ")}.\n` +
            "  Give the full owner/repo so exactly one is chosen."
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

    // `git push origin HEAD` needs a branch: with a detached HEAD git cannot work out which
    // remote branch is meant and refuses ("You are not currently on a branch"). That threw from
    // inside this try, so the catch below exited 1 and NOTHING was ever published — a local tag
    // and no GitHub release. `publish` releases whatever commit is checked out, tag or detached
    // included, so the branch push is skipped rather than fatal when there is no branch.
    const branch = (() => {
        const r = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf-8" });
        return r.status === 0 ? (r.stdout || "").trim() : "";
    })();

    if (branch) {
        console.log(`[release-electron] Pushing ${branch} and tag ${tagName} to origin...`);
        execSync(`git push origin HEAD --tags`, { stdio: "inherit" });
    } else {
        console.log(
            `[release-electron] Detached HEAD — pushing tag ${tagName} to origin only. ` +
            "No branch is checked out, so no branch is pushed."
        );
        execSync(`git push origin ${tagName}`, { stdio: "inherit" });
    }
} catch (err: unknown) {
    console.error(`[release-electron] Git tag/push failed:`, (err as Error)?.message || err);
    console.error("[release-electron] Please resolve git status or push permissions before releasing.");
    process.exit(1);
}

// 2b. Our annotated tag must already be on every repo we publish to. When GitHub is
// asked for a release whose tag it does not have, it makes its OWN lightweight tag on
// the tip of that repo's default branch. For v1.16.12 that tip was the release commit
// while the build had moved four commits on, so repo 1's tag named a commit that was
// never built — and every release left a lightweight tag there that clashed with
// origin's annotated one (Cursor's "conflicting tag(s)" pull dialog). The repo is
// matched to a git remote by its "owner/repo" in the remote's push URL.
// execFileSync, not execSync: on Windows execSync goes through cmd.exe, which eats
// every `^` — `v1.16.13^{commit}` reached git as `v1.16.13{commit}` and stopped v1.16.13.
const tagCommit = execFileSync("git", ["rev-parse", `${tagName}^{commit}`], { encoding: "utf-8" }).trim();
const remotes = execSync("git remote", { encoding: "utf-8" }).split("\n").map(r => r.trim()).filter(Boolean);
for (const target of publishTargets) {
    const slug = `${target.owner}/${target.repo}`.toLowerCase();
    const remote = remotes.find(r => {
        const url = execSync(`git remote get-url --push ${r}`, { encoding: "utf-8" }).trim().toLowerCase();
        return url.replace(/\.git$/, "").endsWith(slug);
    });
    if (!remote) {
        console.error(
            `[release-electron] FATAL: no git remote points at ${target.owner}/${target.repo}, so ${tagName} cannot be pushed there\n` +
            "  before publishing — GitHub would make its own tag on that repo's default branch instead.\n" +
            `  Add one: git remote add <name> <url of ${target.owner}/${target.repo}>`
        );
        process.exit(1);
    }
    // `^{}` is the commit an annotated tag points at; a lightweight tag has only the plain line.
    const lines = execFileSync("git", ["ls-remote", remote, `refs/tags/${tagName}`, `refs/tags/${tagName}^{}`], { encoding: "utf-8" })
        .split("\n").filter(Boolean).map(l => l.split(/\s+/));
    const remoteCommit = (lines.find(([, ref]) => ref.endsWith("^{}")) ?? lines[0])?.[0];
    if (remoteCommit && remoteCommit !== tagCommit) {
        console.error(
            `[release-electron] FATAL: ${remote} already has ${tagName} on ${remoteCommit.slice(0, 8)}, but this build is ${tagCommit.slice(0, 8)}.\n` +
            "  A version number is never reused for a different build — bump the version and release again."
        );
        process.exit(1);
    }
    console.log(`[release-electron] Pushing tag ${tagName} to ${remote} (${target.owner}/${target.repo})...`);
    // Forced only so a lightweight tag on the SAME commit is replaced by our annotated one.
    execSync(`git push --force ${remote} refs/tags/${tagName}`, { stdio: "inherit" });
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

let exitCode = 0;
for (const target of publishTargets) {
    console.log(`[release-electron] → Publishing to ${target.owner}/${target.repo}...`);
    // `tokenEnv` and `slot` are ours, not electron-builder's — they must not reach
    // package.json's build.publish, which is validated against its own schema.
    const { tokenEnv, slot: _slot, ...builderTarget } = target;
    pkg.build.publish = [builderTarget];
    // releaseNotes goes through package.json rather than a `-c.releaseInfo.releaseNotes=...`
    // CLI arg — with 80+ commits since the last tag, the escaped JSON routinely blows
    // past Windows' ~8KB CreateProcess command-line limit ("The command line is too long").
    if (releaseNotes) {
        pkg.build.releaseInfo = { releaseNotes };
    }
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


