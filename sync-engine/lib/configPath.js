"use strict";

const path = require("node:path");

/**
 * Where `config.json` lives.
 *
 * Beside the worker by default, which is how this ran as a standalone service and how
 * it still runs from a repo checkout.
 *
 * Inside the packaged desktop app that directory sits under Program Files: read-only
 * for the account a cashier runs as, and the wrong home for two databases' credentials
 * regardless — the file must never be packaged, only written at runtime. Electron
 * therefore writes it into its own userData directory and points here with
 * `COUNTER_SYNC_CONFIG`.
 */
function configPath() {
    return process.env.COUNTER_SYNC_CONFIG || path.resolve(__dirname, "..", "config.json");
}

module.exports = { configPath };
