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
    platform: process.platform,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
