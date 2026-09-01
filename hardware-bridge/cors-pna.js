// Shared CORS setup for thermal.js / qr.js.
//
// Two jobs:
//
//  1. Restrict who may drive shop hardware. `cors()` with no options answers
//     `Access-Control-Allow-Origin: *`, which let ANY website the cashier happened to
//     browse POST to the relays — paint anything on the customer-facing display, or
//     fire the thermal printer. There is no auth on these endpoints, so the origin
//     check is the only gate. Everything legitimate is a page this counter itself
//     serves (http://127.0.0.1:786, or its own LAN IP — see serverManager.ts), because
//     every client hardcodes `http://localhost:919x`: a browser on ANOTHER PC resolves
//     that to its own machine and never reaches this relay anyway.
//
//  2. Send Access-Control-Allow-Private-Network so Chrome's Private Network Access
//     check doesn't silently block fetches from a page on a public/LAN origin into
//     this http://localhost relay (private address space). Without it, direct browser
//     navigation to /health "succeeds" (PNA doesn't apply to top-level navigation)
//     while the settings page's own fetch() to /config is blocked — looking like the
//     relay is down when it isn't.

const cors = require("cors");
const os   = require("os");

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

// Refreshed rather than computed once: a counter on DHCP can change IP while the
// bridge is running, and a stale list would lock the app out of its own hardware.
let cachedHosts = null;
let cachedAt    = 0;

function allowedHosts() {
    if (cachedHosts && Date.now() - cachedAt < 60_000) return cachedHosts;
    const hosts = new Set(LOOPBACK);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === "IPv4" && !ni.internal) hosts.add(ni.address);
        }
    }
    cachedHosts = hosts;
    cachedAt    = Date.now();
    return hosts;
}

function isAllowedOrigin(origin) {
    try {
        return allowedHosts().has(new URL(origin).hostname);
    } catch {
        return false;
    }
}

function corsWithPna() {
    const base = cors({
        // A missing Origin is a non-browser caller — curl, a health probe, the Electron
        // main process. Those are already on this machine, so nothing is gained by
        // refusing them.
        origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
    });
    return (req, res, next) => {
        if (!req.headers.origin || isAllowedOrigin(req.headers.origin)) {
            res.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        base(req, res, next);
    };
}

module.exports = corsWithPna;
