import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

// ── File log ─────────────────────────────────────────────────────────────────
// A fresh log per run (not appended) — this exists to answer "why didn't it boot this
// time", not as an audit trail, so it stays small on a counter that runs for weeks.
// A boot failure shows this exact path so it is never just a silent blank window.
export const LOG_FILE = path.join(app.getPath("userData"), "logs", "main.log");
try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const logStream = fs.createWriteStream(LOG_FILE, { flags: "w" });
    const writeLine = (level: string, args: unknown[]) => {
        const msg = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(" ");
        logStream.write(`[${new Date().toISOString()}] [${level}] ${msg}\n`);
    };
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    console.log = (...args: unknown[]) => { origLog(...args); writeLine("INFO", args); };
    console.warn = (...args: unknown[]) => { origWarn(...args); writeLine("WARN", args); };
    console.error = (...args: unknown[]) => { origError(...args); writeLine("ERROR", args); };
} catch (err) {
    console.error("[main] Could not open log file:", err);
}

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
let tray: Tray | null = null;
let isQuitting = false;

const isHiddenLaunch = process.argv.includes("--hidden") || process.argv.includes("--autostart");

/**
 * Returns the path to the app icon file, checking packaged extraResources, dev build dir, and dist.
 */
function getAppIconPath(): string {
    const candidatePaths = [
        path.join(process.resourcesPath, "icon.png"),
        path.join(process.cwd(), "build", "icon.png"),
        path.join(__dirname, "..", "build", "icon.png"),
        path.join(__dirname, "icon.png"),
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    return "";
}

function isAutoStartEnabled(): boolean {
    if (!app.isPackaged) return false;
    try {
        const settings = app.getLoginItemSettings({
            path: process.execPath,
            args: ["--hidden"],
        });
        return settings.openAtLogin;
    } catch (err) {
        console.error("[main] Failed to get login item settings:", err);
        return false;
    }
}

function setAutoStart(enabled: boolean): void {
    if (!app.isPackaged) return;
    try {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            openAsHidden: true,
            path: process.execPath,
            args: ["--hidden"],
        });
        console.log(`[main] Auto-start on boot set to: ${enabled}`);
    } catch (err) {
        console.error("[main] Failed to set login item settings:", err);
    }
}

function showMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createShellWindow(false);
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
}

function createSystemTray(): void {
    if (tray) return;

    const iconPath = getAppIconPath();
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

    tray = new Tray(icon);
    tray.setToolTip(`AbeerSuite POS (Port ${PORT})`);

    const updateContextMenu = () => {
        const autoStart = isAutoStartEnabled();
        const contextMenu = Menu.buildFromTemplate([
            {
                label: "Open AbeerSuite",
                click: () => showMainWindow(),
            },
            {
                label: `Open in Browser (Port ${PORT})`,
                click: () => {
                    shell.openExternal(`http://127.0.0.1:${PORT}`);
                },
            },
            { type: "separator" },
            {
                label: "Start with Windows",
                type: "checkbox",
                checked: autoStart,
                enabled: app.isPackaged,
                click: (menuItem) => {
                    setAutoStart(menuItem.checked);
                    updateContextMenu();
                },
            },
            { type: "separator" },
            {
                label: "Quit AbeerSuite",
                click: () => {
                    isQuitting = true;
                    app.quit();
                },
            },
        ]);
        tray?.setContextMenu(contextMenu);
    };

    updateContextMenu();

    tray.on("click", () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            showMainWindow();
            return;
        }
        if (mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) {
            mainWindow.hide();
        } else {
            showMainWindow();
        }
    });

    tray.on("double-click", () => {
        showMainWindow();
    });
}

// ── Single instance ─────────────────────────────────────────────────────────
// A second launch (double-clicked shortcut, or the updater relaunching) would
// otherwise start another Next server and another Postgres attempt against the same
// port and the same pgdata directory. Hand the focus to the running window instead.
if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

app.on("second-instance", () => {
    showMainWindow();
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

        // GITHUB_UPDATE_REPO ("owner/repo") deliberately points at a repo separate from
        // the source — abeersuite-networkservice-update holds only release artifacts, no
        // code. PAT_TOKEN (a fine-grained PAT, "Contents: Read-only", scoped to only that
        // repo) is baked into every installer via counter.env, so a leaked installer
        // exposes at most the artifacts every counter already has on disk, never the
        // private codebase. Either missing, or a malformed repo string — skip update
        // checks rather than block boot; the app just runs the version it has.
        const updateToken = process.env.PAT_TOKEN;
        const [updateOwner, updateRepo] = (process.env.GITHUB_UPDATE_REPO || "").split("/");
        if (!updateToken || !updateOwner || !updateRepo) {
            console.warn("[AutoUpdater] PAT_TOKEN or GITHUB_UPDATE_REPO not set — skipping update checks.");
            return;
        }
        autoUpdater.setFeedURL({
            provider: "github",
            owner: updateOwner,
            repo: updateRepo,
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
import { startNextServer, stopNextServer, type ServerStartResult } from "./serverManager";

// ── Splash / cold-start / boot-failure screens ───────────────────────────────
// All three are self-authored data: URLs, not files under resources/ — nothing here is
// remote or user-controlled, so there is no template injection surface. This avoids
// needing a new build step just to copy static assets into dist-electron.
const SPLASH_BG = "#0f172a";

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function splashHtml(): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>AbeerSuite</title>
<style>
  html,body{height:100%;margin:0;background:${SPLASH_BG};color:#e2e8f0;
    font-family:"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .box{text-align:center}
  h1{font-size:20px;font-weight:600;margin:0 0 12px}
  p{font-size:13px;color:#94a3b8;margin:0}
  .spin{width:28px;height:28px;margin:0 auto 16px;border:3px solid #334155;border-top-color:#38bdf8;
    border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head>
<body><div class="box"><div class="spin"></div><h1>AbeerSuite</h1><p id="msg">Starting…</p></div>
<script>
  if (window.electronAPI && window.electronAPI.onBootProgress) {
    window.electronAPI.onBootProgress(function (message) {
      var el = document.getElementById("msg");
      if (el) el.textContent = message;
    });
  }
</script></body></html>`;
}

function bootErrorHtml(triedUrl: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>AbeerSuite — could not start</title>
<style>
  html,body{height:100%;margin:0;background:${SPLASH_BG};color:#e2e8f0;
    font-family:"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .box{max-width:520px;text-align:center;padding:24px}
  h1{font-size:18px;margin:0 0 12px;color:#f87171}
  p{font-size:13px;color:#94a3b8;line-height:1.6;margin:0 0 8px}
  code{background:#1e293b;padding:2px 6px;border-radius:4px;font-size:12px;word-break:break-all}
</style></head>
<body><div class="box">
  <h1>AbeerSuite could not start</h1>
  <p>The local server did not respond at <code>${escapeHtml(triedUrl)}</code>.</p>
  <p>Log file: <code>${escapeHtml(LOG_FILE)}</code></p>
  <p>Close this window and try again. If it keeps happening, send the log file above.</p>
</div></body></html>`;
}

function sendBootProgress(message: string): void {
    console.log(`[Boot] ${message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app:boot-progress", message);
    }
}

/**
 * Creates the single app window and shows the local splash immediately — the OS paints
 * this window's `backgroundColor` behind it, so there is never a blank white frame while
 * Postgres and the server are still starting.
 */
function createShellWindow(initiallyHidden = false): BrowserWindow {
    const win = new BrowserWindow({
        width: 1366,
        height: 860,
        minWidth: 1024,
        minHeight: 700,
        title: "AbeerSuite",
        autoHideMenuBar: true,
        show: false,
        backgroundColor: SPLASH_BG,
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
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (!initiallyHidden) {
        win.once("ready-to-show", () => win.show());
    }
    win.on("close", (event) => {
        if (!isQuitting) {
            event.preventDefault();
            win.hide();
        }
    });
    win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
    win.loadURL(dataUrl(splashHtml())).catch((err) => {
        // ERR_ABORTED here is the routine case: loadApp() below already navigated on to
        // the real page before this promise settled. That is a race won, not a failure.
        if (err?.code !== "ERR_ABORTED") console.error("[Boot] Failed to load splash:", err);
    });

    return win;
}

async function loadApp(baseUrl: string): Promise<void> {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const startUrl = `${baseUrl}/staff/login`;
    const attempts = 10;
    for (let i = 1; i <= attempts; i++) {
        try {
            console.log(`[Boot] Navigating to ${startUrl} (attempt ${i}/${attempts})...`);
            await mainWindow.loadURL(startUrl);
            return;
        } catch (err) {
            console.warn(`[Boot] loadURL attempt ${i}/${attempts} failed:`, err);
            if (i === attempts) {
                console.error("[Boot] Giving up after repeated load failures.");
                showBootError(startUrl);
                return;
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
}

function showBootError(triedUrl: string): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(dataUrl(bootErrorHtml(triedUrl))).catch((err) => {
        console.error("[Boot] Failed to load the error page itself:", err);
    });
}

// ── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    createSystemTray();

    if (app.isPackaged) {
        const autostartFile = path.join(app.getPath("userData"), "autostart-initialized.json");
        if (!fs.existsSync(autostartFile)) {
            try {
                setAutoStart(true);
                fs.writeFileSync(autostartFile, JSON.stringify({ initialized: true, date: new Date().toISOString() }));
            } catch (err) {
                console.warn("[main] Could not save autostart-initialized.json:", err);
            }
        }
    }

    mainWindow = createShellWindow(isHiddenLaunch);

    sendBootProgress("Starting database…");
    try {
        const localDbUrl = await ensurePostgresRunning();
        if (localDbUrl) {
            // Read-routing (prismaClient.ts / counterMode.ts) gates on COUNTER_PC, not on
            // LOCAL_DATABASE_URL's mere presence — set it here, from the actual detection
            // result, rather than requiring it baked into the installer. serverManager.ts
            // forks the Next server with `env: {...process.env}`, so this is inherited.
            process.env.COUNTER_PC = "1";
        }
    } catch (err) {
        console.error("[Main] Error during postgres initialization:", err);
    }

    sendBootProgress("Starting server…");
    let result: ServerStartResult = { url: `http://127.0.0.1:${PORT}`, ready: false };
    try {
        result = await startNextServer(Number(PORT));
    } catch (err) {
        console.error("[Main] Error starting Next.js server:", err);
    }

    if (result.ready) {
        sendBootProgress("Almost there…");
        await loadApp(result.url);
    } else {
        if (!isHiddenLaunch) {
            showBootError(result.url);
        }
    }

    setupAutoUpdater();

    app.on("activate", () => {
        showMainWindow();
    });
});

app.on("before-quit", () => {
    isQuitting = true;
});

app.on("will-quit", () => {
    stopNextServer();
    stopEmbeddedPostgres();
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        tray = null;
    }
});

app.on("window-all-closed", () => {
    if (isQuitting || process.platform === "darwin") {
        if (process.platform !== "darwin") {
            app.quit();
        }
    }
});
