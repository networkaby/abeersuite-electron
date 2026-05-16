const express  = require("express");
const cors     = require("cors");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const net      = require("net");
const { exec } = require("child_process");
const { ThermalPrinter, PrinterTypes, CharacterSet } = require("node-thermal-printer");

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error("ERROR: config.json not found. Edit config.json and fill in your settings.");
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(data) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

let config = loadConfig();

const RELAY_PORT = process.env.RELAY_PORT || config.relayPort || 9191;

// ── ESC/POS receipt builder ───────────────────────────────────────────────────

function buildReceiptBuffer(data, companyName) {
    // dummy interface — we call getBuffer() only, never execute()
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

// ── POS receipt builder ───────────────────────────────────────────────────────

function buildPosBuffer(data, companyName) {
    const printer = new ThermalPrinter({
        type:         PrinterTypes.EPSON,
        interface:    "tcp://127.0.0.1:9999",
        characterSet: CharacterSet.PC437_USA,
    });

    const { invoiceNumber, date, customerName, lines, subtotal, discountPct, discountAmount, tax, total, cashPaid, upiPaid, extrasPaid } = data;

    const fmtAmt = (n) =>
        Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const formattedDate = date
        ? new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "";
    const formattedTime = date
        ? new Date(date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
        : "";

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(companyName || "My Company");
    printer.setTextNormal();
    printer.bold(false);
    printer.println("TAX INVOICE");
    printer.drawLine();

    printer.alignLeft();
    printer.println(`Invoice: ${invoiceNumber}`);
    printer.tableCustom([
        { text: `Date: ${formattedDate}`, align: "LEFT",  width: 0.6 },
        { text: formattedTime,             align: "RIGHT", width: 0.4 },
    ]);
    printer.println(`Customer: ${customerName || "Walk-in"}`);
    printer.drawLine();

    // Items
    printer.tableCustom([
        { text: "Item",   align: "LEFT",  width: 0.5 },
        { text: "Qty",    align: "RIGHT", width: 0.15 },
        { text: "Amount", align: "RIGHT", width: 0.35 },
    ]);
    printer.drawLine();

    for (const line of lines || []) {
        const name = String(line.name || "").slice(0, 20);
        printer.tableCustom([
            { text: name,              align: "LEFT",  width: 0.5 },
            { text: String(line.qty),  align: "RIGHT", width: 0.15 },
            { text: fmtAmt(line.amount), align: "RIGHT", width: 0.35 },
        ]);
    }

    printer.drawLine();

    // Totals
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
    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
        { text: "TOTAL",       align: "LEFT",  width: 0.55 },
        { text: fmtAmt(total), align: "RIGHT", width: 0.45 },
    ]);
    printer.bold(false);
    printer.drawLine();

    // Payments
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
    printer.alignCenter();
    printer.println("Thank you! Visit again.");
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
            reject(new Error("serialport not available. Run: npm install"));
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

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    const cfg = loadConfig();
    res.json({
        ok:                 true,
        connectionType:     cfg.connectionType || "network",
        printerIp:          cfg.printerIp,
        printerPort:        cfg.printerPort,
        comPort:            cfg.comPort,
        windowsPrinterName: cfg.windowsPrinterName,
    });
});

app.get("/config", (_req, res) => {
    try { res.json(loadConfig()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/config", (req, res) => {
    try {
        const updated = { ...loadConfig(), ...req.body };
        saveConfig(updated);
        config = updated;
        console.log(`[config] Updated:`, req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/printers", async (_req, res) => {
    res.json(await listWindowsPrinters());
});

app.get("/ports", async (_req, res) => {
    res.json(await listComPorts());
});

app.post("/print", async (req, res) => {
    const { reference, lines } = req.body;
    if (!reference || !lines)
        return res.status(400).json({ error: "Missing required fields: reference, lines" });

    const cfg = loadConfig();
    try {
        const buffer = buildReceiptBuffer(req.body, cfg.companyName || "My Company");
        await sendBuffer(cfg, buffer);
        console.log(`[${new Date().toISOString()}] Printed: ${reference}`);
        res.json({ ok: true });
    } catch (err) {
        console.error("Print error:", err.message);
        res.status(503).json({ error: err.message || "Print failed" });
    }
});

// POS receipt print
app.post("/print/pos", async (req, res) => {
    const { invoiceNumber, lines } = req.body;
    if (!invoiceNumber || !lines)
        return res.status(400).json({ error: "Missing required fields: invoiceNumber, lines" });

    const cfg = loadConfig();
    try {
        const buffer = buildPosBuffer(req.body, cfg.companyName || "My Company");
        await sendBuffer(cfg, buffer);
        console.log(`[${new Date().toISOString()}] POS printed: ${invoiceNumber}`);
        res.json({ ok: true });
    } catch (err) {
        console.error("POS print error:", err.message);
        res.status(503).json({ error: err.message || "Print failed" });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(RELAY_PORT, () => {
    const cfg = loadConfig();
    console.log(`Thermal relay running on http://localhost:${RELAY_PORT}`);
    console.log(`Connection: ${cfg.connectionType || "network"}`);
    if ((cfg.connectionType || "network") === "network") console.log(`Printer: ${cfg.printerIp}:${cfg.printerPort || 9100}`);
    if (cfg.connectionType === "com")     console.log(`COM Port: ${cfg.comPort}`);
    if (cfg.connectionType === "windows") console.log(`Windows Printer: ${cfg.windowsPrinterName}`);
});
