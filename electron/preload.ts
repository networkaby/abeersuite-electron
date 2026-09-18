import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState } from "./updateManager";
import type { RestoreReadiness, RunResult } from "./backupManager";

export type { UpdateState, UpdateTier, UpdatePhase } from "./updateManager";
export type { BackupAvailability, RestoreReadiness, RunResult } from "./backupManager";

export interface DisplaySetting {
    mode: "auto" | "fixed";
    /** The zoom factor actually in force, e.g. 0.8 for 80%. */
    applied: number;
    /** Only present on `get` — the choices the Settings page should offer. */
    steps?: number[];
}

/** One face on the sign-in screen. Mirrors the roster entry in electron/main.ts. */
export interface ShellRosterEntry {
    email: string;
    name: string;
    title?: string;
    /** Every Position held, senior first — mirrors shared/lib/counter/shellRoster.ts. */
    seats?: { title: string; scope: string }[];
    avatarUrl?: string;
    /** A `file://` URL when it comes FROM main; left off when handing an entry TO it. */
    avatarFile?: string;
    hasPin: boolean;
    lastLoginAt?: string;
}

export interface ElectronAPI {
    isElectron: true;
    getCounterId: () => Promise<string>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean; displayName?: string }>>;
    windowControl: (action: "minimize" | "maximize" | "close" | "toggle-fullscreen") => Promise<void>;
    /**
     * Native folder picker. Opens at `defaultPath`, or at this PC's Pictures folder
     * when none is given. Resolves null if the user cancels.
     */
    selectFolder: (defaultPath?: string) => Promise<string | null>;
    /**
     * Auto-update, see electron/updateManager.ts. `onState` pushes every change; `getState`
     * is for a component that mounts after the update was already found. `setBusy` is the
     * POS cart's "has lines" flag — main never restarts the app while it is true.
     */
    update: {
        getState: () => Promise<UpdateState>;
        onState: (callback: (state: UpdateState) => void) => () => void;
        installNow: () => Promise<void>;
        checkNow: () => Promise<void>;
        setBusy: (busy: boolean) => Promise<void>;
    };
    /**
     * Backup and restore between Supabase and a file on this PC, run by the bundled
     * pg_dump/pg_restore (electron/backupManager.ts). The database URL stays in main —
     * the renderer only ever sees "can this machine do it", a progress line, and the
     * result. Both calls open a native file dialog, so nothing runs unattended; a
     * cancelled dialog comes back as `{ ok: false }` with no `error`.
     */
    backup: {
        availability: () => Promise<RestoreReadiness>;
        dumpToDisk: () => Promise<RunResult>;
        restoreFromDisk: (confirm: string) => Promise<RunResult>;
        /** Every pg_dump/pg_restore progress line. Returns an unsubscribe function. */
        onProgress: (callback: (line: string) => void) => () => void;
    };
    /**
     * How big the app draws itself on THIS counter, see electron/displayPreference.ts.
     *
     * `applied` is the factor in force right now — under "auto" it is whatever this
     * counter's screen width resolved to, which is the number the Settings page shows
     * beside the Automatic option. `steps` is the list of factors Settings offers, kept
     * in main so the two can never drift apart.
     */
    display: {
        get: () => Promise<DisplaySetting>;
        set: (mode: "auto" | "fixed", factor?: number) => Promise<DisplaySetting>;
    };
    /** Boot progress text pushed from main while Postgres/the server boot. */
    onBootProgress: (callback: (message: string) => void) => void;
    /**
     * The counter's own sign-in screen — `resources/shell/login.html`, loaded off disk
     * before the Next server exists so the cashier can type through the boot rather
     * than watch a spinner. See that file's header for why it is plain HTML.
     *
     * `onServerReady` is what un-disables its button; main fires it once the server
     * answers HTTP. `shellSignIn` hands the typed credentials to main, which parks them
     * and navigates to the real `/staff/login` — that page then collects them with
     * `takeShellCredentials` and submits them itself.
     *
     * The credentials deliberately do NOT get signed in by main: `/staff/login` also
     * reconciles this PC's counter binding, and enforces the "login outside counter"
     * permission (src/app/staff/login/page.tsx). Signing in behind its back would skip
     * all of it. So the shell saves the typing, and the real page still does the work.
     */
    onServerReady: (callback: () => void) => void;
    shellSignIn: (credentials: { email: string; password: string; setPin?: boolean }) => Promise<{ ok: boolean; error?: string }>;
    /** Read-once: returns the parked credentials and clears them in main. Exactly one
     *  of `password` / `pin` is set — `/staff/login` picks its provider from that. */
    takeShellCredentials: () => Promise<{ email: string; password?: string; pin?: string; setPin?: boolean } | null>;
    /** Same handoff as `shellSignIn`, with six digits instead of a password. */
    shellSignInPin: (credentials: { email: string; pin: string }) => Promise<{ ok: boolean; error?: string }>;
    /**
     * The faces on the sign-in screen: who has signed in on THIS PC.
     *
     * A local convenience cache, never an authority. It decides whose photograph is
     * offered to tap, never who may sign in — every card still goes through the same
     * server-side check. `forgetShellUser` likewise forgets a face on this PC only: it
     * does not touch the account or the PIN, which are signed-in actions on the server.
     */
    shellRoster: () => Promise<ShellRosterEntry[]>;
    rememberShellUser: (who: ShellRosterEntry) => Promise<boolean>;
    forgetShellUser: (email: string) => Promise<boolean>;
    /** "none" | "ready" | "password-due", or null when it cannot be answered. Goes
     *  through main because the shell is a file:// page and cannot fetch the server. */
    shellPinStatus: (email: string) => Promise<string | null>;
    /** Keeps a copy of a background the shell fetched, so tomorrow needs no network. */
    cacheLoginBackground: (url: string) => void;
    /**
     * Fired after the sync worker has COMMITTED pulled rows into the local replica.
     *
     * Screens are served from that replica, and they used to re-read it in parallel with
     * the worker on the same Realtime signal — the worker has to spawn a process and scan
     * 113 tables, so the screen normally won that race and re-read the OLD data. This is the
     * only event in the system that means "what you would read is now actually there".
     * Silent when a cycle pulled nothing.
     */
    onSyncApplied: (callback: (info: { rows: number; models: string[] }) => void) => void;
    applyIdRanges: (blockStart: number) => Promise<boolean>;
    getCounterSetup: () => Promise<{ counterId: number; counterNumber: number } | null>;
    saveCounterSetup: (setup: { counterId: number; counterNumber: number }) => Promise<boolean>;
    clearCounterSetup: () => Promise<boolean>;
    /**
     * Starts the sync worker before `counter-setup.json` exists. Onboarding binds the
     * counter in the DB, fills the replica, and only THEN writes the file — so the
     * worker has to be startable from the wizard, not only from the boot gate.
     */
    startSync: () => Promise<boolean>;
    updateWindowStatus: (status: { sync: string; connection: string }) => Promise<void>;
    /**
     * Shop hardware: the DQ11 customer display (hardware-bridge/qr.js) and the thermal
     * printer (thermal.js). `send` is fire-and-forget — the eight QR screens are
     * best-effort and must never surface a failure to the cashier. `request` is for
     * everything that needs a real answer, which is all of printing.
     */
    bridge: {
        send:      (mod: "qr" | "thermal", cmd: string, payload?: unknown) => void;
        request:   (mod: "qr" | "thermal", cmd: string, payload?: unknown) => Promise<unknown>;
        connected: () => Promise<boolean>;
    };
    platform: string;
}

const electronAPI: ElectronAPI = {
    isElectron: true,
    getCounterId: () => ipcRenderer.invoke("app:get-counter-id"),
    getPrinters: () => ipcRenderer.invoke("printer:get-list"),
    windowControl: (action) => ipcRenderer.invoke("window:control", action),
    selectFolder: (defaultPath) => ipcRenderer.invoke("dialog:select-folder", defaultPath),
    update: {
        getState: () => ipcRenderer.invoke("update:get-state"),
        onState: (callback) => {
            const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
            ipcRenderer.on("update:state", handler);
            return () => ipcRenderer.removeListener("update:state", handler);
        },
        installNow: () => ipcRenderer.invoke("update:install-now"),
        checkNow: () => ipcRenderer.invoke("update:check-now"),
        setBusy: (busy) => ipcRenderer.invoke("update:set-busy", busy),
    },
    backup: {
        availability: () => ipcRenderer.invoke("backup:availability"),
        dumpToDisk: () => ipcRenderer.invoke("backup:dump-to-disk"),
        restoreFromDisk: (confirm) => ipcRenderer.invoke("backup:restore-from-disk", confirm),
        onProgress: (callback) => {
            const handler = (_event: Electron.IpcRendererEvent, line: string) => callback(line);
            ipcRenderer.on("backup:progress", handler);
            return () => ipcRenderer.removeListener("backup:progress", handler);
        },
    },
    display: {
        get: () => ipcRenderer.invoke("display:get"),
        set: (mode, factor) => ipcRenderer.invoke("display:set", mode, factor),
    },
    onBootProgress: (callback) => {
        ipcRenderer.on("app:boot-progress", (_event, message: string) => callback(message));
    },
    onServerReady: (callback) => {
        ipcRenderer.on("app:server-ready", () => callback());
    },
    shellSignIn: (credentials) => ipcRenderer.invoke("shell:sign-in", credentials),
    takeShellCredentials: () => ipcRenderer.invoke("shell:take-credentials"),
    shellSignInPin: (credentials) => ipcRenderer.invoke("shell:sign-in-pin", credentials),
    shellRoster: () => ipcRenderer.invoke("shell:roster"),
    rememberShellUser: (who) => ipcRenderer.invoke("shell:remember-user", who),
    forgetShellUser: (email) => ipcRenderer.invoke("shell:forget-user", email),
    shellPinStatus: (email) => ipcRenderer.invoke("shell:pin-status", email),
    cacheLoginBackground: (url) => { void ipcRenderer.invoke("shell:cache-background", url); },
    onSyncApplied: (callback) => {
        ipcRenderer.on("sync:applied", (_event, info: { rows: number; models: string[] }) => callback(info));
    },
    applyIdRanges: (blockStart: number) => ipcRenderer.invoke("counter:apply-id-ranges", blockStart),
    getCounterSetup: () => ipcRenderer.invoke("counter:get-setup"),
    saveCounterSetup: (setup) => ipcRenderer.invoke("counter:save-setup", setup),
    clearCounterSetup: () => ipcRenderer.invoke("counter:clear-setup"),
    startSync: () => ipcRenderer.invoke("counter:start-sync"),
    updateWindowStatus: (status) => ipcRenderer.invoke("app:update-window-status", status),
    bridge: {
        send:      (mod, cmd, payload) => { void ipcRenderer.invoke("bridge:send", mod, cmd, payload); },
        request:   (mod, cmd, payload) => ipcRenderer.invoke("bridge:request", mod, cmd, payload),
        connected: () => ipcRenderer.invoke("bridge:connected"),
    },
    platform: process.platform,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
