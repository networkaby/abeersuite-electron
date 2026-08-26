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
 * Minimal, deliberately duplicated copy of the mode/landing-page contract from
 * `src/shared/lib/appModeCore.ts`. Not imported for the same reason `COUNTER_ENV_FILE`
 * above is repeated rather than imported: this file is compiled by
 * `electron/tsconfig.json`, rooted at `electron/`, and an import reaching outside that
 * root would change the emitted output path and break the `main` entry in package.json.
 * Keep this block, appModeCore.ts, and generate-counter-env.ts's copy of the same idea
 * in sync by hand if the mode contract changes.
 */
const KNOWN_APP_MODES = new Set(["full", "public", "office", "counter"]);
function currentAppMode(): string {
    const raw = (process.env.APP_MODE || "").trim();
    return raw && KNOWN_APP_MODES.has(raw) ? raw : "full";
}
const APP_MODE = currentAppMode();

/** Same-origin-only check — LANDING_PAGE is fed straight to loadURL below, so an
 *  unvalidated value from a bad .env could point the window at an external site. */
function isSafeLandingPage(value: string): boolean {
    return value.startsWith("/") && !value.startsWith("//");
}
function resolveLandingPage(): string {
    const raw = (process.env.LANDING_PAGE || "").trim();
    return raw && isSafeLandingPage(raw) ? raw : "/staff/login";
}
const LANDING_PAGE = resolveLandingPage();

/**
 * Every counter binds the same fixed port — deliberately NOT derived per machine.
 *
 * A counter is its own physical PC with its own IP, so the LAN client reaching it as
 * `http://<counter-ip>:786` is disambiguated by the IP, not the port; two counters on
 * the same shop wifi never collide because they are two different machines. (This
 * replaces an earlier per-counter `3000 + EPBX extension` scheme — dropped because it
 * assumed a 1–2 digit extension, and real EPBX extensions here are not: only stops
 * working if two counter installs ever need to share one machine/IP, which does not
 * happen — one install per PC.)
 *
 * `PORT` remains a per-machine override escape hatch (%APPDATA%/abeersuite-electron/.env,
 * see .env.counter.example) for the rare case a fixed port collides with something else
 * already running on that PC.
 */
const FIXED_PORT = "786";
function resolvePort(): string {
    return process.env.PORT || FIXED_PORT;
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

// Acts on the window that actually sent the request, the same way the printer handlers
// above do. Resolving to `mainWindow` instead would mean a titlebar button in any
// secondary window minimised or closed the main one.
ipcMain.handle("window:control", (event, action: "minimize" | "maximize" | "close" | "toggle-fullscreen") => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    switch (action) {
        case "minimize":
            win.minimize();
            break;
        case "maximize":
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
            break;
        case "close":
            win.close();
            break;
        case "toggle-fullscreen":
            win.setFullScreen(!win.isFullScreen());
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
import { startNextServer, stopNextServer, warmRoutes, type ServerStartResult } from "./serverManager";

// ── Route warming ─────────────────────────────────────────────────────────────
// See serverManager.ts's warmRoutes() for why this exists: preloadEntriesOnStart
// is off, so route entries compile on first hit. These are the routes to hit
// pre-emptively, in the idle seconds between the login page loading and staff
// actually signing in.
//
// A small fixed seed (the areas asked for: POS, office, the day book report) plus
// whatever this specific counter has actually opened before, learned at runtime —
// a manager's PC and a till open different modules, and this adapts to each
// without a config file per machine.
//
// Mode-derived: a `counter` build never ships /office or the day-book report (see
// COUNTER_OFFICE_MODULE_STRIP in appModeCore.ts), so warming them would spend the
// cold start on 404s instead of a real page.
const DEFAULT_WARM_ROUTES =
    APP_MODE === "counter"
        ? ["/office/pos", "/vouchers/pos"]
        : ["/office/pos", "/vouchers/pos", "/office", "/office/accountancy/reports/day-book"];
const WARM_ROUTES_MAX = 40;
const visitedRoutes = new Set<string>();

function warmRoutesFilePath(): string {
    return path.join(app.getPath("userData"), "warm-routes.json");
}

/**
 * Is this something we can safely append to the server's origin and GET?
 *
 * The leading-slash test is the load-bearing part, and it exists because of a real
 * crash: the splash and boot-error screens are `data:text/html,...` URLs, and
 * `new URL()` parses those perfectly happily — `data:` is a valid scheme, so the
 * try/catch that was meant to reject them never fired. Their "pathname"
 * (`text/html;charset=utf-8,%3C!doctype...`) got recorded, persisted to
 * warm-routes.json, and on the NEXT launch was concatenated onto the origin into
 * `http://127.0.0.1:786text/html;...` — an invalid URL, thrown from inside
 * warmRoutes, which took the whole main process down with "A JavaScript error
 * occurred in the main process".
 */
function isWarmablePath(pathname: string): boolean {
    // A real route path always starts with exactly one "/". "//host" would be
    // protocol-relative and resolve off-origin, so it is rejected too.
    if (!pathname.startsWith("/") || pathname.startsWith("//")) return false;
    // /api/* and the landing page itself add no value to pre-warm: the landing page is
    // already the first thing loaded, and API routes are hit incidentally by every
    // page so warming them separately is redundant.
    if (pathname === "/" || pathname.startsWith("/api/") || pathname === LANDING_PAGE) return false;
    return true;
}

function recordVisitedRoute(rawUrl: string): void {
    try {
        const parsed = new URL(rawUrl);
        // Scheme check first: only pages actually served by our own Next server are
        // worth warming. data:/about:/file: all parse fine, so they must be excluded
        // explicitly rather than relied on to throw.
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        if (isWarmablePath(parsed.pathname)) {
            visitedRoutes.add(parsed.pathname);
        }
    } catch {
        // Genuinely unparseable — ignore.
    }
}

function persistVisitedRoutes(): void {
    if (visitedRoutes.size === 0) return;
    try {
        const routes = Array.from(visitedRoutes).slice(-WARM_ROUTES_MAX);
        fs.writeFileSync(warmRoutesFilePath(), JSON.stringify({ routes, updatedAt: new Date().toISOString() }));
    } catch (err) {
        console.warn("[main] Could not persist warm-routes.json:", err);
    }
}

function loadPersistedWarmRoutes(): string[] {
    try {
        const parsed = JSON.parse(fs.readFileSync(warmRoutesFilePath(), "utf-8")) as { routes?: unknown };
        if (Array.isArray(parsed.routes)) {
            // Re-validated on the way IN, not just on the way out: machines that ran an
            // earlier build already have a poisoned warm-routes.json on disk (see
            // isWarmablePath), and it must not be trusted just because we wrote it.
            return parsed.routes.filter((r): r is string => typeof r === "string" && isWarmablePath(r));
        }
    } catch {
        // No file yet on first run, or it's unreadable — fall through to the seed list.
    }
    return [];
}

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

// ── Window-open policy ──────────────────────────────────────────────────────
// This app is multi-tab by design on the web: the 21 entries in
// AllCreateActionsDialog, ButtonBar, Sidebar, every receipt/print page and the
// repairing auto-advance `openTabs` all reach for window.open(url, "_blank").
// A blanket deny here (what shipped before) made every one of those clicks do
// nothing — that was the "POS does not open" symptom, not a boot failure.
//
// The original concern behind the deny was real and is still enforced: a popup
// must never get a foreign origin loaded with this preload attached. So the
// split is by origin, not by allow/deny wholesale — our own pages open as real
// windows, everything else is handed to the user's browser.
const APP_ORIGIN = `http://127.0.0.1:${PORT}`;
// Version in the title so a support call can immediately tell which build someone is
// running, without digging through Settings — plain native window chrome, not a
// web-app-style title bar.
const APP_TITLE = `AbeerSuite ${app.getVersion()}`;

// Resolved against APP_ORIGIN as base, so a relative target ("/vouchers/pos/help" — the
// form most callers in the app use) is correctly judged same-origin. An absolute URL
// ignores the base, so external links are still classified on their own origin.
function classifyTarget(rawUrl: string): { internal: boolean; href: string; protocol: string } | null {
    try {
        const u = new URL(rawUrl, APP_ORIGIN);
        return { internal: u.origin === APP_ORIGIN, href: u.href, protocol: u.protocol };
    } catch {
        return null;
    }
}

/**
 * Applies the origin split to `win`, and to any window `win` itself opens — a receipt
 * window that opens a further link must not fall back to Electron's permissive default.
 */
function attachWindowOpenPolicy(win: BrowserWindow): void {
    // Electron syncs the window title to document.title on every navigation by default —
    // the splash page, the boot-error page, and every real app page each carry their own
    // <title>, which would silently overwrite the version-stamped title set at
    // construction the instant any of them loads. Pin it here instead.
    win.on("page-title-updated", (event) => event.preventDefault());

    win.webContents.setWindowOpenHandler(({ url }) => {
        const target = classifyTarget(url);
        if (!target) return { action: "deny" };

        if (target.internal) {
            return {
                action: "allow",
                // Inherit the parent's hardening explicitly rather than trusting the
                // defaults a child window would otherwise be created with.
                overrideBrowserWindowOptions: {
                    width: 1280,
                    height: 820,
                    minWidth: 900,
                    minHeight: 600,
                    title: APP_TITLE,
                    autoHideMenuBar: true,
                    backgroundColor: SPLASH_BG,
                    webPreferences: {
                        preload: path.join(__dirname, "preload.js"),
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true,
                    },
                },
            };
        }

        // WhatsApp share links and courier tracking URLs were dead too. Send them to the
        // real browser. Restricted to http/https so nothing hands the OS shell an
        // arbitrary protocol handler.
        if (target.protocol === "http:" || target.protocol === "https:") {
            shell.openExternal(target.href);
        }
        return { action: "deny" };
    });

    win.webContents.on("did-create-window", (child) => {
        // Child windows are ordinary windows: closing one closes it. Only the tray-backed
        // main window gets the hide-on-close treatment, so a closed report window is not
        // left invisible in memory with nothing able to bring it back.
        attachWindowOpenPolicy(child);
    });
}

/**
 * Creates the main app window and shows the local splash immediately — the OS paints
 * this window's `backgroundColor` behind it, so there is never a blank white frame while
 * Postgres and the server are still starting.
 */
function createShellWindow(initiallyHidden = false): BrowserWindow {
    const win = new BrowserWindow({
        width: 1366,
        height: 860,
        minWidth: 1024,
        minHeight: 700,
        title: APP_TITLE,
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

    attachWindowOpenPolicy(win);
    // did-navigate covers full loads; did-navigate-in-page covers Next's client-side
    // router (pushState) — staff move between office/pos/vouchers screens without a
    // full reload, so only the latter fires for most in-app navigation.
    win.webContents.on("did-navigate", (_e, url) => recordVisitedRoute(url));
    win.webContents.on("did-navigate-in-page", (_e, url) => recordVisitedRoute(url));
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
    const startUrl = `${baseUrl}${LANDING_PAGE}`;
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
        result = await startNextServer(Number(PORT), path.join(app.getPath("userData"), "v8-compile-cache"));
    } catch (err) {
        console.error("[Main] Error starting Next.js server:", err);
    }

    if (result.ready) {
        sendBootProgress("Almost there…");
        // Warm the routes staff actually use once — but only after the login page
        // itself has finished loading, so the warm requests never compete with it for
        // the server's single event loop. From then on they run in the idle seconds
        // between the login screen appearing and staff typing their PIN, not in front
        // of a spinner. See serverManager.ts's warmRoutes().
        if (mainWindow && !mainWindow.isDestroyed()) {
            const readyUrl = result.url;
            mainWindow.webContents.once("did-finish-load", () => {
                const routes = Array.from(new Set([...DEFAULT_WARM_ROUTES, ...loadPersistedWarmRoutes()]));
                warmRoutes(readyUrl, routes);
            });
        }
        await loadApp(result.url);
    } else {
        if (!isHiddenLaunch) {
            showBootError(result.url);
        }
    }

    // Counter PCs in tray/background mode can go a long time between a clean quit
    // (which is when persistVisitedRoutes() normally runs) — an abrupt power-off or
    // Windows update reboot would otherwise lose everything learned since the last
    // exit. Cheap to redo periodically since it's just a Set -> JSON.stringify.
    setInterval(persistVisitedRoutes, 10 * 60 * 1000);

    setupAutoUpdater();

    app.on("activate", () => {
        showMainWindow();
    });
});

app.on("before-quit", () => {
    isQuitting = true;
    persistVisitedRoutes();
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
