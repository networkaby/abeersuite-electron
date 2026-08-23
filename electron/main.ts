import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

// ── Load environment variables ──────────────────────────────────────────────
// In a packaged Electron app `.env` is not loaded automatically. Each counter PC
// gets its own hand-placed file at %APPDATA%/AbeerSuite/.env — see
// `.env.counter.example` for the required keys.
//
// There is deliberately NO bundled fallback: the installer ships no `.env` at all,
// because the build-machine copy carries production Supabase and payment-gateway
// credentials. If the file is missing we stop with a dialog naming the exact path,
// rather than booting against whatever environment happens to be present.
//
// The forked Next server inherits this process's env (see serverManager.ts), so
// loading it once here is enough to configure the whole app.
if (app.isPackaged) {
    const userEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(userEnv)) {
        dotenv.config({ path: userEnv });
    } else {
        dialog.showErrorBox(
            "AbeerSuite — configuration file missing",
            `AbeerSuite could not find its configuration file:\n\n${userEnv}\n\n` +
            "Ask your administrator to copy '.env.counter.example' to that path and fill " +
            "in this counter's credentials, then start AbeerSuite again.\n\n" +
            "The application cannot run without it."
        );
        app.exit(1);
    }
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const PORT = process.env.PORT || "3000";

let mainWindow: BrowserWindow | null = null;

// ── Single instance ─────────────────────────────────────────────────────────
// A second launch (double-clicked shortcut, or the updater relaunching) would
// otherwise start another Next server and another Postgres attempt against the same
// port and the same pgdata directory. Hand the focus to the running window instead.
if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

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

import { ensurePostgresRunning, stopEmbeddedPostgres } from "./postgresManager";
import { startNextServer, stopNextServer } from "./serverManager";

async function createWindow(baseUrl?: string): Promise<void> {
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
            // The preload only uses contextBridge, ipcRenderer and process.platform, all
            // of which a sandboxed preload still provides — so the renderer gets no
            // reason to run unsandboxed.
            sandbox: true,
        },
    });

    // The POS is a single-window app. Anything that tries to open a popup — an injected
    // script, a stray target="_blank" — is denied rather than given a frameless window
    // with this preload attached.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const root = baseUrl || (process.env.ELECTRON_START_URL ? process.env.ELECTRON_START_URL.replace(/\/staff\/login$/, "") : `http://127.0.0.1:${PORT}`);
    const startUrl = `${root}/staff/login`;

    mainWindow.loadURL(startUrl).catch((err) => {
        console.error("Failed to load start URL:", err);
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

// ── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    try {
        await ensurePostgresRunning();
    } catch (err) {
        console.error("[Main] Error during postgres initialization:", err);
    }

    let baseUrl = `http://127.0.0.1:${PORT}`;
    try {
        baseUrl = await startNextServer(Number(PORT));
    } catch (err) {
        console.error("[Main] Error starting Next.js server:", err);
    }

    await createWindow(baseUrl);
    setupAutoUpdater();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(baseUrl);
        }
    });
});

app.on("will-quit", () => {
    stopNextServer();
    stopEmbeddedPostgres();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
