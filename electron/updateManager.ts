/**
 * Auto-update policy for the desktop app.
 *
 * electron-updater does the mechanics (check the feed, download the differential NSIS
 * installer, run it). This module decides WHEN that install may happen, which is the
 * part that matters on a shop floor: a counter PC lives in the tray for weeks, so
 * "install on next quit" alone means "never", and a restart in the middle of a bill is
 * a lost sale.
 *
 * ── Three tiers, decided on the counter ──────────────────────────────────────
 *
 *   quiet   Every ordinary release: a colour fix, a small feature. A small banner offers
 *           "Restart now"; otherwise the install waits for a SAFE moment — an empty cart
 *           and a PC nobody has touched for a while (or the window hidden in the tray,
 *           or the login screen). It is never forced.
 *
 *   urgent  The release notes carry `[urgent]` (first line of RELEASE_NOTES.md, which
 *           electron-builder copies into latest.yml). A blocking prompt with a countdown:
 *           installs the moment the cart is empty and the cashier's hands are off the
 *           keyboard, and at the end of the countdown regardless.
 *
 *   schema  The counter itself has found its replica halted on schema drift (the sync
 *           worker prints a SCHEMA DRIFT line, see syncManager.ts). Billing on a replica
 *           counter is already paused by ReplicaReadyGate, and only a new build clears
 *           it — so this is the shortest countdown of all, and it also triggers a check
 *           at once rather than waiting out the 30-minute timer.
 *
 * "Busy" has two inputs. The renderer reports whether the POS cart holds lines
 * (`update:set-busy`, fed from the POS draft store), and the OS reports how long since
 * the last key or mouse input (`powerMonitor.getSystemIdleTime`) — which covers every
 * other screen without instrumenting each form.
 *
 * ── Feed ────────────────────────────────────────────────────────────────────
 * Production: a private GitHub releases-only repo, `GITHUB_DOWNLOAD_UPDATE_REPO` +
 * `GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN`, both baked into counter.env (see
 * scripts/counterEnv.ts for why a baked read-only token is acceptable there).
 *
 * `UPDATE_FEED_URL` overrides it with a `generic` provider (any HTTPS/HTTP folder that
 * holds latest.yml + the installer). This is how the whole flow is tested without a
 * GitHub release: in dev it also switches the updater on, which electron-updater
 * otherwise refuses outside a packaged app. `UPDATE_DRY_RUN=1` logs the install decision
 * instead of running the installer, so the fake feed never needs a real installer.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { app, BrowserWindow, powerMonitor } from "electron";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
import type { UpdateInfo } from "electron-updater";

export type UpdateTier = "quiet" | "urgent" | "schema";
export type UpdatePhase = "idle" | "checking" | "downloading" | "ready" | "installing" | "error";

/** What the renderer sees. Pushed on every change and available on demand. */
export interface UpdateState {
    phase: UpdatePhase;
    /** The version being fetched or waiting to install; null when there is none. */
    version: string | null;
    tier: UpdateTier;
    /** Download progress, 0–100, while `phase` is "downloading". */
    percent: number | null;
    /** Epoch ms after which an urgent/schema update installs regardless. Null for quiet. */
    deadlineAt: number | null;
    /** Last failure, kept for the tray/log; the UI does not show it. */
    error: string | null;
    /** Where the update comes from, for the log and a support call. */
    feed: string | null;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** First check waits for the login page and the warm-up requests to settle. */
const FIRST_CHECK_DELAY_MS = 20 * 1000;
/** How often a ready update re-asks "is it safe now?". */
const SAFE_POLL_MS = 15 * 1000;

/**
 * How long the PC must have been untouched before a QUIET update may restart it.
 * Long, because nobody asked for this restart: a cashier stepping away for tea
 * must not come back to a login screen. Overridable for testing.
 */
const QUIET_IDLE_SECONDS = Number(process.env.UPDATE_IDLE_SECONDS) || 10 * 60;
/** For urgent/schema tiers: only "hands off the keyboard", not "gone for a while". */
const URGENT_IDLE_SECONDS = Number(process.env.UPDATE_URGENT_IDLE_SECONDS) || 60;

/** Grace before an urgent/schema update installs even while someone is working. */
const GRACE_MS: Record<UpdateTier, number | null> = {
    quiet: null,
    urgent: (Number(process.env.UPDATE_URGENT_GRACE_MINUTES) || 30) * 60 * 1000,
    schema: (Number(process.env.UPDATE_SCHEMA_GRACE_MINUTES) || 5) * 60 * 1000,
};

const DRY_RUN = process.env.UPDATE_DRY_RUN === "1";

const state: UpdateState = {
    phase: "idle",
    version: null,
    tier: "quiet",
    percent: null,
    deadlineAt: null,
    error: null,
    feed: null,
};

let configured = false;
let cartBusy = false;
let schemaDrift = false;
let releaseNotes = "";
let safeTimer: NodeJS.Timeout | null = null;
let checkTimer: NodeJS.Timeout | null = null;
/** The screen the app boots on. Nothing is entered there, so a restart costs nothing. */
let landingPage = "/staff/login";

export function getUpdateState(): UpdateState {
    return { ...state };
}

function broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("update:state", getUpdateState());
    }
}

function patch(next: Partial<UpdateState>): void {
    Object.assign(state, next);
    broadcast();
}

function notesText(info: UpdateInfo): string {
    const n = info.releaseNotes;
    if (!n) return "";
    if (typeof n === "string") return n;
    return n.map((r) => r.note ?? "").join("\n");
}

/**
 * The tier is re-derived whenever either input changes: the notes arrive with the
 * update, drift can be found later (or clear, if the office re-runs a migration).
 */
function currentTier(): UpdateTier {
    if (schemaDrift) return "schema";
    if (/\[urgent\]/i.test(releaseNotes)) return "urgent";
    return "quiet";
}

function applyTier(): void {
    const tier = currentTier();
    if (tier === state.tier && state.deadlineAt !== null) return;
    const grace = GRACE_MS[tier];
    // A deadline only starts counting once the update is actually here to install.
    const deadlineAt = grace !== null && state.phase === "ready" ? Date.now() + grace : null;
    patch({ tier, deadlineAt });
}

/**
 * Called by syncManager when the worker halts on drift (true) or completes a cycle
 * again (false). Drift with no update in hand asks the feed straight away.
 */
export function noteSchemaDrift(drifted: boolean): void {
    if (schemaDrift === drifted) return;
    schemaDrift = drifted;
    if (!configured) return;
    applyTier();
    if (drifted && state.phase !== "ready" && state.phase !== "downloading") {
        console.log("[Updater] Replica halted on schema drift — checking for an update now.");
        void checkNow("schema drift");
    }
}

/** The POS cart's "has lines" flag, from the renderer. */
export function setCartBusy(busy: boolean): void {
    cartBusy = busy;
}

function onSafeScreen(): boolean {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win) return true;
    if (!win.isVisible() || win.isMinimized()) return true;
    try {
        return new URL(win.webContents.getURL()).pathname === landingPage;
    } catch {
        return false;
    }
}

/**
 * Is this a moment where a restart costs nobody anything?
 *
 * Quiet: an empty cart AND (hidden / login screen OR untouched for QUIET_IDLE_SECONDS).
 * Urgent/schema: an empty cart AND hands off for URGENT_IDLE_SECONDS — the countdown
 * on screen has already told the cashier it is coming.
 */
function safeToInstall(): boolean {
    if (cartBusy) return false;
    const idle = powerMonitor.getSystemIdleTime();
    if (state.tier === "quiet") return onSafeScreen() || idle >= QUIET_IDLE_SECONDS;
    return idle >= URGENT_IDLE_SECONDS || onSafeScreen();
}

function stopSafePoll(): void {
    if (safeTimer) clearInterval(safeTimer);
    safeTimer = null;
}

function startSafePoll(): void {
    stopSafePoll();
    safeTimer = setInterval(() => {
        if (state.phase !== "ready") return stopSafePoll();
        const overdue = state.deadlineAt !== null && Date.now() >= state.deadlineAt;
        if (overdue) return install("countdown ended");
        if (safeToInstall()) return install("safe moment");
    }, SAFE_POLL_MS);
}

/**
 * The window a counter sees while the update installs.
 *
 * Between `quitAndInstall` and the new version's first screen the app does not exist:
 * NSIS unpacks ~600 MB and copies it into place with nothing on the display. On a busy
 * till that blank stretch is indistinguishable from a crash, and somebody power-cycles
 * the PC in the middle of an install.
 *
 * The splash cannot be an Electron window — the binary it would run from is the one
 * NSIS is overwriting. It is a 24 KB WinForms executable instead (see
 * scripts/update-splash/), copied to the temp folder first so nothing holds a handle
 * inside the program folder, and started detached so it outlives this process.
 *
 * It closes when SENTINEL_FILE disappears, which the next version does on boot, and
 * gives up after its own timeout. Both matter: a splash left on top of the till would
 * be worse than the blank screen it replaces.
 */
const SENTINEL_FILE = path.join(os.tmpdir(), "abeersuite-update-in-progress.flag");
const SPLASH_EXE_NAME = "AbeerSuiteUpdateSplash.exe";
/** Long enough for a slow counter to unpack, short enough to never look stuck. */
const SPLASH_TIMEOUT_SECONDS = 900;

function showUpdateSplash(version: string | null): void {
    if (process.platform !== "win32") return;
    const source = path.join(process.resourcesPath, SPLASH_EXE_NAME);
    if (!fs.existsSync(source)) {
        // Dev runs and any build made before the splash existed.
        console.log("[Updater] No update splash in resources — installing without one.");
        return;
    }

    try {
        // Copy out of the program folder: that folder is about to be replaced.
        const staged = path.join(os.tmpdir(), SPLASH_EXE_NAME);
        fs.copyFileSync(source, staged);
        fs.writeFileSync(SENTINEL_FILE, String(Date.now()), "utf8");

        const child = spawn(staged, [version ?? "", SENTINEL_FILE, String(SPLASH_TIMEOUT_SECONDS)], {
            detached: true,
            stdio: "ignore",
            windowsHide: false,
        });
        child.unref();
        console.log("[Updater] Update splash started.");
    } catch (err) {
        // A missing splash is cosmetic; a blocked update is not. Never rethrow.
        console.warn("[Updater] Could not start the update splash:", err);
        clearUpdateSplash();
    }
}

/**
 * Tells a splash left over from the update we just came back from that it can go.
 * Called once the new version has a window on screen — see electron/main.ts.
 *
 * Safe to call on every boot: almost always there is no sentinel to remove.
 */
export function clearUpdateSplash(): void {
    try {
        fs.rmSync(SENTINEL_FILE, { force: true });
    } catch (err) {
        console.warn("[Updater] Could not clear the update splash sentinel:", err);
    }
}

/**
 * Runs the downloaded installer silently and relaunches. `isSilent` keeps the NSIS
 * wizard off the screen; `isForceRunAfter` brings the app back — a counter that went
 * down for an update must come back on its own, there may be nobody there to start it.
 *
 * Silent is load-bearing, not a preference: electron-builder only auto-relaunches on
 * the ${Silent} path, and with perMachine:false a visible run would stop on an
 * "install for me / for all users" chooser and again on a Finish button — a counter
 * dead until somebody walks over. The splash above is what fills the screen instead.
 */
export function install(reason: string): void {
    if (state.phase !== "ready") return;
    console.log(`[Updater] Installing ${state.version} (${reason}).`);
    stopSafePoll();
    patch({ phase: "installing" });
    if (DRY_RUN) {
        console.log("[Updater] UPDATE_DRY_RUN=1 — would run the installer now; staying up.");
        return;
    }
    showUpdateSplash(state.version);
    try {
        autoUpdater.quitAndInstall(true, true);
    } catch (err) {
        console.error("[Updater] quitAndInstall failed:", err);
        // The app is staying up after all, so the splash must not.
        clearUpdateSplash();
        patch({ phase: "ready", error: String(err) });
        startSafePoll();
    }
}

export async function checkNow(reason: string): Promise<void> {
    if (!configured) return;
    if (state.phase === "downloading" || state.phase === "ready" || state.phase === "installing") return;
    console.log(`[Updater] Checking for updates (${reason}).`);
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        // Already reported through the "error" event; nothing more to say here.
        void err;
    }
}

/**
 * The provider config electron-updater reads from disk.
 *
 * It is written to a file rather than passed with `setFeedURL()` because the updater
 * reads `updaterCacheDirName` from its on-disk config in the DOWNLOAD path regardless
 * of any feed set in code — and the packaged app ships no `resources/app-update.yml`
 * (package.json has no `publish` block; release-electron.ts injects one per target at
 * publish time, after the tree is packed). With `setFeedURL()` alone the check
 * succeeded and the download then failed with ENOENT on that file. JSON is valid YAML,
 * so the file needs no yaml writer.
 */
type FeedConfig =
    | { provider: "generic"; url: string; updaterCacheDirName: string }
    | { provider: "github"; owner: string; repo: string; private: true; token: string; updaterCacheDirName: string };

const CACHE_DIR_NAME = "abeersuite-electron-updater";

function resolveFeed(): FeedConfig | null {
    const override = (process.env.UPDATE_FEED_URL || "").trim();
    if (override) return { provider: "generic", url: override, updaterCacheDirName: CACHE_DIR_NAME };
    // GITHUB_DOWNLOAD_UPDATE_REPO ("owner/repo") deliberately points at a repo separate
    // from the source — a releases-only repo holds artifacts, no code — so the baked
    // read-only PAT exposes at most what every counter already has on disk. Either
    // missing, or a malformed repo string: skip checks rather than block boot.
    const token = process.env.GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN;
    const [owner, repo] = (process.env.GITHUB_DOWNLOAD_UPDATE_REPO || "").split("/");
    if (!token || !owner || !repo) return null;
    return { provider: "github", owner, repo, private: true, token, updaterCacheDirName: CACHE_DIR_NAME };
}

function feedLabel(feed: FeedConfig): string {
    return feed.provider === "generic" ? `generic ${feed.url}` : `github ${feed.owner}/${feed.repo}`;
}

/** Same home and mode as sync-config.json: per-user, owner-only, never packaged. */
function writeFeedConfig(feed: FeedConfig): string {
    const file = path.join(app.getPath("userData"), "update-config.yml");
    fs.writeFileSync(file, JSON.stringify(feed, null, 2), { encoding: "utf8", mode: 0o600 });
    return file;
}

/**
 * Wires the updater. Safe to call once; a missing feed logs and returns, the app just
 * runs the version it has.
 */
export function setupAutoUpdater(opts: { isDev: boolean; landingPage: string }): void {
    if (configured) return;
    landingPage = opts.landingPage;

    if (opts.isDev && !process.env.UPDATE_FEED_URL) {
        console.log("[Updater] Dev build — set UPDATE_FEED_URL to exercise the updater.");
        return;
    }

    const feed = resolveFeed();
    if (!feed) {
        console.warn("[Updater] GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN or GITHUB_DOWNLOAD_UPDATE_REPO not set — skipping update checks.");
        return;
    }

    try {
        autoUpdater.updateConfigPath = writeFeedConfig(feed);
        if (feed.provider === "generic") autoUpdater.forceDevUpdateConfig = true;
        autoUpdater.autoDownload = true;
        // A clean quit (tray → Quit, or Windows shutting the app down) still installs a
        // downloaded update; the safe-moment loop above is for the quits that never come.
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowDowngrade = false;
        autoUpdater.logger = {
            info: (m: unknown) => console.log(`[Updater] ${String(m)}`),
            warn: (m: unknown) => console.warn(`[Updater] ${String(m)}`),
            error: (m: unknown) => console.error(`[Updater] ${String(m)}`),
            debug: () => {},
        };
        configured = true;
        state.feed = feedLabel(feed);
        console.log(`[Updater] Feed: ${state.feed}${DRY_RUN ? " (dry run)" : ""}.`);

        autoUpdater.on("checking-for-update", () => {
            if (state.phase === "idle" || state.phase === "error") patch({ phase: "checking", error: null });
        });
        autoUpdater.on("update-not-available", () => {
            if (state.phase === "checking") patch({ phase: "idle", version: null, percent: null });
        });
        autoUpdater.on("update-available", (info: UpdateInfo) => {
            releaseNotes = notesText(info);
            patch({ phase: "downloading", version: info.version, percent: 0, deadlineAt: null });
            applyTier();
            console.log(`[Updater] ${info.version} available (${state.tier}) — downloading in the background.`);
        });
        autoUpdater.on("download-progress", (p: { percent: number }) => {
            patch({ percent: Math.round(p.percent) });
        });
        autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
            releaseNotes = notesText(info) || releaseNotes;
            patch({ phase: "ready", version: info.version, percent: 100, deadlineAt: null });
            applyTier();
            console.log(`[Updater] ${info.version} downloaded (${state.tier}) — waiting for a safe moment.`);
            startSafePoll();
        });
        autoUpdater.on("error", (err: Error) => {
            console.warn("[Updater] Error:", err?.message ?? err);
            // A failed re-check must not throw away an update already sitting on disk.
            if (state.phase === "ready" || state.phase === "installing") return;
            patch({ phase: "error", error: err?.message ?? String(err), percent: null });
        });

        setTimeout(() => void checkNow("startup"), FIRST_CHECK_DELAY_MS);
        checkTimer = setInterval(() => void checkNow("interval"), CHECK_INTERVAL_MS);
    } catch (err) {
        console.warn("[Updater] Failed to initialize auto-updater:", err);
    }
}

export function stopAutoUpdater(): void {
    stopSafePoll();
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
}
