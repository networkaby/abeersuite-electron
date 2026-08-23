import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const PORT = process.env.PORT || "3000";
const START_URL = process.env.ELECTRON_START_URL || `http://localhost:${PORT}/staff/login`;

let mainWindow: BrowserWindow | null = null;

// ── Persistent Unique Installation ID ──────────────────────────────────────────
function getOrCreateInstallationId(): string {
    const userDataPath = app.getPath("userData");
    const idFilePath = path.join(userDataPath, "counter-installation-id.json");

    try {
        if (fs.existsSync(idFilePath)) {
            const raw = fs.readFileSync(idFilePath, "utf-8");
            const data = JSON.parse(raw);
            if (data?.counterId && typeof data.counterId === "string") {
                return data.counterId;
            }
        }
    } catch {
        // Fallback to generating a fresh one below
    }

    const newId = `COUNTER-${crypto.randomUUID()}`;
    try {
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        fs.writeFileSync(idFilePath, JSON.stringify({ counterId: newId, createdAt: new Date().toISOString() }, null, 2));
    } catch (err) {
        console.error("Failed to persist counter ID:", err);
    }
    return newId;
}

const counterInstallationId = getOrCreateInstallationId();

function createWindow(): void {
    mainWindow = new BrowserWindow({
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
ipcMain.handle("app:get-counter-id", () => {
    return counterInstallationId;
});

ipcMain.handle("printer:get-list", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];
    try {
        return await win.webContents.getPrintersAsync();
    } catch (err) {
        console.error("Error fetching printers:", err);
        return [];
    }
});

ipcMain.handle("printer:print-silent", async (event, options?: { printerName?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    return new Promise((resolve) => {
        win.webContents.print(
            {
                silent: true,
                printBackground: true,
                deviceName: options?.printerName || "",
            },
            (success, errorType) => {
                if (!success) {
                    console.error("Silent print failed:", errorType);
                    resolve(false);
                } else {
                    resolve(true);
                }
            }
        );
    });
});

ipcMain.handle("window:control", (_event, action: "minimize" | "maximize" | "close" | "toggle-fullscreen") => {
    if (!mainWindow) return;
    switch (action) {
        case "minimize":
            mainWindow.minimize();
            break;
        case "maximize":
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
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

ipcMain.handle("sync:trigger", async (_event, tableNumber?: number) => {
    // In dev / production, trigger sync worker delta pull
    return { success: true, tableNumber };
});


// ── Auto Updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater(): void {
    if (isDev) return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { autoUpdater } = require("electron-updater");
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on("update-available", () => {
            console.log("[AutoUpdater] Update available. Downloading in background...");
        });

        autoUpdater.on("update-downloaded", () => {
            console.log("[AutoUpdater] Update downloaded. Ready to install.");
            if (mainWindow) {
                mainWindow.webContents.send("app:update-ready");
            }
        });

        autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
            console.warn("[AutoUpdater] Update check failed:", err);
        });

        // Check for updates every 30 minutes in background
        setInterval(() => {
            autoUpdater.checkForUpdatesAndNotify().catch(() => {});
        }, 30 * 60 * 1000);
    } catch (err) {
        console.warn("[AutoUpdater] Failed to initialize auto-updater:", err);
    }
}

// ── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
