"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electronAPI = {
    isElectron: true,
    getCounterId: () => electron_1.ipcRenderer.invoke("app:get-counter-id"),
    getPrinters: () => electron_1.ipcRenderer.invoke("printer:get-list"),
    printSilent: (options) => electron_1.ipcRenderer.invoke("printer:print-silent", options),
    windowControl: (action) => electron_1.ipcRenderer.invoke("window:control", action),
    triggerSync: (tableNumber) => electron_1.ipcRenderer.invoke("sync:trigger", tableNumber),
    platform: process.platform,
};
electron_1.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
