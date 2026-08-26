// Thermal printer relay (ESC/POS). Listens on cfg.relayPort (default 9191).
// Endpoints kept identical to the standalone thermal-relay so the web app
// (PrinterSettingsPage + voucher print buttons) doesn't need any changes.

const express  = require("express");
const cors     = require("./cors-pna");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const net      = require("net");
const { exec } = require("child_process");
/**
 * `sharp` is a NATIVE module and is deliberately NOT a dependency of the desktop app.
 *
 * It was a top-level require while this ran as its own Node service with its own
 * node_modules. Inside Electron a native module has to be rebuilt against Electron's
 * ABI and unpacked from the asar, and none of that is built yet — so requiring it here
 * would stop the whole printer from loading rather than just the two features that use
 * it.
 *
 * Those two are raster image conversions: a fetched logo (`logoToTempPng`) and the
 * struck-through MRP label (`strikeToTempPng`). Everything else — text, QR, barcodes,
 * cut, drawer — is pure JS. So it is loaded on demand and its absence degrades exactly
 * those two, with a message that names the cause.
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
// Small helpers mirroring the browser ThermalHeader / ThermalFooter so all three
// builders (payment · POS · voucher) stay in sync with the print template. The
// email + website lines are gated by showPhone (matching ThermalReceiptPreview).
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

// ── ESC/POS receipt builder ───────────────────────────────────────────────────

function buildReceiptBuffer(data, companyName) {
    const printer = new ThermalPrinter({
        type:         PrinterTypes.EPSON,
        interface:    "tcp://127.0.0.1:9999",
        characterSet: CharacterSet.PC437_USA,
    });

    const { reference, date, type, party, narration, lines, totalDebit, totalCredit, status, createdBy } = data;

    const fmtAmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const formattedDate = date
        ? new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "";

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(companyName || "My Company");
    printer.setTextNormal();
    printer.bold(false);
    printer.println("VOUCHER");
    printer.drawLine();

    printer.alignLeft();
    printer.tableCustom([
        { text: `Ref: ${reference}`, align: "LEFT",  width: 0.6 },
        { text: formattedDate,        align: "RIGHT", width: 0.4 },
    ]);
    printer.println(`Type: ${(type || "").replace(/_/g, " ")}`);
    if (party) printer.println(`Party: ${party}`);
    printer.drawLine();

    printer.tableCustom([
        { text: "Account", align: "LEFT",  width: 0.5 },
        { text: "Dr",      align: "RIGHT", width: 0.25 },
        { text: "Cr",      align: "RIGHT", width: 0.25 },
    ]);
    printer.drawLine();

    for (const line of lines || []) {
        const amt = fmtAmt(line.amount);
        const dr  = line.type === "DEBIT"  ? amt : "";
        const cr  = line.type === "CREDIT" ? amt : "";
        printer.tableCustom([
            { text: line.accountName || "", align: "LEFT",  width: 0.5 },
            { text: dr,                     align: "RIGHT", width: 0.25 },
            { text: cr,                     align: "RIGHT", width: 0.25 },
        ]);
        if (line.description) printer.println("  " + line.description);
    }

    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
        { text: "Total",             align: "LEFT",  width: 0.5 },
        { text: fmtAmt(totalDebit),  align: "RIGHT", width: 0.25 },
        { text: fmtAmt(totalCredit), align: "RIGHT", width: 0.25 },
    ]);
    printer.bold(false);
    printer.drawLine();

    if (narration) {
        printer.println(`Note: ${narration}`);
        printer.drawLine();
    }

    printer.println(`Status: ${status || ""}   By: ${createdBy || ""}`);
    printer.println(`Printed: ${new Date().toLocaleString("en-GB")}`);
    printer.cut();

    return printer.getBuffer();
}

// ── Payment / Receipt voucher builder (POS "Rcv" + collect-on-the-go surplus) ──
// Prints the money side of a counter receipt: who paid, the tender breakdown
// (cash / UPI / card — one row each), the total received, and how it was applied
// (old dues cleared / advance). For a POS overpayment the sale slip carries NO
// tenders — they live here.
async function buildPaymentBuffer(data, companyName) {
    const { reference, date, party, tenders, total, arrear, advance, note,
            title, partyLabel, totalLabel, template: tpl } = data;

    // Resolved template (header/address/toggles/footer) — sent with every job so
    // the slip honours the shop's current config, matching the browser payment
    // page. Older clients omit it → safe fallbacks.
    const t = {
        headerLine1:    "",
        headerLine2:    "",
        addressBlock:   "",
        gstinLine:      "",
        phoneLine:      "",
        logoUrl:        "",
        showLogo:       false,
        showHeaderText: true,
        showAddress:    true,
        showGstin:      true,
        showPhone:      true,
        signatureLabel: "Authorised Signatory",
        footerLine:     "Thank you · Visit again",
        paperWidthMm:   80,
        ...(tpl || {}),
    };

    const mm        = Number(t.paperWidthMm) || 80;
    const cols      = mm >= 70 ? 48 : 32;
    const charWidth = cols - 2;

    const printer = new ThermalPrinter({
        type:         PrinterTypes.EPSON,
        interface:    "tcp://127.0.0.1:9999",
        characterSet: CharacterSet.PC437_USA,
        width:        charWidth,
    });

    const fmtAmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedDate = date
        ? new Date(date).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";

    // ── Header (template-driven) ──────────────────────────────────────────
    printer.alignCenter();
    if (t.showLogo && t.logoUrl) {
        try {
            const logoFile = await logoToTempPng(t.logoUrl, cols >= 48 ? 360 : 240);
            await printer.printImage(logoFile);
        } catch (err) {
            console.warn("[thermal:payment] logo skipped:", err.message);
        }
    }
    if (t.showHeaderText) {
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(t.headerLine1 || companyName || "My Company");
        printer.setTextNormal();
        printer.bold(false);
    }
    printer.println(t.headerLine2 || title || "PAYMENT RECEIPT");
    if (t.showAddress && t.addressBlock) {
        for (const ln of String(t.addressBlock).split("\n").map((s) => s.trim()).filter(Boolean))
            printer.println(ln);
    }
    if (t.showPhone && t.phoneLine) printer.println(t.phoneLine);
    printEmailWeb(printer, t);
    if (t.showGstin && t.gstinLine) printer.println(t.gstinLine);
    printer.drawLine();

    printer.alignLeft();
    printer.tableCustom([
        { text: `No: ${reference || ""}`, align: "LEFT",  width: 0.55 },
        { text: formattedDate,            align: "RIGHT", width: 0.45 },
    ]);
    if (party) printer.println(`${partyLabel || "Received from"}: ${party}`);
    printer.drawLine();

    // Tender breakdown — the money side lives here now (not on the sale slip).
    for (const tnd of tenders || []) {
        printer.tableCustom([
            { text: tnd.label || "",   align: "LEFT",  width: 0.6 },
            { text: fmtAmt(tnd.amount), align: "RIGHT", width: 0.4 },
        ]);
    }
    printer.drawLine();

    printer.bold(true);
    printer.tableCustom([
        { text: totalLabel || "Received", align: "LEFT",  width: 0.5 },
        { text: "Rs. " + fmtAmt(total),   align: "RIGHT", width: 0.5 },
    ]);
    printer.bold(false);
    printer.drawLine();

    if (Number(arrear) > 0)
        printer.tableCustom([{ text: "Cleared old dues", align: "LEFT", width: 0.6 }, { text: fmtAmt(arrear), align: "RIGHT", width: 0.4 }]);
    if (Number(advance) > 0)
        printer.tableCustom([{ text: "Advance / credit", align: "LEFT", width: 0.6 }, { text: fmtAmt(advance), align: "RIGHT", width: 0.4 }]);
    if (Number(arrear) > 0 || Number(advance) > 0) printer.drawLine();

    if (note) { printer.println(note); printer.drawLine(); }

    printer.alignCenter();
    if ((totalLabel || "Received") === "Received") printer.println("Received with thanks");

    // Bank details + scan-to-pay UPI QR (template-driven), matching the browser footer.
    await printBankBlock(printer, t, "payment");

    // Signature line — the payment slip always shows it (a money receipt),
    // matching the browser body.
    printer.println("");
    printer.println("");
    printer.alignRight();
    printer.println(t.signatureLabel || "Authorised Signatory");

    printer.alignCenter();
    printer.println(t.footerLine || "Thank you · Visit again");
    printDisclaimer(printer, t);
    printer.cut();

    return printer.getBuffer();
}

// ── POS receipt builder ───────────────────────────────────────────────────────

async function buildPosBuffer(data, companyName) {
    const { invoiceNumber, date, customerName, customerGstin, lines, subtotal, discountPct, discountAmount, tax, total, cashPaid, upiPaid, extrasPaid, grossAtTag, discounts, charges, savings, hsnSummary, template: tpl } = data;

    // Resolved POS voucher print template (header/address/toggles/terms/footer).
    // Sent by PosScreen (via /api/pos/sale → posTemplate) so this slip matches
    // /receipt/invoice/[id]?kind=POS. Older clients omit it → safe fallbacks.
    const t = {
        headerLine1:    "",
        headerLine2:    "POS sale receipt",
        addressBlock:   "",
        gstinLine:      "",
        phoneLine:      "",
        logoUrl:        "",
        showLogo:       false,
        showHeaderText: true,
        showAddress:    true,
        showGstin:      true,
        showPhone:      true,
        showTaxSummary: true,
        showMrp:        true,
        showSignature:  false,
        showBarcode:    false,
        signatureLabel: "Authorised Signatory",
        termsText:      "",
        footerLine:     "Thank you · Visit again",
        paperWidthMm:   80,
        ...(tpl || {}),
    };

    // Usable columns from the paper size. An "80mm" head prints ~72mm wide = 48
    // columns (Font A); a "58mm" head prints ~48mm = 32. paperWidthMm may carry
    // either the roll width (80 / 58) or the printable width (72 / 48), so treat
    // anything ~70mm+ as the wide class. node-thermal-printer's tableCustom emits
    // one column more than configured, so keep a 2-column safety margin (wide →
    // 46, narrow → 30) or right-aligned amounts wrap their last digit.
    const mm        = Number(t.paperWidthMm) || 80;
    const cols      = mm >= 70 ? 48 : 32;
    const charWidth = cols - 2;
    const nameWidth = Math.floor(charWidth * 0.5) - 1;

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

    const formattedDate = date
        ? new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "";
    const formattedTime = date
        ? new Date(date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
        : "";

    // ── Header (template-driven) ──────────────────────────────────────────
    printer.alignCenter();
    // Logo (same template as the browser receipt). Best-effort — a fetch/raster
    // failure or a printer without image support must never block the slip.
    if (t.showLogo && t.logoUrl) {
        try {
            const logoFile = await logoToTempPng(t.logoUrl, cols >= 48 ? 360 : 240);
            await printer.printImage(logoFile);
        } catch (err) {
            console.warn("[thermal:pos] logo skipped:", err.message);
        }
    }
    if (t.showHeaderText) {
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(t.headerLine1 || companyName || "My Company");
        printer.setTextNormal();
        printer.bold(false);
    }
    if (t.headerLine2) printer.println(t.headerLine2);
    if (t.showAddress && t.addressBlock) {
        for (const ln of String(t.addressBlock).split("\n").map((s) => s.trim()).filter(Boolean))
            printer.println(ln);
    }
    if (t.showPhone && t.phoneLine) printer.println(t.phoneLine);
    printEmailWeb(printer, t);
    if (t.showGstin && t.gstinLine) printer.println(t.gstinLine);
    printer.drawLine();

    printer.alignLeft();
    printer.println(`Invoice: ${invoiceNumber}`);
    printer.tableCustom([
        { text: `Date: ${formattedDate}`, align: "LEFT",  width: 0.6 },
        { text: formattedTime,             align: "RIGHT", width: 0.4 },
    ]);
    printer.println(`Customer: ${customerName || "Walk-in"}`);
    if (customerGstin) printer.println(`GSTIN: ${customerGstin}`);
    printer.drawLine();

    printer.tableCustom([
        { text: "Item",   align: "LEFT",  width: 0.5 },
        { text: "Qty",    align: "RIGHT", width: 0.15 },
        { text: "Amount", align: "RIGHT", width: 0.35 },
    ]);
    printer.drawLine();

    for (const line of lines || []) {
        const name = String(line.name || "").slice(0, nameWidth);
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
    } else if (t.showTaxSummary) {
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
        { text: "TOTAL",       align: "LEFT",  width: 0.55 },
        { text: fmtAmt(total), align: "RIGHT", width: 0.45 },
    ]);
    printer.bold(false);
    // GST is INCLUDED in the inclusive amounts above — shown as a note on the
    // total (not a column row, so the running math reads correctly).
    if (ladderMode && t.showTaxSummary && Array.isArray(hsnSummary) && hsnSummary.length > 0) {
        const gst = hsnSummary.reduce((s, h) => s + (h.cgst || 0) + (h.sgst || 0), 0);
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
    printer.drawLine();

    if (cashPaid > 0) {
        printer.tableCustom([
            { text: "Cash",           align: "LEFT",  width: 0.55 },
            { text: fmtAmt(cashPaid), align: "RIGHT", width: 0.45 },
        ]);
    }
    if (upiPaid > 0) {
        printer.tableCustom([
            { text: "UPI",           align: "LEFT",  width: 0.55 },
            { text: fmtAmt(upiPaid), align: "RIGHT", width: 0.45 },
        ]);
    }
    for (const e of extrasPaid || []) {
        if (e.amount > 0) {
            const label = e.method.replace(/_/g, " ");
            printer.tableCustom([
                { text: label,           align: "LEFT",  width: 0.55 },
                { text: fmtAmt(e.amount), align: "RIGHT", width: 0.45 },
            ]);
        }
    }
    const change = Math.max(0, (cashPaid || 0) - total);
    if (change > 0) {
        printer.tableCustom([
            { text: "Change",       align: "LEFT",  width: 0.55 },
            { text: fmtAmt(change), align: "RIGHT", width: 0.45 },
        ]);
    }

    printer.drawLine();

    // ── Terms / bank / signature / footer (template-driven) ───────────────
    if (t.termsText) {
        printer.alignLeft();
        for (const ln of String(t.termsText).split("\n")) printer.println(ln);
        printer.drawLine();
    }
    await printBankBlock(printer, t, "pos");
    if (t.showSignature) {
        printer.println("");
        printer.println("");
        printer.alignRight();
        printer.println(t.signatureLabel || "Authorised Signatory");
        printer.alignLeft();
    }
    printer.alignCenter();
    printer.println(t.footerLine || "Thank you · Visit again");
    printDisclaimer(printer, t);
    // Scannable CODE128 of the invoice number (matches the browser slip's
    // BarcodeSvg) — gated by the template. Best-effort: never block the slip.
    if (t.showBarcode && invoiceNumber) {
        try { printer.code128(String(invoiceNumber), { height: 60, text: 2 }); }
        catch (err) { console.warn("[thermal:pos] barcode skipped:", err.message); }
    }
    printer.cut();

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

// Cash → Bank deposit / cash → cash handover WORKSHEET — bank / ledger block +
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
        if (bankLine)        printer.tableCustom([{ text: "Bank", align: "LEFT", width: 0.3 },  { text: bankLine,                 align: "RIGHT", width: 0.7 }]);
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

// ── Generic voucher builder ─────────────────────────────────────────────────────
// Prints ANY office voucher (GL · inventory · journal) from the SAME
// ThermalReceiptSample + VoucherTemplateDefaults the browser slip uses, so the
// thermal output honours each kind's configured template. Mirrors the web
// <ThermalReceiptPreview> ReceiptBody. Sent by the app's /receipt/voucher,
// /receipt/[id] (repair ticket) and /shipping-slip pages → POST /print/voucher.
async function buildVoucherBuffer(data, companyName) {
    const { sample = {}, template: tpl } = data || {};

    // Resolved per-kind print template (header/address/toggles/terms/footer).
    // Older clients omit it → safe fallbacks.
    const t = {
        headerLine1:    "",
        headerLine2:    "",
        addressBlock:   "",
        gstinLine:      "",
        phoneLine:      "",
        logoUrl:        "",
        showLogo:          false,
        showHeaderText:    true,
        showAddress:       true,
        showBranchAddress: false,
        showGstin:         true,
        showPhone:         true,
        showTaxSummary:    true,
        showMrp:           true,
        showSignature:     false,
        showBarcode:       false,
        signatureLabel: "Authorised Signatory",
        termsText:      "",
        footerLine:     "Thank you · Visit again",
        paperWidthMm:   80,
        ...(tpl || {}),
    };

    const mm        = Number(t.paperWidthMm) || 80;
    const cols      = mm >= 70 ? 48 : 32;
    const charWidth = cols - 2;
    const nameWidth = Math.floor(charWidth * 0.5) - 1;

    const printer = new ThermalPrinter({
        type:         PrinterTypes.EPSON,
        interface:    "tcp://127.0.0.1:9999",
        characterSet: CharacterSet.PC437_USA,
        width:        charWidth,
    });

    const fmtAmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedDate = sample.date
        ? new Date(sample.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "";

    // ── Header (template-driven) ──────────────────────────────────────────
    printer.alignCenter();
    if (t.showLogo && t.logoUrl) {
        try {
            const logoFile = await logoToTempPng(t.logoUrl, cols >= 48 ? 360 : 240);
            await printer.printImage(logoFile);
        } catch (err) {
            console.warn("[thermal:voucher] logo skipped:", err.message);
        }
    }
    if (t.showHeaderText) {
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(t.headerLine1 || companyName || "My Company");
        printer.setTextNormal();
        printer.bold(false);
    }
    if (t.headerLine2) printer.println(t.headerLine2);
    if (t.showAddress && t.addressBlock) {
        for (const ln of String(t.addressBlock).split("\n").map((s) => s.trim()).filter(Boolean))
            printer.println(ln);
    }
    // Issuing-branch address (voucher-backed prints) — matches the browser slip.
    if (t.showBranchAddress && sample.branchAddress) {
        for (const ln of String(sample.branchAddress).split("\n").map((s) => s.trim()).filter(Boolean))
            printer.println(ln);
    }
    if (t.showPhone && t.phoneLine) printer.println(t.phoneLine);
    printEmailWeb(printer, t);
    if (t.showGstin && t.gstinLine) printer.println(t.gstinLine);
    printer.drawLine();

    // ── Kind-aware middle — bespoke bodies mirror the browser ReceiptBody ───
    // Non-invoice kinds (repair ticket, shipping slip, deposit/handover
    // worksheet, journal) each render their own middle; everything else falls
    // through to the generic Item/Qty invoice below.
    const kind = String(data.kind || "");
    if (kind === "REPAIR_TICKET") {
        printRepairTicketMiddle(printer, data.body);
    } else if (kind === "SHIPPING_SLIP") {
        printShippingSlipMiddle(printer, data.body);
    } else if ((kind === "BANK_DEPOSIT" || kind === "CASH_HANDOVER") && sample.depositSlip) {
        printDepositMiddle(printer, sample, fmtAmt, formattedDate);
    } else if (kind === "CONTRA" || kind === "JOURNAL") {
        printJournalMiddle(printer, sample, fmtAmt, formattedDate);
    } else {
    // ── Reference + party ─────────────────────────────────────────────────
    printer.alignLeft();
    printer.tableCustom([
        { text: String(sample.reference || ""), align: "LEFT",  width: 0.6 },
        { text: formattedDate,                  align: "RIGHT", width: 0.4 },
    ]);
    printer.println(`Customer: ${sample.partyName || "Walk-in"}`);
    if (sample.partyPhone) printer.println(String(sample.partyPhone));
    if (sample.partyGstin) printer.println(`GSTIN: ${sample.partyGstin}`);
    printer.drawLine();

    // ── Line items ────────────────────────────────────────────────────────
    printer.tableCustom([
        { text: "Item",   align: "LEFT",  width: 0.5 },
        { text: "Qty",    align: "RIGHT", width: 0.15 },
        { text: "Amount", align: "RIGHT", width: 0.35 },
    ]);
    printer.drawLine();
    for (const line of sample.lines || []) {
        const name = String(line.description || "").slice(0, nameWidth);
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
        if (t.showTaxSummary && Array.isArray(sample.hsnSummary) && sample.hsnSummary.length > 0) {
            const inter = sample.taxBreakdown && sample.taxBreakdown.kind === "INTER";
            const gst   = sample.hsnSummary.reduce((s, h) => s + (h.cgst || 0) + (h.sgst || 0), 0);
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
        if (t.showTaxSummary && sample.subtotal != null) {
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
    printer.drawLine();
    } // end generic Item/Qty invoice middle

    // ── Notes / terms / bank / signature / footer (template-driven) ───────
    // Journal/Contra print their own narration in the middle → skip here.
    if (sample.notes && kind !== "CONTRA" && kind !== "JOURNAL") {
        printer.alignLeft();
        for (const ln of String(sample.notes).split("\n")) printer.println(ln);
        printer.drawLine();
    }
    if (t.termsText) {
        printer.alignLeft();
        for (const ln of String(t.termsText).split("\n")) printer.println(ln);
        printer.drawLine();
    }
    await printBankBlock(printer, t, "voucher");
    if (t.showSignature) {
        printer.println("");
        printer.println("");
        printer.alignRight();
        printer.println(t.signatureLabel || "Authorised Signatory");
        printer.alignLeft();
    }
    printer.alignCenter();
    printer.println(t.footerLine || "Thank you · Visit again");
    printDisclaimer(printer, t);
    // Scannable CODE128 of the voucher number (matches the browser slip's
    // BarcodeSvg) — gated by the template. Best-effort: never block the slip.
    if (t.showBarcode && sample.reference) {
        try { printer.code128(String(sample.reference), { height: 60, text: 2 }); }
        catch (err) { console.warn("[thermal:voucher] barcode skipped:", err.message); }
    }
    printer.cut();

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

// ── start() — boots the thermal Express app ──────────────────────────────────

function start({ getConfig, setConfig }) {
    const app = express();
    app.use(cors());
    app.use(express.json());

    const initialCfg = getConfig();
    const RELAY_PORT = process.env.THERMAL_RELAY_PORT || initialCfg.relayPort || 9191;

    app.get("/health", (_req, res) => {
        const cfg = getConfig();
        res.json({
            ok:                 true,
            version:            pkg.version,
            connectionType:     cfg.connectionType || "network",
            printerIp:          cfg.printerIp,
            printerPort:        cfg.printerPort,
            comPort:            cfg.comPort,
            windowsPrinterName: cfg.windowsPrinterName,
        });
    });

    app.get("/config", (_req, res) => {
        try { res.json(getConfig()); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post("/config", (req, res) => {
        try {
            const updated = setConfig(req.body || {});
            console.log("[thermal:config] updated:", req.body);
            res.json({ ok: true, config: updated });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get("/printers", async (_req, res) => res.json(await listWindowsPrinters()));
    app.get("/ports",    async (_req, res) => res.json(await listComPorts()));

    app.post("/print", async (req, res) => {
        const { reference, lines } = req.body;
        if (!reference || !lines)
            return res.status(400).json({ error: "Missing required fields: reference, lines" });

        const cfg = getConfig();
        try {
            const buffer = buildReceiptBuffer(req.body, cfg.companyName || "My Company");
            await sendBuffer(cfg, buffer);
            console.log(`[thermal] Printed: ${reference}`);
            res.json({ ok: true });
        } catch (err) {
            console.error("[thermal] print error:", err.message);
            res.status(503).json({ error: err.message || "Print failed" });
        }
    });

    app.post("/print/pos", async (req, res) => {
        const { invoiceNumber, lines } = req.body;
        if (!invoiceNumber || !lines)
            return res.status(400).json({ error: "Missing required fields: invoiceNumber, lines" });

        const cfg = getConfig();
        try {
            const buffer = await buildPosBuffer(req.body, cfg.companyName || "My Company");
            await sendBuffer(cfg, buffer);
            console.log(`[thermal] POS printed: ${invoiceNumber}`);
            res.json({ ok: true });
        } catch (err) {
            console.error("[thermal] POS print error:", err.message);
            res.status(503).json({ error: err.message || "Print failed" });
        }
    });

    app.post("/print/payment", async (req, res) => {
        const { reference } = req.body;
        if (!reference)
            return res.status(400).json({ error: "Missing required field: reference" });

        const cfg = getConfig();
        try {
            const buffer = await buildPaymentBuffer(req.body, cfg.companyName || "My Company");
            await sendBuffer(cfg, buffer);
            console.log(`[thermal] Payment printed: ${reference}`);
            res.json({ ok: true });
        } catch (err) {
            console.error("[thermal] payment print error:", err.message);
            res.status(503).json({ error: err.message || "Print failed" });
        }
    });

    // Generic office voucher (GL · inventory · journal) — renders the app's
    // ThermalReceiptSample + per-kind template. Payload: { kind, title, sample, template }.
    app.post("/print/voucher", async (req, res) => {
        const { sample } = req.body || {};
        if (!sample || !Array.isArray(sample.lines))
            return res.status(400).json({ error: "Missing required field: sample.lines" });

        const cfg = getConfig();
        try {
            const buffer = await buildVoucherBuffer(req.body, cfg.companyName || "My Company");
            await sendBuffer(cfg, buffer);
            console.log(`[thermal] Voucher printed: ${sample.reference || ""}`);
            res.json({ ok: true });
        } catch (err) {
            console.error("[thermal] voucher print error:", err.message);
            res.status(503).json({ error: err.message || "Print failed" });
        }
    });

    app.listen(RELAY_PORT, () => {
        const cfg = getConfig();
        console.log(`[thermal] running on http://localhost:${RELAY_PORT}`);
        console.log(`[thermal] connection: ${cfg.connectionType || "network"}`);
        if ((cfg.connectionType || "network") === "network") console.log(`[thermal] printer: ${cfg.printerIp}:${cfg.printerPort || 9100}`);
        if (cfg.connectionType === "com")     console.log(`[thermal] COM port: ${cfg.comPort}`);
        if (cfg.connectionType === "windows") console.log(`[thermal] windows printer: ${cfg.windowsPrinterName}`);
    });
}

module.exports = { start, buildPosBuffer, buildReceiptBuffer, buildPaymentBuffer, buildVoucherBuffer };
