/**
 * One-off classification script.
 *
 * Reads every InvProduct, applies keyword rules to its name, and writes a CSV
 * suggesting `group / hsnCode / gstRate` per SKU. You review the CSV (sort by
 * `confidence`, scan the `Unclassified` rows), edit anything wrong, then
 * upload via `/office/settings/item-import` with `Auto-create missing masters`
 * enabled — the importer will create any missing Groups and assign every
 * Product to its new Group in one transaction.
 *
 * Rules are ordered: first match wins. Each rule has a `confidence` field —
 * `high` means the keyword is specific (`^pendrive\b`), `medium` means broader
 * (`\bcable\b`), `low` means a catch-all fallback.
 *
 * The output Group names embed the parent in the name ("Peripherals — Mice")
 * because the CSV importer auto-creates flat Groups. Once they exist, you can
 * optionally set parentId on each via the Groups admin page to enable the GST
 * cascade; for now the per-Group hsnCode + gstRate handle that directly.
 *
 * Run:  pnpm tsx scripts/classify-products-csv.ts
 * Output: out/products-classified.csv
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config({ path: ".env" });
const url = (process.env.DIRECT_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never) as PrismaClient;

type Confidence = "high" | "medium" | "low";

interface Rule {
    /** Case-insensitive regex tested against product.name */
    re: RegExp;
    /** Proposed Group name (the importer will auto-create if missing). */
    group: string;
    /** Suggested HSN code — see notes in PROPOSAL.md. Operator can override. */
    hsn: string;
    /** Suggested GST % — most IT hardware is 18%. */
    gst: number;
    confidence: Confidence;
}

/**
 * Ordered rule table. **First match wins**, so more specific patterns must
 * appear before generic ones. Adjust freely; re-run the script.
 *
 * HSN codes are approximate — common buckets for Indian IT retail. Verify
 * against your CA's classification before filing.
 */
const RULES: Rule[] = [
    // ── CCTV / Surveillance ──────────────────────────────────────────────────
    { re: /^dome\b/i,                          group: "Surveillance — Cameras",        hsn: "8525",   gst: 18, confidence: "high" },
    { re: /^bullet\b/i,                        group: "Surveillance — Cameras",        hsn: "8525",   gst: 18, confidence: "high" },
    { re: /\bbullet ip\b/i,                    group: "Surveillance — Cameras",        hsn: "8525",   gst: 18, confidence: "high" },
    { re: /\bwifi camera\b/i,                  group: "Surveillance — Cameras",        hsn: "8525",   gst: 18, confidence: "high" },
    { re: /\b360 wifi camera\b/i,              group: "Surveillance — Cameras",        hsn: "8525",   gst: 18, confidence: "high" },
    { re: /^dvr\b/i,                           group: "Surveillance — Recorders",      hsn: "8521",   gst: 18, confidence: "high" },
    { re: /^nvr\b/i,                           group: "Surveillance — Recorders",      hsn: "8521",   gst: 18, confidence: "high" },
    { re: /^hdd cctv\b/i,                      group: "Surveillance — Storage HDDs",   hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^cctv smps\b/i,                     group: "Surveillance — CCTV Power",     hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^cctv adapter\b/i,                  group: "Surveillance — CCTV Power",     hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^cctv audio\b/i,                    group: "Surveillance — Audio",          hsn: "8518",   gst: 18, confidence: "high" },
    { re: /^cctv hd video balun\b/i,           group: "Surveillance — Cables & Connectors", hsn: "8544", gst: 18, confidence: "high" },
    { re: /\bvideo balun\b/i,                  group: "Surveillance — Cables & Connectors", hsn: "8544", gst: 18, confidence: "high" },
    { re: /^bnc\b/i,                           group: "Surveillance — Cables & Connectors", hsn: "8536", gst: 18, confidence: "high" },
    { re: /^cctv dc connector\b/i,             group: "Surveillance — Cables & Connectors", hsn: "8536", gst: 18, confidence: "high" },
    { re: /^pigtail\b/i,                       group: "Surveillance — Cables & Connectors", hsn: "8536", gst: 18, confidence: "high" },
    { re: /^cat ?6 dahua\b/i,                  group: "Surveillance — Cables & Connectors", hsn: "8544", gst: 18, confidence: "high" },
    { re: /^cctv\b/i,                          group: "Surveillance — Accessories",    hsn: "8525",   gst: 18, confidence: "medium" },

    // ── Networking ───────────────────────────────────────────────────────────
    { re: /^switch poe\b/i,                    group: "Networking — Switches & Routers", hsn: "8517", gst: 18, confidence: "high" },
    { re: /\bethernet switch\b/i,              group: "Networking — Switches & Routers", hsn: "8517", gst: 18, confidence: "high" },
    { re: /\b4g lte wi-?fi router\b/i,         group: "Networking — Switches & Routers", hsn: "8517", gst: 18, confidence: "high" },
    { re: /^router\b/i,                        group: "Networking — Switches & Routers", hsn: "8517", gst: 18, confidence: "high" },
    { re: /^wifi adapter\b/i,                  group: "Networking — Wifi Adapters",    hsn: "8517",   gst: 18, confidence: "high" },
    { re: /\bwifi adapter\b/i,                 group: "Networking — Wifi Adapters",    hsn: "8517",   gst: 18, confidence: "high" },
    { re: /^bluetooth adapter\b/i,             group: "Networking — Bluetooth",        hsn: "8517",   gst: 18, confidence: "high" },
    { re: /\badapter wifi and bluetooth\b/i,   group: "Networking — Bluetooth",        hsn: "8517",   gst: 18, confidence: "high" },
    { re: /^networking\b/i,                    group: "Networking — Network Hardware", hsn: "8517",   gst: 18, confidence: "high" },
    { re: /^digisol\b/i,                       group: "Networking — Network Hardware", hsn: "8517",   gst: 18, confidence: "high" },
    { re: /\bkeystone jack\b/i,                group: "Networking — Network Hardware", hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\bface plate\b/i,                   group: "Networking — Network Hardware", hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\bmount box\b/i,                    group: "Networking — Network Hardware", hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\brj45\b/i,                         group: "Networking — LAN Accessories",  hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\brj11\b/i,                         group: "Networking — LAN Accessories",  hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\blan clip\b/i,                     group: "Networking — LAN Accessories",  hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\blan card\b/i,                     group: "Networking — LAN Accessories",  hsn: "8517",   gst: 18, confidence: "high" },
    { re: /^rack\b/i,                          group: "Networking — Racks",            hsn: "9403",   gst: 18, confidence: "high" },

    // ── Computer > Finished Systems ──────────────────────────────────────────
    { re: /^laptop\b/i,                        group: "Finished — Laptops",            hsn: "8471",   gst: 18, confidence: "high" },
    { re: /^monitor\b/i,                       group: "Finished — Monitors",           hsn: "8528",   gst: 18, confidence: "high" },
    { re: /^printer\b/i,                       group: "Finished — Printers",           hsn: "8443",   gst: 18, confidence: "high" },

    // ── Computer > Peripherals (must come before generic CPU/MB) ─────────────
    { re: /^web ?cam(era)?\b/i,                group: "Peripherals — Webcams",         hsn: "8525",   gst: 18, confidence: "high" },
    { re: /\bweb camera\b/i,                   group: "Peripherals — Webcams",         hsn: "8525",   gst: 18, confidence: "high" },
    { re: /^usb hub\b/i,                       group: "Peripherals — USB Hubs",        hsn: "8471",   gst: 18, confidence: "high" },
    { re: /^barcode scanner\b/i,               group: "Peripherals — Barcode Scanners", hsn: "8471",  gst: 18, confidence: "high" },
    { re: /^keyboard combo\b/i,                group: "Peripherals — Combos",          hsn: "8471",   gst: 18, confidence: "high" },
    { re: /^keyboard\b/i,                      group: "Peripherals — Keyboards",       hsn: "8471",   gst: 18, confidence: "high" },
    { re: /^mouse pad\b/i,                     group: "Accessories — Mouse Pads",      hsn: "3926",   gst: 18, confidence: "high" },
    { re: /^mouse\b/i,                         group: "Peripherals — Mice",            hsn: "8471",   gst: 18, confidence: "high" },

    // ── Computer > Components ────────────────────────────────────────────────
    { re: /^cpu (intel|amd|inlel|ryzen)\b/i,   group: "Components — CPUs",             hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^cpu cabinet fan\b/i,               group: "Components — Cooling",          hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^cpu fan\b/i,                       group: "Components — Cooling",          hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^mb\b/i,                            group: "Components — Motherboards",     hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^ddr[34]\b/i,                       group: "Components — RAM",              hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^ssd\b/i,                           group: "Components — SSDs",             hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^hdd\b/i,                           group: "Components — HDDs",             hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^cabinet\b/i,                       group: "Components — Cabinets & SMPS",  hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^smps\b/i,                          group: "Components — Cabinets & SMPS",  hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^graphics crd\b/i,                  group: "Components — Graphics Cards",   hsn: "8473",   gst: 18, confidence: "high" },
    { re: /\bgraphics card\b/i,                group: "Components — Graphics Cards",   hsn: "8473",   gst: 18, confidence: "high" },
    { re: /\boptical (dvd|cd)\b/i,             group: "Components — Optical Drives",   hsn: "8471",   gst: 18, confidence: "high" },
    { re: /\bdvd ?rw\b/i,                      group: "Components — Optical Drives",   hsn: "8471",   gst: 18, confidence: "high" },
    { re: /^heat sink\b/i,                     group: "Components — Cooling",          hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^converter (power|usb|hdmi|dp)\b/i, group: "Components — Converters",       hsn: "8543",   gst: 18, confidence: "medium" },
    { re: /\bdp to hdmi\b/i,                   group: "Components — Converters",       hsn: "8543",   gst: 18, confidence: "high" },
    { re: /\bsound card\b/i,                   group: "Audio — Sound Cards",           hsn: "8471",   gst: 18, confidence: "high" },

    // ── Laptop Spares ────────────────────────────────────────────────────────
    { re: /^laptop battery\b/i,                group: "Laptop Spares — Batteries",     hsn: "8507",   gst: 18, confidence: "high" },
    { re: /^adapter (acer|hp|dell|lenovo|asus|lapcare|lapcare\.?|samsung|sony)\b/i,
                                              group: "Laptop Spares — Adapters",      hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^adapter lapcare\b/i,               group: "Laptop Spares — Adapters",      hsn: "8504",   gst: 18, confidence: "high" },
    { re: /\blappy power\b/i,                  group: "Laptop Spares — Adapters",      hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^parts laptop\b/i,                  group: "Laptop Spares — Display / Other", hsn: "8473", gst: 18, confidence: "high" },
    { re: /\bkeypad protector\b/i,             group: "Laptop Spares — Keypad Protectors", hsn: "3926", gst: 18, confidence: "high" },
    { re: /\blaptop colling pad\b/i,           group: "Laptop Spares — Cooling Pads",  hsn: "8473",   gst: 18, confidence: "high" },
    { re: /\blaptop 3d stiker\b/i,             group: "Laptop Spares — Stickers",      hsn: "4911",   gst: 18, confidence: "high" },
    { re: /^screen protector\b/i,              group: "Accessories — Screen Protectors", hsn: "3919", gst: 18, confidence: "high" },
    { re: /^bag (laptop|backpack)\b/i,         group: "Accessories — Bags",            hsn: "4202",   gst: 18, confidence: "high" },

    // ── Printer Spares ───────────────────────────────────────────────────────
    { re: /^toner powder\b/i,                  group: "Printer Spares — Toner Powder", hsn: "3215",   gst: 18, confidence: "high" },
    { re: /^toner\b/i,                         group: "Printer Spares — Toner Cartridges", hsn: "8443", gst: 18, confidence: "high" },
    { re: /^ink epson\b/i,                     group: "Printer Spares — Inks",         hsn: "3215",   gst: 18, confidence: "high" },
    { re: /^ink\b/i,                           group: "Printer Spares — Inks",         hsn: "3215",   gst: 18, confidence: "medium" },
    { re: /^ribbon\b/i,                        group: "Printer Spares — Ribbons",      hsn: "9612",   gst: 18, confidence: "high" },
    { re: /^head canon\b/i,                    group: "Printer Spares — Print Heads",  hsn: "8443",   gst: 18, confidence: "high" },
    { re: /^part fuser\b/i,                    group: "Printer Spares — Fusers",       hsn: "8443",   gst: 18, confidence: "high" },
    { re: /^part printer\b/i,                  group: "Printer Spares — Other",        hsn: "8443",   gst: 18, confidence: "high" },

    // ── Paper / Office Stationery ────────────────────────────────────────────
    { re: /^paper (a4|my choice|jk|satia)\b/i, group: "Office Paper — A4",             hsn: "4802",   gst: 12, confidence: "high" },
    { re: /^paper brahmaputra\b/i,             group: "Office Paper — DMP",            hsn: "4802",   gst: 12, confidence: "high" },
    { re: /\bdmp\b/i,                          group: "Office Paper — DMP",            hsn: "4802",   gst: 12, confidence: "medium" },
    { re: /^photo paper\b/i,                   group: "Photo Paper",                    hsn: "4811",   gst: 18, confidence: "high" },
    { re: /^thermal paper\b/i,                 group: "Thermal Paper Rolls",            hsn: "4823",   gst: 18, confidence: "high" },
    { re: /^lamination roll\b/i,               group: "Lamination — Rolls",             hsn: "3920",   gst: 18, confidence: "high" },
    { re: /^lamination jacket\b/i,             group: "Lamination — Jackets",           hsn: "3920",   gst: 18, confidence: "high" },
    { re: /^lamination machine\b/i,            group: "Lamination — Machines",          hsn: "8472",   gst: 18, confidence: "high" },
    { re: /^lamination\b/i,                    group: "Lamination — Rolls",             hsn: "3920",   gst: 18, confidence: "medium" },
    { re: /^pvc card\b/i,                      group: "PVC / ID Cards",                 hsn: "3920",   gst: 18, confidence: "high" },
    { re: /\bcard printing tray\b/i,           group: "PVC / ID Cards",                 hsn: "3926",   gst: 18, confidence: "high" },

    // ── Cables (generic computer/data cables) ─────────────────────────────────
    { re: /^vga cable\b/i,                     group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^hdmi cable\b/i,                    group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^usb extension\b/i,                 group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^printer cable\b/i,                 group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^sata cable\b/i,                    group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^ext hdd cable\b/i,                 group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^cable type ?c\b/i,                 group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^aux cable\b/i,                     group: "Cables — Audio",                 hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^aux to rca\b/i,                    group: "Cables — Audio",                 hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^av cable\b/i,                      group: "Cables — Audio",                 hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^av jack\b/i,                       group: "Cables — Audio",                 hsn: "8536",   gst: 18, confidence: "high" },
    { re: /^power cable\b/i,                   group: "Cables — Power",                 hsn: "8544",   gst: 18, confidence: "high" },

    // ── Storage Media (standalone, not internal components) ──────────────────
    { re: /^pendrive\b/i,                      group: "Storage Media — Pendrives",      hsn: "8523",   gst: 18, confidence: "high" },
    { re: /\bsd card\b/i,                      group: "Storage Media — SD Cards",       hsn: "8523",   gst: 18, confidence: "high" },
    { re: /\bextreme pro micro sd\b/i,         group: "Storage Media — SD Cards",       hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^cdr\b/i,                           group: "Storage Media — Optical Discs",  hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^dvdr\b/i,                          group: "Storage Media — Optical Discs",  hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^casing (hdd|ssd)\b/i,              group: "Storage Media — External Casings", hsn: "3926", gst: 18, confidence: "high" },

    // ── Mobile & Audio ───────────────────────────────────────────────────────
    { re: /^speaker\b/i,                       group: "Audio — Speakers",              hsn: "8518",   gst: 18, confidence: "high" },
    { re: /^earphone\b/i,                      group: "Audio — Earphones",             hsn: "8518",   gst: 18, confidence: "high" },
    { re: /^data cable\b/i,                    group: "Mobile — Data Cables",          hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^otg\b/i,                           group: "Mobile — OTG Connectors",       hsn: "8536",   gst: 18, confidence: "high" },
    { re: /^tv remote\b/i,                     group: "TV Accessories — Remotes",      hsn: "8529",   gst: 18, confidence: "high" },
    { re: /\bset top\b/i,                      group: "TV Accessories — Set-top Cables", hsn: "8544", gst: 18, confidence: "medium" },
    { re: /\bwall mount\b.*\b(lcd|led|phone)\b/i, group: "Accessories — Wall Mounts",  hsn: "8302",   gst: 18, confidence: "high" },
    { re: /\bphone holder\b/i,                 group: "Accessories — Wall Mounts",     hsn: "8302",   gst: 18, confidence: "high" },

    // ── Power / Backup ───────────────────────────────────────────────────────
    { re: /^ups\b/i,                           group: "Power — UPS",                   hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^battery ups\b/i,                   group: "Power — UPS Batteries",         hsn: "8507",   gst: 18, confidence: "high" },
    { re: /^battery cmos\b/i,                  group: "Power — CMOS Batteries",        hsn: "8506",   gst: 18, confidence: "high" },
    { re: /^battery\b/i,                       group: "Power — Misc Batteries",        hsn: "8506",   gst: 18, confidence: "medium" },

    // ── Software / Services ──────────────────────────────────────────────────
    { re: /^tally\b/i,                         group: "Software — Accounting",         hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^antivir/i,                         group: "Software — Antivirus",          hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^service charge\b/i,                group: "Services",                       hsn: "9954",   gst: 18, confidence: "high" },

    // ── Tools / Misc ─────────────────────────────────────────────────────────
    { re: /^tools\b/i,                         group: "Tools",                          hsn: "8203",   gst: 18, confidence: "high" },
    { re: /^wire cutter\b/i,                   group: "Tools",                          hsn: "8203",   gst: 18, confidence: "high" },
    { re: /^screwdriver/i,                     group: "Tools",                          hsn: "8205",   gst: 18, confidence: "high" },
    { re: /\bcable tie\b/i,                    group: "Tools",                          hsn: "3926",   gst: 18, confidence: "high" },
    { re: /\brubber stamp\b/i,                 group: "Misc — Stamps",                  hsn: "9611",   gst: 18, confidence: "high" },
    { re: /^solar.*sensor light\b/i,           group: "Misc — Solar Lights",            hsn: "9405",   gst: 12, confidence: "high" },
    { re: /\bsensor light\b/i,                 group: "Misc — Solar Lights",            hsn: "9405",   gst: 12, confidence: "medium" },
    { re: /^gps\b/i,                           group: "Misc — GPS Trackers",            hsn: "8526",   gst: 18, confidence: "high" },
    { re: /\bjunction box\b/i,                 group: "Misc — Electrical",              hsn: "8536",   gst: 18, confidence: "high" },
    { re: /\bsmart band\b/i,                   group: "Misc — Wearables",               hsn: "9102",   gst: 18, confidence: "high" },
    { re: /\bfingerprint scanner\b/i,          group: "Misc — Biometric",               hsn: "8543",   gst: 18, confidence: "high" },

    // ── Second-pass / broader fallbacks (must come last; earlier specifics win)
    { re: /^charger mobile\b/i,                group: "Mobile — Chargers",              hsn: "8504",   gst: 18, confidence: "high" },
    { re: /^charger\b/i,                       group: "Mobile — Chargers",              hsn: "8504",   gst: 18, confidence: "medium" },
    { re: /^head ?phone\b/i,                   group: "Audio — Earphones",              hsn: "8518",   gst: 18, confidence: "high" },
    { re: /\bmic (wired|wireless|condenser)\b/i, group: "Audio — Microphones",          hsn: "8518",   gst: 18, confidence: "high" },
    { re: /^cat ?6 patch cable\b/i,            group: "Networking — LAN Accessories",   hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^cat ?6\b/i,                        group: "Networking — LAN Accessories",   hsn: "8544",   gst: 18, confidence: "medium" },
    { re: /^converter (vga|type ?c|hdmi|dp|usb|sata)\b/i, group: "Components — Converters", hsn: "8543", gst: 18, confidence: "high" },
    { re: /^power ext\b/i,                     group: "Cables — Power",                 hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^power extension\b/i,               group: "Cables — Power",                 hsn: "8544",   gst: 18, confidence: "high" },
    { re: /^ddr ?2\b/i,                        group: "Components — RAM",               hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^paper\b.*\d+gsm\b/i,               group: "Office Paper — A4",              hsn: "4802",   gst: 12, confidence: "medium" },
    { re: /^part desktop\b/i,                  group: "Components — Misc",              hsn: "8473",   gst: 18, confidence: "medium" },
    { re: /^part lcd\b/i,                      group: "Accessories — Wall Mounts",      hsn: "8302",   gst: 18, confidence: "medium" },
    { re: /\bwall mount\b/i,                   group: "Accessories — Wall Mounts",      hsn: "8302",   gst: 18, confidence: "medium" },
    { re: /\bcpu cooler\b/i,                   group: "Components — Cooling",           hsn: "8473",   gst: 18, confidence: "high" },
    { re: /^memory card\b/i,                   group: "Storage Media — SD Cards",       hsn: "8523",   gst: 18, confidence: "high" },
    { re: /^smps\b|^cabinet\b/i,               group: "Components — Cabinets & SMPS",   hsn: "8504",   gst: 18, confidence: "medium" },
    { re: /^connector\b/i,                     group: "Networking — LAN Accessories",   hsn: "8536",   gst: 18, confidence: "low" },
    { re: /^converter\b/i,                     group: "Components — Converters",        hsn: "8543",   gst: 18, confidence: "low" },
    { re: /^cable\b/i,                         group: "Cables — Data",                  hsn: "8544",   gst: 18, confidence: "low" },
    { re: /^paper\b/i,                         group: "Office Paper — A4",              hsn: "4802",   gst: 12, confidence: "low" },
];

/// Importer does a FULL-row replace on update — fields not present in the
/// CSV become null. So the export must include every classification + pricing
/// field for every SKU, with the proposed group/hsn/gst overlaid on top. That
/// way the round-trip is safe: operator only reviews the new columns, every
/// other field stays exactly as it was.
const HEADER = [
    "sku",
    "name",
    "unit",          // required by importer
    "brand",
    "category",
    "group",         // ← proposed (overlay)
    "warrantyTerm",
    "modelNo",
    "barcode1",
    "hsnCode",       // ← proposed
    "gstRate",       // ← proposed
    "taxability",
    // costPrice intentionally dropped — importer no longer accepts it. Cost
    // flows via Opening rate at books-beginning, then Purchase vouchers.
    "salePrice",
    "mrp",
    "openingStock",
    "openingRate",
    "openingDate",
    // Diagnostic columns — keep at the right edge, importer ignores them.
    "_currentGroup",
    "_confidence",
    "_matchedRule",
] as const;

const paiseToRupees = (p: number | null): string =>
    p == null ? "" : (p / 100).toFixed(2);

const decimalStr = (d: { toString(): string } | null): string =>
    d == null ? "" : d.toString();

function csvEscape(v: string | number | null): string {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

async function main() {
    const products = await prisma.invProduct.findMany({
        select: {
            id: true, sku: true, name: true,
            modelNo: true, barcode1: true,
            hsnCode: true, taxability: true,
            pricePaise: true, mrpPaise: true,
            openingStock: true, openingRate: true, openingStockDate: true,
            unit:         { select: { code: true } },
            brand:        { select: { name: true } },
            category:     { select: { name: true } },
            group:        { select: { name: true } },
            warrantyTerm: { select: { name: true } },
            gstRate:      { select: { rate: true } },
        },
        orderBy: { sku: "asc" },
    });
    console.log(`Loaded ${products.length} products from DB.`);

    const out: string[] = [HEADER.map(csvEscape).join(",")];
    const tally = new Map<string, number>();
    const unclassified: { sku: string; name: string }[] = [];

    for (const p of products) {
        let matched: Rule | null = null;
        for (const r of RULES) {
            if (r.re.test(p.name)) { matched = r; break; }
        }
        // Proposed (overlay) — only the 3 classification columns change.
        // Everything else echoes the current DB state so the round-trip is
        // safe under the importer's full-row-replace semantics.
        const proposedGroup = matched?.group ?? p.group?.name ?? "";
        const proposedHsn   = matched?.hsn ?? p.hsnCode ?? "";
        const proposedGst   = matched?.gst != null
            ? String(matched.gst)
            : (p.gstRate?.rate != null ? decimalStr(p.gstRate.rate) : "");
        const confidence = matched?.confidence ?? "low";
        const ruleSrc    = matched ? matched.re.source : "(no match — manual classify needed)";

        const row = [
            p.sku,
            p.name,
            p.unit?.code ?? "",
            p.brand?.name ?? "",
            p.category?.name ?? "",
            proposedGroup,
            p.warrantyTerm?.name ?? "",
            p.modelNo ?? "",
            p.barcode1 ?? "",
            proposedHsn,
            proposedGst,
            p.taxability ?? "",
            // costPaise omitted — importer derives running cost from openingRate.
            paiseToRupees(p.pricePaise),
            paiseToRupees(p.mrpPaise),
            decimalStr(p.openingStock as unknown as { toString(): string } | null),
            decimalStr(p.openingRate  as unknown as { toString(): string } | null),
            p.openingStockDate ? p.openingStockDate.toISOString().slice(0, 10) : "",
            p.group?.name ?? "",
            confidence,
            ruleSrc,
        ];
        out.push(row.map(csvEscape).join(","));

        tally.set(proposedGroup || "Unclassified", (tally.get(proposedGroup || "Unclassified") ?? 0) + 1);
        if (!matched) unclassified.push({ sku: p.sku, name: p.name });
    }

    const outDir = resolve(process.cwd(), "out");
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, "products-classified.csv");
    writeFileSync(outPath, out.join("\n"), "utf8");

    // Print summary so the operator can eyeball coverage before opening the file.
    console.log(`\nWrote ${products.length} rows → ${outPath}\n`);
    console.log("Per-group counts (descending):");
    [...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([g, n]) =>
        console.log(`  ${String(n).padStart(4)}  ${g}`)
    );
    if (unclassified.length > 0) {
        console.log(`\n${unclassified.length} unclassified products. Sample:`);
        for (const u of unclassified.slice(0, 25)) {
            console.log(`  ${u.sku.padEnd(16)}  ${u.name}`);
        }
        if (unclassified.length > 25) console.log(`  … and ${unclassified.length - 25} more (see CSV).`);
    }

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
