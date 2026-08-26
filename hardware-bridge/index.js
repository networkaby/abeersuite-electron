"use strict";

/**
 * The shop-hardware bridge, now running inside AbeerSuite instead of beside it.
 *
 * This was `combined-bridge`: a separate Node service, its own installer, its own
 * autostart task, serving the thermal printer on :9191 and the QR display on :9192.
 * Owner decision 2026-08-26 — one box — so the printer half moved here unchanged and
 * Electron supervises it (see electron/hardwareBridgeManager.ts).
 *
 * ── Why it still serves HTTP on the same port ────────────────────────────────
 * The obvious "native" thing would be IPC. But the app has eight-plus call sites that
 * fetch `http://localhost:9191/...` directly — PosScreen, PrintToolbar, printer
 * settings, counter identity, bridge health — and rewriting all of them at the same
 * time as moving 1300 lines of ESC/POS, Windows-spooler and COM code is two risky
 * changes at once. Keeping the interface means the renderer does not change at all
 * today; call sites can migrate to IPC afterwards behind the BRIDGE_ORIGIN seam that
 * already exists in src/shared/lib/bridge/bridgeHealth.ts. The separate installer and
 * scheduled task are gone either way, which was the actual goal.
 *
 * ── The QR display is not here yet ───────────────────────────────────────────
 * `qr.js` needs `serialport` AND `sharp`, both native, so it waits until the build
 * chain gains electron-rebuild and asarUnpack. Until then the QR relay on :9192 stays
 * a separate bridge install. Thermal deliberately went first because its native
 * dependency is optional (see the sharp shim in thermal.js) rather than structural.
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
        getConfig: () => loadAll()[key] || {},
        setConfig: (partial) => {
            const full = loadAll();
            full[key] = { ...(full[key] || {}), ...partial };
            saveAll(full);
            return full[key];
        },
    };
}

console.log("[bridge] starting hardware bridge (thermal printer)…");
require("./thermal").start(makeAccessors("thermal"));
