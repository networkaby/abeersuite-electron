// Thermal printer driver (ESC/POS).
//
// Driven over the Electron IPC channel, not HTTP. It used to run an Express app on
// cfg.relayPort (9191) — inherited from the standalone thermal-relay, back when the app
// ran in a plain browser and HTTP was the only way to reach a local process. Inside
// Electron that port bought nothing and left the printer drivable by anything that could
// reach it. Commands now arrive as `{ mod: "thermal", cmd, payload, id? }` — see COMMANDS
// in start(). A browser still talks HTTP, but to a standalone combined-bridge install on
// its own PC; see src/shared/lib/bridge/thermalBridge.ts.
//
// `cfg.relayPort` survives in saved configs and is simply unused now.

const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const net      = require("net");
const { exec } = require("child_process");
/**
 * `sharp` is a native module, and IS a dependency now — the QR display needs it
 * structurally, so it ships with the bridge (it is N-API, so no Electron rebuild is
 * involved; see the note in index.js).
 *
 * The lazy require stays anyway. It is used in exactly two places here: a fetched logo
 * (`logoToTempPng`) and the struck-through MRP label (`strikeToTempPng`). Everything
 * else the printer does — text, QR, barcodes, cut, drawer — is pure JS. Loading it on
 * demand means a counter whose sharp binary is somehow unusable still prints receipts,
 * with those two features degrading with a message that names the cause, rather than the
 * whole printer failing to load. That was worth keeping once written.
 */
let _sharp = null;
function sharp(...args) {
    if (_sharp === null) {
        try {
            // eslint-disable-next-line global-require
            _sharp = require("sharp");
        } catch {
            _sharp = false;
        }
    }
    if (_sharp === false) {
        throw new Error(
            "image printing needs the optional 'sharp' module, which is not installed in this "
            + "build — text, QR and barcode printing are unaffected"
        );
    }
    return _sharp(...args);
}
const QRCode   = require("qrcode");
const { ThermalPrinter, PrinterTypes, CharacterSet } = require("node-thermal-printer");
// Bridge version, surfaced on /health. Was `require("./package.json")` when this
// shipped as its own service; the desktop app supplies its own version instead so the
// number a counter reports matches the installer it came from.
const pkg = { version: process.env.HARDWARE_BRIDGE_VERSION || "0.0.0-dev" };

// ── Shared money formatter ──────────────────────────────────────────────────────
// Indian grouping, always 2 decimals. Used by every builder + the bespoke middles.
const fmtAmt = (n) =>
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Rupees → words (Indian system) ──────────────────────────────────────────────
// Ported verbatim from the web app's src/shared/lib/format/numberToWords.ts so the
// journal / deposit / handover slips print the SAME "Rupees … Only" line the
// browser ThermalReceiptPreview shows. Keep the two in sync.
const _ONES = [
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const _TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function _under100(n) {
    if (n < 20) return _ONES[n];
    const t = Math.floor(n / 10), o = n % 10;
    return o === 0 ? _TENS[t] : `${_TENS[t]} ${_ONES[o]}`;
}
function _under1000(n) {
    if (n < 100) return _under100(n);
    const h = Math.floor(n / 100), r = n % 100;
    return r === 0 ? `${_ONES[h]} Hundred` : `${_ONES[h]} Hundred ${_under100(r)}`;
}
function _intWords(n) {
    if (n === 0) return "Zero";
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh  = Math.floor(n / 1e5); n %= 1e5;
    const thou  = Math.floor(n / 1e3); n %= 1e3;
    const parts = [];
    if (crore) parts.push(`${_under1000(crore)} Crore`);
    if (lakh)  parts.push(`${_under1000(lakh)} Lakh`);
    if (thou)  parts.push(`${_under1000(thou)} Thousand`);
    if (n)     parts.push(_under1000(n));
    return parts.join(" ");
}
function rupeesInWords(amount) {
    const safe = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
    const rupees = Math.floor(safe);
    const paise  = Math.round((safe - rupees) * 100);
    if (rupees === 0 && paise === 0) return "Zero Rupees Only";
    const rupeePart = rupees > 0 ? `Rupees ${_intWords(rupees)}` : "";
    const paisePart = paise  > 0 ? `${_intWords(paise)} Paise` : "";
    if (rupeePart && paisePart) return `${rupeePart} and ${paisePart} Only`;
    return rupeePart ? `${rupeePart} Only` : `${paisePart} Only`;
}

// ── Logo raster ────────────────────────────────────────────────────────────────
// The browser receipt shows the org logo via <img>; to keep the ESC/POS slip on
// the SAME template, fetch that logoUrl, downscale to the printable width, flatten
// to mono-friendly grayscale, and hand node-thermal-printer a temp PNG. Cached by
// url+width so we don't re-download every print. Best-effort: any failure → no logo.
const _logoCache = new Map();
async function logoToTempPng(url, widthPx) {
    const key = `${url}@${widthPx}`;
    if (_logoCache.has(key)) return _logoCache.get(key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`logo fetch ${res.status}`);
    const png = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize({ width: widthPx, withoutEnlargement: true })
        .flatten({ background: "#ffffff" })   // drop alpha — thermal paper is white
        .grayscale()
        .png()
        .toBuffer();
    const file = path.join(os.tmpdir(), `pos-logo-${Buffer.from(key).toString("hex").slice(0, 16)}.png`);
    await fs.promises.writeFile(file, png);
    _logoCache.set(key, file);
    return file;
}

// ── Struck-MRP raster ───────────────────────────────────────────────────────────
// ESC/POS has no strike-through text style, so to show the MRP crossed out (like
// the browser receipt) we render the sub-line to a tiny mono PNG with a line
// through the price and print it as a raster. Cached by text. Best-effort: the
// caller falls back to plain "MRP <amt>" text if this throws.
const _strikeCache = new Map();
async function strikeMrpPng(label, priceStr) {
    const key = `${label}|${priceStr}`;
    if (_strikeCache.has(key)) return _strikeCache.get(key);
    const fontSz = 22;                       // px (named to avoid shadowing the `fs` module)
    const cw   = fontSz * 0.6;               // monospace char width ≈ 0.6em
    const padX = 12;                         // left indent (matches the "  MRP" inset)
    const text = `${label} ${priceStr}`;
    const w    = Math.ceil(text.length * cw) + padX + 6;
    const h    = 34;
    const numStart = padX + (label.length + 1) * cw;       // strike only the number
    const numEnd   = numStart + priceStr.length * cw;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
        + `<rect width="100%" height="100%" fill="#fff"/>`
        + `<text x="${padX}" y="24" font-family="monospace" font-size="${fontSz}" fill="#000">${text}</text>`
        + `<line x1="${numStart}" y1="16" x2="${numEnd}" y2="16" stroke="#000" stroke-width="2"/>`
        + `</svg>`;
    const png  = await sharp(Buffer.from(svg)).png().toBuffer();
    const file = path.join(os.tmpdir(), `pos-mrp-${Buffer.from(key).toString("hex").slice(0, 20)}.png`);
    await fs.promises.writeFile(file, png);
    _strikeCache.set(key, file);
    return file;
}

// ── Scan-to-pay UPI QR raster ───────────────────────────────────────────────────
// The browser footer renders a <QrSvg> for the shop's upi://pay link. ESC/POS
// native printQR isn't universal across cheap 80mm heads, so — like the logo and
// struck-MRP — we rasterize to a PNG (qrcode → sharp-free PNG buffer) and print
// it as an image. Cached by text. Best-effort: any failure → the caller skips it.
const _qrCache = new Map();
async function qrToTempPng(text) {
    if (_qrCache.has(text)) return _qrCache.get(text);
    const buf = await QRCode.toBuffer(String(text), {
        type: "png", width: 240, margin: 1, errorCorrectionLevel: "M",
    });
    const file = path.join(os.tmpdir(), `pos-qr-${Buffer.from(String(text)).toString("hex").slice(0, 20)}.png`);
    await fs.promises.writeFile(file, buf);
    _qrCache.set(text, file);
    return file;
}

// ── Shared template chrome ───────────────────────────────────────────────────────
// Helpers mirroring the browser ThermalHeader / ThermalFooter / MoneyThermalMiddle
// (src/shared/components/print/ThermalReceiptPreview.tsx) line for line, so the
// paper slip and the thermal preview are the same document. Both builders (POS ·
// voucher) are the same printer type and page size (80mm ESC/POS), which is the
// only reason they may share these. The email + website lines are gated by
// showPhone (matching the preview).
//
// The template arrives already merged with the Organisation and resolved for
// THERMAL_80MM by the app (getThermalTemplate / resolveTemplateForFormat), so
// there is no brand / footer fallback here: a blank line prints nothing.
//
// fontFamily / fontSizePx are browser-only — ESC/POS prints the head's built-in
// font, so they are deliberately not read here.
function printEmailWeb(printer, t) {
    if (t.showPhone && t.emailLine)   printer.println(t.emailLine);
    if (t.showPhone && t.websiteLine) printer.println(t.websiteLine);
}

// Bank Details block + scan-to-pay UPI QR, gated by the template's showBank flag.
// Order mirrors the browser: a divider, the labelled bank lines, then the QR with
// a "SCAN TO PAY" caption. Best-effort QR: a raster failure never blocks the slip.
async function printBankBlock(printer, t, tag) {
    if (!t.showBank || (!t.bankDetails && !t.bankUpiQr)) return;
    printer.drawLine();
    if (t.bankDetails) {
        printer.alignLeft();
        printer.bold(true);
        printer.println("Bank Details");
        printer.bold(false);
        for (const ln of String(t.bankDetails).split("\n").map((s) => s.trim()).filter(Boolean))
            printer.println(ln);
    }
    if (t.bankUpiQr) {
        try {
            const qr = await qrToTempPng(t.bankUpiQr);
            printer.alignCenter();
            await printer.printImage(qr);
            printer.println("SCAN TO PAY");
        } catch (err) {
            console.warn(`[thermal:${tag}] UPI QR skipped:`, err.message);
        }
    }
}

// Disclaimer line ("computer-generated…") under the footer, centred + small.
function printDisclaimer(printer, t) {
    if (t.disclaimerLine) {
        printer.alignCenter();
        printer.println(t.disclaimerLine);
    }
}

// The preview prints `sample.date` exactly as the page supplied it (an ISO day
// "2026-09-06" or a preformatted "06 Sept 2026, 05:30"), so the slip does too.
function displayDate(d) {
    return d == null ? "" : String(d);
}

// Kinds whose party is the supplier (mirrors isSupplierPartyKind in the preview).
const SUPPLIER_PARTY_KINDS = new Set(["PURCHASE", "PURCHASE_RETURN", "PURCHASE_ORDER", "GRN", "REJECTION_OUT", "DEBIT_NOTE"]);

// Multi-line template text → one println per trimmed, non-empty line.
function printLines(printer, text) {
    for (const ln of String(text || "").split("\n").map((x) => x.trim()).filter(Boolean))
        printer.println(ln);
}

// Header chrome — mirrors ThermalHeader + the doc-title line of ReceiptBody:
// logo → brand → HO address → branch address → phone → email/web → GSTIN →
// divider → headerLine2 (bold, centred, BELOW the divider).
async function printHeader(printer, t, branchAddress, tag) {
    printer.alignCenter();
    if (t.showLogo && t.logoUrl) {
        try {
            const logoFile = await logoToTempPng(t.logoUrl, t._cols >= 48 ? 360 : 240);
            await printer.printImage(logoFile);
        } catch (err) {
            console.warn(`[thermal:${tag}] logo skipped:`, err.message);
        }
    }
    if (t.showHeaderText && t.headerLine1) {
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(t.headerLine1);
        printer.setTextNormal();
        printer.bold(false);
    }
    if (t.showAddress && t.addressBlock) printLines(printer, t.addressBlock);
    if (t.showBranchAddress && branchAddress) printLines(printer, branchAddress);
    if (t.showPhone && t.phoneLine) printer.println(t.phoneLine);
    printEmailWeb(printer, t);
    if (t.showGstin && t.gstinLine) printer.println(t.gstinLine);
    printer.drawLine();
    if (t.headerLine2) {
        printer.bold(true);
        printer.println(t.headerLine2);
        printer.bold(false);
    }
    printer.alignLeft();
}

// Footer chrome — mirrors ThermalFooter: [divider + terms] → [bank block] →
// [signature] → divider → footer line → disclaimer → barcode → cut.
async function printFooter(printer, t, reference, tag) {
    if (t.termsText) {
        printer.drawLine();
        printer.alignLeft();
        for (const ln of String(t.termsText).split("\n")) printer.println(ln);
    }
    await printBankBlock(printer, t, tag);
    if (t.showSignature) {
        printer.println("");
        printer.println("");
        if (t.kind === "SHIFT_CLOSE") {
            printer.tableCustom([
                { text: t.signatureLabel || "Cashier Signature", align: "CENTER", width: 0.5 },
                { text: "Manager Signature",                   align: "CENTER", width: 0.5 },
            ]);
        } else {
            printer.alignRight();
            printer.println(t.signatureLabel || "Authorised Signatory");
            printer.alignLeft();
        }
    }
    printer.drawLine();
    printer.alignCenter();
    if (t.footerLine && String(t.footerLine).trim()) printer.println(String(t.footerLine).trim());
    printDisclaimer(printer, t);
    // Scannable CODE128 of the voucher number (matches the browser slip's
    // BarcodeSvg) — gated by the template. Best-effort: never block the slip.
    if (t.showBarcode && reference) {
        // HRI text (`text: 2`) is ignored by some heads (RETSOL TP806), so the
        // number is printed as a plain centred line under the bars, like the
        // preview's BarcodeSvg caption.
        try { printer.code128(String(reference), { height: 60, text: 0 }); printer.println(String(reference)); }
        catch (err) { console.warn(`[thermal:${tag}] barcode skipped:`, err.message); }
    }
    printer.cut();
}

// Tenders received against the bill (one row per tender ledger) + balance due,
// then — opt-in via the template's Party balance toggle — the party's running
// account. Mirrors ThermalReceiptsBlock in ThermalReceiptPreview.
function printReceiptsBlock(printer, sample, fmt, t) {
    const receipts = Array.isArray(sample.receipts) ? sample.receipts.filter((r) => Math.abs(Number(r.amount)) > 0.005) : [];
    const due      = Number(sample.balanceDue || 0);
    if (receipts.length === 0 && due <= 0.005) return;
    printer.drawLine();
    printer.alignLeft();
    for (const r of receipts)
        printer.tableCustom([
            { text: String(r.label || "Received").slice(0, 22), align: "LEFT",  width: 0.55 },
            { text: fmt(r.amount),                             align: "RIGHT", width: 0.45 },
        ]);
    if (due > 0.005) {
        printer.bold(true);
        printer.tableCustom([
            { text: "Balance due", align: "LEFT",  width: 0.55 },
            { text: fmt(due),      align: "RIGHT", width: 0.45 },
        ]);
        printer.bold(false);
    }
    if (t && t.showPartyBalance) {
        if (sample.balanceBefore)
            printer.tableCustom([
                { text: "Previous balance",           align: "LEFT",  width: 0.45 },
                { text: String(sample.balanceBefore), align: "RIGHT", width: 0.55 },
            ]);
        if (sample.balanceAfter) {
            printer.bold(true);
            printer.tableCustom([
                { text: "Closing balance",           align: "LEFT",  width: 0.45 },
                { text: String(sample.balanceAfter), align: "RIGHT", width: 0.55 },
            ]);
            printer.bold(false);
        }
    }
}

// Money voucher (RECEIPT / PAYMENT) cash slip — mirrors MoneyThermalMiddle:
// ref | date → divider → Received from / Paid to → phone → By: mode(s) →
// Towards: notes → divider → RECEIVED / PAID + amount → words → [party balance].
function printMoneyMiddle(printer, sample, t, fmt, formattedDate) {
    const isPayment = t.kind === "PAYMENT";
    const total     = Number(sample.total || 0);
    const modes     = (sample.lines || []).filter((l) => String(l.description || "").trim());
    printer.alignLeft();
    // Wider date column than the invoice middle — kept from when money slips
    // printed a time too; an ISO day ("2026-09-29") fits either way.
    printer.tableCustom([
        { text: String(sample.reference || ""), align: "LEFT",  width: 0.45 },
        { text: formattedDate,                  align: "RIGHT", width: 0.55 },
    ]);
    printer.drawLine();
    printer.tableCustom([
        { text: isPayment ? "Paid to:" : "Received from:", align: "LEFT",  width: 0.4, bold: true },
        { text: String(sample.partyName || "Walk-in"),     align: "RIGHT", width: 0.6, bold: true },
    ]);
    if (sample.partyPhone) {
        printer.alignRight();
        printer.println(String(sample.partyPhone));
        printer.alignLeft();
    }
    if (modes.length === 1) {
        printer.tableCustom([
            { text: "By:",                 align: "LEFT",  width: 0.3 },
            { text: modes[0].description,  align: "RIGHT", width: 0.7 },
        ]);
    } else if (modes.length > 1) {
        modes.forEach((l, i) => {
            printer.tableCustom([
                { text: `${i === 0 ? "By: " : ""}${l.description}`, align: "LEFT",  width: 0.6 },
                { text: fmt(l.amount),                              align: "RIGHT", width: 0.4 },
            ]);
        });
    }
    if (sample.notes) printer.println(`Towards: ${sample.notes}`);
    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
        { text: isPayment ? "PAID" : "RECEIVED", align: "LEFT",  width: 0.5 },
        { text: fmt(total),                      align: "RIGHT", width: 0.5 },
    ]);
    printer.bold(false);
    printer.alignCenter();
    printer.println(rupeesInWords(total));
    printer.alignLeft();
    if (t.showPartyBalance && (sample.balanceBefore || sample.balanceAfter)) {
        printer.drawLine();
        if (sample.balanceBefore)
            printer.tableCustom([
                { text: "Balance before",             align: "LEFT",  width: 0.5 },
                { text: String(sample.balanceBefore), align: "RIGHT", width: 0.5 },
            ]);
        if (sample.balanceAfter) {
            printer.bold(true);
            printer.tableCustom([
                { text: "Balance after",             align: "LEFT",  width: 0.5 },
                { text: String(sample.balanceAfter), align: "RIGHT", width: 0.5 },
            ]);
            printer.bold(false);
        }
    }
}

// ── POS receipt builder ───────────────────────────────────────────────────────

async function buildPosBuffer(data) {
    const { invoiceNumber, date, customerName, customerPhone, customerGstin, lines, subtotal, discountPct, discountAmount, tax, total, receipts, balanceDue, balanceBefore, balanceAfter, branchAddress, grossAtTag, discounts, charges, savings, hsnSummary, taxTotal, template: tpl } = data;

    // Thermal-resolved POS print template (header/address/toggles/terms/footer).
    // Sent by PosScreen (via /api/pos/sale → posTemplate) and by the invoice
    // reprint page, so this slip matches /receipt/invoice/[id]?kind=POS.
    const t = { paperWidthMm: 80, ...(tpl || {}) };

    // Usable columns from the paper size. An "80mm" head prints ~72mm wide = 48
    // columns (Font A); a "58mm" head prints ~48mm = 32. paperWidthMm may carry
    // either the roll width (80 / 58) or the printable width (72 / 48), so treat
    // anything ~70mm+ as the wide class. node-thermal-printer's tableCustom emits
    // one column more than configured, so keep a 2-column safety margin (wide →
    // 46, narrow → 30) or right-aligned amounts wrap their last digit.
    const mm        = Number(t.paperWidthMm) || 80;
    const cols      = mm >= 70 ? 48 : 32;
    const charWidth = cols - 2;
    t._cols = cols;

    const printer = new ThermalPrinter({
        type:         PrinterTypes.EPSON,
        interface:    "tcp://127.0.0.1:9999",
        characterSet: CharacterSet.PC437_USA,
        width:        charWidth,
    });

    // Ladder mode: POS sends the customer-facing "Counter discount" ladder
    // (Gross-at-tag → discount rows → Total → You saved). Older / non-ladder
    // payloads have no grossAtTag → fall back to the legacy Subtotal/Discount/Tax.
    const ladderMode = grossAtTag != null && Array.isArray(discounts);

    const fmtAmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    await printHeader(printer, t, branchAddress, "pos");

    // ── Reference + party — mirrors DefaultThermalMiddle ──────────────────
    printer.alignLeft();
    printer.tableCustom([
        { text: String(invoiceNumber || ""), align: "LEFT",  width: 0.6 },
        { text: displayDate(date),           align: "RIGHT", width: 0.4 },
    ]);
    printer.tableCustom([
        { text: "Customer:",                       align: "LEFT",  width: 0.4 },
        { text: String(customerName || "Walk-in"), align: "RIGHT", width: 0.6 },
    ]);
    if (customerPhone) { printer.alignRight(); printer.println(String(customerPhone)); printer.alignLeft(); }
    if (customerGstin) {
        printer.tableCustom([
            { text: "GSTIN:",               align: "LEFT",  width: 0.4 },
            { text: String(customerGstin),  align: "RIGHT", width: 0.6 },
        ]);
    }
    printer.drawLine();

    printer.tableCustom([
        { text: "Item",   align: "LEFT",  width: 0.5 },
        { text: "Qty",    align: "RIGHT", width: 0.15 },
        { text: "Amount", align: "RIGHT", width: 0.35 },
    ]);
    printer.drawLine();

    for (const line of lines || []) {
        // Full name — tableCustom wraps it inside the column, like the preview.
        const name = String(line.name || "");
        const qty  = Number(line.qty) || 0;
        // Ladder mode shows the public tag (barcode) total as the line amount; the
        // real per-item price stays pooled in "Counter discount" below.
        const lineAmt = ladderMode && line.barcode != null ? line.barcode * qty : line.amount;
        printer.tableCustom([
            { text: name,              align: "LEFT",  width: 0.5 },
            { text: String(line.qty),  align: "RIGHT", width: 0.15 },
            { text: fmtAmt(lineAmt),   align: "RIGHT", width: 0.35 },
        ]);
        // MRP reference, struck through (rasterized — escpos has no strike-through
        // text style). Gated by the template's showMrp toggle. Falls back to plain
        // text if the raster fails.
        if (ladderMode && t.showMrp && line.mrp != null && line.mrp * qty > lineAmt) {
            try {
                const f = await strikeMrpPng("MRP", fmtAmt(line.mrp * qty));
                printer.alignLeft();
                await printer.printImage(f);
            } catch (err) {
                console.warn("[thermal:pos] MRP strike raster skipped:", err.message);
                printer.tableCustom([
                    { text: `  MRP ${fmtAmt(line.mrp * qty)}`, align: "LEFT", width: 1 },
                ]);
            }
        }
    }

    printer.drawLine();

    if (ladderMode) {
        // Gross-at-tag → "Counter discount" + tier/loyalty/coupon rows → (HSN) → Total.
        printer.tableCustom([
            { text: "Gross",            align: "LEFT",  width: 0.55 },
            { text: fmtAmt(grossAtTag), align: "RIGHT", width: 0.45 },
        ]);
        for (const d of discounts) {
            printer.tableCustom([
                { text: String(d.label || "Discount").slice(0, 22), align: "LEFT",  width: 0.55 },
                { text: `-${fmtAmt(d.amount)}`,                      align: "RIGHT", width: 0.45 },
            ]);
        }
        // Bill-level adjustments (shipping/round-off/manual) — signed.
        if (Array.isArray(charges)) {
            for (const c of charges) {
                printer.tableCustom([
                    { text: String(c.label || "Charge").slice(0, 22),                   align: "LEFT",  width: 0.55 },
                    { text: `${c.amount < 0 ? "-" : "+"}${fmtAmt(Math.abs(c.amount))}`,  align: "RIGHT", width: 0.45 },
                ]);
            }
        }
    } else {
        printer.tableCustom([
            { text: "Subtotal", align: "LEFT",  width: 0.55 },
            { text: fmtAmt(subtotal), align: "RIGHT", width: 0.45 },
        ]);
        if (discountPct > 0) {
            printer.tableCustom([
                { text: `Discount (${discountPct}%)`, align: "LEFT",  width: 0.55 },
                { text: `-${fmtAmt(discountAmount)}`, align: "RIGHT", width: 0.45 },
            ]);
        }
        if (tax > 0) {
            printer.tableCustom([
                { text: "Tax",        align: "LEFT",  width: 0.55 },
                { text: fmtAmt(tax), align: "RIGHT", width: 0.45 },
            ]);
        }
    }
    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
        { text: "Total",       align: "LEFT",  width: 0.55 },
        { text: fmtAmt(total), align: "RIGHT", width: 0.45 },
    ]);
    printer.bold(false);
    // GST is INCLUDED in the inclusive amounts above — shown as a note on the
    // total (not a column row, so the running math reads correctly). Part of
    // the total block, so it always prints (matches the preview).
    if (ladderMode && Array.isArray(hsnSummary) && hsnSummary.length > 0) {
        const gst = taxTotal != null ? Number(taxTotal) : hsnSummary.reduce((s, h) => s + (h.cgst || 0) + (h.sgst || 0), 0);
        if (gst > 0.005) {
            printer.tableCustom([
                { text: "incl. GST (CGST+SGST)", align: "LEFT",  width: 0.6 },
                { text: fmtAmt(gst),              align: "RIGHT", width: 0.4 },
            ]);
        }
    }
    printer.bold(true);
    if (ladderMode && savings && savings.amount > 0) {
        printer.tableCustom([
            { text: "You saved", align: "LEFT",  width: 0.55 },
            { text: `${fmtAmt(savings.amount)} (${savings.pct}%)`, align: "RIGHT", width: 0.45 },
        ]);
    }
    printer.bold(false);

    // Tenders (one row per ledger) + balance due + party balance — same block
    // as the preview.
    printReceiptsBlock(printer, { receipts, balanceDue, balanceBefore, balanceAfter }, fmtAmt, t);

    await printFooter(printer, t, invoiceNumber, "pos");
    return printer.getBuffer();
}

// ── Bespoke voucher middles ──────────────────────────────────────────────────────
// One function per non-invoice document, each mirroring its browser counterpart in
// ThermalReceiptPreview so the ESC/POS slip and the browser fallback match. They
// print the middle only; the shared header + footer chrome is added by the caller.

// Journal-style GL voucher (plain CONTRA · JOURNAL) — each ledger leg as
// "Account Dr/Cr … amount" + a balancing total. Mirrors JournalThermalMiddle.
function printJournalMiddle(printer, sample, fmt, formattedDate) {
    const lines   = sample.lines || [];
    const totalDr = lines.filter((l) => l.entryType !== "CREDIT").reduce((s, l) => s + Number(l.amount || 0), 0);
    const grand   = sample.total != null ? sample.total : totalDr;
    printer.alignLeft();
    printer.tableCustom([
        { text: String(sample.reference || ""), align: "LEFT",  width: 0.6 },
        { text: formattedDate,                  align: "RIGHT", width: 0.4 },
    ]);
    printer.drawLine();
    for (const l of lines) {
        const isCr = l.entryType === "CREDIT";
        printer.tableCustom([
            { text: `${isCr ? "  " : ""}${l.description || ""} ${isCr ? "Cr" : "Dr"}`, align: "LEFT",  width: 0.62 },
            { text: fmt(l.amount),                                                     align: "RIGHT", width: 0.38 },
        ]);
    }
    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
        { text: "Total",       align: "LEFT",  width: 0.6 },
        { text: fmt(totalDr),  align: "RIGHT", width: 0.4 },
    ]);
    printer.bold(false);
    printer.alignCenter();
    printer.println(rupeesInWords(grand));
    if (sample.notes) {
        printer.alignLeft();
        printer.println(`Narration: ${sample.notes}`);
    }
}

// Cash → Bank deposit (Contra, or a cash Payment into the party's bank — then
// `paidTo` is set and the bank block is theirs) / cash → cash handover WORKSHEET — bank / ledger block +
// denomination table (filled when captured, blank pen-fill rows otherwise) +
// cheque list + total + signature(s). Mirrors DepositThermalMiddle.
function printDepositMiddle(printer, sample, fmt, formattedDate) {
    const slip       = sample.depositSlip;
    const isHandover = slip.mode === "handover";
    const counted    = slip.counted && (slip.counted.notes.length || slip.counted.cheques.length) ? slip.counted : null;
    const notes      = (slip.denominations || []).filter((d) => d >= 10);
    const hasCoins   = (slip.denominations || []).some((d) => d < 10);
    const bankLine   = [slip.bankName, slip.branch].filter(Boolean).join(", ");
    const fmtNum     = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cashTotal  = counted ? counted.notes.reduce((s, n) => s + n.denom * n.count, 0) : 0;
    const chequeTot  = counted ? counted.cheques.reduce((s, c) => s + c.amount, 0) : 0;
    const total      = counted ? cashTotal + chequeTot : (sample.total || 0);

    printer.alignCenter();
    if (!isHandover) printer.println("Worksheet - fill the bank's own slip from this");
    printer.drawLine();
    printer.alignLeft();
    printer.tableCustom([
        { text: String(sample.reference || ""), align: "LEFT",  width: 0.6 },
        { text: formattedDate,                  align: "RIGHT", width: 0.4 },
    ]);
    printer.drawLine();
    if (isHandover) {
        if (slip.fromLedger) printer.tableCustom([{ text: "From", align: "LEFT", width: 0.35 }, { text: String(slip.fromLedger), align: "RIGHT", width: 0.65 }]);
        if (slip.toLedger)   printer.tableCustom([{ text: "To",   align: "LEFT", width: 0.35 }, { text: String(slip.toLedger),   align: "RIGHT", width: 0.65 }]);
    } else {
        if (slip.paidTo)     printer.tableCustom([{ text: "Paid to", align: "LEFT", width: 0.3 }, { text: String(slip.paidTo),    align: "RIGHT", width: 0.7 }]);
        if (bankLine)        printer.tableCustom([{ text: "Bank", align: "LEFT", width: 0.3 },  { text: bankLine,                 align: "RIGHT", width: 0.7 }]);
        if (slip.paidTo && slip.accountName)
                             printer.tableCustom([{ text: "A/C Name", align: "LEFT", width: 0.3 }, { text: String(slip.accountName), align: "RIGHT", width: 0.7 }]);
        if (slip.accountNo)  printer.tableCustom([{ text: "A/C",  align: "LEFT", width: 0.35 }, { text: String(slip.accountNo),   align: "RIGHT", width: 0.65 }]);
        if (slip.ifsc)       printer.tableCustom([{ text: "IFSC", align: "LEFT", width: 0.35 }, { text: String(slip.ifsc),        align: "RIGHT", width: 0.65 }]);
        if (slip.pan)        printer.tableCustom([{ text: "PAN",  align: "LEFT", width: 0.35 }, { text: String(slip.pan),         align: "RIGHT", width: 0.65 }]);
        if (slip.fromLedger) printer.tableCustom([{ text: "From", align: "LEFT", width: 0.35 }, { text: String(slip.fromLedger),  align: "RIGHT", width: 0.65 }]);
    }
    printer.drawLine();
    printer.tableCustom([
        { text: "Note",   align: "LEFT",  width: 0.4 },
        { text: "Cnt",    align: "RIGHT", width: 0.2 },
        { text: "Amount", align: "RIGHT", width: 0.4 },
    ]);
    if (counted) {
        for (const n of counted.notes)
            printer.tableCustom([
                { text: `${n.denom} x`,           align: "LEFT",  width: 0.4 },
                { text: String(n.count),          align: "RIGHT", width: 0.2 },
                { text: fmtNum(n.denom * n.count), align: "RIGHT", width: 0.4 },
            ]);
        if (counted.notes.length) {
            printer.bold(true);
            printer.tableCustom([
                { text: "Cash",                                       align: "LEFT",  width: 0.4 },
                { text: String(counted.notes.reduce((s, n) => s + n.count, 0)), align: "RIGHT", width: 0.2 },
                { text: fmtNum(cashTotal),                            align: "RIGHT", width: 0.4 },
            ]);
            printer.bold(false);
        }
        if (counted.cheques.length) {
            printer.println("Cheques:");
            for (const c of counted.cheques)
                printer.tableCustom([
                    { text: c.account ? `${c.account} - ${c.no}` : String(c.no), align: "LEFT",  width: 0.6 },
                    { text: fmt(c.amount),                                        align: "RIGHT", width: 0.4 },
                ]);
        }
    } else {
        for (const d of notes)
            printer.tableCustom([
                { text: `${d} x`,   align: "LEFT",  width: 0.4 },
                { text: "____",     align: "RIGHT", width: 0.2 },
                { text: "_______",  align: "RIGHT", width: 0.4 },
            ]);
        if (hasCoins)
            printer.tableCustom([
                { text: "Coins",    align: "LEFT",  width: 0.4 },
                { text: "____",     align: "RIGHT", width: 0.2 },
                { text: "_______",  align: "RIGHT", width: 0.4 },
            ]);
    }
    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
        { text: isHandover ? "HANDED OVER" : "DEPOSIT", align: "LEFT",  width: 0.6 },
        { text: fmt(total),                             align: "RIGHT", width: 0.4 },
    ]);
    printer.bold(false);
    printer.alignCenter();
    printer.println(rupeesInWords(total));
    printer.println("");
    printer.println("");
    if (isHandover) {
        printer.tableCustom([
            { text: "Handed over by", align: "LEFT",  width: 0.5 },
            { text: "Received by",    align: "RIGHT", width: 0.5 },
        ]);
    } else {
        printer.alignRight();
        printer.println("Depositor's Signature");
    }
    printer.alignLeft();
}

// Repair ticket / job receipt — device / problem / accessories / estimate.
// Mirrors RepairTicketBody's ThermalTicket. Data rides in the payload's `body`
// (RepairTicketBodyData), since a repair ticket's sample.lines is empty.
function printRepairTicketMiddle(printer, body) {
    const b    = body || {};
    const cust = b.customer || {};
    const dev  = b.device || {};
    const row  = (label, val) => printer.tableCustom([
        { text: label,               align: "LEFT",  width: 0.4 },
        { text: String(val ?? "-"),  align: "RIGHT", width: 0.6 },
    ]);
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(String(b.ticketNo || ""));
    printer.setTextNormal();
    printer.bold(false);
    if (b.date) printer.println(String(b.date));
    printer.drawLine();
    printer.alignLeft();
    printer.bold(true); printer.println("CUSTOMER"); printer.bold(false);
    row("Name", cust.name ?? "-");
    row("Phone", cust.phone ?? "-");
    if (cust.email) row("Email", cust.email);
    printer.drawLine();
    printer.bold(true); printer.println("DEVICE"); printer.bold(false);
    row("Type", dev.type);
    row("Brand", dev.brand);
    row("Model", dev.model);
    printer.drawLine();
    printer.bold(true); printer.println("PROBLEM"); printer.bold(false);
    if (b.problem) printer.println(String(b.problem));
    printer.drawLine();
    printer.bold(true); printer.println("ACCESSORIES RECEIVED"); printer.bold(false);
    printer.println(b.accessories ? String(b.accessories) : "No accessories received.");
    if (b.estimatedCost != null) {
        printer.drawLine();
        row("Estimated Cost", `Rs. ${b.estimatedCost}`);
    }
    printer.drawLine();
    row("Priority", b.priority);
    if (b.createdBy) row("Created by", b.createdBy);
}

// Shipping slip / delivery challan — to/owner blocks, device rows, sign-off rows
// and the "for Service Centre use" findings box. Mirrors ShippingSlipBody
// (thermal). Data rides in the payload's `body` (ShippingSlipBodyData).
function printShippingSlipMiddle(printer, body) {
    const b     = body || {};
    const party = b.party;
    const owner = b.owner || {};
    const dev   = b.device || {};
    const on    = (v) => v === undefined || v === true;
    const row   = (label, val) => printer.tableCustom([
        { text: label,              align: "LEFT",  width: 0.4 },
        { text: String(val || "-"), align: "RIGHT", width: 0.6 },
    ]);
    printer.alignLeft();
    printer.tableCustom([
        { text: `Ticket: ${b.ticketNo || ""}`, align: "LEFT",  width: 0.5 },
        { text: `Date: ${b.date || ""}`,        align: "RIGHT", width: 0.5 },
    ]);
    if (b.ref)
        printer.tableCustom([
            { text: "Svc Ref / Job #", align: "LEFT",  width: 0.5 },
            { text: String(b.ref),     align: "RIGHT", width: 0.5 },
        ]);
    printer.drawLine();
    printer.bold(true); printer.println("TO - SERVICE CENTRE"); printer.bold(false);
    if (party) {
        printer.println(String(party.name || ""));
        if (party.address)
            for (const ln of String(party.address).split("\n").map((s) => s.trim()).filter(Boolean))
                printer.println(ln);
        if (party.phone) printer.println(`Ph: ${party.phone}`);
    } else {
        printer.println(String(b.partyNameFallback || "-"));
    }
    printer.drawLine();
    printer.bold(true); printer.println(String(b.ownerLabel || "Device Owner").toUpperCase()); printer.bold(false);
    printer.println(String(owner.name || "-"));
    if (owner.phone) printer.println(`Ph: ${owner.phone}`);
    printer.drawLine();
    row("Device Type", dev.type);
    row("Brand", dev.brand);
    row("Model", dev.model);
    row("Reported Problem", dev.problem);
    if (b.accessories) row("Accessories Sent", b.accessories);
    if (b.condition)   row("Physical Condition", b.condition);
    if (!b.hasSlip) {
        printer.alignCenter();
        printer.println("No service slip saved yet - showing ticket device details.");
        printer.alignLeft();
    }
    const showReceivedBy = on(b.showReceivedBy);
    const showSentBy     = on(b.showSentBy);
    if (showReceivedBy || showSentBy) {
        printer.println(""); printer.println(""); printer.println("");
        printer.alignCenter();
        if (showReceivedBy) { printer.println("Received by / Service Centre"); printer.drawLine(); }
        if (showSentBy)     { printer.println(String(b.sentByLabel || "Sent by (Shop)")); }
        printer.alignLeft();
    }
    if (on(b.showPreparedBy) && b.preparedBy) {
        printer.alignCenter();
        printer.println(`Prepared by ${b.preparedBy}.`);
        printer.alignLeft();
    }
    if (on(b.showFindings)) {
        printer.drawLine();
        printer.bold(true); printer.println("FINDINGS & SOLUTION - for Service Centre use"); printer.bold(false);
        printer.println("");
        printer.println("______________________________");
        printer.println("______________________________");
        printer.alignCenter();
        printer.println("Note: Please return this slip with the device.");
        printer.alignLeft();
    }
}

// Shift close report — cash reconciliation, declared physical count, variance,
// tender breakdown, collections breakdown and linked vouchers.
// Mirrors ShiftCloseBody (thermal). Data rides in payload's `body`, which is the
// SAME ShiftCloseBodyData the browser slip renders — every money field is a
// paise string/number, so each one goes through rupees() before printing.
function printShiftCloseMiddle(printer, body) {
    const b = body || {};
    const rupees = (paise) => (paise == null ? 0 : (Number(paise) || 0) / 100);
    const fmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const money = (paise) => `Rs. ${fmt(rupees(paise))}`;
    const signed = (paise) => {
        const val = rupees(paise);
        if (val > 0) return `+Rs. ${fmt(val)}`;
        if (val < 0) return `-Rs. ${fmt(Math.abs(val))}`;
        return `Rs. ${fmt(0)}`;
    };
    // openedAt / closedAt ride as ISO strings — show them the way the slip does.
    const stamp = (iso) => {
        if (!iso) return "";
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    };
    // Closed At sits beside the opened date in the header, so the time alone fits
    // the 48-column roll without wrapping onto a second line.
    const clock = (iso) => {
        if (!iso) return "";
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    };
    const row = (label, val) => printer.tableCustom([
        { text: String(label),      align: "LEFT",  width: 0.55 },
        { text: String(val ?? "-"), align: "RIGHT", width: 0.45 },
    ]);
    const subRow = (label, val) => printer.tableCustom([
        { text: `  . ${label}`,     align: "LEFT",  width: 0.55 },
        { text: String(val ?? "-"), align: "RIGHT", width: 0.45 },
    ]);

    printer.alignCenter();
    printer.bold(true);
    printer.println(`Shift #${b.shiftId || ""} (${b.status || "CLOSED"})`);
    printer.bold(false);
    if (b.openedAt) printer.println(stamp(b.openedAt));
    printer.drawLine();

    printer.alignLeft();
    row("Counter", b.counterName || "-");
    row("Cashier", b.cashierName || "-");
    if (b.durationStr) row("Duration", b.durationStr);
    if (b.closedAt) row("Closed At", clock(b.closedAt));
    printer.drawLine();

    printer.bold(true); printer.println("CASH RECONCILIATION"); printer.bold(false);
    row("Counter Opening Cash", money(b.openingFloatPaise));

    row("Counter Cash Flow", signed(b.tillMovementPaise));
    if (b.movementBreakdown) {
        const m = b.movementBreakdown;
        if (Number(m.cashSalesPaise || 0) > 0)    subRow("Cash Sales", `+${money(m.cashSalesPaise)}`);
        if (Number(m.receiptsPaise || 0) > 0)     subRow("Customer Receipts", `+${money(m.receiptsPaise)}`);
        if (Number(m.expendituresPaise || 0) > 0) subRow("Expenses", `-${money(m.expendituresPaise)}`);
        if (Number(m.refundsPaise || 0) > 0)      subRow("Refunds", `-${money(m.refundsPaise)}`);
        if (Number(m.otherPaise || 0) !== 0)      subRow("Other Adjustments", signed(m.otherPaise));
    }

    if (Number(b.dropsPaise || 0) > 0) {
        row("Dropped to Safe", `-${money(b.dropsPaise)}`);
    }

    printer.bold(true);
    row("Expected in Drawer", money(b.expectedCashPaise));
    if (b.declaredCashPaise != null) {
        row("Physical Count (Declared)", money(b.declaredCashPaise));
        const v = rupees(b.variancePaise);
        const varText = v === 0 ? "Rs. 0.00 (Balanced)" : (v > 0 ? `+Rs. ${fmt(v)} (Over)` : `-Rs. ${fmt(Math.abs(v))} (Short)`);
        row("Variance", varText);
    }
    printer.bold(false);

    if (b.carryOverNextPaise != null || b.toVaultPaise != null) {
        printer.drawLine();
        printer.bold(true); printer.println("CLOSING DISTRIBUTION"); printer.bold(false);
        if (b.carryOverNextPaise != null) row("Kept in Counter", money(b.carryOverNextPaise));
        if (b.toVaultPaise != null)       row("Swept to Vault", money(b.toVaultPaise));
    }

    if (Array.isArray(b.tenderBreakdown) && b.tenderBreakdown.length > 0) {
        printer.drawLine();
        printer.bold(true); printer.println("PAYMENTS COLLECTED"); printer.bold(false);
        let totalPaise = 0;
        for (const t of b.tenderBreakdown) {
            totalPaise += Number(t.amountPaise || 0);
            row(t.label, money(t.amountPaise));
        }
        printer.bold(true);
        row("Total Collected", money(totalPaise));
        printer.bold(false);
    }

    if (b.collectionsBreakdown) {
        printer.drawLine();
        printer.bold(true); printer.println("COLLECTIONS BY ACTIVITY"); printer.bold(false);
        const cb = b.collectionsBreakdown;
        row(`POS Sales (${cb.salesCount || 0})`, `+${money(cb.salesPaise)}`);
        if (cb.receiptsCount > 0) row(`Receipts (${cb.receiptsCount})`, `+${money(cb.receiptsPaise)}`);
        if (cb.refundsCount > 0)  row(`Refunds (${cb.refundsCount})`, `-${money(cb.refundsPaise)}`);
        printer.bold(true);
        row("Net Total", money(cb.netCollectedPaise));
        printer.bold(false);
    }

    if (b.closingContraVoucher || b.varianceJournalEntry) {
        printer.drawLine();
        printer.bold(true); printer.println("LINKED VOUCHERS"); printer.bold(false);
        if (b.closingContraVoucher) row("Closing Contra", b.closingContraVoucher.reference);
        if (b.varianceJournalEntry) row("Variance JE", b.varianceJournalEntry.reference);
    }

    if (b.notes) {
        printer.drawLine();
        printer.bold(true); printer.println("NOTES"); printer.bold(false);
        printer.println(String(b.notes));
    }
}

// ── Generic voucher builder ─────────────────────────────────────────────────────
// Prints ANY office voucher (GL · inventory · journal) from the SAME
// ThermalReceiptSample + VoucherTemplateDefaults the browser slip uses, so the
// thermal output honours each kind's configured template. Mirrors the web
// <ThermalReceiptPreview> ReceiptBody. Sent by the app's /receipt/voucher,
// /receipt/[id] (repair ticket), /shipping-slip, and /receipt/shift/[id] pages → POST /print/voucher.
async function buildVoucherBuffer(data) {
    const { sample = {}, template: tpl } = data || {};

    // Thermal-resolved per-kind print template (header/address/toggles/terms/footer).
    const kind = String(data.kind || (tpl && tpl.kind) || "");
    const t = { paperWidthMm: 80, ...(tpl || {}), kind };

    const mm        = Number(t.paperWidthMm) || 80;
    const cols      = mm >= 70 ? 48 : 32;
    const charWidth = cols - 2;
    t._cols = cols;

    const printer = new ThermalPrinter({
        type:         PrinterTypes.EPSON,
        interface:    "tcp://127.0.0.1:9999",
        characterSet: CharacterSet.PC437_USA,
        width:        charWidth,
    });

    const fmtAmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedDate = displayDate(sample.date);

    await printHeader(printer, t, sample.branchAddress, "voucher");

    // ── Kind-aware middle — bespoke bodies mirror the browser ReceiptBody ───
    // Non-invoice kinds (repair ticket, shipping slip, shift close, deposit/handover
    // worksheet, journal) each render their own middle; everything else falls
    // through to the generic Item/Qty invoice below.
    if (kind === "REPAIR_TICKET") {
        printRepairTicketMiddle(printer, data.body);
    } else if (kind === "SHIPPING_SLIP") {
        printShippingSlipMiddle(printer, data.body);
    } else if (kind === "SHIFT_CLOSE") {
        printShiftCloseMiddle(printer, data.body || sample.shiftClose || sample);
    } else if ((kind === "BANK_DEPOSIT" || kind === "CASH_HANDOVER") && sample.depositSlip) {
        printDepositMiddle(printer, sample, fmtAmt, formattedDate);
    } else if (kind === "CONTRA" || kind === "JOURNAL") {
        printJournalMiddle(printer, sample, fmtAmt, formattedDate);
    } else if (kind === "RECEIPT" || kind === "PAYMENT") {
        printMoneyMiddle(printer, sample, t, fmtAmt, formattedDate);
    } else {
    // ── Reference + party ─────────────────────────────────────────────────
    printer.alignLeft();
    printer.tableCustom([
        { text: String(sample.reference || ""), align: "LEFT",  width: 0.6 },
        { text: formattedDate,                  align: "RIGHT", width: 0.4 },
    ]);
    printer.tableCustom([
        { text: SUPPLIER_PARTY_KINDS.has(kind) ? "Supplier:" : "Customer:", align: "LEFT",  width: 0.4 },
        { text: String(sample.partyName || "Walk-in"),                       align: "RIGHT", width: 0.6 },
    ]);
    if (sample.partyPhone) { printer.alignRight(); printer.println(String(sample.partyPhone)); printer.alignLeft(); }
    if (sample.partyGstin) {
        printer.tableCustom([
            { text: "GSTIN:",                  align: "LEFT",  width: 0.4 },
            { text: String(sample.partyGstin), align: "RIGHT", width: 0.6 },
        ]);
    }
    printer.drawLine();

    // ── Line items ────────────────────────────────────────────────────────
    printer.tableCustom([
        { text: "Item",   align: "LEFT",  width: 0.5 },
        { text: "Qty",    align: "RIGHT", width: 0.15 },
        { text: "Amount", align: "RIGHT", width: 0.35 },
    ]);
    printer.drawLine();
    for (const line of sample.lines || []) {
        const name = String(line.description || "");
        printer.tableCustom([
            { text: name,                        align: "LEFT",  width: 0.5 },
            { text: String(line.quantity ?? ""), align: "RIGHT", width: 0.15 },
            { text: fmtAmt(line.amount),         align: "RIGHT", width: 0.35 },
        ]);
        // Struck MRP sub-line (raster — escpos has no strike-through), gated by
        // the template, only in ladder mode (matches the browser slip).
        if (t.showMrp && sample.discounts && line.mrp != null && line.mrp > Number(line.amount) + 0.005) {
            try {
                const f = await strikeMrpPng("MRP", fmtAmt(line.mrp));
                printer.alignLeft();
                await printer.printImage(f);
            } catch (err) {
                console.warn("[thermal:voucher] MRP strike skipped:", err.message);
                printer.println(`  MRP ${fmtAmt(line.mrp)}`);
            }
        }
    }
    printer.drawLine();

    // ── Totals — "Today's discount" ladder OR subtotal/tax/total ───────────
    if (sample.discounts) {
        const d = sample.discounts;
        printer.tableCustom([
            { text: "Gross",            align: "LEFT",  width: 0.55 },
            { text: fmtAmt(d.grossAtTag), align: "RIGHT", width: 0.45 },
        ]);
        for (const r of d.rows || [])
            printer.tableCustom([
                { text: String(r.label || "Discount").slice(0, 22), align: "LEFT",  width: 0.55 },
                { text: `-${fmtAmt(r.amount)}`,                     align: "RIGHT", width: 0.45 },
            ]);
        for (const c of d.charges || [])
            printer.tableCustom([
                { text: String(c.label || "Charge").slice(0, 22),                  align: "LEFT",  width: 0.55 },
                { text: `${c.amount < 0 ? "-" : "+"}${fmtAmt(Math.abs(c.amount))}`, align: "RIGHT", width: 0.45 },
            ]);
        printer.drawLine();
        printer.bold(true);
        printer.tableCustom([
            { text: "Total", align: "LEFT", width: 0.55 },
            { text: fmtAmt(sample.total != null ? sample.total : d.grossAtTag - d.total), align: "RIGHT", width: 0.45 },
        ]);
        printer.bold(false);
        if (Array.isArray(sample.hsnSummary) && sample.hsnSummary.length > 0) {
            const inter = sample.taxBreakdown && sample.taxBreakdown.kind === "INTER";
            const gst   = d.taxTotal != null ? Number(d.taxTotal) : sample.hsnSummary.reduce((s, h) => s + (h.cgst || 0) + (h.sgst || 0), 0);
            if (gst > 0.005)
                printer.tableCustom([
                    { text: `incl. ${inter ? "GST (IGST)" : "GST (CGST+SGST)"}`, align: "LEFT",  width: 0.6 },
                    { text: fmtAmt(gst),                                         align: "RIGHT", width: 0.4 },
                ]);
        }
        if (d.savingsTotal > 0) {
            printer.bold(true);
            printer.tableCustom([
                { text: "You saved", align: "LEFT", width: 0.5 },
                { text: `${fmtAmt(d.savingsTotal)} (${d.savingsPct}%)`, align: "RIGHT", width: 0.5 },
            ]);
            printer.bold(false);
        }
    } else {
        if (sample.subtotal != null) {
            printer.tableCustom([
                { text: "Subtotal",       align: "LEFT",  width: 0.55 },
                { text: fmtAmt(sample.subtotal), align: "RIGHT", width: 0.45 },
            ]);
            if (sample.taxBreakdown && sample.taxBreakdown.kind === "INTRA") {
                printer.tableCustom([{ text: "CGST", align: "LEFT", width: 0.55 }, { text: fmtAmt(sample.taxBreakdown.cgst), align: "RIGHT", width: 0.45 }]);
                printer.tableCustom([{ text: "SGST", align: "LEFT", width: 0.55 }, { text: fmtAmt(sample.taxBreakdown.sgst), align: "RIGHT", width: 0.45 }]);
            } else if (sample.taxBreakdown && sample.taxBreakdown.kind === "INTER") {
                printer.tableCustom([{ text: "IGST", align: "LEFT", width: 0.55 }, { text: fmtAmt(sample.taxBreakdown.igst), align: "RIGHT", width: 0.45 }]);
            } else if (sample.taxAmount != null && sample.taxAmount > 0) {
                printer.tableCustom([{ text: "Tax", align: "LEFT", width: 0.55 }, { text: fmtAmt(sample.taxAmount), align: "RIGHT", width: 0.45 }]);
            }
        }
        if (sample.total != null) {
            printer.drawLine();
            printer.bold(true);
            printer.tableCustom([
                { text: "Total",            align: "LEFT",  width: 0.55 },
                { text: fmtAmt(sample.total), align: "RIGHT", width: 0.45 },
            ]);
            printer.bold(false);
        }
    }
    // Tenders received + balance due (reprint shows payments as of now).
    printReceiptsBlock(printer, sample, fmtAmt, t);
    } // end generic Item/Qty invoice middle

    // No narration on the counter slip — internal bookkeeping text (the
    // preview skips it too). Journal / money middles print their own.
    await printFooter(printer, t, sample.reference, "voucher");
    return printer.getBuffer();
}

// ── Send buffer ───────────────────────────────────────────────────────────────

function sendNetwork(ip, port, buffer) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ host: ip, port: Number(port) }, () => {
            client.write(buffer, (err) => {
                if (err) { client.destroy(); return reject(err); }
                client.end();
                resolve();
            });
        });
        client.setTimeout(5000, () => { client.destroy(); reject(new Error("Network timeout")); });
        client.on("error", reject);
    });
}

function sendCom(comPort, buffer) {
    return new Promise((resolve, reject) => {
        try {
            const { SerialPort } = require("serialport");
            const port = new SerialPort({ path: comPort, baudRate: 9600 });
            port.on("open", () => {
                port.write(buffer, (err) => {
                    if (err) { port.close(); return reject(err); }
                    port.drain(() => { port.close(); resolve(); });
                });
            });
            port.on("error", reject);
        } catch {
            reject(new Error("serialport not available. Run: pnpm install"));
        }
    });
}

function sendWindows(printerName, buffer) {
    return new Promise((resolve, reject) => {
        const tmpFile  = path.join(os.tmpdir(), `receipt-${Date.now()}.bin`);
        const psScript = path.join(__dirname, "print-raw.ps1");
        fs.writeFileSync(tmpFile, buffer);
        exec(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -PrinterName "${printerName}" -FilePath "${tmpFile}"`,
            (err, stdout, stderr) => {
                fs.unlink(tmpFile, () => {});
                if (err) return reject(new Error(stderr.trim() || err.message));
                const out = stdout.trim();
                if (out !== "OK") return reject(new Error(out || "Print failed"));
                resolve();
            }
        );
    });
}

async function sendBuffer(cfg, buffer) {
    const type = cfg.connectionType || "network";
    if (type === "network") {
        if (!cfg.printerIp || cfg.printerIp === "192.168.1.x")
            throw new Error("Printer IP not configured. Go to Printer Settings.");
        await sendNetwork(cfg.printerIp, cfg.printerPort || 9100, buffer);
    } else if (type === "com") {
        if (!cfg.comPort)
            throw new Error("COM port not configured. Go to Printer Settings.");
        await sendCom(cfg.comPort, buffer);
    } else if (type === "windows") {
        if (!cfg.windowsPrinterName)
            throw new Error("Windows printer name not configured. Go to Printer Settings.");
        await sendWindows(cfg.windowsPrinterName, buffer);
    } else {
        throw new Error(`Unknown connectionType: ${type}`);
    }
}

// ── Printer probe ─────────────────────────────────────────────────────────────

/** Reachability of the configured printer. Shape: { connected, target, detail }. */
async function probePrinter(cfg) {
    const type = cfg.connectionType || "network";

    if (type === "network") {
        const ip = cfg.printerIp;
        const port = Number(cfg.printerPort) || 9100;
        if (!ip || ip === "192.168.1.x")
            return { connected: false, target: "", detail: "No printer IP set." };
        const ok = await canConnect(ip, port, 2000);
        return {
            connected: ok,
            target: `${ip}:${port}`,
            detail: ok ? "Answering on the network." : "No answer — check power, cable and IP.",
        };
    }

    if (type === "com") {
        if (!cfg.comPort) return { connected: false, target: "", detail: "No COM port set." };
        const ports = await listComPorts();
        const ok = ports.includes(cfg.comPort);
        return {
            connected: ok,
            target: cfg.comPort,
            detail: ok ? "Port present." : `Port not found. Available: ${ports.join(", ") || "none"}.`,
        };
    }

    if (type === "windows") {
        if (!cfg.windowsPrinterName)
            return { connected: false, target: "", detail: "No Windows printer selected." };
        const names = await listWindowsPrinters();
        const ok = names.includes(cfg.windowsPrinterName);
        return {
            connected: ok,
            target: cfg.windowsPrinterName,
            detail: ok ? "Installed in Windows." : "Not in Printers & Scanners any more.",
        };
    }

    return { connected: false, target: "", detail: `Unknown connectionType: ${type}` };
}

/** TCP connect test — resolves true/false, never rejects. */
function canConnect(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const done = (result) => { socket.destroy(); resolve(result); };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once("error", () => done(false));
        socket.connect(port, host, () => done(true));
    });
}

// ── List helpers ──────────────────────────────────────────────────────────────

function listWindowsPrinters() {
    return new Promise((resolve) => {
        exec("wmic printer get Name /format:list", (err, stdout) => {
            if (err) return resolve([]);
            const names = stdout
                .split(/\r?\n/)
                .map((l) => l.replace(/^Name=/, "").trim())
                .filter(Boolean);
            resolve(names);
        });
    });
}

function listComPorts() {
    return new Promise((resolve) => {
        try {
            const { SerialPort } = require("serialport");
            SerialPort.list()
                .then((ports) => resolve(ports.map((p) => p.path)))
                .catch(() => resolve([]));
        } catch {
            exec("wmic path Win32_SerialPort get DeviceID /format:list", (err, stdout) => {
                if (err) return resolve([]);
                const ids = stdout
                    .split(/\r?\n/)
                    .map((l) => l.replace(/^DeviceID=/, "").trim())
                    .filter(Boolean);
                resolve(ids);
            });
        }
    });
}

// ── start() — registers the thermal command handler ──────────────────────────

function start({ getConfig, setConfig }) {
    // ── Commands ─────────────────────────────────────────────────────────────
    //
    // Replaces the old Express app on :9191, for the reasons in index.js. Unlike the QR
    // display, every command here is request/response: a failed receipt must reach the
    // cashier, never be swallowed.
    //
    // Names deliberately match the old HTTP paths so logs and greps still line up. The
    // two /config verbs are the one place that could not stay identical.

    const COMMANDS = {
        "health": async () => {
            const cfg = getConfig();
            return {
                ok:                 true,
                version:            pkg.version,
                connectionType:     cfg.connectionType || "network",
                printerIp:          cfg.printerIp,
                printerPort:        cfg.printerPort,
                comPort:            cfg.comPort,
                windowsPrinterName: cfg.windowsPrinterName,
            };
        },

        "config:get": async () => getConfig(),

        "config:set": async (payload) => {
            const updated = setConfig(payload || {});
            console.log("[thermal:config] updated:", payload);
            return { ok: true, config: updated };
        },

        "printers": async () => listWindowsPrinters(),
        "ports":    async () => listComPorts(),

        // Is the configured printer actually reachable? Answers without printing, so the
        // settings page can show it on load and after every save. What "reachable" means
        // depends on the wiring: a TCP connect for a network printer (it is powered and on
        // the LAN — paper it cannot tell us), and presence in the port/driver list for COM
        // and Windows. Never throws: an unreachable printer is an answer, not a fault.
        "printer:probe": async () => probePrinter(getConfig()),

        "print/pos": async (payload) => {
            const { invoiceNumber, lines } = payload || {};
            if (!invoiceNumber || !lines) throw new Error("Missing required fields: invoiceNumber, lines");
            const cfg = getConfig();
            await sendBuffer(cfg, await buildPosBuffer(payload));
            console.log(`[thermal] POS printed: ${invoiceNumber}`);
            return { ok: true };
        },

        // Every document except the POS ladder slip (GL · inventory · journal ·
        // money slips · repair · shipping · shift close) — renders the app's ThermalReceiptSample
        // + thermal-resolved per-kind template. Payload: { kind, title, sample, template }.
        "print/voucher": async (payload) => {
            const { sample, kind, body } = payload || {};
            if (kind !== "SHIFT_CLOSE" && !body && (!sample || !Array.isArray(sample.lines))) {
                throw new Error("Missing required field: sample.lines");
            }
            const cfg = getConfig();
            await sendBuffer(cfg, await buildVoucherBuffer(payload));
            console.log(`[thermal] Voucher printed: ${(sample && sample.reference) || (body && `Shift #${body.id}`) || ""}`);
            return { ok: true };
        },
    };

    process.on("message", async (msg) => {
        if (!msg || msg.mod !== "thermal" || !msg.cmd) return;

        const reply = (body) => {
            if (msg.id && process.send) process.send({ mod: "thermal", id: msg.id, ...body });
        };

        const fn = COMMANDS[msg.cmd];
        if (!fn) {
            console.error(`[thermal] unknown command: ${msg.cmd}`);
            return reply({ error: `unknown command: ${msg.cmd}` });
        }

        try {
            reply({ result: await fn(msg.payload) });
        } catch (err) {
            console.error(`[thermal:${msg.cmd}]`, err.message);
            reply({ error: err.message || "Print failed" });
        }
    });

    // ── Start ────────────────────────────────────────────────────────────────

    const cfg = getConfig();
    if (process.send) {
        // Announce readiness — main buffers commands until it sees this, because Node
        // drops an IPC message that arrives before this handler is registered.
        process.send({ mod: "thermal", ready: true });
        console.log("[thermal] ready on the Electron IPC channel (no HTTP port)");
    } else {
        console.error("[thermal] no IPC channel — start the bridge from Electron (hardwareBridgeManager).");
    }
    console.log(`[thermal] connection: ${cfg.connectionType || "network"}`);
    if ((cfg.connectionType || "network") === "network") console.log(`[thermal] printer: ${cfg.printerIp}:${cfg.printerPort || 9100}`);
    if (cfg.connectionType === "com")     console.log(`[thermal] COM port: ${cfg.comPort}`);
    if (cfg.connectionType === "windows") console.log(`[thermal] windows printer: ${cfg.windowsPrinterName}`);
}

module.exports = { start, buildPosBuffer, buildVoucherBuffer };
