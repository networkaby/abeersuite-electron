// QR display relay (DQ11 320×480 RGB565 over USB serial @ 921600).
// Listens on cfg.relayPort (default 9192). Endpoints kept identical to the
// standalone qr-display relay so the web app (QrDisplaySettingsPage + POS
// integration) doesn't need any changes.

const express  = require("express");
const cors     = require("./cors-pna");
const fs       = require("fs");
const path     = require("path");
const { exec } = require("child_process");
const sharp    = require("sharp");
const QRCode   = require("qrcode");

// ── DQ11 constants ────────────────────────────────────────────────────────────

const WIDTH  = 320;
const HEIGHT = 480;

const fmt = (n) =>
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const escapeXml = (s) =>
    String(s).replace(/[<>&"']/g, (c) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&apos;" }[c]));

// ── RGB888 → DQ11 RGB565 big-endian, vertical flip ────────────────────────────

function rgb888BufferToDq11Bytes(rgb) {
    const out = Buffer.alloc(WIDTH * HEIGHT * 2);
    let o = 0;
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const i = (y * WIDTH + x) * 3;
            const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
            const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
            out[o++] = (rgb565 >> 8) & 0xFF;
            out[o++] = rgb565 & 0xFF;
        }
    }
    return out;
}

// ── Rendering helpers (sharp) ─────────────────────────────────────────────────

async function svgToRgb(svgString) {
    const png = await sharp(Buffer.from(svgString)).png().toBuffer();
    return canvasToRgb(png);
}

async function canvasToRgb(pngBuffer) {
    const { data } = await sharp(pngBuffer)
        .resize(WIDTH, HEIGHT, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return data;
}

async function fileToRgb(filePath) {
    const { data } = await sharp(filePath)
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "center" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return data;
}

// ── POS screens ───────────────────────────────────────────────────────────────

async function renderCustomer({ name, level, loyaltyPoints, lastVisitAt, discountPct, balanceDue }) {
    const levelColors = {
        Platinum: "#7c3aed",
        Gold:     "#d97706",
        Silver:   "#64748b",
        Bronze:   "#92400e",
    };
    const color = levelColors[level] || "#1976d2";
    const points = Number(loyaltyPoints || 0);
    const disc   = Number(discountPct  || 0);
    const due    = Number(balanceDue   || 0);
    const lastVisit = lastVisitAt
        ? new Date(lastVisitAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : null;

    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <rect x="0" y="0" width="${WIDTH}" height="70" fill="${color}"/>
        <text x="160" y="44" font-family="sans-serif" font-size="22" font-weight="bold" fill="#fff" text-anchor="middle">Welcome back!</text>

        <text x="160" y="135" font-family="sans-serif" font-size="24" font-weight="bold" fill="#000" text-anchor="middle">${escapeXml(String(name || "Guest"))}</text>

        ${level ? `
          <rect x="95" y="160" width="130" height="32" rx="16" fill="${color}"/>
          <text x="160" y="182" font-family="sans-serif" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">${escapeXml(String(level).toUpperCase())} MEMBER</text>
        ` : ""}

        ${points > 0 ? `
          <text x="160" y="245" font-family="sans-serif" font-size="13" fill="#666" text-anchor="middle">Loyalty Points</text>
          <text x="160" y="282" font-family="sans-serif" font-size="32" font-weight="bold" fill="#0a7e3d" text-anchor="middle">${points.toLocaleString("en-IN")}</text>
        ` : ""}

        ${disc > 0 ? `
          <rect x="40" y="320" width="240" height="46" rx="8" fill="#fef3c7" stroke="#f59e0b" stroke-width="1"/>
          <text x="160" y="349" font-family="sans-serif" font-size="15" font-weight="bold" fill="#92400e" text-anchor="middle">${disc}% loyalty discount today!</text>
        ` : ""}

        ${due > 0 ? `
          <text x="160" y="405" font-family="sans-serif" font-size="13" fill="#c00" text-anchor="middle">Outstanding balance: ₹${fmt(due)}</text>
        ` : ""}

        ${lastVisit ? `<text x="160" y="450" font-family="sans-serif" font-size="12" fill="#888" text-anchor="middle">Last visit: ${escapeXml(lastVisit)}</text>` : ""}
      </svg>`;
    return svgToRgb(svg);
}

async function renderCart({ items = [], subtotal = 0, discount = 0, total = 0, title = "YOUR ORDER", discounts = [], charges = [], gst = 0, savings = null }) {
    // Ladder mode: customer-facing "Counter discount" pool + "You saved" hero.
    // Falls back to the legacy Subtotal/Discount block when POS sends no rows.
    const ladderRows = (Array.isArray(discounts) ? discounts : []).filter((d) => d && d.amount > 0);
    const chargeRows = (Array.isArray(charges) ? charges : []).filter((c) => c && Math.abs(c.amount) > 0.005);
    const ladderMode = ladderRows.length > 0;
    const heroOn     = ladderMode && savings && savings.amount > 0;
    const gstOn      = ladderMode && Number(gst) > 0.005;

    const headerH  = 50;
    const rowH     = 22;
    const mrpH     = 13;   // extra height for a struck-MRP sub-line
    // Bottom totals block: divider + (Gross + N discount rows + charge rows + GST | Subtotal + maybe discount) + hero + 56px TOTAL bar.
    const blockLines = ladderMode ? (1 + ladderRows.length + chargeRows.length + (gstOn ? 1 : 0)) : (1 + (discount > 0 ? 1 : 0));
    const heroH    = heroOn ? 26 : 0;
    const totalBarY = HEIGHT - 56;
    // Totals block top — computed FIRST so items can never overlap it.
    const ty       = totalBarY - heroH - blockLines * 24 - 6;

    // Gross = Σ tag totals over ALL items (not just the visible ones).
    const lineOf  = (it) => { const q = Number(it.qty) || 0; return ladderMode && it.barcode != null ? it.barcode * q : q * (Number(it.price) || 0); };
    const hasMrp  = (it, ln) => ladderMode && it.mrp != null && it.mrp * (Number(it.qty) || 0) > ln;
    const heightOf = (it) => rowH + (hasMrp(it, lineOf(it)) ? mrpH : 0);
    const grossCalc = items.reduce((s, it) => s + lineOf(it), 0);

    // Fit the most-recent items into the space above the totals block by ACTUAL
    // height (incl. MRP sub-lines), reserving room for a "+N more" line.
    const itemTop   = headerH + 6;
    const itemAvail = ty - itemTop - 8;
    let used = 0;
    const visible = [];
    for (let i = items.length - 1; i >= 0; i--) {
        const h = heightOf(items[i]);
        if (visible.length && used + h > itemAvail) break;
        used += h; visible.unshift(items[i]);
    }
    let overflow = items.length - visible.length;
    if (overflow > 0 && visible.length > 1 && itemAvail - used < 18) { used -= heightOf(visible[0]); visible.shift(); overflow = items.length - visible.length; }

    let rowsSvg = "";
    let y = itemTop + 16;
    for (const it of visible) {
        const name = escapeXml(String(it.name || "").slice(0, 20));
        const qty  = Number(it.qty) || 0;
        const line = lineOf(it);
        rowsSvg += `
          <text x="10"  y="${y}" font-family="sans-serif" font-size="14" fill="#000">${name}</text>
          <text x="195" y="${y}" font-family="sans-serif" font-size="14" fill="#444" text-anchor="middle">×${escapeXml(String(it.qty || 1))}</text>
          <text x="310" y="${y}" font-family="sans-serif" font-size="14" fill="#000" text-anchor="end">${fmt(line)}</text>`;
        // Struck MRP (SVG supports line-through, unlike the thermal printer).
        if (hasMrp(it, line)) {
            rowsSvg += `
          <text x="310" y="${y + mrpH}" font-family="sans-serif" font-size="11" fill="#999" text-anchor="end" text-decoration="line-through">MRP ${fmt(it.mrp * qty)}</text>`;
            y += mrpH;
        }
        y += rowH;
    }
    if (overflow > 0) {
        rowsSvg += `<text x="160" y="${Math.min(y, ty - 6)}" font-family="sans-serif" font-size="12" fill="#666" text-anchor="middle">… +${overflow} more</text>`;
    }

    let totalsSvg = `<line x1="10" y1="${ty}" x2="310" y2="${ty}" stroke="#000"/>`;
    let ly = ty + 22;
    if (ladderMode) {
        totalsSvg += `
          <text x="10"  y="${ly}" font-family="sans-serif" font-size="15" fill="#000">Gross</text>
          <text x="310" y="${ly}" font-family="sans-serif" font-size="15" fill="#000" text-anchor="end">${fmt(grossCalc)}</text>`;
        for (const d of ladderRows) {
            ly += 24;
            totalsSvg += `
          <text x="10"  y="${ly}" font-family="sans-serif" font-size="15" fill="#c00">${escapeXml(String(d.label || "Discount").slice(0, 22))}</text>
          <text x="310" y="${ly}" font-family="sans-serif" font-size="15" fill="#c00" text-anchor="end">−${fmt(d.amount)}</text>`;
        }
        for (const c of chargeRows) {
            ly += 24;
            const neg = c.amount < 0;
            totalsSvg += `
          <text x="10"  y="${ly}" font-family="sans-serif" font-size="15" fill="${neg ? "#c00" : "#333"}">${escapeXml(String(c.label || "Charge").slice(0, 22))}</text>
          <text x="310" y="${ly}" font-family="sans-serif" font-size="15" fill="${neg ? "#c00" : "#333"}" text-anchor="end">${neg ? "−" : "+"}${fmt(Math.abs(c.amount))}</text>`;
        }
    } else {
        totalsSvg += `
          <text x="10"  y="${ly}" font-family="sans-serif" font-size="16" fill="#000">Subtotal</text>
          <text x="310" y="${ly}" font-family="sans-serif" font-size="16" fill="#000" text-anchor="end">${fmt(subtotal)}</text>`;
        if (discount > 0) {
            ly += 24;
            totalsSvg += `
          <text x="10"  y="${ly}" font-family="sans-serif" font-size="16" fill="#c00">Discount</text>
          <text x="310" y="${ly}" font-family="sans-serif" font-size="16" fill="#c00" text-anchor="end">−${fmt(discount)}</text>`;
        }
    }
    if (heroOn) {
        ly += 24;
        totalsSvg += `
          <text x="310" y="${ly}" font-family="sans-serif" font-size="15" font-weight="bold" fill="#0a7d2c" text-anchor="end">You saved ₹${fmt(savings.amount)} (${savings.pct}%)</text>`;
    }
    // GST is INCLUDED in the inclusive amounts above — a note above the TOTAL bar,
    // not an additive row (so the column reads correctly).
    if (gstOn) {
        ly += 22;
        totalsSvg += `
          <text x="310" y="${ly}" font-family="sans-serif" font-size="12" fill="#666" text-anchor="end">incl. GST (CGST+SGST) ₹${fmt(gst)}</text>`;
    }
    totalsSvg += `
      <rect x="0" y="${totalBarY}" width="${WIDTH}" height="56" fill="#000"/>
      <text x="10"  y="${totalBarY + 38}" font-family="sans-serif" font-size="22" font-weight="bold" fill="#fff">TOTAL</text>
      <text x="310" y="${totalBarY + 38}" font-family="sans-serif" font-size="26" font-weight="bold" fill="#fff" text-anchor="end">₹${fmt(total)}</text>`;

    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <rect x="0" y="0" width="${WIDTH}" height="${headerH}" fill="#1976d2"/>
        <text x="160" y="32" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">${escapeXml(title)}</text>
        ${rowsSvg}
        ${totalsSvg}
      </svg>`;
    return svgToRgb(svg);
}

async function renderPayment({ total = 0, cashPaid = 0, balance = 0 }) {
    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <rect x="0" y="0" width="${WIDTH}" height="60" fill="#1976d2"/>
        <text x="160" y="40" font-family="sans-serif" font-size="22" font-weight="bold" fill="#fff" text-anchor="middle">PAYMENT</text>

        <text x="20"  y="130" font-family="sans-serif" font-size="18" fill="#444">Total</text>
        <text x="300" y="130" font-family="sans-serif" font-size="22" font-weight="bold" fill="#000" text-anchor="end">₹${fmt(total)}</text>

        <text x="20"  y="180" font-family="sans-serif" font-size="18" fill="#444">Cash Paid</text>
        <text x="300" y="180" font-family="sans-serif" font-size="22" font-weight="bold" fill="#0a0" text-anchor="end">₹${fmt(cashPaid)}</text>

        <line x1="20" y1="210" x2="300" y2="210" stroke="#000"/>

        <rect x="0" y="280" width="${WIDTH}" height="120" fill="#c00"/>
        <text x="160" y="320" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">BALANCE DUE</text>
        <text x="160" y="375" font-family="sans-serif" font-size="44" font-weight="bold" fill="#fff" text-anchor="middle">₹${fmt(balance)}</text>
      </svg>`;
    return svgToRgb(svg);
}

async function renderUpi({ vpa, amount, payeeName, caption, payeeNameDefault }) {
    if (!vpa) throw new Error("vpa required");
    const amt = Number(amount || 0);
    const pn  = encodeURIComponent(payeeName || payeeNameDefault || "Merchant");
    const pa  = encodeURIComponent(vpa);
    const upiUrl = `upi://pay?pa=${pa}&pn=${pn}&am=${amt.toFixed(2)}&cu=INR`;

    const qrPng = await QRCode.toBuffer(upiUrl, {
        type: "png",
        width: 320,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
    });

    const captionText = caption || `Pay ₹${fmt(amt)} to ${payeeName || payeeNameDefault || "Merchant"}`;
    const captionSvg = `
      <svg width="${WIDTH}" height="${HEIGHT - 320}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <text x="160" y="65" font-family="sans-serif" font-size="18" font-weight="bold" fill="#000" text-anchor="middle">${escapeXml(captionText)}</text>
        <text x="160" y="105" font-family="sans-serif" font-size="14" fill="#666" text-anchor="middle">Scan with any UPI app</text>
      </svg>`;
    const captionPng = await sharp(Buffer.from(captionSvg)).png().toBuffer();

    const composed = await sharp({
        create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
        .composite([
            { input: qrPng,      top: 0,   left: 0 },
            { input: captionPng, top: 320, left: 0 },
        ])
        .png()
        .toBuffer();

    return canvasToRgb(composed);
}

// ── Product preview (single item, not on the bill yet) ────────────────────────
// POS Product Explorer hover — the customer sees the actual item (photo, name,
// price) so a cashier can show it "without the real product in hand" before
// adding it. Distinct screen from renderCart (which is the running bill).

async function fetchImageBuffer(url) {
    if (!url) return null;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null; // no photo, slow shop link, bad URL — fall back to text-only
    }
}

async function renderProduct({ name, price = 0, mrp, image }) {
    const photoH = 300;
    const cardH  = HEIGHT - photoH;
    const showMrp = mrp != null && mrp > price;

    const cardSvg = `
      <svg width="${WIDTH}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#fff"/>
        <line x1="0" y1="0" x2="${WIDTH}" y2="0" stroke="#eee"/>
        <text x="10" y="34" font-family="sans-serif" font-size="18" font-weight="bold" fill="#000">${escapeXml(String(name || "").slice(0, 26))}</text>
        ${showMrp ? `<text x="10" y="62" font-family="sans-serif" font-size="13" fill="#999" text-decoration="line-through">MRP ₹${fmt(mrp)}</text>` : ""}
        <rect x="0" y="${cardH - 66}" width="${WIDTH}" height="66" fill="#7c3aed"/>
        <text x="10" y="${cardH - 24}" font-family="sans-serif" font-size="26" font-weight="bold" fill="#fff">₹${fmt(price)}</text>
        <text x="${WIDTH - 10}" y="${cardH - 24}" font-family="sans-serif" font-size="12" fill="#e9d5ff" text-anchor="end">Ask us to add it!</text>
      </svg>`;
    const cardPng = await sharp(Buffer.from(cardSvg)).png().toBuffer();

    const imgBuf = await fetchImageBuffer(image);
    let photoPng = null;
    if (imgBuf) {
        try {
            photoPng = await sharp(imgBuf)
                .resize(WIDTH, photoH, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
                .png()
                .toBuffer();
        } catch {
            photoPng = null; // corrupt/unsupported image — text-only card below
        }
    }

    const composite = photoPng
        ? [{ input: photoPng, top: 0, left: 0 }, { input: cardPng, top: photoH, left: 0 }]
        // No photo — centre the card vertically rather than pin it under an empty gap.
        : [{ input: cardPng, top: Math.round((HEIGHT - cardH) / 2), left: 0 }];

    const composed = await sharp({
        create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
        .composite(composite)
        .png()
        .toBuffer();

    return canvasToRgb(composed);
}

async function renderThankyou({ amount, message }) {
    const amt = Number(amount || 0);
    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#0a7e3d"/>
        <text x="160" y="170" font-family="sans-serif" font-size="44" font-weight="bold" fill="#fff" text-anchor="middle">Thank You</text>
        ${amt > 0 ? `<text x="160" y="240" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">Paid ₹${fmt(amt)}</text>` : ""}
        <text x="160" y="320" font-family="sans-serif" font-size="18" fill="#fff" text-anchor="middle">${escapeXml(message || "Visit again!")}</text>
      </svg>`;
    return svgToRgb(svg);
}

async function renderBlank() {
    return Buffer.alloc(WIDTH * HEIGHT * 3, 0);
}

async function renderWelcomeFallback(companyName) {
    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#1976d2"/>
        <text x="160" y="220" font-family="sans-serif" font-size="32" font-weight="bold" fill="#fff" text-anchor="middle">Welcome</text>
        <text x="160" y="270" font-family="sans-serif" font-size="18" fill="#fff" text-anchor="middle">${escapeXml(companyName || "")}</text>
      </svg>`;
    return svgToRgb(svg);
}

// ── Serial send (queued — only one open at a time) ────────────────────────────

function sendToDq11Once(comPort, baud, bytes) {
    return new Promise((resolve, reject) => {
        try {
            const { SerialPort } = require("serialport");
            const port = new SerialPort({ path: comPort, baudRate: baud });
            let settled = false;
            const finish = (err) => { if (settled) return; settled = true; try { port.close(); } catch {} err ? reject(err) : resolve(); };
            port.on("open", () => {
                port.write(bytes, (err) => {
                    if (err) return finish(err);
                    port.drain((dErr) => finish(dErr));
                });
            });
            port.on("error", finish);
        } catch {
            reject(new Error("serialport not available. Run: pnpm install"));
        }
    });
}

function listComPorts() {
    return new Promise((resolve) => {
        try {
            const { SerialPort } = require("serialport");
            SerialPort.list()
                .then((ports) => resolve(ports.map((p) => ({ path: p.path, description: p.manufacturer || p.friendlyName || "" }))))
                .catch(() => resolve([]));
        } catch {
            exec("wmic path Win32_SerialPort get DeviceID /format:list", (err, stdout) => {
                if (err) return resolve([]);
                const ids = stdout.split(/\r?\n/).map((l) => l.replace(/^DeviceID=/, "").trim()).filter(Boolean);
                resolve(ids.map((p) => ({ path: p, description: "" })));
            });
        }
    });
}

// ── start() — boots the QR display Express app ───────────────────────────────

function start({ getConfig, setConfig }) {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: "2mb" }));

    const initialCfg = getConfig();
    const RELAY_PORT = process.env.QR_RELAY_PORT || initialCfg.relayPort || 9192;

    // ── Display pipeline (queued so concurrent calls serialize) ───────────────

    let sendChain = Promise.resolve();

    async function display(rgbBuffer) {
        const cfg = getConfig();
        if (!cfg.comPort) throw new Error("comPort not configured. Edit config.json or POST /config.");
        const bytes = rgb888BufferToDq11Bytes(rgbBuffer);
        const job   = sendChain.then(() => sendToDq11Once(cfg.comPort, cfg.baudRate || 921600, bytes));
        sendChain   = job.catch(() => {});
        return job;
    }

    // ── Idle slideshow ────────────────────────────────────────────────────────

    let idleTimer   = null;
    let idleIndex   = 0;
    let idleFiles   = [];
    let resumeTimer = null;

    function loadIdleFiles() {
        const cfg = getConfig();
        const folder = cfg.idleFolder && cfg.idleFolder.trim()
            ? cfg.idleFolder
            : path.join(__dirname, "assets", "idle");
        if (!fs.existsSync(folder)) return [];
        try {
            return fs.readdirSync(folder)
                .filter((f) => /\.(png|jpe?g|jfif|bmp|gif|webp)$/i.test(f))
                .sort()
                .map((f) => path.join(folder, f));
        } catch {
            return [];
        }
    }

    function stopIdle() {
        if (idleTimer)   { clearTimeout(idleTimer);   idleTimer   = null; }
        if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    }

    async function tickIdle() {
        const cfg = getConfig();
        const interval = Math.max(1000, Number(cfg.idleIntervalMs) || 5000);

        if (idleFiles.length === 0) {
            try {
                await display(await renderWelcomeFallback(cfg.companyName));
            } catch (e) {
                console.error("[qr:idle] welcome fallback failed:", e.message);
            }
            return;
        }

        const file = idleFiles[idleIndex % idleFiles.length];
        idleIndex++;
        try {
            await display(await fileToRgb(file));
        } catch (e) {
            console.error("[qr:idle] failed to show", path.basename(file), "—", e.message);
        }
        idleTimer = setTimeout(tickIdle, interval);
    }

    function startIdle() {
        stopIdle();
        idleFiles = loadIdleFiles();
        idleIndex = 0;
        tickIdle();
    }

    function scheduleResumeIdle(ms) {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => { resumeTimer = null; startIdle(); }, ms);
    }

    async function showActive(rgbBuffer, { resumeIdleInMs } = {}) {
        stopIdle();
        await display(rgbBuffer);
        if (resumeIdleInMs && resumeIdleInMs > 0) scheduleResumeIdle(resumeIdleInMs);
    }

    // ── Routes ───────────────────────────────────────────────────────────────

    app.get("/health", (_req, res) => {
        const cfg = getConfig();
        res.json({
            ok:       true,
            comPort:  cfg.comPort,
            baudRate: cfg.baudRate || 921600,
            idle:     { running: !!idleTimer, files: idleFiles.length },
        });
    });

    app.get("/config", (_req, res) => {
        try { res.json(getConfig()); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post("/config", (req, res) => {
        try {
            const updated = setConfig(req.body || {});
            console.log("[qr:config] updated:", req.body);
            res.json({ ok: true, config: updated });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get("/ports", async (_req, res) => res.json(await listComPorts()));

    app.post("/pos/customer", async (req, res) => {
        try {
            const rgb = await renderCustomer(req.body || {});
            await showActive(rgb);
            res.json({ ok: true });
        } catch (err) {
            console.error("[qr:customer]", err.message);
            res.status(503).json({ error: err.message });
        }
    });

    app.post("/pos/cart", async (req, res) => {
        try {
            const rgb = await renderCart(req.body || {});
            await showActive(rgb);
            res.json({ ok: true });
        } catch (err) {
            console.error("[qr:cart]", err.message);
            res.status(503).json({ error: err.message });
        }
    });

    app.post("/pos/payment", async (req, res) => {
        try {
            const rgb = await renderPayment(req.body || {});
            await showActive(rgb);
            res.json({ ok: true });
        } catch (err) {
            console.error("[qr:payment]", err.message);
            res.status(503).json({ error: err.message });
        }
    });

    app.post("/pos/upi", async (req, res) => {
        try {
            const cfg = getConfig();
            const payload = {
                ...req.body,
                vpa:              req.body?.vpa || cfg.upiPayeeVpa,
                payeeName:        req.body?.payeeName || cfg.upiPayeeName,
                payeeNameDefault: cfg.upiPayeeName,
            };
            if (!payload.vpa) return res.status(400).json({ error: "vpa missing (set upiPayeeVpa in config or pass in body)" });
            const rgb = await renderUpi(payload);
            await showActive(rgb);
            res.json({ ok: true });
        } catch (err) {
            console.error("[qr:upi]", err.message);
            res.status(503).json({ error: err.message });
        }
    });

    app.post("/pos/product", async (req, res) => {
        try {
            const rgb = await renderProduct(req.body || {});
            await showActive(rgb);
            res.json({ ok: true });
        } catch (err) {
            console.error("[qr:product]", err.message);
            res.status(503).json({ error: err.message });
        }
    });

    app.post("/pos/thankyou", async (req, res) => {
        try {
            const cfg = getConfig();
            const rgb = await renderThankyou(req.body || {});
            await showActive(rgb, { resumeIdleInMs: Number(cfg.thankyouDurationMs) || 4000 });
            res.json({ ok: true });
        } catch (err) {
            console.error("[qr:thankyou]", err.message);
            res.status(503).json({ error: err.message });
        }
    });

    app.post("/idle/start", (_req, res) => {
        try {
            startIdle();
            res.json({ ok: true, files: idleFiles.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/clear", async (_req, res) => {
        try {
            stopIdle();
            await display(await renderBlank());
            res.json({ ok: true });
        } catch (err) {
            res.status(503).json({ error: err.message });
        }
    });

    // ── Start ────────────────────────────────────────────────────────────────

    app.listen(RELAY_PORT, () => {
        const cfg = getConfig();
        console.log(`[qr] running on http://localhost:${RELAY_PORT}`);
        console.log(`[qr] COM port: ${cfg.comPort}  baud: ${cfg.baudRate || 921600}`);
        const folder = cfg.idleFolder && cfg.idleFolder.trim() ? cfg.idleFolder : path.join(__dirname, "assets", "idle");
        console.log(`[qr] idle folder: ${folder}`);
        startIdle();
    });
}

module.exports = { start };
