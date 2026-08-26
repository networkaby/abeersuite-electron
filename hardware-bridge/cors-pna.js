// Shared CORS setup for thermal.js / qr.js. Wraps the plain `cors` package with
// an Access-Control-Allow-Private-Network response so Chrome's Private Network
// Access check doesn't silently block fetches from an https:// office page
// (public origin) into this http://localhost relay (private address space).
// Without this, direct browser navigation to /health "succeeds" (PNA doesn't
// apply to top-level navigation) while the settings page's own fetch() to
// /config is blocked — looking like the relay is down when it isn't.

const cors = require("cors");

function corsWithPna() {
    const base = cors();
    return (req, res, next) => {
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        base(req, res, next);
    };
}

module.exports = corsWithPna;
