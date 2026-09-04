import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState } from "./updateManager";

export type { UpdateState, UpdateTier, UpdatePhase } from "./updateManager";

export interface ElectronAPI {
    isElectron: true;
    getCounterId: () => Promise<string>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean; displayName?: string }>>;
    printSilent: (options?: { printerName?: string }) => Promise<boolean>;
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
    /** Splash-screen progress text pushed from main while Postgres/the server boot. */
    onBootProgress: (callback: (message: string) => void) => void;
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
    printSilent: (options) => ipcRenderer.invoke("printer:print-silent", options),
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
    onBootProgress: (callback) => {
        ipcRenderer.on("app:boot-progress", (_event, message: string) => callback(message));
    },
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
