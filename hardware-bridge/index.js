"use strict";

/**
 * The shop-hardware bridge, now running inside AbeerSuite instead of beside it.
 *
 * This was `combined-bridge`: a separate Node service, its own installer, its own
 * autostart task, serving the thermal printer on :9191 and the QR display on :9192.
 * Owner decision 2026-08-26 — one box — so both halves moved here and Electron
 * supervises them (see electron/hardwareBridgeManager.ts).
 *
 * ── Why there are no longer any ports ───────────────────────────────────────
 * Both modules now take `{ mod, cmd, payload, id? }` messages over the Electron channel
 * and listen on nothing. The ports were inherited from `combined-bridge`, when the app
 * ran in a plain browser and HTTP was the only way to reach a local process; inside
 * Electron they bought nothing and left the printer and display drivable by anything
 * that could reach them.
 *
 * QR moved first — its calls are fire-and-forget through one facade, so nothing the
 * cashier sees depends on the reply — then thermal, whose commands all return answers
 * because a failed receipt must be reported. Browsers still speak HTTP, but to a
 * standalone combined-bridge on their OWN PC (src/shared/lib/bridge/hardwareBridge.ts):
 * an admin opening a counter from their desk drives their own hardware, which is the
 * design this bridge always had. The separate installer and scheduled task are gone
 * either way, which was the actual goal.
 *
 * ── Native modules turned out to be a non-issue ──────────────────────────────
 * The QR display was expected to need `electron-rebuild` and `asarUnpack`, because it
 * uses `serialport` and `sharp` and Electron 43 is ABI 148 while the system Node here is
 * ABI 137. Neither is needed:
 *
 *   - Both ship as **N-API** addons (sharp 0.35, serialport 13), so one binary works
 *     across ABIs. Verified by loading them under `ELECTRON_RUN_AS_NODE` — the exact
 *     runtime this process uses — where they load as cleanly as under plain Node.
 *   - `asarUnpack` never applied: these workers ship via `extraResources`, so they live
 *     beside the asar rather than inside it, and a native binary loads from a real path.
 *
 * If a future dependency is NOT N-API, that is when the rebuild step becomes real work.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Written at runtime by Electron into userData — never packaged. Same rule and the same
 * reason as the sync worker's config: the packaged directory is under Program Files and
 * read-only, and configuration that can be edited from the settings page has to live
 * somewhere writable.
 */
function configPath() {
    return process.env.HARDWARE_BRIDGE_CONFIG || path.resolve(__dirname, "config.json");
}

function loadAll() {
    const p = configPath();
    if (!fs.existsSync(p)) return {};
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (err) {
        // A corrupt file must not take the printer down: an empty config still serves
        // /health and /config, which is what the settings page needs to repair it.
        console.error(`[bridge] ${p} is not valid JSON — starting with an empty config:`, err.message);
        return {};
    }
}

function saveAll(full) {
    fs.writeFileSync(configPath(), JSON.stringify(full, null, 2), "utf8");
}

/** One accessor pair per top-level key, matching what the modules expect. */
function makeAccessors(key) {
    return {
        // Writable folder beside the config, for what a module keeps on disk.
        dataDir: path.dirname(configPath()),
        getConfig: () => loadAll()[key] || {},
        setConfig: (partial) => {
            const full = loadAll();
            full[key] = { ...(full[key] || {}), ...partial };
            saveAll(full);
            return full[key];
        },
    };
}

console.log("[bridge] starting hardware bridge (thermal printer + QR display)…");

/**
 * Each module is started independently so one failing hardware path cannot take the
 * other down. A counter with a printer but no QR display is an ordinary configuration,
 * not a fault — and the QR module opens a COM port, which is the more likely of the two
 * to be missing, in use, or unplugged.
 */
function startModule(name) {
    try {
        require(`./${name}`).start(makeAccessors(name));
    } catch (err) {
        console.error(`[bridge] ${name} failed to start — the other module keeps running:`, err.message);
    }
}

startModule("thermal");
startModule("qr");
