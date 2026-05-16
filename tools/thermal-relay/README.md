# Thermal Relay

A small Node.js script that runs on the **shop PC** and bridges the cloud-hosted web app to your thermal printer (ESC/POS). Supports three connection types: LAN network, USB COM port, or Windows installed printer.

## How it works

```
Browser (cloud app)  →  http://localhost:9191/print  →  Relay  →  Printer
```

The browser calls `localhost:9191` directly — no port forwarding or cloud-server involvement needed.

## Setup (one time)

1. **Install Node.js** on the shop PC — download from https://nodejs.org (LTS version).

2. **Copy this folder** (`thermal-relay/`) to the shop PC, e.g. `C:\thermal-relay\`.

3. **Install dependencies** (only once):
   ```
   cd C:\thermal-relay
   npm install
   ```

4. **Start the relay**:
   ```
   node relay.js
   ```

5. **Configure the printer** — open the web app → any voucher → ⚙ gear icon → **Printer Settings**. Pick your connection type, fill in the details, click **Save Settings**, then **Test Print**.

## Connection types

| Type | When to use |
|------|-------------|
| **Network (LAN)** | Printer has a static IP on your local network |
| **COM Port (USB)** | USB printer shows as COM3 / COM4 in Device Manager → Ports |
| **Windows Printer** | USB printer installed via Windows driver (visible in Printers & Scanners) |

## config.json fields

```json
{
  "connectionType":     "network",        // "network" | "com" | "windows"
  "printerIp":         "192.168.1.x",    // for network type
  "printerPort":        9100,             // for network type (usually 9100)
  "comPort":           "COM3",            // for com type
  "windowsPrinterName": "80mm Printer",  // for windows type — exact name from Printers & Scanners
  "companyName":       "Network Service", // printed at top of every receipt
  "relayPort":          9191              // port this relay listens on
}
```

> `config.json` is gitignored — it stays on the shop PC only.

## Run automatically on Windows startup

**Option A — Task Scheduler:**
1. Open Task Scheduler → Create Basic Task
2. Trigger: When the computer starts
3. Action: Start a program → `node.exe`, argument: `C:\thermal-relay\relay.js`
4. Check "Run whether user is logged on or not"

**Option B — pm2:**
```
npm install -g pm2
pm2 start C:\thermal-relay\relay.js --name thermal-relay
pm2 startup
pm2 save
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Relay not running" in browser | Start `node relay.js` on the shop PC |
| "Printer not reachable" | Check printer is on; verify IP / COM port / printer name in settings |
| Port 9191 already in use | Change `relayPort` in config.json and restart |
| Wrong characters printing | Edit `CharacterSet` in relay.js (default: PC437_USA) |
| Windows printer: "OpenPrinter failed" | Printer name must match exactly as shown in Printers & Scanners |
