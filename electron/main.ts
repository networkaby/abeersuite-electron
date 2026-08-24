import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

// ── Load environment variables ──────────────────────────────────────────────
// In a packaged Electron app `.env` is not loaded automatically. Two sources feed it,
// in precedence order:
//
//   1. %APPDATA%/abeersuite-electron/.env — optional, per-machine override
//   2. resources/counter.env              — baked into the installer at build time
//
// (2) is what makes installation unattended. This variant is internal only, so the
// company's own credentials travel inside the installer rather than being copied onto
// each counter by hand. `scripts/counterEnv.ts` fixes exactly which keys go in and
// `scripts/verify-package.ts` fails the build if anything else does — the 0.1.0 build
// shipped the build machine's whole ~60-key `.env`, payment salts included, by accident.
//
// dotenv never overwrites a variable that is already set, so loading (1) first is what
// makes it win: a single counter can be pointed at a test database without a rebuild.
//
// AUTH_SECRET is in neither file — it is generated per machine on first run, see
// `ensureAuthSecret`. (The `%APPDATA%` folder is named from app.getName(), which reads
// package.json "name", not the "AbeerSuite" productName.)
//
// The forked Next server inherits this process's env (see serverManager.ts), so
// loading it once here is enough to configure the whole app.

/**
 * Keys the app cannot work without, each with the symptom its absence produces.
 *
 * Inner arrays are alternatives — any one of them satisfies the entry.
 *
 * Why this exists: a half-filled config used to give the worst failure of all. The app
 * started, the login page rendered, and every sign-in was refused with "Invalid email or
 * password" — because the staff domain allowlist fails closed when
 * `INTERNAL_STAFF_EMAIL_DOMAINS` is unset (see
 * src/shared/lib/auth/staffEmailAllowlist.ts), and it is checked before the password is.
 * Nothing in the UI or the server log said which key was missing.
 *
 * `generate-counter-env.ts` already refuses to build without these, so on a normal
 * installer this check never fires. It stays because it covers what that one cannot: a
 * hand-written per-machine override that shadows a good baked value with a blank or
 * placeholder one.
 *
 * AUTH_SECRET is absent from this list on purpose — `ensureAuthSecret` guarantees it.
 */
const REQUIRED_ENV: Array<{ keys: string[]; why: string }> = [
    {
        keys: ["DATABASE_URL"],
        why: "no database connection — every page fails",
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

/**
 * Name of the baked file, written by `scripts/generate-counter-env.ts`.
 *
 * Repeated rather than imported: this file is compiled by `electron/tsconfig.json`, whose
 * output path assumes `electron/` is the only root. Importing from `scripts/` would emit
 * `dist-electron/electron/main.js` and break the `main` entry in package.json. Change it in
 * `scripts/counterEnv.ts`, here, and in `build.extraResources` — which already spells it
 * out the same way.
 */
const COUNTER_ENV_FILE = "counter.env";

/**
 * Loads the baked configuration, letting a per-machine file override it.
 *
 * Order is the mechanism, not a detail: dotenv skips any variable already present, so the
 * override has to be read first to win.
 */
function loadCounterEnv(): void {
    const userEnv = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(userEnv)) {
        dotenv.config({ path: userEnv });
        console.log(`[main] Applied per-machine override: ${userEnv}`);
    }

    const bakedEnv = path.join(process.resourcesPath, COUNTER_ENV_FILE);
    if (fs.existsSync(bakedEnv)) {
        dotenv.config({ path: bakedEnv });
        return;
    }

    // Only reachable if the installer was built without scripts/generate-counter-env.ts
    // having run, or with the extraResources entry for it removed. `verify-package.ts`
    // fails the build for exactly this, so it should never ship — but if it does, the
    // symptom otherwise arrives as an unexplained "every page fails" on the shop floor.
    dialog.showErrorBox(
        "AbeerSuite — installation incomplete",
        `AbeerSuite could not find its bundled configuration:\n\n${bakedEnv}\n\n` +
        "This installer was built incorrectly — the file is generated during packaging " +
        "and should always be present.\n\n" +
        "Report this to whoever built the installer. As a stop-gap, a configuration file " +
        `placed at\n\n${userEnv}\n\nis loaded instead (see '.env.counter.example').`
    );
    app.exit(1);
}

/**
 * Session signing key, generated once per machine.
 *
 * Neither baked into the installer nor asked of an operator. Every counter runs its own
 * Next server and the window loads http://127.0.0.1:3000, so session cookies never cross
 * machines and there is nothing for counters to share. One random secret per PC is
 * therefore strictly better than a shipped constant at no operational cost: a secret read
 * off one counter forges nothing on another.
 *
 * Stored beside counter-installation-id.json, which survives upgrades, so an update does
 * not sign everybody out. Both names are set because next-auth v5 reads AUTH_SECRET while
 * older call sites still look for NEXTAUTH_SECRET.
 */
function ensureAuthSecret(): void {
    if (process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim()) return;

    const file = path.join(app.getPath("userData"), "auth-secret.json");
    let secret = "";
    try {
        if (fs.existsSync(file)) {
            const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { authSecret?: unknown };
            if (typeof parsed.authSecret === "string" && parsed.authSecret.length >= 32) {
                secret = parsed.authSecret;
            }
        }
    } catch {
        // Corrupt or unreadable — replaced below rather than failing the launch.
    }

    if (!secret) {
        secret = crypto.randomBytes(32).toString("base64");
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify({ authSecret: secret }, null, 2), "utf-8");
            console.log(`[main] Generated this machine's session signing key: ${file}`);
        } catch (err) {
            // Not fatal — the app runs. But a fresh secret on every launch signs everyone
            // out at each restart, which looks like a login bug, so name the real cause.
            console.error(
                `[main] Could not save ${file} — staff will be signed out on every restart:`,
                err
            );
        }
    }

    process.env.AUTH_SECRET = secret;
    process.env.NEXTAUTH_SECRET = secret;
}

if (app.isPackaged) {
    loadCounterEnv();
    ensureAuthSecret();

    const missing = findMissingEnv();
    if (missing.length > 0) {
        const userEnv = path.join(app.getPath("userData"), ".env");
        dialog.showErrorBox(
            "AbeerSuite — configuration incomplete",
            "These settings are missing or still hold an example value:\n\n" +
            missing.map((line) => `  • ${line}`).join("\n") +
            "\n\nAbeerSuite ships its own configuration, so this normally means the file\n\n" +
            `${userEnv}\n\nis overriding it with a blank or placeholder value. Correct or ` +
            "delete that file and start AbeerSuite again.\n\n" +
            "Starting without them would give a working-looking app that no one can log into."
        );
        app.exit(1);
    }
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

/**
 * Each counter serves itself on its own port — 3000 plus its two-digit EPBX extension
 * (e.g. extension "04" -> 3004) — so the same shop LAN can reach any counter's browser
 * directly by port number without a reverse proxy. COUNTER_EPBX_EXT is set per machine
 * in %APPDATA%/abeersuite-electron/.env (see .env.counter.example); it is never baked
 * into the shared counter.env because every counter's value is different.
 */
function resolvePort(): string {
    if (process.env.PORT) return process.env.PORT;
    const ext = (process.env.COUNTER_EPBX_EXT || "").trim();
    if (/^\d{1,2}$/.test(ext)) return String(3000 + Number(ext));
    return "3000";
}
const PORT = resolvePort();

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

        // The releases repo is private, so the app-baked app-update.yml (from
        // build.publish in package.json) has no credentials of its own. GH_UPDATE_TOKEN
        // is a fine-grained PAT scoped to "contents: read" on this repo only — set it
        // per counter the same way as every other credential (see .env.counter.example).
        // No token, no update checks; the app just runs the version it has.
        const updateToken = process.env.GH_UPDATE_TOKEN;
        if (!updateToken) {
            console.warn("[AutoUpdater] GH_UPDATE_TOKEN not set — skipping update checks.");
            return;
        }
        autoUpdater.setFeedURL({
            provider: "github",
            owner: "devloperakramul",
            repo: "abeersuite-electron",
            private: true,
            token: updateToken,
        });

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
