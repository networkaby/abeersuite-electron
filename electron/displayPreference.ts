import { app, BrowserWindow, screen } from "electron";
import * as path from "path";
import * as fs from "fs";

// ── Screen size ──────────────────────────────────────────────────────────────
// The office screens were laid out on a large monitor. On a counter's 1366-wide
// screen they need roughly 80% zoom before the content stops asking for a
// horizontal scrollbar — that number is the owner's own measurement, not a guess,
// and DESIGN_WIDTH below is derived from it: 1366 / 0.8 ≈ 1700.
//
// Why zoom rather than smaller CSS: the screens write their small text as fixed
// pixels (`text-[10px]` / `text-[11px]`, 918 places). A CSS-only shrink would pull
// the boxes in while leaving that text at full size, so the text would spill out of
// the boxes it sits in. Zoom scales text, icons, padding and borders together, in
// exact proportion, which is precisely the result the owner already verified by
// hand at 80%.
const DESIGN_WIDTH = 1700;

/** Never shrink past legibility, never enlarge past the design size on its own. */
const MIN_AUTO_ZOOM = 0.7;
const MAX_AUTO_ZOOM = 1.0;

/** The range a person is allowed to pick, by menu, keyboard or the Settings page. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

/** Offered in Settings. "auto" is the default and is not in this list. */
export const ZOOM_STEPS = [0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25] as const;

export type DisplayPreference =
    | { mode: "auto" }
    | { mode: "fixed"; factor: number };

const PREF_FILE = "display.json";

function prefPath(): string {
    return path.join(app.getPath("userData"), PREF_FILE);
}

function clampZoom(factor: number): number {
    if (!Number.isFinite(factor)) return 1;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
}

/**
 * The zoom this screen wants when nobody has chosen one.
 *
 * Width only, on purpose. A tall list scrolling vertically is how a table is meant to
 * behave; it is the sideways scrollbar that makes a screen feel broken, and that one
 * is decided by width alone. Bringing height into the formula pushed a normal
 * 1366 x 768 counter down to 75%, smaller than the owner asked for.
 */
export function automaticZoomFactor(workAreaWidth: number): number {
    const stepped = Math.round((workAreaWidth / DESIGN_WIDTH) * 20) / 20; // nearest 0.05
    return Math.min(MAX_AUTO_ZOOM, Math.max(MIN_AUTO_ZOOM, stepped));
}

/** Missing, unreadable or malformed all mean "never answered" — and the answer is auto. */
export function readDisplayPreference(): DisplayPreference {
    try {
        const parsed = JSON.parse(fs.readFileSync(prefPath(), "utf8")) as {
            mode?: unknown;
            factor?: unknown;
        };
        if (parsed.mode === "fixed" && typeof parsed.factor === "number") {
            return { mode: "fixed", factor: clampZoom(parsed.factor) };
        }
    } catch {
        // fall through
    }
    return { mode: "auto" };
}

export function writeDisplayPreference(pref: DisplayPreference): void {
    try {
        const body =
            pref.mode === "fixed"
                ? { mode: "fixed", factor: clampZoom(pref.factor) }
                : { mode: "auto" };
        fs.writeFileSync(prefPath(), JSON.stringify({ ...body, updated: new Date().toISOString() }));
    } catch (err) {
        console.warn("[main] Could not save the screen size preference:", err);
    }
}

/** The work area of the display a window sits on, or of the primary display if it has none yet. */
function workAreaFor(win?: BrowserWindow): Electron.Rectangle {
    try {
        if (win && !win.isDestroyed()) {
            return screen.getDisplayMatching(win.getBounds()).workArea;
        }
    } catch {
        // A window mid-teardown, or a display that vanished — fall back to primary.
    }
    return screen.getPrimaryDisplay().workArea;
}

/** What `win` should be zoomed to right now, given the saved preference and its screen. */
export function resolveZoomFactor(win?: BrowserWindow): number {
    const pref = readDisplayPreference();
    if (pref.mode === "fixed") return clampZoom(pref.factor);
    return automaticZoomFactor(workAreaFor(win).width);
}

/**
 * Applies the resolved zoom to `win`, now and after every page it loads.
 *
 * The re-apply is not belt-and-braces: Electron keeps zoom per origin, and this app
 * moves between a `data:` splash, a `data:` boot-error page and http://localhost
 * during one boot. A factor set on the splash does not carry across to the app.
 */
export function attachZoom(win: BrowserWindow): void {
    const apply = () => {
        if (win.isDestroyed()) return;
        try {
            win.webContents.setZoomFactor(resolveZoomFactor(win));
        } catch (err) {
            console.warn("[main] Could not apply the screen zoom:", err);
        }
    };
    win.webContents.on("did-finish-load", apply);
    // Ctrl + mouse wheel. The menu's Zoom In / Zoom Out do not raise this event, which
    // is why those two carry their own handlers in the application menu.
    win.webContents.on("zoom-changed", () => {
        setTimeout(() => rememberCurrentZoom(win), 0);
    });
    apply();
}

/** Saves whatever `win` is zoomed to as an explicit choice, so a restart keeps it. */
function rememberCurrentZoom(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    try {
        writeDisplayPreference({ mode: "fixed", factor: win.webContents.getZoomFactor() });
    } catch {
        // Nothing to save if the window went away mid-gesture.
    }
}

/** Menu / keyboard zoom. `delta` of 0 means "back to automatic". */
export function stepZoom(win: BrowserWindow | null, delta: number): void {
    if (!win || win.isDestroyed()) return;
    if (delta === 0) {
        writeDisplayPreference({ mode: "auto" });
        applyPreferenceToAllWindows();
        return;
    }
    const next = clampZoom(win.webContents.getZoomFactor() + delta);
    writeDisplayPreference({ mode: "fixed", factor: next });
    applyPreferenceToAllWindows();
}

/** Re-reads the saved preference and pushes it to every open window, live. */
export function applyPreferenceToAllWindows(): void {
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
            win.webContents.setZoomFactor(resolveZoomFactor(win));
        } catch {
            // A window closing while Settings is being changed is not an error.
        }
    }
}

/**
 * Shrinks a window's intended size down to what the screen can actually show.
 *
 * Without this the app opened at a fixed 1366 x 860 on every machine, so a counter
 * with a 1366 x 768 screen got a window about 130px taller than the screen it was on.
 * The bottom of every page then sat under the taskbar or off the screen entirely —
 * scrollbars that no amount of zoom would have removed.
 */
export function fitToScreen(desired: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
}): { width: number; height: number; minWidth: number; minHeight: number; oversized: boolean } {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(desired.width, area.width);
    const height = Math.min(desired.height, area.height);
    return {
        width,
        height,
        // A minimum larger than the screen would undo the fit the moment the window
        // was shown, so the floor comes down with the ceiling.
        minWidth: Math.min(desired.minWidth, width),
        minHeight: Math.min(desired.minHeight, height),
        oversized: width < desired.width || height < desired.height,
    };
}
