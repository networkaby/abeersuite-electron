"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const isDev = process.env.NODE_ENV === "development" || !electron_1.app.isPackaged;
const PORT = process.env.PORT || "3000";
const START_URL = process.env.ELECTRON_START_URL || `http://localhost:${PORT}/staff/login`;
let mainWindow = null;
// ── Persistent Unique Installation ID ──────────────────────────────────────────
function getOrCreateInstallationId() {
    const userDataPath = electron_1.app.getPath("userData");
    const idFilePath = path.join(userDataPath, "counter-installation-id.json");
    try {
        if (fs.existsSync(idFilePath)) {
            const raw = fs.readFileSync(idFilePath, "utf-8");
            const data = JSON.parse(raw);
            if (data?.counterId && typeof data.counterId === "string") {
                return data.counterId;
            }
        }
    }
    catch {
        // Fallback to generating a fresh one below
    }
    const newId = `COUNTER-${crypto.randomUUID()}`;
    try {
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        fs.writeFileSync(idFilePath, JSON.stringify({ counterId: newId, createdAt: new Date().toISOString() }, null, 2));
    }
    catch (err) {
        console.error("Failed to persist counter ID:", err);
    }
    return newId;
}
const counterInstallationId = getOrCreateInstallationId();
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1366,
        height: 860,
        minWidth: 1024,
        minHeight: 700,
        title: "AbeerSuite",
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
    });
    mainWindow.loadURL(START_URL).catch((err) => {
        console.error("Failed to load start URL:", err);
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
// ── IPC Handlers ─────────────────────────────────────────────────────────────
electron_1.ipcMain.handle("app:get-counter-id", () => {
    return counterInstallationId;
});
electron_1.ipcMain.handle("printer:get-list", async (event) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return [];
    try {
        return await win.webContents.getPrintersAsync();
    }
    catch (err) {
        console.error("Error fetching printers:", err);
        return [];
    }
});
electron_1.ipcMain.handle("printer:print-silent", async (event, options) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return false;
    return new Promise((resolve) => {
        win.webContents.print({
            silent: true,
            printBackground: true,
            deviceName: options?.printerName || "",
        }, (success, errorType) => {
            if (!success) {
                console.error("Silent print failed:", errorType);
                resolve(false);
            }
            else {
                resolve(true);
            }
        });
    });
});
electron_1.ipcMain.handle("window:control", (_event, action) => {
    if (!mainWindow)
        return;
    switch (action) {
        case "minimize":
            mainWindow.minimize();
            break;
        case "maximize":
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            }
            else {
                mainWindow.maximize();
            }
            break;
        case "close":
            mainWindow.close();
            break;
        case "toggle-fullscreen":
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
            break;
    }
});
electron_1.ipcMain.handle("sync:trigger", async (_event, tableNumber) => {
    // In dev / production, trigger sync worker delta pull
    return { success: true, tableNumber };
});
// ── App Lifecycle ────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
