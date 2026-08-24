import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

// ── Load environment variables ──────────────────────────────────────────────
// In a packaged Electron app `.env` is not loaded automatically. Each counter PC
// gets its own hand-placed file at %APPDATA%/abeersuite-electron/.env — see
// `.env.counter.example` for the required keys. (The folder name comes from
// app.getName(), which reads package.json "name", not the "AbeerSuite" productName.)
//
// There is deliberately NO bundled fallback: the installer ships no `.env` at all,
// because the build-machine copy carries production Supabase and payment-gateway
// credentials. If the file is missing we stop with a dialog naming the exact path,
// rather than booting against whatever environment happens to be present.
//
// The forked Next server inherits this process's env (see serverManager.ts), so
// loading it once here is enough to configure the whole app.

/**
 * Keys the app cannot work without, each with the symptom its absence produces.
 *
 * Inner arrays are alternatives — any one of them satisfies the entry.
 *
 * Why this exists: a half-filled `.env` used to give the worst failure of all. The
 * app started, the login page rendered, and every sign-in was refused with
 * "Invalid email or password" — because the staff domain allowlist fails closed
 * when `INTERNAL_STAFF_EMAIL_DOMAINS` is unset (see
 * src/shared/lib/auth/staffEmailAllowlist.ts), and it is checked before the
 * password is. Nothing in the UI or the server log said which key was missing.
 * Naming it at startup turns a day of guessing into one line of config.
 */
const REQUIRED_ENV: Array<{ keys: string[]; why: string }> = [
    {
        keys: ["DATABASE_URL"],
        why: "no database connection — every page fails",
    },
    {
        keys: ["AUTH_SECRET", "NEXTAUTH_SECRET"],
        why: "sessions cannot be signed, so no one can stay logged in",
    },
    {
        keys: ["INTERNAL_STAFF_EMAIL_DOMAINS", "COMPANY_DOMAIN"],
        why: "staff login refuses every address — the domain allowlist fails closed",
    },
];

/**
 * Example values that are present but worthless, so they count as missing.
 *
 * A copied-verbatim `AUTH_SECRET` is worse than an absent one: it looks configured
 * and it signs real session cookies with a string published in this repository.
 */
const PLACEHOLDER_ENV_VALUES = new Set([
    "replace-me-with-a-generated-secret",
    "your-auth-secret-here",
]);

function findMissingEnv(): string[] {
    const missing: string[] = [];
    for (const entry of REQUIRED_ENV) {
        const satisfied = entry.keys.some((key) => {
            const value = process.env[key]?.trim();
            return !!value && !PLACEHOLDER_ENV_VALUES.has(value);
        });
        if (!satisfied) missing.push(`${entry.keys.join(" or ")} — ${entry.why}`);
    }
    return missing;
}

if (app.isPackaged) {
    const userEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(userEnv)) {
        dotenv.config({ path: userEnv });

        const missing = findMissingEnv();
        if (missing.length > 0) {
            dialog.showErrorBox(
                "AbeerSuite — configuration incomplete",
                `AbeerSuite loaded its configuration file:\n\n${userEnv}\n\n` +
                "but these settings are missing or still hold an example value:\n\n" +
                missing.map((line) => `  • ${line}`).join("\n") +
                "\n\nAdd them to that file (see '.env.counter.example' for the format) " +
                "and start AbeerSuite again.\n\n" +
                "Starting without them would give a working-looking app that no one can log into."
            );
            app.exit(1);
        }
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
