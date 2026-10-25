// ── Auto-start with Windows ─────────────────────────────────────────────────
// The Windows login entry (`--hidden`, waits in the tray) and the preference file
// that says whether it should be there. main.ts calls these at boot and from the
// tray's "Start with Windows" tick box.

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { writeJsonAtomic } from "./stateFile";

export function isAutoStartEnabled(): boolean {
    if (!app.isPackaged) return false;
    try {
        const settings = app.getLoginItemSettings({
            path: process.execPath,
            args: ["--hidden"],
        });
        return settings.openAtLogin;
    } catch (err) {
        console.error("[main] Failed to get login item settings:", err);
        return false;
    }
}

export function setAutoStart(enabled: boolean): void {
    if (!app.isPackaged) return;
    try {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            openAsHidden: true,
            path: process.execPath,
            args: ["--hidden"],
        });
        console.log(`[main] Auto-start on boot set to: ${enabled}`);
    } catch (err) {
        console.error("[main] Failed to set login item settings:", err);
    }
}

// ── Auto-start: the preference lives here, not in Windows ───────────────────
//
// A counter PC has to come back on its own after a power cut or a Windows update
// reboot — nobody walks over to start the till — so the app registers itself with
// `--hidden` and waits in the tray.
//
// Until 2026-09-06 that was a ONE-SHOT: turn it on the first time the app ran,
// write a marker, never look again. So once the Run entry went away — a cleanup
// tool, a Windows profile reset, a reinstall that kept the settings folder — it
// never came back and nothing noticed.
//
// Keeping our own preference file is what makes checking it again safe. Windows
// holds only the consequence; this file holds the intent, which is the one thing
// that tells "the entry was wiped" (put it back) apart from "the owner turned it
// off" (leave it alone).
const AUTOSTART_PREF_FILE = "autostart.json";
/** The pre-2026-09-06 one-shot marker. Its presence means this counter is not a fresh install. */
const AUTOSTART_LEGACY_FILE = "autostart-initialized.json";

function autoStartPrefPath(): string {
    return path.join(app.getPath("userData"), AUTOSTART_PREF_FILE);
}

/** Missing, unreadable or malformed all mean "never answered" — and the answer we want by default is on. */
function readAutoStartPreference(): boolean {
    try {
        const parsed = JSON.parse(fs.readFileSync(autoStartPrefPath(), "utf8")) as { enabled?: unknown };
        return typeof parsed.enabled === "boolean" ? parsed.enabled : true;
    } catch {
        return true;
    }
}

export function writeAutoStartPreference(enabled: boolean): void {
    try {
        writeJsonAtomic(autoStartPrefPath(), { enabled, updated: new Date().toISOString() });
    } catch (err) {
        console.warn("[main] Could not save the auto-start preference:", err);
    }
}

/**
 * Gives this counter a preference file the first time it runs a version that has one.
 *
 * A counter carrying the old marker is NOT seeded with a plain `true`: the one-shot
 * never recorded what the tray tick box was set to, so Windows is the only surviving
 * record of it. Seeding from the live setting means a counter where somebody
 * deliberately turned auto-start off keeps it off instead of having it forced back on
 * by the very check this change adds.
 */
export function initAutoStartPreference(): void {
    if (fs.existsSync(autoStartPrefPath())) return;
    if (fs.existsSync(path.join(app.getPath("userData"), AUTOSTART_LEGACY_FILE))) {
        writeAutoStartPreference(isAutoStartEnabled());
        return;
    }
    writeAutoStartPreference(true);
}

/**
 * Puts the Windows startup entry back when it has gone missing — and only then.
 *
 * Switching the app off in Task Manager -> Startup apps does NOT go through here,
 * because Windows records that veto in a separate key (StartupApproved) and leaves
 * the Run entry alone. `openAtLogin` therefore stays true, this returns early, and a
 * choice made in Windows' own screen is never overruled. (`executableWillLaunchAtLogin`
 * is the field that reports the veto, and nothing here reads it on purpose.)
 */
export function ensureAutoStartMatchesPreference(): void {
    if (!app.isPackaged) return;
    if (!readAutoStartPreference()) return;
    if (isAutoStartEnabled()) return;
    console.log("[main] Auto-start is switched on but Windows has no entry for it — putting it back.");
    setAutoStart(true);
}
