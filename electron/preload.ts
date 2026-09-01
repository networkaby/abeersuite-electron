import { contextBridge, ipcRenderer } from "electron";

export interface ElectronAPI {
    isElectron: true;
    getCounterId: () => Promise<string>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean; displayName?: string }>>;
    printSilent: (options?: { printerName?: string }) => Promise<boolean>;
    windowControl: (action: "minimize" | "maximize" | "close" | "toggle-fullscreen") => Promise<void>;
    onUpdateReady: (callback: () => void) => void;
    /** Splash-screen progress text pushed from main while Postgres/the server boot. */
    onBootProgress: (callback: (message: string) => void) => void;
    applyIdRanges: (blockStart: number) => Promise<boolean>;
    getCounterSetup: () => Promise<{ counterId: number; counterNumber: number } | null>;
    saveCounterSetup: (setup: { counterId: number; counterNumber: number }) => Promise<boolean>;
    clearCounterSetup: () => Promise<boolean>;
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
    onUpdateReady: (callback) => {
        ipcRenderer.on("app:update-ready", () => callback());
    },
    onBootProgress: (callback) => {
        ipcRenderer.on("app:boot-progress", (_event, message: string) => callback(message));
    },
    applyIdRanges: (blockStart: number) => ipcRenderer.invoke("counter:apply-id-ranges", blockStart),
    getCounterSetup: () => ipcRenderer.invoke("counter:get-setup"),
    saveCounterSetup: (setup) => ipcRenderer.invoke("counter:save-setup", setup),
    clearCounterSetup: () => ipcRenderer.invoke("counter:clear-setup"),
    updateWindowStatus: (status) => ipcRenderer.invoke("app:update-window-status", status),
    bridge: {
        send:      (mod, cmd, payload) => { void ipcRenderer.invoke("bridge:send", mod, cmd, payload); },
        request:   (mod, cmd, payload) => ipcRenderer.invoke("bridge:request", mod, cmd, payload),
        connected: () => ipcRenderer.invoke("bridge:connected"),
    },
    platform: process.platform,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
