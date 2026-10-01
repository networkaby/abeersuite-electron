import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, session, shell, Tray } from "electron";
import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { readJsonState, setAsideCorrupt, writeJsonAtomic, type StateRead } from "./stateFile";
import { resolveInstallationId } from "./installationId";

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
// AUTH_SECRET is baked into (2) only when the build's .env carries one — a
// WRITE_MODE=v_live till must share the office's secret (see scripts/counterEnv.ts).
// Otherwise it is generated per machine on first run, see `ensureAuthSecret`. (The
// `%APPDATA%` folder is named from app.getName(), which reads package.json "name", not
// the "AbeerSuite" productName.)
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
        `placed at\n\n${userEnv}\n\nis loaded instead (see '.env.example').`
    );
    app.exit(1);
}

/**
 * Session signing key: the baked one when the build ships it, else one per machine.
 *
 * A build carries `AUTH_SECRET` in counter.env only for `WRITE_MODE=v_live`, where the
 * till relays its writes to the office and must present a cookie the office can decrypt
 * (see scripts/counterEnv.ts). Every other build ships none, and this generates one:
 * that counter's Next server serves only http://127.0.0.1, so its cookies never cross
 * machines, and a secret read off one such PC forges nothing on another. A placeholder
 * from .env.example counts as absent — it would sign real cookies with a published string.
 *
 * Stored beside counter-installation-id.json, which survives upgrades, so an update does
 * not sign everybody out. Both names are set because next-auth v5 reads AUTH_SECRET while
 * older call sites still look for NEXTAUTH_SECRET.
 */
function ensureAuthSecret(): void {
    const configured = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
    if (configured && !PLACEHOLDER_ENV_VALUES.has(configured)) return;

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
            writeJsonAtomic(file, { authSecret: secret });
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
 * see .env.example) for the rare case a fixed port collides with something else
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
/** Set once the Next server answers HTTP. Null means "not ready" — see shellPath(). */
let serverUrl: string | null = null;
let currentSyncStatus = "";
let currentConnectionStatus = "";

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

// ── Auto-start: the preference lives here, not in Windows ───────────────────
//
// A counter PC has to come back on its own after a power cut or a Windows update
// reboot — nobody walks over to start the till — so the app registers itself with
// `--hidden` and waits in the tray.
//
// Until 2026-09-06 that was a ONE-SHOT: turn it on the first time the app ran,
// write a marker, never look again. So once the Run entry went away — a cleanup
// tool, a Windows profile reset, a reinstall that kept the settings folder — it
// never came back and nothing noticed.
//
// Keeping our own preference file is what makes checking it again safe. Windows
// holds only the consequence; this file holds the intent, which is the one thing
// that tells "the entry was wiped" (put it back) apart from "the owner turned it
// off" (leave it alone).
const AUTOSTART_PREF_FILE = "autostart.json";
/** The pre-2026-09-06 one-shot marker. Its presence means this counter is not a fresh install. */
const AUTOSTART_LEGACY_FILE = "autostart-initialized.json";

function autoStartPrefPath(): string {
    return path.join(app.getPath("userData"), AUTOSTART_PREF_FILE);
}

/** Missing, unreadable or malformed all mean "never answered" — and the answer we want by default is on. */
function readAutoStartPreference(): boolean {
    try {
        const parsed = JSON.parse(fs.readFileSync(autoStartPrefPath(), "utf8")) as { enabled?: unknown };
        return typeof parsed.enabled === "boolean" ? parsed.enabled : true;
    } catch {
        return true;
    }
}

function writeAutoStartPreference(enabled: boolean): void {
    try {
        writeJsonAtomic(autoStartPrefPath(), { enabled, updated: new Date().toISOString() });
    } catch (err) {
        console.warn("[main] Could not save the auto-start preference:", err);
    }
}

/**
 * Gives this counter a preference file the first time it runs a version that has one.
 *
 * A counter carrying the old marker is NOT seeded with a plain `true`: the one-shot
 * never recorded what the tray tick box was set to, so Windows is the only surviving
 * record of it. Seeding from the live setting means a counter where somebody
 * deliberately turned auto-start off keeps it off instead of having it forced back on
 * by the very check this change adds.
 */
function initAutoStartPreference(): void {
    if (fs.existsSync(autoStartPrefPath())) return;
    if (fs.existsSync(path.join(app.getPath("userData"), AUTOSTART_LEGACY_FILE))) {
        writeAutoStartPreference(isAutoStartEnabled());
        return;
    }
    writeAutoStartPreference(true);
}

/**
 * Puts the Windows startup entry back when it has gone missing — and only then.
 *
 * Switching the app off in Task Manager -> Startup apps does NOT go through here,
 * because Windows records that veto in a separate key (StartupApproved) and leaves
 * the Run entry alone. `openAtLogin` therefore stays true, this returns early, and a
 * choice made in Windows' own screen is never overruled. (`executableWillLaunchAtLogin`
 * is the field that reports the veto, and nothing here reads it on purpose.)
 */
function ensureAutoStartMatchesPreference(): void {
    if (!app.isPackaged) return;
    if (!readAutoStartPreference()) return;
    if (isAutoStartEnabled()) return;
    console.log("[main] Auto-start is switched on but Windows has no entry for it — putting it back.");
    setAutoStart(true);
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

    // "Up to date" is not a phase the updater keeps — a check that finds nothing just
    // goes back to idle. The tray holds the good news itself for a few seconds so a
    // click is never answered by a menu that looks exactly like it did before.
    let upToDateUntil = 0;
    let upToDateTimer: NodeJS.Timeout | null = null;

    const updateItemLabel = (): { label: string; enabled: boolean } => {
        const state = getUpdateState();
        switch (state.phase) {
            case "checking":
                return { label: "Checking for updates…", enabled: false };
            case "downloading":
                return {
                    label:
                        state.percent === null
                            ? "Downloading update…"
                            : `Downloading update ${Math.round(state.percent)}%`,
                    enabled: false,
                };
            case "ready":
                return { label: `Update ready${state.version ? ` — v${state.version}` : ""}`, enabled: true };
            case "installing":
                return { label: "Installing update…", enabled: false };
            case "error":
                return { label: "Check for updates (last check failed)", enabled: true };
            default:
                return upToDateUntil > Date.now()
                    ? { label: "You are up to date", enabled: false }
                    : { label: "Check for updates", enabled: true };
        }
    };

    const updateContextMenu = () => {
        const autoStart = isAutoStartEnabled();
        const updateItem = updateItemLabel();
        const contextMenu = Menu.buildFromTemplate([
            {
                label: `Open AbeerSuite ${app.getVersion()}`,
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
                    // Record it, or the next start would read a missing preference as
                    // "never answered", default to on, and undo what was just clicked.
                    writeAutoStartPreference(menuItem.checked);
                    updateContextMenu();
                },
            },
            {
                label: updateItem.label,
                enabled: updateItem.enabled,
                click: () => {
                    // A ready update is not restarted from here: the window's update
                    // prompt knows whether a cart is open and asks first. The tray only
                    // carries the news and puts that prompt in front of the owner.
                    if (getUpdateState().phase === "ready") {
                        showMainWindow();
                        return;
                    }
                    upToDateUntil = 0;
                    void checkNow("tray").then(() => {
                        if (getUpdateState().phase !== "idle") return;
                        upToDateUntil = Date.now() + 5000;
                        updateContextMenu();
                        if (upToDateTimer) clearTimeout(upToDateTimer);
                        upToDateTimer = setTimeout(() => {
                            upToDateTimer = null;
                            updateContextMenu();
                        }, 5000);
                    });
                    showMainWindow();
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

    // Every phase change (checking → downloading → ready) redraws the menu, so the
    // label is right even when the check was not started from the tray.
    onUpdateState(() => updateContextMenu());

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
// See installationId.ts. Resolved against how counter-setup.json reads, because only a
// PC that holds no counter may be given a new id. Null only when a PC that holds a
// counter has lost both copies — every check below then answers "cannot tell".
const counterInstallationId: string | null =
    resolveInstallationId(app.getPath("userData"), readCounterSetupState().kind).id;



// ── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle("app:get-counter-id", () => {
    return counterInstallationId;
});

ipcMain.handle("counter:apply-id-ranges", async (_, blockStart: number) => {
    const localUrl = process.env.LOCAL_DATABASE_URL;
    if (!localUrl || typeof blockStart !== "number") return false;
    return await applyIdRanges(localUrl, blockStart);
});

// ── First-launch counter setup ───────────────────────────────────────────────
// Which PosCounter (and its counterNumber) this PC is bound to, chosen once at
// setup. Separate from counter-installation-id.json (this machine's own identity,
// created above) — this file records which counter ROW that identity was matched
// to, so later launches can skip the setup screen without hitting the server.
interface CounterSetup {
    counterId: number;
    counterNumber: number;
}

function counterSetupFilePath(): string {
    return path.join(app.getPath("userData"), "counter-setup.json");
}

/**
 * The replica's sync-role url, held from boot so the sync worker can be started later —
 * a machine that had no counter at launch starts syncing the moment it claims one,
 * without needing a restart.
 */
let pendingSyncUrl: string | null = null;

/**
 * The embedded cluster's superuser url, held from boot for the replica wipe: emptying
 * every table needs more than the app role has, and the wipe runs after the setup file
 * is gone, long after the boot path returned.
 */
let localAdminUrl: string | null = null;

function parseCounterSetup(raw: unknown): CounterSetup | null {
    const data = raw as { counterId?: unknown; counterNumber?: unknown } | null;
    return typeof data?.counterId === "number" && typeof data?.counterNumber === "number"
        ? { counterId: data.counterId, counterNumber: data.counterNumber }
        : null;
}

/** present / absent / corrupt — boot treats each differently (see the replica section). */
function readCounterSetupState(): StateRead<CounterSetup> {
    return readJsonState(counterSetupFilePath(), parseCounterSetup);
}

function readCounterSetup(): CounterSetup | null {
    const state = readCounterSetupState();
    return state.kind === "present" ? state.value : null;
}

/**
 * counter-setup.json exists but cannot be read — a save cut short by a power cut, or
 * damage since. Not the same as no file: this PC was a counter a moment ago, and its
 * replica may hold sales it has not pushed yet.
 *
 * The replica can say which counter this is: the pos_counters row that carries this
 * PC's installation id IS the setup. Exactly one such row → the file is rebuilt and
 * boot carries on as if nothing happened. No row, in a replica that has synced → the
 * last answer the DB gave is that this PC holds no counter, the same verdict an intact
 * file would get from the boot binding check → "released". Anything else (no id, an
 * unreadable or never-filled replica, two rows) → null: hold, wipe nothing.
 *
 * The damaged file is set aside first either way, so nothing else reads it.
 */
async function recoverCounterSetup(adminUrl: string, error: string): Promise<CounterSetup | "released" | null> {
    const aside = setAsideCorrupt(counterSetupFilePath());
    console.error(`[main] counter-setup.json is damaged (${error})${aside ? ` — kept as ${path.basename(aside)}` : ""}.`);
    if (!counterInstallationId) return null;
    const bound = await counterBoundToThisPc(adminUrl, counterInstallationId);
    if (bound === "none") return "released";
    if (!bound) return null;
    try {
        writeJsonAtomic(counterSetupFilePath(), bound);
    } catch (err) {
        console.error("[main] Could not rewrite counter-setup.json:", err);
    }
    console.warn(`[main] counter-setup.json rebuilt from the replica — counter ${bound.counterNumber}.`);
    return bound;
}

ipcMain.handle("counter:get-setup", (): CounterSetup | null => readCounterSetup());

ipcMain.handle("counter:save-setup", (_, setup: CounterSetup): boolean => {
    try {
        writeJsonAtomic(counterSetupFilePath(), setup);
        // Written LAST in onboarding, after the wizard already started the worker and
        // waited for the replica to fill (counter:start-sync). No-op when it is up.
        if (pendingSyncUrl) startSyncWorker(pendingSyncUrl);
        // Reflect the (possibly new) counter number in the title immediately —
        // called both at first-launch setup and whenever the renderer discovers
        // this device was reassigned to a different counter (see
        // reconcileCounterSetup in setupGate.ts).
        mainWindow?.setTitle(buildFullTitle());
        return true;
    } catch (err) {
        console.error("[main] Could not write counter-setup.json:", err);
        return false;
    }
});

/**
 * This PC is no longer a counter: drop the file, stop syncing, and empty the replica —
 * a machine without a counter holds no business data. Called when the app learns of a
 * release (counter:clear-setup) and at boot when the replica says the file's counter
 * no longer carries this PC.
 */
async function resetCounter(reason: string): Promise<boolean> {
    try {
        console.log(`[main] Resetting this PC's counter — ${reason}.`);
        const file = counterSetupFilePath();
        if (fs.existsSync(file)) fs.unlinkSync(file);
        // No counter, no sync — the mirror image of the boot gate. Awaited: the wipe
        // below must not race a cycle still writing into the replica.
        await stopSyncWorker();
        currentSyncStatus = "";
        currentConnectionStatus = "";
        mainWindow?.setTitle(APP_TITLE);
        if (localAdminUrl) await wipeReplica(localAdminUrl);
        return true;
    } catch (err) {
        console.error("[main] Could not reset the counter:", err);
        return false;
    }
}

ipcMain.handle("counter:clear-setup", () => resetCounter("released by the office"));

// Onboarding starts the worker BEFORE the file exists: bind in the DB, fill the
// replica, and only then write counter-setup.json. The boot gate stays on the file.
ipcMain.handle("counter:start-sync", (): boolean => {
    if (!pendingSyncUrl) return false;
    startSyncWorker(pendingSyncUrl);
    return true;
});

// ── The sign-in shell ───────────────────────────────────────────────────────
// See shellPath() for what this screen is and why main does not sign in itself.

ipcMain.handle("shell:sign-in", async (_, credentials: { email: string; password: string; setPin?: boolean }) => {
    if (!credentials || typeof credentials.email !== "string" || typeof credentials.password !== "string") {
        return { ok: false, error: "Enter your email and password." };
    }
    if (!serverUrl) {
        // The button is disabled until the server answers, so this is only reachable by
        // a race — the cashier hitting Enter in the same tick readiness arrived.
        return { ok: false, error: "Still starting. Try again in a moment." };
    }
    parkedCredentials = {
        email: credentials.email,
        password: credentials.password,
        // "Set PIN" on the sign-in screen: a PIN cannot be set before anyone is signed
        // in, so the intent travels with the credentials and the app opens the panel on
        // the other side. Just an intent — it grants nothing.
        setPin: credentials.setPin === true,
    };
    // From here the real /staff/login takes over: it collects these through
    // shell:take-credentials, submits them, and does the counter reconciliation the
    // shell has no business doing.
    await loadApp(serverUrl);
    return { ok: true };
});

ipcMain.handle("shell:take-credentials", () => {
    const held = parkedCredentials;
    parkedCredentials = null;   // Read once. A retry types them again.
    return held;
});

/**
 * Sign in with a counter PIN. Same handoff as `shell:sign-in`, different field.
 *
 * Main checks nothing about the PIN itself — it cannot: the check needs the database,
 * and the rules around it (this counter only, the ten-day password clock) live in
 * `shared/lib/auth/counterPin.ts` where the server can enforce them. This only carries
 * the digits across to `/staff/login`.
 */
ipcMain.handle("shell:sign-in-pin", async (_, credentials: { email: string; pin: string }) => {
    if (!credentials || typeof credentials.email !== "string" || typeof credentials.pin !== "string") {
        return { ok: false, error: "Enter your PIN." };
    }
    if (!serverUrl) return { ok: false, error: "Still starting. Try again in a moment." };
    parkedCredentials = { email: credentials.email, pin: credentials.pin };
    await loadApp(serverUrl);
    return { ok: true };
});

// ── The face roster ─────────────────────────────────────────────────────────
// Who has signed in on THIS PC, so the shell can offer a photograph to tap instead of
// an email address to type. See rosterPath() for what this is and is not.

ipcMain.handle("shell:roster", (): ShellRosterEntry[] => readRoster().map((entry) => ({
    ...entry,
    avatarFile: faceDataUrl(entry.avatarFile),
})));

ipcMain.handle("shell:remember-user", async (_, who: {
    email?: unknown; name?: unknown; title?: unknown; avatarUrl?: unknown; hasPin?: unknown;
    seats?: unknown;
}) => {
    if (typeof who?.email !== "string" || typeof who?.name !== "string") return false;
    const email = who.email.trim().toLowerCase();
    if (!email) return false;

    const roster = readRoster();
    const existing = roster.find((r) => r.email === email);
    const avatarUrl = typeof who.avatarUrl === "string" ? who.avatarUrl : undefined;

    // Re-fetch the photograph only when it actually changed — unlike the login
    // background, which is cached once and never refreshed, a face has to follow the
    // person's profile. Nothing here is allowed to fail the sign-in it follows.
    let avatarFile = existing?.avatarFile;
    if (avatarUrl && avatarUrl !== existing?.avatarUrl) {
        avatarFile = await cacheFace(email, avatarUrl) ?? undefined;
    } else if (!avatarUrl) {
        avatarFile = undefined;
    }

    const entry: ShellRosterEntry = {
        email,
        name: who.name,
        title: typeof who.title === "string" ? who.title : undefined,
        seats: Array.isArray(who.seats)
            ? (who.seats as { title?: unknown; scope?: unknown }[])
                .filter((seat) => typeof seat?.title === "string" && typeof seat?.scope === "string")
                .map((seat) => ({ title: String(seat.title), scope: String(seat.scope) }))
            : undefined,
        avatarUrl,
        avatarFile,
        hasPin: who.hasPin === true,
        lastLoginAt: new Date().toISOString(),
    };

    const next = [entry, ...roster.filter((r) => r.email !== email)]
        .sort((a, b) => (b.lastLoginAt ?? "").localeCompare(a.lastLoginAt ?? ""));
    // A till that has seen twenty people does not need twenty faces on the screen —
    // past a dozen the grid is worse than the form it replaced.
    for (const dropped of next.slice(ROSTER_MAX)) forgetFace(dropped.avatarFile);
    writeRoster(next.slice(0, ROSTER_MAX));
    return true;
});

/**
 * Take a face off this screen. LOCAL ONLY — and that is the point.
 *
 * It forgets a name and a photograph on this PC. It does not touch the account, the
 * PIN, or anything the office can see. Removing a PIN everywhere is a signed-in
 * action (`/api/me/counter-pin`); letting an unauthenticated screen reach an account
 * would be a door, not a convenience.
 */
/**
 * Does this person have a usable PIN on this counter?
 *
 * Asked by the shell before it puts a keypad up — and it has to come through main,
 * because the shell is a `file://` page: a relative `fetch("/api/...")` there resolves
 * to `file:///api/...` and fails. That was the bug this replaces; the check looked
 * present and had never once run, so a password falling due was only discovered after
 * six digits had been typed.
 *
 * Null whenever the question cannot be answered — the server not up yet, or anything
 * thrown. The sign-in itself is the real check either way; this only decides whether
 * the cashier is shown a keypad or asked for their password.
 */
ipcMain.handle("shell:pin-status", async (_, email: string): Promise<string | null> => {
    if (typeof email !== "string" || !email.trim() || !serverUrl) return null;
    try {
        const res = await net.fetch(`${serverUrl}/api/counter-pin/status`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
        });
        if (!res.ok) return null;
        const out = await res.json() as { state?: unknown };
        return typeof out.state === "string" ? out.state : null;
    } catch {
        return null;
    }
});

ipcMain.handle("shell:forget-user", (_, email: string) => {
    if (typeof email !== "string") return false;
    const key = email.trim().toLowerCase();
    const roster = readRoster();
    const gone = roster.find((r) => r.email === key);
    if (!gone) return false;
    forgetFace(gone.avatarFile);
    writeRoster(roster.filter((r) => r.email !== key));
    return true;
});

/**
 * Saves the background the shell just displayed, so a counter that opens tomorrow with
 * the line down still gets its photograph.
 *
 * Best-effort throughout: a failure here costs a picture, never a sign-in. Capped
 * because this writes a file from a URL that came out of a config block — an oversized
 * or non-image response is dropped rather than parked in userData.
 */
ipcMain.handle("shell:cache-background", async (_, url: string) => {
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
    if (fs.existsSync(loginBackgroundPath())) return false;   // The owner's own picture wins.
    const cached = path.join(app.getPath("userData"), "login-background-cache.jpg");
    if (fs.existsSync(cached)) return false;                  // Already held.
    try {
        const res = await net.fetch(url);
        if (!res.ok) return false;
        const type = res.headers.get("content-type") || "";
        if (!type.startsWith("image/")) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > 8 * 1024 * 1024) return false;
        fs.writeFileSync(cached, buf);
        return true;
    } catch (err) {
        console.warn("[Shell] Could not cache the login background:", (err as Error).message);
        return false;
    }
});

ipcMain.handle("app:update-window-status", (_, status: { sync: string; connection: string }): void => {
    currentSyncStatus = status.sync;
    currentConnectionStatus = status.connection;
    mainWindow?.setTitle(buildFullTitle());
});

// ── Shop hardware: DQ11 customer display + thermal printer ───────────────────
//
// Replaces the old HTTP relays on :9192 and :9191. Renderer → here → the bridge child's
// message channel. No listening sockets, so nothing on the shop LAN and no website the
// cashier browses can drive the printer or the display.

ipcMain.handle("bridge:send", (_event, mod: "qr" | "thermal", cmd: string, payload?: unknown) => {
    bridgeSend(mod, cmd, payload);
});

ipcMain.handle("bridge:request", async (_event, mod: "qr" | "thermal", cmd: string, payload?: unknown) => {
    // Surfaced as a message, not a thrown IPC error, so callers can render "bridge not
    // running" the way the old /health probe let them.
    try {
        return { ok: true, result: await bridgeRequest(mod, cmd, payload) };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("bridge:connected", () => isBridgeConnected());

/**
 * Folder picker for the settings pages. Deliberately knows nothing about any one
 * feature: it opens at whatever `defaultPath` the caller passes — the QR display
 * page passes its saved `idleFolder`, which the bridge fills in on first start —
 * and falls back to this PC's Pictures folder. `createDirectory` lets staff make a
 * new one without leaving the dialog. Returns null when cancelled, so the caller
 * keeps whatever was there.
 */
ipcMain.handle("dialog:select-folder", async (event, defaultPath?: string): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
        defaultPath: defaultPath?.trim() || app.getPath("pictures"),
        properties: ["openDirectory", "createDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

// ── Local backup & restore ───────────────────────────────────────────────────
// Supabase ⇄ this PC, using the bundled pg_dump/pg_restore. See backupManager.ts for
// why this exists beside the Dropbox path and why the URL never leaves main.
//
// Not separately permission-gated: the only page that calls this is
// /office/settings/backup-restore, which the nav gates on `settings:manage`, and the
// restore additionally needs the operator to type RESTORE. Both operations are also
// bounded by a native dialog the user has to complete by hand — nothing here can run
// without someone picking a file on this machine.

/**
 * `pendingWrites` rides along so the restore card can name what a restore costs THIS
 * till before the operator commits to it — see the restore handler below for why the
 * outbox has to go.
 */
ipcMain.handle("backup:availability", async (): Promise<RestoreReadiness> => ({
    ...backupAvailability(),
    pendingWrites: localAdminUrl ? await countPendingOutbox(localAdminUrl) : 0,
}));

ipcMain.handle("backup:dump-to-disk", async (event): Promise<RunResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const availability = backupAvailability();
    if (!availability.available) return { ok: false, error: availability.reason };

    const options: Electron.SaveDialogOptions = {
        title: "Save database backup",
        defaultPath: path.join(app.getPath("documents"), makeLocalBackupFileName(availability.projectRef)),
        filters: [{ name: "Database backup", extensions: ["dump"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    // Cancelled is not a failure — the card goes back to idle with no error shown.
    if (picked.canceled || !picked.filePath) return { ok: false };

    return runBackup(picked.filePath, (line) => {
        if (!event.sender.isDestroyed()) event.sender.send("backup:progress", line);
    });
});

ipcMain.handle("backup:restore-from-disk", async (event, confirm: string): Promise<RunResult> => {
    // The renderer already asks for this word and confirms twice; checked again here
    // because this is the one call in the app that replaces the live database.
    if (confirm !== "RESTORE") return { ok: false, error: "Type RESTORE to confirm." };

    const win = BrowserWindow.fromWebContents(event.sender);
    const availability = backupAvailability();
    if (!availability.available) return { ok: false, error: availability.reason };

    const options: Electron.OpenDialogOptions = {
        title: "Choose the backup to restore",
        defaultPath: app.getPath("documents"),
        filters: [{ name: "Database backup", extensions: ["dump"] }],
        properties: ["openFile"],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false };

    // ── Everything that writes has to stop, and stay stopped ────────────────
    // A restore replaces Supabase. Three things on THIS machine keep writing straight
    // through one, and each of them undoes it:
    //
    //   1. The sync worker pulls Supabase into the replica. `stopSyncWorker()` resolves
    //      only once the worker AND its cycle are gone — it ends a cycle in flight
    //      rather than leave it writing behind the restore.
    //   2. The outbox flusher pushes this PC's pending writes UP. It lives inside the
    //      forked Next server (instrumentation.ts) and stops only with it, so it
    //      would push pre-restore rows back over the restore within the minute.
    //   3. The replica itself keeps the pre-restore values for ever: restored rows
    //      carry an OLDER updatedAt than the watermark, and the pull's last-write-wins
    //      guard refuses to apply them.
    //
    // Relaunching answers the other two with what already exists. `app.quit()` runs the
    // will-quit handler, which stops the Next server and its flusher before
    // PostgreSQL; the wipe before it empties `_sync_state` so
    // the next boot's worker sees a never-synced replica and pulls the restored data
    // in full, with the readiness gate closed until it has.
    await stopSyncWorker();

    const result = await runRestore(picked.filePaths[0], (line) => {
        if (!event.sender.isDestroyed()) event.sender.send("backup:progress", line);
    });

    if (!result.ok) {
        // Nothing was replaced (or only partly — the card says to check). Either way
        // this PC carries on as a counter, so put the worker back.
        if (pendingSyncUrl) startSyncWorker(pendingSyncUrl);
        return result;
    }

    // The wipe takes `_outbox` with it. That is the point: those rows were written
    // against the database that has just been replaced, and the flusher would push
    // them back over it. The card names the count before the operator gets here.
    if (localAdminUrl) await wipeReplica(localAdminUrl);

    if (!event.sender.isDestroyed()) event.sender.send("backup:progress", "Restarting the app…");
    app.relaunch();
    app.quit();
    return result;
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

// ── Screen size ──────────────────────────────────────────────────────────────
// Reads as "what is applied right now" rather than just the saved value, because the
// Settings page has to show what Automatic actually resolved to on THIS counter — the
// answer differs per machine and the staff need to see the number they are comparing
// their manual choices against.
ipcMain.handle("display:get", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pref = readDisplayPreference();
    return {
        mode: pref.mode,
        applied: resolveZoomFactor(win ?? undefined),
        steps: [...ZOOM_STEPS],
    };
});

ipcMain.handle("display:set", (event, mode: "auto" | "fixed", factor?: number) => {
    if (mode === "fixed" && typeof factor === "number") {
        writeDisplayPreference({ mode: "fixed", factor });
    } else {
        writeDisplayPreference({ mode: "auto" });
    }
    // Every window, not only the sender: a report window left open beside the Settings
    // page would otherwise keep the old size until it was closed and opened again.
    applyPreferenceToAllWindows();
    const win = BrowserWindow.fromWebContents(event.sender);
    return { mode: readDisplayPreference().mode, applied: resolveZoomFactor(win ?? undefined) };
});

// ── Auto Updater ─────────────────────────────────────────────────────────────
// Policy and mechanics live in updateManager.ts. What stays here is the wiring: the
// renderer's view of the update, its "Restart now", and the POS cart's busy flag.
ipcMain.handle("update:get-state", () => getUpdateState());
ipcMain.handle("update:install-now", () => install("restart now"));
ipcMain.handle("update:check-now", () => checkNow("asked"));
ipcMain.handle("update:set-busy", (_, busy: boolean) => setCartBusy(busy === true));

import { ensurePostgresRunning, stopEmbeddedPostgres } from "./postgresManager";
import {
    backupAvailability,
    makeLocalBackupFileName,
    runBackup,
    runRestore,
    type RestoreReadiness,
    type RunResult,
} from "./backupManager";
import { provisionLocalDatabase } from "./localDbProvisioner";
import { startSyncWorker, stopSyncWorker } from "./syncManager";
import { wipeReplica, replicaBindsThisPc, countPendingOutbox, counterBoundToThisPc, replicaHasSyncedData } from "./replicaWipe";
import { waitForReplicaReady } from "./waitForReplica";
import { startHardwareBridge, stopHardwareBridge, bridgeSend, bridgeRequest, isBridgeConnected } from "./hardwareBridgeManager";
import { applyIdRanges } from "./applyIdRanges";
import { startNextServer, stopNextServer, onNextServerRestarted, warmRoutes, type ServerStartResult } from "./serverManager";
import { helperNotes, onHelperNotesChanged } from "./helperSupervisor";
import { setupAutoUpdater, stopAutoUpdater, getUpdateState, onUpdateState, install, checkNow, setCartBusy, clearUpdateSplash } from "./updateManager";
import { repairAfterSwap } from "./stagedUpdate";
import { attachZoom, fitToScreen, stepZoom, readDisplayPreference, writeDisplayPreference, applyPreferenceToAllWindows, resolveZoomFactor, ZOOM_STEPS } from "./displayPreference";

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
        writeJsonAtomic(warmRoutesFilePath(), { routes, updatedAt: new Date().toISOString() });
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

/**
 * The counter's sign-in screen, shown from the first frame.
 *
 * This replaced a spinner. The window cannot show the real app until the Next server
 * answers — ten-odd seconds on a cold counter, with Postgres starting first — and that
 * used to be dead time in front of a cashier. The same seconds are now spent typing
 * into a real form, so the wait costs nothing. See the file's own header for the rules
 * it lives by; it is plain HTML because it runs before any server exists.
 */
function shellPath(): string {
    // Packaged: electron-builder puts `resources/shell` in extraResources. Dev: main.js
    // runs out of dist-electron/, so the repo copy is one level up.
    return app.isPackaged
        ? path.join(process.resourcesPath, "shell", "login.html")
        : path.join(__dirname, "..", "resources", "shell", "login.html");
}

/**
 * Who has signed in on this PC — the face grid on the sign-in screen.
 *
 * A CONVENIENCE CACHE and nothing more. It decides whose photograph is offered, never
 * who may sign in: every card still goes through the same server-side sign-in, and a
 * roster someone hand-edited buys them precisely nothing. It lives on disk because the
 * shell paints before the server is up and often before the line is.
 *
 * Kept beside counter-setup.json in userData, so an app update leaves it alone.
 */
type ShellRosterEntry = {
    email: string;
    name: string;
    title?: string;
    /** Every Position held, senior first. Shape mirrored in electron/preload.ts. */
    seats?: { title: string; scope: string }[];
    /** The profile photo's source URL — kept only to notice when it changes. */
    avatarUrl?: string;
    /** File name under faces/, or (over IPC) the file:// URL the shell can use. */
    avatarFile?: string;
    hasPin: boolean;
    lastLoginAt: string;
};

/** Past a dozen faces the grid is worse than the form it replaced. */
const ROSTER_MAX = 12;

function rosterPath(): string {
    return path.join(app.getPath("userData"), "counter-roster.json");
}

function faceFile(name: string): string {
    return path.join(app.getPath("userData"), "faces", name);
}

function readRoster(): ShellRosterEntry[] {
    try {
        const raw = fs.readFileSync(rosterPath(), "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e): e is ShellRosterEntry =>
            !!e && typeof (e as ShellRosterEntry).email === "string" && typeof (e as ShellRosterEntry).name === "string");
    } catch {
        return [];   // Missing or unreadable — the shell falls back to its form.
    }
}

function writeRoster(entries: ShellRosterEntry[]): void {
    try {
        writeJsonAtomic(rosterPath(), entries);
    } catch (err) {
        console.warn("[Shell] Could not save the face roster:", (err as Error).message);
    }
}

/**
 * Keep a copy of someone's profile photo, so tomorrow's sign-in needs no network.
 *
 * Same guards as the login background — an `image/` content type and a size cap — but
 * NOT the same "already held, skip" rule: a face has to follow the person's profile,
 * so the caller re-fetches whenever the source URL changes. Returns the file name to
 * store, or null, and a null costs a photograph and never a sign-in.
 */
async function cacheFace(email: string, url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const name = `${crypto.createHash("sha1").update(email).digest("hex")}.img`;
    try {
        const res = await net.fetch(url);
        if (!res.ok) return null;
        if (!(res.headers.get("content-type") || "").startsWith("image/")) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        // Tighter than the login background's 8MB: a 52px circle never needs more, and
        // every face is carried to the screen as base64 now, so the cap bounds what the
        // roster costs to hand over as well as what it costs on disk.
        if (buf.byteLength > 1024 * 1024) return null;
        fs.mkdirSync(path.dirname(faceFile(name)), { recursive: true });
        fs.writeFileSync(faceFile(name), buf);
        return name;
    } catch (err) {
        console.warn("[Shell] Could not cache a profile photo:", (err as Error).message);
        return null;
    }
}

/**
 * The cached photograph, as a `data:` URL.
 *
 * NOT a `file://` path, which is what this used to hand over and why the app's own
 * sign-in page showed initials where the shell showed faces: the shell is a `file://`
 * document and could load one, but the page is served over http, and Chromium refuses a
 * `file://` subresource from an http document. A data URL is the one form BOTH screens
 * can display, so there is one shape to reason about instead of two.
 *
 * The type is read off the first bytes rather than stored, so the photographs already
 * cached on every till keep working without being re-fetched.
 */
function faceDataUrl(name: string | undefined): string | undefined {
    if (!name) return undefined;
    try {
        const buf = fs.readFileSync(faceFile(name));
        const type =
            buf[0] === 0x89 && buf[1] === 0x50 ? "image/png"
                : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
                    : buf[0] === 0x47 && buf[1] === 0x49 ? "image/gif"
                        : buf.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
                            : null;
        if (!type) return undefined;   // Not an image we can name — initials instead.
        return `data:${type};base64,${buf.toString("base64")}`;
    } catch {
        return undefined;              // Missing or unreadable: initials, never a hole.
    }
}

function forgetFace(name: string | undefined): void {
    if (!name) return;
    try { fs.rmSync(faceFile(name), { force: true }); } catch { /* a leftover picture is harmless */ }
}

/** Where an owner's own background lives, if they have dropped one in. */
function loginBackgroundPath(): string {
    return path.join(app.getPath("userData"), "login-background.jpg");
}

/**
 * `?bg=` — the counter's own picture, when there is one.
 *
 * Passed as a file URL rather than a path because the shell hands it straight to CSS.
 * Absent when no picture has been dropped in, and the shell then falls back through its
 * configured photos to a background drawn in CSS, so the screen is never blank.
 */
function shellQuery(): Record<string, string> {
    // The owner's own picture first, then the copy kept from the last time the shell
    // fetched one. Either way this is a local file, so a counter that has seen its
    // background once never waits on the network for it again.
    for (const candidate of [loginBackgroundPath(), path.join(app.getPath("userData"), "login-background-cache.jpg")]) {
        if (fs.existsSync(candidate)) return { bg: pathToFileURL(candidate).href };
    }
    return {};
}

/**
 * Credentials the shell collected, held until `/staff/login` asks for them.
 *
 * In memory only, read exactly once, and never written anywhere. Main does NOT sign in
 * with them: `/staff/login` also reconciles this PC's counter binding and enforces the
 * "login outside counter" permission, and signing in behind its back would skip both.
 * So the shell saves the cashier the typing and the real page still does the work.
 *
 * Exactly ONE of `password` / `pin` is ever set, and they are separate fields on
 * purpose: `/staff/login` picks the auth provider from which one arrived. Reusing the
 * password field for six digits would let an older shell paired with a newer page
 * submit a PIN as a password — refused, but refused confusingly.
 */
let parkedCredentials: { email: string; password?: string; pin?: string; setPin?: boolean } | null = null;

/** Tells the shell its button may go live. */
function notifyServerReady(): void {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:server-ready");
}

/**
 * Is someone still signed in on this counter?
 *
 * Only asks whether the cookie exists — whether it is still *valid* is the server's
 * business, and `src/proxy.ts` already bounces a stale one back to `/staff/login`. The
 * question here is narrower: should this boot show a sign-in screen at all, or did the
 * cashier simply close the app last night without signing out.
 *
 * The cookie name is pinned in `src/auth.ts` and must stay in step with it.
 */
async function hasStaffSession(): Promise<boolean> {
    try {
        const jar = await session.defaultSession.cookies.get({ name: "authjs.session-token" });
        return jar.length > 0;
    } catch {
        return false;   // Unreadable jar → show the sign-in screen. The safe way to be wrong.
    }
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

// Appends this PC's counter number (from counter-setup.json, see the
// first-launch setup IPC handlers below) to the base title, when known. Read
// synchronously — this only runs at window creation and right after
// counter-setup.json is rewritten, never on a hot path.
function currentAppTitle(): string {
    const setup = readCounterSetup();
    return setup ? `${APP_TITLE} — Counter ${setup.counterNumber}` : APP_TITLE;
}

// Builds the full title including sync and connection status
function buildFullTitle(): string {
    const base = currentAppTitle();
    const parts: string[] = [base];
    if (currentSyncStatus) parts.push(currentSyncStatus);
    if (currentConnectionStatus) parts.push(currentConnectionStatus);
    // A helper that crashed: "Printer bridge restarting…" (helperSupervisor.ts).
    parts.push(...helperNotes());
    return parts.join(" | ");
}

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
 * Every window the app opened from itself with `window.open` — POS tabs, the office
 * opened beside a bill, receipts. The main window is never in here.
 */
const childWindows = new Set<BrowserWindow>();

function isLoginUrl(rawUrl: string): boolean {
    try {
        const u = new URL(rawUrl);
        return (u.protocol === "http:" || u.protocol === "https:") && u.pathname.startsWith("/staff/login");
    } catch {
        return false;
    }
}

/**
 * Closes every child window the moment any window lands on the sign-in page.
 *
 * Sign-out is decided per window: each one watches its own session and only hears
 * about a sign-out elsewhere through next-auth's broadcast, which fires solely when
 * `signOut()` is called. A session that went cold overnight, or a token an admin
 * revoked, sends the main window to sign-in with no broadcast at all — and a POS
 * tab sitting beside it, visible and idle with an empty cart, never re-checks. It
 * kept showing an open shift and a Hand over button for a person who was no longer
 * signed in. Closing the children on every route to sign-in, rather than only on a
 * button press, covers the silent routes too and leaves one window to sign in on.
 *
 * A child reaching sign-in is closed as well — a second sign-in window has no use —
 * and the main window is brought up so nobody is left staring at an empty desktop
 * because the main window had been hidden to the tray.
 */
function closeChildWindowsOnLogin(win: BrowserWindow): void {
    const onNavigate = (_event: unknown, url: string) => {
        if (!isLoginUrl(url)) return;
        // Deferred: closing a window from inside its own navigation event is asking
        // for trouble, and the main window needs no such care but gains nothing here.
        setImmediate(() => {
            for (const child of Array.from(childWindows)) {
                if (!child.isDestroyed()) child.close();
            }
            if (win !== mainWindow) showMainWindow();
        });
    };
    win.webContents.on("did-navigate", onNavigate);
    win.webContents.on("did-navigate-in-page", onNavigate);
}

/**
 * Applies the origin split to `win`, and to any window `win` itself opens — a receipt
 * window that opens a further link must not fall back to Electron's permissive default.
 */
function attachWindowOpenPolicy(win: BrowserWindow): void {
    closeChildWindowsOnLogin(win);
    // Electron syncs the window title to document.title on every navigation by default —
    // the splash page, the boot-error page, and every real app page each carry their own
    // <title>, which would silently overwrite the version-stamped title set at
    // construction the instant any of them loads. Pin it here instead.
    win.on("page-title-updated", (event) => event.preventDefault());

    win.webContents.setWindowOpenHandler(({ url }) => {
        const target = classifyTarget(url);
        if (!target) return { action: "deny" };

        if (target.internal) {
            // Same reason as the main window: a report window opened at a size the
            // counter's screen does not have is a window with its footer off the
            // bottom of the screen.
            const fitted = fitToScreen({ width: 1280, height: 820, minWidth: 900, minHeight: 600 });
            return {
                action: "allow",
                // Inherit the parent's hardening explicitly rather than trusting the
                // defaults a child window would otherwise be created with.
                overrideBrowserWindowOptions: {
                    width: fitted.width,
                    height: fitted.height,
                    minWidth: fitted.minWidth,
                    minHeight: fitted.minHeight,
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
        childWindows.add(child);
        child.on("closed", () => childWindows.delete(child));
        attachWindowOpenPolicy(child);
        attachZoom(child);
    });
}

/**
 * Creates the main app window and shows the local splash immediately — the OS paints
 * this window's `backgroundColor` behind it, so there is never a blank white frame while
 * Postgres and the server are still starting.
 */
function createShellWindow(initiallyHidden = false): BrowserWindow {
    // 1366 x 860 is the size the office screens were designed against. On a counter
    // with a smaller screen it is simply not available, so ask the screen first.
    const fitted = fitToScreen({ width: 1366, height: 860, minWidth: 1024, minHeight: 700 });
    const win = new BrowserWindow({
        width: fitted.width,
        height: fitted.height,
        minWidth: fitted.minWidth,
        minHeight: fitted.minHeight,
        title: currentAppTitle(),
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
    attachZoom(win);
    // On a screen too small for the design size, the fitted window already fills the
    // work area — maximising makes that the window's real state, so Windows snaps and
    // restores it correctly instead of treating a full-screen-sized window as floating.
    if (fitted.oversized) win.once("ready-to-show", () => win.maximize());
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
    // Windows only: sign-out, restart or shutdown. Fired on a hidden window too.
    win.on("session-end", stopHelpersNow);
    win.loadFile(shellPath(), { query: shellQuery() }).catch((err) => {
        // ERR_ABORTED here is the routine case: loadApp() below already navigated on to
        // the real page before this promise settled. That is a race won, not a failure.
        if (err?.code !== "ERR_ABORTED") console.error("[Boot] Failed to load the sign-in shell:", err);
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
            // The shell (`login.html`, off disk) is still in this window's history, right
            // behind the app. Left there, Back on the first page after sign-in walked out
            // of the app onto the shell's faces screen while the cashier was signed in.
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.navigationHistory.clear();
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
/**
 * Replaces Electron's built-in menu, for one reason: the built-in Zoom In / Zoom Out
 * change the zoom without telling the app, so a size a cashier set with the keyboard
 * was forgotten the moment the counter restarted. These items go through stepZoom,
 * which saves the choice.
 *
 * The menu stays hidden (`autoHideMenuBar`); it exists for its shortcuts. Edit is here
 * because Ctrl+C / Ctrl+V on Windows come from the menu — drop it and copy-paste dies
 * in every input box in the app.
 */
function buildApplicationMenu(): void {
    const focused = () => BrowserWindow.getFocusedWindow() ?? mainWindow;
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: "Edit",
                submenu: [
                    { role: "undo" },
                    { role: "redo" },
                    { type: "separator" },
                    { role: "cut" },
                    { role: "copy" },
                    { role: "paste" },
                    { role: "selectAll" },
                ],
            },
            {
                label: "View",
                submenu: [
                    { role: "reload" },
                    { role: "forceReload" },
                    { role: "toggleDevTools" },
                    { type: "separator" },
                    {
                        label: "Zoom In",
                        accelerator: "CommandOrControl+Plus",
                        click: () => stepZoom(focused(), 0.05),
                    },
                    {
                        // Ctrl and "=" is the same physical key as "+" without Shift, and
                        // it is the one people actually press.
                        label: "Zoom In",
                        accelerator: "CommandOrControl+=",
                        visible: false,
                        click: () => stepZoom(focused(), 0.05),
                    },
                    {
                        label: "Zoom Out",
                        accelerator: "CommandOrControl+-",
                        click: () => stepZoom(focused(), -0.05),
                    },
                    {
                        label: "Automatic Size",
                        accelerator: "CommandOrControl+0",
                        click: () => stepZoom(focused(), 0),
                    },
                    { type: "separator" },
                    { role: "togglefullscreen" },
                ],
            },
            { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
        ]),
    );
}

app.whenReady().then(async () => {
    buildApplicationMenu();
    createSystemTray();

    if (app.isPackaged) {
        initAutoStartPreference();
        ensureAutoStartMatchesPreference();
    }

    mainWindow = createShellWindow(isHiddenLaunch);

    // A crashed helper comes back by itself (helperSupervisor.ts); the title says so
    // while it does. Pages are served by the Next server, so a restarted one means
    // every page in the window is stale — reloaded once the new process answers.
    onHelperNotesChanged(() => {
        // Also called while quitting (each stop clears its note), window or no window.
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(buildFullTitle());
    });
    onNextServerRestarted(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    });

    sendBootProgress("Starting database…");
    try {
        const localDbUrl = await ensurePostgresRunning();
        if (localDbUrl) {
            sendBootProgress("Preparing local database…");
            const replica = await provisionLocalDatabase(localDbUrl);
            if (replica) {
                // Downgrade from the superuser URL postgresManager handed back to the
                // least-privilege app role, which cannot DELETE or change the schema.
                process.env.LOCAL_DATABASE_URL = replica.appUrl;
                // Fills the replica and keeps it current. Runs under the sync role, which
                // owns the data and may suspend foreign keys while replaying a table.
                //
                // Only once this PC actually holds a counter, though. A machine sitting on
                // the setup wizard has nothing to sync FOR: there is no counter to bill on,
                // no local writes to push, and no reason to drag the whole dataset down or
                // to show sync failures on a screen the cashier cannot act on. The url is
                // kept so the wizard can start the worker the moment a counter is claimed.
                pendingSyncUrl = replica.syncUrl;
                localAdminUrl = localDbUrl;
                const setupState = readCounterSetupState();
                let setup = setupState.kind === "present" ? setupState.value : null;
                if (setupState.kind === "corrupt") {
                    const recovered = await recoverCounterSetup(localDbUrl, setupState.error);
                    if (recovered === "released") {
                        await resetCounter("the damaged setup file names no counter this PC holds");
                    } else if (recovered) {
                        setup = recovered;
                    } else {
                        // Hold: no worker, no wipe. The wizard offers the counter the DB
                        // still binds to this PC, and saving it writes a clean file.
                        console.error("[main] Holding: counter-setup.json could not be rebuilt. Nothing was emptied.");
                        void dialog.showMessageBox({
                            type: "warning",
                            title: "Counter setup needs a check",
                            message: "This counter's setup file was damaged and could not be rebuilt.",
                            detail: "Nothing on this PC has been deleted. Run counter setup again — it offers the counter this PC is bound to.",
                        });
                    }
                }
                if (setup) startSyncWorker(replica.syncUrl);
                else if (setupState.kind === "absent") {
                    console.log("[main] No counter claimed yet — sync worker stays down until onboarding completes.");
                    // A PC without a counter holds no business data. A release learned
                    // of at the last run, or an onboarding that never finished, may have
                    // left the dataset here. No-op on a fresh install. Only for a file
                    // that is truly not there — a damaged one is handled above.
                    await wipeReplica(localDbUrl);
                }
                // The outbox flusher runs INSIDE the Next server (see src/instrumentation.ts):
                // pushing needs the Supabase client, which lives there. Driving it from here
                // meant an HTTP hop that requireAuth() rejected with 401 on every attempt.
                // Read-routing (prismaClient.ts / counterMode.ts) gates on COUNTER_PC, not on
                // LOCAL_DATABASE_URL's mere presence — set it here, from the actual detection
                // result, rather than requiring it baked into the installer. serverManager.ts
                // forks the Next server with `env: {...process.env}`, so this is inherited.
                process.env.COUNTER_PC = "true";
                // Owner decision: the app must SAY which database it picked, so the choice is
                // never invisible. `counterStatus()` reports the same value to the in-app badge
                // from LOCAL_DATABASE_SOURCE; this is the boot-time half of that.
                sendBootProgress(`Local database ready (${process.env.LOCAL_DATABASE_SOURCE ?? "embedded"}).`);
                // Hold the splash until the replica has actually filled. An empty replica
                // does not error, it returns fewer rows — see waitForReplica.ts. Instant
                // on every launch after the first, because `ready` is already true.
                // Not on a PC with no counter: nothing is filling that replica, so this
                // would sit on the splash for the whole timeout before showing the wizard.
                if (setup) {
                    const wait = await waitForReplicaReady(localDbUrl, sendBootProgress);
                    // Verify the binding before the app opens. Online, the worker has
                    // just pulled pos_counters, so the replica IS the DB's answer; offline
                    // it is the last answer the DB gave. No cloud call either way.
                    //
                    // "timeout" means the replica never completed a first pull — an
                    // onboarding that did not finish. Onboarding ends with the file, so a
                    // file without a filled replica is not a counter: reset, and the
                    // wizard resumes on the row the DB still binds to this PC.
                    //
                    // "error" is schema drift after an upgrade: the replica WAS ready and
                    // holds real data. Keep it — the app shows its update screen — because
                    // an offline PC could never onboard again if it were wiped here.
                    //
                    // Only while the replica is still empty, though. One that has synced
                    // before is a working counter that could not finish a pull this time
                    // (offline, after an upgrade added a table) — emptying it would throw
                    // away its unsent sales and leave an offline till unable to onboard.
                    if (wait === "timeout") {
                        if (!(await replicaHasSyncedData(localDbUrl))) {
                            await resetCounter("the replica never finished its first sync");
                        } else {
                            console.warn("[main] The replica did not report ready in time, but it holds synced data — keeping it.");
                        }
                    } else if (wait === "ready") {
                        const bound = await replicaBindsThisPc(localDbUrl, setup.counterId, counterInstallationId ? [counterInstallationId] : []);
                        if (bound === false) await resetCounter(`counter ${setup.counterNumber} no longer carries this PC`);
                    }
                }
            } else {
                // The server is up but the replica is not usable. Clear the URL
                // postgresManager set: leaving it would make prismaClient.ts build a
                // local client against an unprovisioned database, and `reportLiveDown()`
                // demotes reads to LOCAL on any transient Supabase error — turning a
                // brief network blip into pages that render with zero rows, which reads
                // as "these records were deleted" rather than "this database is empty".
                delete process.env.LOCAL_DATABASE_URL;
                delete process.env.LOCAL_DATABASE_SOURCE;
                sendBootProgress("Local database unavailable — using the live server.");
            }
        } else {
            sendBootProgress("No local database — using the live server.");
        }
    } catch (err) {
        console.error("[Main] Error during postgres initialization:", err);
    }

    // Drives the thermal printer and the QR display. Independent of the database — a
    // counter with no replica still prints — so it starts regardless of what happened above.
    startHardwareBridge();

    // The Next server needs to know WHICH machine it is, to refuse work for a counter
    // this PC no longer holds (src/shared/lib/counter/releaseGuard.ts): the installation
    // id to match against pos_counters.boundDeviceId, and where counter-setup.json lives
    // so it can tell "released" from "never set up". Inherited through serverManager's
    // `env: {...process.env}`.
    if (counterInstallationId) process.env.COUNTER_MACHINE_ID = counterInstallationId;
    process.env.COUNTER_USER_DATA = app.getPath("userData");

    sendBootProgress("Starting server…");
    let result: ServerStartResult = { url: `http://127.0.0.1:${PORT}`, ready: false };
    try {
        result = await startNextServer(Number(PORT), path.join(app.getPath("userData"), "v8-compile-cache"));
    } catch (err) {
        console.error("[Main] Error starting Next.js server:", err);
    }

    if (result.ready) {
        serverUrl = result.url;
        sendBootProgress("Almost there…");
        // Warm the routes staff actually use. This used to wait for the login page to
        // finish loading so the two would not compete for the server's single event
        // loop — but the sign-in screen is now served off disk and is already up, so
        // these seconds ARE the idle ones: the cashier is typing into the shell and
        // nothing else wants the server yet. See serverManager.ts's warmRoutes().
        warmRoutes(result.url, Array.from(new Set([...DEFAULT_WARM_ROUTES, ...loadPersistedWarmRoutes()])));

        // A cashier who never signed out still holds a session cookie, and must not be
        // shown a login screen for a session they already have. Straight in for them;
        // everyone else stays on the shell, which is now live and takes their typing.
        if (await hasStaffSession()) {
            await loadApp(result.url);
        } else {
            notifyServerReady();
        }
    } else {
        // A hidden start normally stays hidden — but a boot failure is the one thing
        // nobody can act on from an invisible window, and the tray icon alone gives no
        // clue what went wrong. So break the rule here and put the window up.
        //
        // This matters most right after setup: the installer now starts the app into
        // the tray, and that very first boot is the slow, risky one (initdb, then
        // provisioning the replica). Silence there would read as a failed install.
        if (isHiddenLaunch) showMainWindow();
        showBootError(result.url);
    }

    // If we got here by way of an update, the splash from the version before this one
    // is still on top of the till. Take it down now that there is something behind it —
    // including the boot-error page, which the cashier needs to be able to read.
    // A no-op on every ordinary start.
    clearUpdateSplash();

    // Same story for a staged update: the swap helper removes the folder it moved aside,
    // but it is a detached script and the PC may have been switched off under it. This
    // process is running, so whatever is left beside the program folder is spare — and
    // on a counter each leftover is ~600 MB.
    repairAfterSwap();

    // Counter PCs in tray/background mode can go a long time between a clean quit
    // (which is when persistVisitedRoutes() normally runs) — an abrupt power-off or
    // Windows update reboot would otherwise lose everything learned since the last
    // exit. Cheap to redo periodically since it's just a Set -> JSON.stringify.
    setInterval(persistVisitedRoutes, 10 * 60 * 1000);

    setupAutoUpdater({ isDev, landingPage: LANDING_PAGE });

    app.on("activate", () => {
        showMainWindow();
    });
});

app.on("before-quit", () => {
    isQuitting = true;
    persistVisitedRoutes();
});

/** The helpers below are down, so the quit that follows may go through. */
let helpersStopped = false;
let helpersStopping: Promise<void> | null = null;

/**
 * Stops everything this app started, in an order that leaves nothing half-done: the
 * Next server and the sync worker first — each asked, then ended, side by side since
 * neither waits on the other — then the bridge, then PostgreSQL under them. Bounded:
 * at most 5 s for the two asks (usually well under one), 5 s for pg_ctl.
 */
async function stopHelpers(): Promise<void> {
    await Promise.all([stopNextServer(3000), stopSyncWorker(5000)]);
    stopHardwareBridge();
    stopEmbeddedPostgres();
}

/**
 * Windows is signing out or shutting down. There is no time for the polite path — the
 * OS ends this process soon after the handler returns — so PostgreSQL, the part that
 * matters (a clean stop means no crash recovery at the next boot), is stopped
 * synchronously and the rest is told to go.
 */
function stopHelpersNow(): void {
    helpersStopped = true;
    void stopNextServer(0);
    void stopSyncWorker(0);
    stopHardwareBridge();
    stopEmbeddedPostgres();
}

app.on("will-quit", (event) => {
    stopAutoUpdater();
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        tray = null;
    }
    if (helpersStopped) return;
    // Held until the helpers are down. On Windows `kill()` is a hard TerminateProcess,
    // so a synchronous sweep here could only ever kill them: the flusher mid-batch, the
    // sync worker with its cycle orphaned and still writing, and PostgreSQL stopped
    // only when this launch had started it.
    event.preventDefault();
    if (helpersStopping) return;
    helpersStopping = stopHelpers()
        .catch((err) => console.error("[main] Stopping the helpers failed:", err))
        .finally(() => {
            helpersStopped = true;
            app.quit();
        });
});

app.on("window-all-closed", () => {
    if (isQuitting || process.platform === "darwin") {
        if (process.platform !== "darwin") {
            app.quit();
        }
    }
});
