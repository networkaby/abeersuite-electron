/**
 * Unpacking an update BEFORE the counter goes down, instead of during.
 *
 * ── The problem this exists for ──────────────────────────────────────────────
 * An update costs a counter almost nothing to download and a great deal to install, and
 * until now the expensive half happened with the app dead and a splash on the screen.
 * Measured on 2026-09-15, against the real 1.3.5 -> 1.3.6 release:
 *
 *   downloaded (differential)   7.5 MB   app running, nobody waiting
 *   payload inside the exe    169.7 MB
 *   unpacks to                672.7 MB   across 14,840 files
 *   time to unpack               272 s   on a developer machine; longer on a till
 *
 * Every second of that unpack is downtime, and it recurs on every release. The download,
 * which is the part electron-updater optimises hardest, was never the cost.
 *
 * Note what the compression settings cannot do about it: `differentialPackage: true`
 * makes electron-builder pin the payload to `normal` / 1 MB dictionary / non-solid and
 * ignore the `compression` field entirely (app-builder-lib's
 * differentialUpdateInfoBuilder: "do not allow to change compression level"). Both
 * `maximum` and `store` produce a byte-identical 169,736,659-byte payload. There is no
 * setting to turn. The work has to MOVE, not shrink.
 *
 * ── What this does instead ───────────────────────────────────────────────────
 * The moment electron-updater finishes downloading, and while the counter is still
 * billing, the installer is opened here and its payload unpacked into a folder beside
 * the program folder. When the safe moment arrives the app does not run the installer:
 * it hands a small helper the two folder names and quits. The helper renames one folder
 * out and the other in — instant, on the same volume, whatever the size — and starts
 * the app again. Downtime falls from "unpack 672 MB" to "rename twice".
 *
 * The unpack does not get cheaper. It moves to a window where nobody is waiting for it,
 * which was the whole point.
 *
 * ── What it refuses to do ────────────────────────────────────────────────────
 * Every check below fails towards the ordinary installer, never towards a broken till.
 * No 7za, no room on the disk, no write permission beside the program folder, a payload
 * that does not look like our app afterwards — each of those abandons staging and lets
 * electron-updater install the normal way. A counter that cannot take the fast path
 * takes the slow one; it never takes no path.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { writeJsonAtomic } from "./stateFile";
import * as path from "node:path";
import { app } from "electron";

const SWAP_SCRIPT_NAME = "swap-update.ps1";

/**
 * Free space demanded before staging starts.
 *
 * The staged copy is ~670 MB and the old program folder stays where it is until the
 * swap, so the counter genuinely needs that much spare. 1.5 GB is the ~670 MB plus room
 * for the till to keep trading — a disk that fills mid-shift is a worse outcome than a
 * slow update, which is the fallback this refuses into.
 */
const REQUIRED_FREE_BYTES = 1.5 * 1024 * 1024 * 1024;

export interface StagedInfo {
    version: string;
    stagedDir: string;
    completedAt: number;
}

let staging = false;
let staged: StagedInfo | null = null;

/** The folder the running app lives in — the one that gets swapped out. */
function installDir(): string {
    return path.dirname(app.getPath("exe"));
}

/**
 * Staging sits BESIDE the program folder rather than in the updater cache, and that is
 * deliberate: the swap is a rename, and a rename is only instant — only atomic at all —
 * within one volume. A sibling is guaranteed to be on the same volume; %LOCALAPPDATA%
 * is not, on a counter where the app was installed into Program Files on another drive.
 */
function stagedDirFor(version: string): string {
    return path.join(path.dirname(installDir()), `.AbeerSuite-staged-${version}`);
}

function markerFor(version: string): string {
    // Beside the staged folder, not inside it: everything inside becomes the new
    // program folder after the swap, and it should contain only what we shipped.
    return path.join(path.dirname(installDir()), `.AbeerSuite-staged-${version}.json`);
}

function sevenZip(): string | null {
    const exe = path.join(process.resourcesPath, "7za.exe");
    return fs.existsSync(exe) ? exe : null;
}

function rmQuiet(target: string): void {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
        console.warn(`[StagedUpdate] Could not remove ${target}:`, err);
    }
}

function freeBytes(dir: string): number | null {
    try {
        // statfsSync landed in Node 18.15; Electron 43 is well past it. Guarded anyway,
        // because a failure to MEASURE the disk must not be read as a full disk.
        const statfs = (fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number } }).statfsSync;
        if (!statfs) return null;
        const s = statfs(dir);
        return s.bavail * s.bsize;
    } catch {
        return null;
    }
}

/**
 * Runs 7za and waits for it.
 *
 * The counter is SELLING while this runs, so it is dropped to below-normal priority: a
 * 670 MB unpack at normal priority is exactly the kind of background work that makes a
 * till feel broken — a bill that takes three seconds to save is indistinguishable, to a
 * cashier, from an app that has hung. Below normal keeps the unpack off the CPU whenever
 * the app wants it, at the cost of taking longer, and taking longer is free here.
 *
 * The priority is set on the child after spawning rather than by launching it through
 * `cmd /c start /belownormal`. That wrapper was tried first and is wrong twice over: it
 * reports exit code 0 even when the command it ran failed — which would have let a
 * broken unpack be treated as a good one, the single worst outcome this file can produce
 * — and on a quoted path it can drop out of `start` into an interactive shell. Losing the
 * first few milliseconds of the unpack at normal priority is the cheaper problem by far.
 */
function run7za(exe: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
        const child = spawn(exe, args, { windowsHide: true });
        try {
            if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
        } catch (err) {
            // Priority is an optimisation; the unpack is not. Never fail on it.
            console.warn("[StagedUpdate] Could not lower the unpack priority:", err);
        }

        let tail = "";
        const keep = (chunk: Buffer): void => {
            // Bounded: 7za on a bad archive can be chatty, and this only exists for a log line.
            tail = (tail + chunk.toString()).slice(-2000);
        };
        child.stdout?.on("data", keep);
        child.stderr?.on("data", keep);

        child.on("error", (err) => resolve({ ok: false, detail: String(err) }));
        child.on("close", (code) =>
            resolve(code === 0 ? { ok: true, detail: "" } : { ok: false, detail: `7za exited ${code}: ${tail.slice(-400)}` }),
        );
    });
}

/**
 * Does this folder actually look like a program folder we could boot from?
 *
 * The rename is the point of no return, so the check happens before it and not after.
 * These three are enough: the binary the shortcut points at, the asar main reads, and
 * the embedded server the app cannot start without.
 */
function looksLikeOurApp(dir: string): boolean {
    return (
        fs.existsSync(path.join(dir, "AbeerSuite.exe")) &&
        fs.existsSync(path.join(dir, "resources", "app.asar")) &&
        fs.existsSync(path.join(dir, "resources", "standalone"))
    );
}

/**
 * True while the background unpack is still running.
 *
 * The safe-moment loop in updateManager.ts uses this to hold an update back for a
 * minute or two rather than restarting into the slow installer path when the fast one is
 * nearly ready. A deadline always wins over it — an urgent update waits for nothing.
 */
export function isStaging(): boolean {
    return staging;
}

export function getStaged(version: string | null): StagedInfo | null {
    if (!version || !staged || staged.version !== version) return null;
    if (!fs.existsSync(staged.stagedDir) || !looksLikeOurApp(staged.stagedDir)) return null;
    return staged;
}

/**
 * Unpacks the downloaded installer beside the program folder. Returns false whenever the
 * counter should just run the installer the old way — which is not a failure, only a
 * slower update.
 */
export async function stageUpdate(installerPath: string, version: string): Promise<boolean> {
    if (process.platform !== "win32") return false;
    if (staging) return false;
    if (getStaged(version)) return true;

    const exe = sevenZip();
    if (!exe) {
        console.log("[StagedUpdate] No 7za.exe in resources — the installer will unpack this update itself.");
        return false;
    }
    if (!fs.existsSync(installerPath)) {
        console.warn(`[StagedUpdate] Downloaded installer not found at ${installerPath} — leaving it to electron-updater.`);
        return false;
    }

    const dest = stagedDirFor(version);
    const parent = path.dirname(dest);

    // Anything from an older attempt, or an older version, is dead weight on a counter's
    // disk and must not be mistaken for this one.
    cleanupStaging(version);

    const free = freeBytes(parent);
    if (free !== null && free < REQUIRED_FREE_BYTES) {
        console.log(
            `[StagedUpdate] Only ${(free / 1073741824).toFixed(1)} GB free beside the program folder — ` +
                `staging needs ${(REQUIRED_FREE_BYTES / 1073741824).toFixed(1)} GB. ` +
                `The installer will unpack this update itself.`,
        );
        return false;
    }

    staging = true;
    const startedAt = Date.now();
    try {
        try {
            fs.mkdirSync(dest, { recursive: true });
        } catch (err) {
            // Program Files without elevation lands here. Nothing is wrong with the
            // counter; it simply cannot take the fast path.
            console.log("[StagedUpdate] Cannot write beside the program folder — the installer will unpack this update itself.", err);
            return false;
        }

        console.log(`[StagedUpdate] Unpacking ${version} in the background while the counter keeps working.`);

        // The installer is read AS the payload, in one pass.
        //
        // An NSIS installer is a stub wrapped around `$PLUGINSDIR\app-64.7z`, and the
        // obvious route is to lift that file out and then expand it — two passes and an
        // extra 170 MB on the counter's disk. It is also the route that does not work:
        // this 7za is the reduced standalone build and has no NSIS support, so asking it
        // for a file by that name matched nothing and exited 0 — a silent empty unpack.
        //
        // What it does instead is find the 7z signature inside the executable and treat
        // the installer itself as that archive. Verified against the real 1.3.6
        // installer: `Type = 7z`, `Physical Size = 169,736,659` — exactly app-64.7z —
        // and one `x` yields the whole 14,840-file program folder.
        const expand = await run7za(exe, ["x", installerPath, `-o${dest}`, "-y"]);
        if (!expand.ok) {
            console.warn(`[StagedUpdate] Could not unpack the installer — falling back. ${expand.detail}`);
            rmQuiet(dest);
            return false;
        }

        if (!looksLikeOurApp(dest)) {
            console.warn("[StagedUpdate] Unpacked folder does not look like AbeerSuite — falling back, and removing it.");
            rmQuiet(dest);
            return false;
        }

        const info: StagedInfo = { version, stagedDir: dest, completedAt: Date.now() };
        writeJsonAtomic(markerFor(version), info);
        staged = info;
        console.log(
            `[StagedUpdate] ${version} is unpacked and ready (${Math.round((Date.now() - startedAt) / 1000)}s). ` +
                `The restart now only has to rename two folders.`,
        );
        return true;
    } catch (err) {
        console.warn("[StagedUpdate] Staging failed — the installer will unpack this update itself:", err);
        rmQuiet(dest);
        return false;
    } finally {
        staging = false;
    }
}

/**
 * Hands the swap to a detached helper and reports whether it started.
 *
 * It cannot be done in this process: the folder being renamed is the one this executable
 * is running from. The helper waits for this PID to go, does the two renames, and starts
 * the new build. It is copied to the temp folder first for the same reason the update
 * splash is — the folder it would otherwise run from is the folder being moved.
 */
export function beginSwap(version: string): boolean {
    const info = getStaged(version);
    if (!info) return false;

    const source = path.join(process.resourcesPath, SWAP_SCRIPT_NAME);
    if (!fs.existsSync(source)) {
        console.warn("[StagedUpdate] No swap helper in resources — falling back to the installer.");
        return false;
    }

    try {
        const helper = path.join(os.tmpdir(), SWAP_SCRIPT_NAME);
        fs.copyFileSync(source, helper);

        const powershell = path.join(
            process.env.SYSTEMROOT || "C:\\Windows",
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
        );
        const child = spawn(
            powershell,
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                helper,
                "-WaitForPid",
                String(process.pid),
                "-InstallDir",
                installDir(),
                "-StagedDir",
                info.stagedDir,
                "-Version",
                version,
            ],
            { detached: true, stdio: "ignore", windowsHide: true },
        );
        child.unref();
        console.log(`[StagedUpdate] Swap helper started for ${version}; quitting so it can rename the folders.`);
        return true;
    } catch (err) {
        console.warn("[StagedUpdate] Could not start the swap helper — falling back to the installer:", err);
        return false;
    }
}

/**
 * Clears staged folders, markers and any folder left behind by a swap.
 *
 * `keep` is the version being staged right now. Everything else is from an update that
 * has already happened or been abandoned, and on a counter that is 600 MB per copy.
 */
export function cleanupStaging(keep?: string): void {
    const parent = path.dirname(installDir());
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        const name = e.name;
        const isOurs =
            name.startsWith(".AbeerSuite-staged-") ||
            name.startsWith(".AbeerSuite-staging-") ||
            name.startsWith(".AbeerSuite-old-");
        if (!isOurs) continue;
        if (keep && (name === `.AbeerSuite-staged-${keep}` || name === `.AbeerSuite-staged-${keep}.json`)) continue;
        rmQuiet(path.join(parent, name));
    }
}

/**
 * Removes a leftover copy of the app in the other install location ("only me" vs
 * "everyone"). Shortcuts are the setup's job alone: the app used to rewrite one on the
 * user's own Desktop after every update, which sat beside the setup's shared one on an
 * "everyone" install and showed two icons.
 */
function removeOtherInstallLocation(): void {
    try {
        const exe = app.getPath("exe");
        const dir = path.dirname(exe);
        const isPerUser = exe.toLowerCase().includes("appdata\\local");

        if (isPerUser) {
            // Check default machine directories if accessible
            const p64 = path.join(process.env.ProgramFiles || "C:\\Program Files", "AbeerSuite");
            if (fs.existsSync(p64) && p64.toLowerCase() !== dir.toLowerCase()) {
                try {
                    fs.rmSync(p64, { recursive: true, force: true });
                } catch {
                    // requires elevation, best-effort
                }
            }
        } else {
            // Running machine-wide; check per-user directory
            const localApp = process.env.LOCALAPPDATA;
            if (localApp) {
                const userDir = path.join(localApp, "Programs", "AbeerSuite");
                if (fs.existsSync(userDir) && userDir.toLowerCase() !== dir.toLowerCase()) {
                    try {
                        fs.rmSync(userDir, { recursive: true, force: true });
                    } catch {
                        // best-effort
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[StagedUpdate] Could not check the other install location:", err);
    }
}

/**
 * Boot-time tidy-up, called once the new version is up.
 *
 * The helper removes the old folder itself, but it is a detached script racing a PC that
 * may be switched off the moment the app appears. Anything it left is cleared here, on a
 * counter that is demonstrably running fine — which is the safest possible moment.
 */
export function repairAfterSwap(): void {
    if (process.platform !== "win32") return;
    try {
        // Running from a folder that looks right is the only evidence needed: if this
        // process started at all, the swap either completed or never began.
        cleanupStaging();
        staged = null;
        removeOtherInstallLocation();
    } catch (err) {
        console.warn("[StagedUpdate] Post-update tidy-up failed (harmless):", err);
    }
}
