/**
 * One-off transformer for the Vyapar "Export Items.csv" → importer-ready CSV.
 *
 * Input  : d:/Users/User/Desktop/contact-import-testing/Export Items.csv
 * Output : d:/Users/User/Desktop/contact-import-testing/Export Items_enriched.csv
 *
 * For each row we:
 *  - Map Vyapar columns → importer's PRODUCT_IMPORT_FIELDS schema.
 *  - Strip the leading "- " noise some names carry.
 *  - Derive **Brand** from the name (first match against a known-brand list).
 *  - Derive **Group + HSN + GST** from keyword rules — same rule philosophy
 *    as scripts/classify-products-csv.ts, but ordered to match the canonical
 *    Group tree seeded by prisma/seeds/dummy-product-groups.ts.
 *  - Pass through Item code → sku/barcode1, Sale price, MRP, Purchase price
 *    → openingRate (cost), Current stock → openingStock, Base Unit → unit.
 *  - Parse "GST@18%" → "18".
 *  - Keep the existing Category (Vyapar's tax-bucket categories) — operator
 *    can decide later whether to drop or repurpose.
 *  - Add diagnostic columns `_confidence` and `_matchedRule` (the importer
 *    ignores unmapped columns).
 *
 * Run:  pnpm tsx scripts/transform-vyapar-csv.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/shared/lib/import/csvParse";

const INPUT  = "d:/Users/User/Desktop/contact-import-testing/Export Items.csv";
const OUTPUT = "d:/Users/User/Desktop/contact-import-testing/Export Items_enriched_v2.csv";

// ── Brand list ───────────────────────────────────────────────────────────────
// Order matters: longer / more-specific names first so "Hi Focus" doesn't lose
// to a bare "Focus" elsewhere. Case-insensitive whole-word match.
const BRANDS: readonly string[] = [
    // Multi-word brands (must come first)
    "Hi Focus", "HI Focus", "CP Pluse", "CP Plus", "Cp Plus", "Quick Heal", "Memory Power", "Power-X", "Power X",
    "Image King", "Image Toner", "Royal England", "Royal Englang", "Silver Line", "My Choice",
    "Color Power", "ARU ARX", "ARU", "Color Sprint", "Sun Pro", "Sandisk Ultra", "Ant Esports",
    "Coco Sports",
    // Single-word major brands
    "Logitech", "Lenovo", "Dell", "HP", "Canon", "Cannon", "Epson", "Brother", "Samsung",
    "Toshiba", "Kingston", "Sandisk", "Prodot", "Coconut", "Lapcare", "Foxin", "KiTech",
    "Rapoo", "Zebronics", "Trueview", "EVM", "Daichi", "Frontech", "Crucial", "Vention",
    "ADATA", "NPAV", "Tally", "Asus", "Acer", "Robotek", "Portronics", "Zoook", "Ptron",
    "Bigsavings", "Numeric", "Elnova", "Dahua", "Stellular", "Scuda", "Avertek",
    "M.Skill", "M.SKILL", "M SKILL", "Retsol", "Bindal", "BINDAL", "JK", "Satia", "Brahmaputra",
    "Nova", "Prismajet", "Impex", "Gobbler", "Kodak", "Konica", "Kyocera", "Xerox",
    "Folex", "Supremo", "Tatasky", "GTPL", "SITI", "Videocon", "Airtel", "Foleo", "Coco",
    "Galaxy", "Cosco", "Widzet", "Roshni", "PULP", "HTR", "Pulp", "Brindavan", "River Fox",
    "Robotek", "Zinq", "Zinq", "Uricom", "NETGEAR", "TP-Link", "DIGISOL", "Digisol",
    "KARANI", "Gold Star", "Eprint", "Exxact", "Genus", "Indigo", "KOne", "Konquer",
    "Maple", "Excelam", "IK", "ECO P", "ECO G", "ECO RISE", "WL eco", "Force",
    "ImageKing", "Cofe", "Tablepro", "Wivpha", "Cisco", "D-Link", "DLink", "Tenda",
    "iBall", "TVS", "TVS Champ", "Relicell", "Cofe", "Yonex", "Xcess", "Daichi",
    "Quintet", "Daichi", "OCC", "VMS", "Schneider", "Havells", "Anchor", "Philips",
    "Eveready", "Duracell", "Panasonic", "Sony", "Boat", "Cofe", "Secureya", "DVM",
    "Alkon", "Divinext",
    // Round 3 additions from real catalog data
    "K7", "KOne", "Bond", "BGPPL", "Desmat", "TNPL", "Ergin", "SMACC", "AUSHA",
    "Helett", "Tiandy", "UNC", "Powerx", "TJ-Alfa", "Trayojack", "Anchor", "Boat",
    "Smart Bharat", "Ambrane", "DLink", "D-Link", "Iball", "iBall", "Vyapar",
    "Stanley", "Sumo", "Homdum", "Hikvision", "Vinay", "RR Kabel", "Ajanta",
    "Presto", "Gitti", "Witch", "Hikvision",
];
// Deduplicate while preserving order (multi-word entries written above before bare).
const BRAND_LIST = Array.from(new Set(BRANDS));

// Compile to one big alternation regex (escape spaces & dots).
const BRAND_RE = new RegExp(
    "\\b(" + BRAND_LIST.map((b) => b.replace(/[.+*?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|") + ")\\b",
    "i",
);

function extractBrand(name: string): string {
    const m = BRAND_RE.exec(name);
    if (!m) return "";
    // Normalise common variants to canonical names so master de-dupes correctly.
    const canon: Record<string, string> = {
        "cannon": "Canon",
        "cp plus": "CP Plus",
        "cp pluse": "CP Plus",
        "hi focus": "Hi Focus",
        "royal englang": "Royal England",
        "m.skill": "M-Skill",
        "m.SKILL": "M-Skill",
        "m skill": "M-Skill",
        "bindal": "Bindal",
        "imageking": "Image King",
        "d-link": "D-Link",
        "dlink": "D-Link",
        "iball": "iBall",
    };
    const key = m[1].toLowerCase().replace(/\s+/g, " ");
    return canon[key] ?? m[1].replace(/\s+/g, " ");
}

// ── Group / HSN / GST rules ──────────────────────────────────────────────────
// First match wins. Group names align with the canonical tree seeded by
// prisma/seeds/dummy-product-groups.ts.
type Confidence = "high" | "medium" | "low";
interface Rule { re: RegExp; group: string; hsn: string; gst: number; confidence: Confidence }

const RULES: Rule[] = [
    // ── CCTV / Surveillance ───────────────────────────────────────────────────
    { re: /^dome\b/i,                            group: "Surveillance Cameras",       hsn: "85258090", gst: 18, confidence: "high" },
    { re: /^bullet\b/i,                          group: "Surveillance Cameras",       hsn: "85258090", gst: 18, confidence: "high" },
    { re: /\bbullet ip\b/i,                      group: "Surveillance Cameras",       hsn: "85258090", gst: 18, confidence: "high" },
    { re: /\bwifi camera\b/i,                    group: "Surveillance Cameras",       hsn: "85258090", gst: 18, confidence: "high" },
    { re: /^dvr\b/i,                             group: "Surveillance Recorders",     hsn: "85219090", gst: 18, confidence: "high" },
    { re: /^nvr\b/i,                             group: "Surveillance Recorders",     hsn: "85219090", gst: 18, confidence: "high" },
    { re: /^hdd cctv\b/i,                        group: "CCTV Storage Drives",        hsn: "85235100", gst: 18, confidence: "high" },
    { re: /^cctv smps\b/i,                       group: "CCTV Power Supplies",        hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^cctv adapter\b/i,                    group: "CCTV Power Supplies",        hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^cctv audio\b/i,                      group: "CCTV Cabling & Connectors",  hsn: "85181000", gst: 18, confidence: "high" },
    { re: /\bvideo balun\b/i,                    group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^bnc\b/i,                             group: "CCTV Cabling & Connectors",  hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^cctv dc connector\b/i,               group: "CCTV Cabling & Connectors",  hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^pigtail\b/i,                         group: "CCTV Cabling & Connectors",  hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^cat ?6 dahua\b/i,                    group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^cctv\b/i,                            group: "Surveillance Mounts & Misc", hsn: "83024900", gst: 18, confidence: "medium" },

    // ── Networking ────────────────────────────────────────────────────────────
    { re: /^switch poe\b/i,                      group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /\bethernet switch\b/i,                group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /\b4g lte wi-?fi router\b/i,           group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^4g router\b/i,                       group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^router\b/i,                          group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^wifi adapter\b/i,                    group: "Wifi & Bluetooth Adapters",  hsn: "85176290", gst: 18, confidence: "high" },
    { re: /\bwifi adapter\b/i,                   group: "Wifi & Bluetooth Adapters",  hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^bluetooth adapter\b/i,               group: "Wifi & Bluetooth Adapters",  hsn: "85176290", gst: 18, confidence: "high" },
    { re: /\badapter wifi and bluetooth\b/i,     group: "Wifi & Bluetooth Adapters",  hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^networking\b/i,                      group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^digisol\b/i,                         group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bkeystone jack\b/i,                  group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bface plate\b/i,                     group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bmount box\b/i,                      group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\brj45\b/i,                           group: "LAN Accessories",            hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\brj11\b/i,                           group: "LAN Accessories",            hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\blan clip\b/i,                       group: "LAN Accessories",            hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\blan card\b/i,                       group: "LAN Accessories",            hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^rack\b/i,                            group: "Network Hardware",           hsn: "94036000", gst: 18, confidence: "high" },

    // ── Computer > Finished Systems ───────────────────────────────────────────
    // Tight `^laptop <brand>` so the generic doesn't swallow "Laptop Battery /
    // Laptop Cooling Pad / Laptop 3d Sticker" (the specific spare-rules below
    // need a chance to match first).
    { re: /^laptop (hp|dell|lenovo|acer|asus|apple|samsung|msi|fujitsu|toshiba|sony)\b/i,
                                                  group: "Laptops",                    hsn: "84713010", gst: 18, confidence: "high" },
    { re: /^laptop (i\d|amd|celeron|core|pentium|ryzen)\b/i,
                                                  group: "Laptops",                    hsn: "84713010", gst: 18, confidence: "high" },
    { re: /^monitor\b/i,                         group: "Monitors",                   hsn: "85285200", gst: 18, confidence: "high" },
    { re: /^printer\b/i,                         group: "Printers",                   hsn: "84433100", gst: 18, confidence: "high" },
    { re: /^cartridge\b/i,                       group: "Toner Cartridges",           hsn: "32151900", gst: 18, confidence: "high" },

    // ── Computer > Peripherals ────────────────────────────────────────────────
    { re: /^web ?cam(era)?\b/i,                  group: "Webcams",                    hsn: "85258020", gst: 18, confidence: "high" },
    { re: /\bweb camera\b/i,                     group: "Webcams",                    hsn: "85258020", gst: 18, confidence: "high" },
    { re: /^usb hub\b/i,                         group: "USB Hubs & Converters",      hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^barcode scanner\b/i,                 group: "Barcode Scanners",           hsn: "84717090", gst: 18, confidence: "high" },
    { re: /^keyboard combo\b/i,                  group: "Keyboard-Mouse Combos",      hsn: "84716090", gst: 18, confidence: "high" },
    { re: /^keyboard\b/i,                        group: "Computer Keyboards",         hsn: "84716060", gst: 18, confidence: "high" },
    { re: /^mouse pad\b/i,                       group: "Mouse Pads",                 hsn: "39269099", gst: 18, confidence: "high" },
    { re: /^mouse\b/i,                           group: "Computer Mice",              hsn: "84716090", gst: 18, confidence: "high" },

    // ── Computer > Components ─────────────────────────────────────────────────
    { re: /^cpu (intel|amd|inlel|ryzen)\b/i,     group: "CPUs",                       hsn: "85423100", gst: 18, confidence: "high" },
    { re: /^cpu cabinet fan\b/i,                 group: "Cooling Components",         hsn: "84733099", gst: 18, confidence: "high" },
    { re: /^cpu fan\b/i,                         group: "Cooling Components",         hsn: "84733099", gst: 18, confidence: "high" },
    { re: /^mb\b/i,                              group: "Motherboards",               hsn: "84733020", gst: 18, confidence: "high" },
    { re: /^ddr[234]\b/i,                        group: "Memory (RAM)",               hsn: "84733010", gst: 18, confidence: "high" },
    { re: /^ssd\b/i,                             group: "Internal Storage Drives",    hsn: "84717020", gst: 18, confidence: "high" },
    { re: /^hdd\b/i,                             group: "Internal Storage Drives",    hsn: "84717020", gst: 18, confidence: "high" },
    { re: /^cabinet\b/i,                         group: "Cabinets & SMPS",            hsn: "84733099", gst: 18, confidence: "high" },
    { re: /^smps\b/i,                            group: "Cabinets & SMPS",            hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^graphics crd\b/i,                    group: "Graphics Cards",             hsn: "84733030", gst: 18, confidence: "high" },
    { re: /\bgraphics card\b/i,                  group: "Graphics Cards",             hsn: "84733030", gst: 18, confidence: "high" },
    { re: /\boptical (dvd|cd)\b/i,               group: "Optical Drives",             hsn: "84717030", gst: 18, confidence: "high" },
    { re: /\bdvd ?rw\b/i,                        group: "Optical Drives",             hsn: "84717030", gst: 18, confidence: "high" },
    { re: /^heat sink\b/i,                       group: "Cooling Components",         hsn: "84733099", gst: 18, confidence: "high" },
    { re: /^converter (power|usb|hdmi|dp|vga|type ?c|sata)\b/i,
                                                  group: "USB Hubs & Converters",      hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bdp to hdmi\b/i,                     group: "USB Hubs & Converters",      hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bsound card\b/i,                     group: "Audio Adapters",             hsn: "84717090", gst: 18, confidence: "high" },

    // ── Laptop Spares ─────────────────────────────────────────────────────────
    { re: /^laptop battery\b/i,                  group: "Laptop Batteries",           hsn: "85076000", gst: 18, confidence: "high" },
    { re: /^adapter (acer|hp|dell|lenovo|asus|lapcare|samsung|sony)\b/i,
                                                  group: "Laptop Adapters",            hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^adapter lapcare\b/i,                 group: "Laptop Adapters",            hsn: "85044090", gst: 18, confidence: "high" },
    { re: /\blappy power\b/i,                    group: "Laptop Adapters",            hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^parts laptop\b/i,                    group: "Laptop Display Screens",     hsn: "85285200", gst: 18, confidence: "high" },
    { re: /\bkeypad protector\b/i,               group: "Laptop Cosmetic Accessories",hsn: "39269099", gst: 18, confidence: "high" },
    { re: /\blaptop (colling|cooling) pad\b/i,   group: "Laptop Cooling Pads",        hsn: "84149090", gst: 18, confidence: "high" },
    { re: /\blaptop cooler\b/i,                  group: "Laptop Cooling Pads",        hsn: "84149090", gst: 18, confidence: "high" },
    { re: /\blaptop 3d stiker\b/i,               group: "Laptop Cosmetic Accessories",hsn: "39269099", gst: 18, confidence: "high" },
    { re: /^screen protector\b/i,                group: "Laptop Cosmetic Accessories",hsn: "39269099", gst: 18, confidence: "high" },
    { re: /^bag (laptop|backpack)\b/i,           group: "Laptop Bags & Backpacks",    hsn: "42021290", gst: 18, confidence: "high" },

    // ── Printer Spares ────────────────────────────────────────────────────────
    { re: /^toner powder\b/i,                    group: "Toner Powder",               hsn: "32151990", gst: 18, confidence: "high" },
    { re: /^toner\b/i,                           group: "Toner Cartridges",           hsn: "32151900", gst: 18, confidence: "high" },
    { re: /^ink epson\b/i,                       group: "Printer Ink",                hsn: "32151110", gst: 18, confidence: "high" },
    { re: /^ink (canon|cannon|hp|brother)\b/i,   group: "Printer Ink",                hsn: "32151110", gst: 18, confidence: "high" },
    { re: /^ink\b/i,                             group: "Printer Ink",                hsn: "32151110", gst: 18, confidence: "medium" },
    { re: /^ribbon\b/i,                          group: "Printer Ribbons",            hsn: "96121010", gst: 18, confidence: "high" },
    { re: /^head canon\b/i,                      group: "Printer Heads",              hsn: "84439990", gst: 18, confidence: "high" },
    { re: /^part fuser\b/i,                      group: "Printer Fusers & Rollers",   hsn: "84439990", gst: 18, confidence: "high" },
    { re: /^part printer\b/i,                    group: "Printer Fusers & Rollers",   hsn: "84439990", gst: 18, confidence: "high" },

    // ── Paper / Office Stationery ─────────────────────────────────────────────
    { re: /^paper (a4|my choice|jk|satia|brahmaputra)\b/i,
                                                  group: "Office Paper",               hsn: "48025690", gst: 12, confidence: "high" },
    { re: /\bdmp\b/i,                            group: "Office Paper",               hsn: "48025690", gst: 12, confidence: "medium" },
    { re: /^photo paper\b/i,                     group: "Photo Paper",                hsn: "48119099", gst: 18, confidence: "high" },
    { re: /^thermal paper\b/i,                   group: "Thermal Paper",              hsn: "48239090", gst: 18, confidence: "high" },
    { re: /^lamination roll\b/i,                 group: "Lamination Material",        hsn: "39204900", gst: 18, confidence: "high" },
    { re: /^lamination jacket\b/i,               group: "Lamination Material",        hsn: "39204900", gst: 18, confidence: "high" },
    { re: /^lamination machine\b/i,              group: "Lamination Machines",        hsn: "84729090", gst: 18, confidence: "high" },
    { re: /^lamination\b/i,                      group: "Lamination Material",        hsn: "39204900", gst: 18, confidence: "medium" },
    { re: /^pvc card\b/i,                        group: "PVC & ID Cards",             hsn: "39204900", gst: 18, confidence: "high" },
    { re: /\bcard printing tray\b/i,             group: "PVC & ID Cards",             hsn: "39269099", gst: 18, confidence: "high" },

    // ── Cables ────────────────────────────────────────────────────────────────
    { re: /^vga cable\b/i,                       group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^hdmi cable\b/i,                      group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^usb extension\b/i,                   group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^printer cable\b/i,                   group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^sata cable\b/i,                      group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^ext hdd cable\b/i,                   group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^cable type ?c\b/i,                   group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^aux cable\b/i,                       group: "AUX & RCA Cables",           hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^aux to rca\b/i,                      group: "AUX & RCA Cables",           hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^av cable\b/i,                        group: "AUX & RCA Cables",           hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^av jack\b/i,                         group: "AUX & RCA Cables",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^power cable\b/i,                     group: "Power Cables",               hsn: "85444299", gst: 18, confidence: "high" },

    // ── Storage Media ─────────────────────────────────────────────────────────
    { re: /^pendrive\b/i,                        group: "USB Flash Drives",           hsn: "85235100", gst: 18, confidence: "high" },
    { re: /\bsd card\b/i,                        group: "Memory Cards",               hsn: "85235100", gst: 18, confidence: "high" },
    { re: /\bextreme pro micro sd\b/i,           group: "Memory Cards",               hsn: "85235100", gst: 18, confidence: "high" },
    { re: /^cdr\b/i,                             group: "Optical Discs",              hsn: "85234120", gst: 18, confidence: "high" },
    { re: /^dvdr\b/i,                            group: "Optical Discs",              hsn: "85234120", gst: 18, confidence: "high" },
    { re: /^casing (hdd|ssd)\b/i,                group: "External Storage Casings",   hsn: "84733099", gst: 18, confidence: "high" },

    // ── Mobile & Audio ────────────────────────────────────────────────────────
    { re: /^speaker\b/i,                         group: "Bluetooth Speakers",         hsn: "85182200", gst: 18, confidence: "high" },
    { re: /^earphone\b/i,                        group: "Earphones & Headsets",       hsn: "85183000", gst: 18, confidence: "high" },
    { re: /^head ?phone\b/i,                     group: "Earphones & Headsets",       hsn: "85183000", gst: 18, confidence: "high" },
    { re: /^data cable\b/i,                      group: "Mobile Data Cables",         hsn: "85444299", gst: 18, confidence: "high" },
    { re: /^otg\b/i,                             group: "Mobile Connectors & OTG",    hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^tv remote\b/i,                       group: "TV Remotes & Set-top",       hsn: "85299090", gst: 18, confidence: "high" },
    { re: /\bset top\b/i,                        group: "TV Remotes & Set-top",       hsn: "85444299", gst: 18, confidence: "medium" },
    { re: /\bwall mount\b.*\b(lcd|led|phone)\b/i,group: "Wall Mounts & Stands",       hsn: "83024900", gst: 18, confidence: "high" },
    { re: /\bphone holder\b/i,                   group: "Phone Mounts & Holders",     hsn: "83024900", gst: 18, confidence: "high" },

    // ── Power / Backup ────────────────────────────────────────────────────────
    { re: /^ups\b/i,                             group: "UPS Systems",                hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^battery ups\b/i,                     group: "UPS Batteries",              hsn: "85072000", gst: 18, confidence: "high" },
    { re: /^battery cmos\b/i,                    group: "CMOS & Coin Batteries",      hsn: "85068000", gst: 18, confidence: "high" },
    { re: /^battery\b/i,                         group: "CMOS & Coin Batteries",      hsn: "85068000", gst: 18, confidence: "medium" },

    // ── Software / Services ───────────────────────────────────────────────────
    { re: /^tally\b/i,                           group: "Accounting Software",        hsn: "85234990", gst: 18, confidence: "high" },
    { re: /^antivir/i,                           group: "Antivirus Software",         hsn: "85234990", gst: 18, confidence: "high" },
    { re: /^service charge\b/i,                  group: "Installation Services",      hsn: "998739",   gst: 18, confidence: "high" },

    // ── Tools / Misc ──────────────────────────────────────────────────────────
    { re: /^tools\b/i,                           group: "Repair Tools",               hsn: "82054000", gst: 18, confidence: "high" },
    { re: /^wire cutter\b/i,                     group: "Repair Tools",               hsn: "82054000", gst: 18, confidence: "high" },
    { re: /^screwdriver/i,                       group: "Repair Tools",               hsn: "82054000", gst: 18, confidence: "high" },
    { re: /\bcable tie\b/i,                      group: "Repair Tools",               hsn: "39269099", gst: 18, confidence: "high" },
    { re: /\brubber stamp\b/i,                   group: "Office Stationery",          hsn: "96120010", gst: 18, confidence: "high" },
    { re: /^solar.*sensor light\b/i,             group: "Lifestyle & Misc",           hsn: "94054090", gst: 12, confidence: "high" },
    { re: /\bsensor light\b/i,                   group: "Lifestyle & Misc",           hsn: "94054090", gst: 12, confidence: "medium" },
    { re: /^gps\b/i,                             group: "Lifestyle & Misc",           hsn: "85269190", gst: 18, confidence: "high" },
    { re: /\bjunction box\b/i,                   group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bsmart band\b/i,                     group: "Lifestyle & Misc",           hsn: "91021900", gst: 18, confidence: "high" },
    { re: /\bfingerprint scanner\b/i,            group: "Lifestyle & Misc",           hsn: "85437099", gst: 18, confidence: "high" },

    // ── Round 3 fallbacks (long-tail patterns from real Vyapar data) ──────────
    { re: /^switch \d+[\s-]*port\b/i,            group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /^xpon\b/i,                            group: "Network Switches & Routers", hsn: "85176290", gst: 18, confidence: "high" },
    { re: /\bptz\b/i,                            group: "Surveillance Cameras",       hsn: "85258090", gst: 18, confidence: "high" },
    { re: /\bhikvision\b/i,                      group: "Surveillance Cameras",       hsn: "85258090", gst: 18, confidence: "medium" },
    { re: /^mobile holder\b/i,                   group: "Phone Mounts & Holders",     hsn: "83024900", gst: 18, confidence: "high" },
    { re: /^tripod\b/i,                          group: "Phone Mounts & Holders",     hsn: "96204000", gst: 18, confidence: "high" },
    { re: /^pvc (box|gang box|wall plug)\b/i,    group: "Network Hardware",           hsn: "39259090", gst: 18, confidence: "high" },
    { re: /\bjunction box\b|^termination box\b/i,group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "high" },
    { re: /^power bank\b/i,                      group: "Mobile Data Cables",         hsn: "85076000", gst: 18, confidence: "high" },
    { re: /^spike guard\b/i,                     group: "Power Cables",               hsn: "85369090", gst: 18, confidence: "high" },
    { re: /\bsoundbar\b/i,                       group: "Bluetooth Speakers",         hsn: "85182200", gst: 18, confidence: "high" },
    { re: /^sepaker\b/i,                         group: "Bluetooth Speakers",         hsn: "85182200", gst: 18, confidence: "high" }, // typo of "Speaker"
    { re: /\bcrimping tool\b|^punch[\s-]?down tool\b|^punch tool\b/i,
                                                  group: "Repair Tools",               hsn: "82054000", gst: 18, confidence: "high" },
    { re: /\bstanley\b/i,                        group: "Repair Tools",               hsn: "82054000", gst: 18, confidence: "medium" },
    { re: /\btool belt\b/i,                      group: "Repair Tools",               hsn: "42029900", gst: 18, confidence: "high" },
    { re: /\bdigital weighting scale\b|\bweighting scale\b/i,
                                                  group: "Lifestyle & Misc",           hsn: "84233000", gst: 18, confidence: "high" },
    { re: /\bvyapar software\b/i,                group: "Accounting Software",        hsn: "85234990", gst: 18, confidence: "high" },
    { re: /^thermal printer\b/i,                 group: "Printers",                   hsn: "84433100", gst: 18, confidence: "high" },
    { re: /\bmaintenance box\b/i,                group: "Printer Fusers & Rollers",   hsn: "84439990", gst: 18, confidence: "high" },
    { re: /\btv remot\b/i,                       group: "TV Remotes & Set-top",       hsn: "85299090", gst: 18, confidence: "high" },
    { re: /^tv\b.*\b(controller|driver)\b/i,     group: "TV Remotes & Set-top",       hsn: "85299090", gst: 18, confidence: "medium" },
    { re: /\bwall plug\b/i,                      group: "Network Hardware",           hsn: "85369090", gst: 18, confidence: "medium" },
    { re: /\binsulated\b.*\bwire\b/i,            group: "Power Cables",               hsn: "85444299", gst: 18, confidence: "high" },
    { re: /\bcomponent organiser\b|^cash tray\b/i,
                                                  group: "Office Stationery",          hsn: "39239090", gst: 18, confidence: "high" },
    { re: /\btape self adhesive\b|^tape\b/i,     group: "Office Stationery",          hsn: "39199090", gst: 18, confidence: "high" },
    { re: /\bled.*striker light\b|\bled.*light\b/i,
                                                  group: "Lifestyle & Misc",           hsn: "94054090", gst: 18, confidence: "medium" },
    { re: /\bsensor.*switch\b/i,                 group: "Lifestyle & Misc",           hsn: "85365000", gst: 18, confidence: "medium" },
    { re: /\belectric switch\b/i,                group: "Network Hardware",           hsn: "85365000", gst: 18, confidence: "high" },
    { re: /\benvelop(e)?\b/i,                    group: "Office Stationery",          hsn: "48171000", gst: 18, confidence: "high" },
    { re: /\bwoki toki\b|\bwalkie talkie\b/i,    group: "Lifestyle & Misc",           hsn: "85176100", gst: 18, confidence: "high" },
    { re: /^mobile\b.*\b(\d+gb|ram)\b/i,         group: "Lifestyle & Misc",           hsn: "85171300", gst: 18, confidence: "medium" }, // mobile phones

    // ── Broader fallbacks (must come last; earlier specifics win) ─────────────
    { re: /\bcar charger\b/i,                    group: "Mobile Data Cables",         hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^charger mobile\b/i,                  group: "Mobile Data Cables",         hsn: "85044090", gst: 18, confidence: "high" },
    { re: /^charger\b/i,                         group: "Mobile Data Cables",         hsn: "85044090", gst: 18, confidence: "medium" },
    { re: /^adapter\b/i,                         group: "Laptop Adapters",            hsn: "85044090", gst: 18, confidence: "medium" },
    { re: /\bairdopes\b/i,                       group: "Earphones & Headsets",       hsn: "85183000", gst: 18, confidence: "high" },
    { re: /^boat (earphone|bt speaker|airdopes)\b/i,
                                                  group: "Earphones & Headsets",       hsn: "85183000", gst: 18, confidence: "high" },
    { re: /^bt speaker\b/i,                      group: "Bluetooth Speakers",         hsn: "85182200", gst: 18, confidence: "high" },
    { re: /\bmic (wired|wireless|condenser)\b/i, group: "Earphones & Headsets",       hsn: "85181000", gst: 18, confidence: "high" },
    { re: /^cat ?6\b/i,                          group: "LAN Accessories",            hsn: "85444299", gst: 18, confidence: "medium" },
    { re: /^converter\b/i,                       group: "USB Hubs & Converters",      hsn: "85369090", gst: 18, confidence: "low" },
    { re: /^cable\b/i,                           group: "CCTV Cabling & Connectors",  hsn: "85444299", gst: 18, confidence: "low" },
    { re: /^memory card\b/i,                     group: "Memory Cards",               hsn: "85235100", gst: 18, confidence: "high" },
    { re: /^connector\b/i,                       group: "LAN Accessories",            hsn: "85369090", gst: 18, confidence: "low" },
    { re: /\bcpu cooler\b/i,                     group: "Cooling Components",         hsn: "84733099", gst: 18, confidence: "high" },
    { re: /^paper\b.*\d+gsm\b/i,                 group: "Office Paper",               hsn: "48025690", gst: 12, confidence: "medium" },
    { re: /^paper\b/i,                           group: "Office Paper",               hsn: "48025690", gst: 12, confidence: "low" },
    { re: /^power ext\b/i,                       group: "Power Cables",               hsn: "85444299", gst: 18, confidence: "high" },
];

function classify(name: string): { group: string; hsn: string; gst: number; confidence: Confidence; ruleIdx: number } {
    for (let i = 0; i < RULES.length; i++) {
        if (RULES[i].re.test(name)) {
            return { ...RULES[i], ruleIdx: i };
        }
    }
    return { group: "", hsn: "", gst: 18, confidence: "low", ruleIdx: -1 };
}

// ── CSV write helper (RFC 4180) ──────────────────────────────────────────────
function csvEscape(s: unknown): string {
    if (s == null) return "";
    const t = String(s);
    if (/[",\r\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
    return t;
}
function toCsv(rows: string[][]): string {
    return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

// ── Tax-rate parser: "GST@18%" / "18%" / "18" → number ───────────────────────
function parseGstCell(raw: string): number | null {
    const m = /(\d+(?:\.\d+)?)/.exec(raw ?? "");
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}

function stripLeadingDash(name: string): string {
    return name.replace(/^[\s-]+/, "").trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────
const raw = readFileSync(INPUT, "utf8").replace(/^﻿/, ""); // strip BOM
const parsed = parseCsv(raw);
const headers = parsed.headers.map((h) => h.trim());

// Vyapar column → index
const col = (label: string): number => {
    const idx = headers.findIndex((h) => h.toLowerCase() === label.toLowerCase());
    if (idx < 0) throw new Error(`Vyapar column "${label}" not found. Got headers: ${headers.join(", ")}`);
    return idx;
};
const I_NAME    = col("Item name*");
const I_CODE    = col("Item code");
const I_CAT     = col("Category");
const I_HSN     = col("HSN");
const I_MRP     = col("Default Mrp");
const I_SALE    = col("Sale price");
const I_PURCH   = col("Purchase price");
const I_STOCK   = col("Current stock quantity");
const I_TAX     = col("Tax Rate");
const I_UNIT    = col("Base Unit (x)");

const OUT_HEADER = [
    "sku", "name", "unit", "brand", "category", "group",
    "hsnCode", "gstRate",
    "salePrice", "mrp",
    "openingStock", "openingRate",
    "barcode1",
    "_confidence", "_matchedRule",
];

const out: string[][] = [OUT_HEADER];
const confCounts: Record<Confidence | "unclassified", number> = { high: 0, medium: 0, low: 0, unclassified: 0 };
const groupCounts: Record<string, number> = {};

for (const row of parsed.rows) {
    const itemCode = (row[I_CODE] ?? "").trim();
    const rawName  = (row[I_NAME] ?? "").trim();
    if (!itemCode || !rawName) continue;
    const name     = stripLeadingDash(rawName);
    const category = (row[I_CAT] ?? "").trim();
    const unit     = (row[I_UNIT] ?? "Unit").trim() || "Unit";
    const mrp      = (row[I_MRP] ?? "").trim();
    const sale     = (row[I_SALE] ?? "").trim();
    const purch    = (row[I_PURCH] ?? "").trim();
    const stock    = (row[I_STOCK] ?? "").trim();
    const hsnOrig  = (row[I_HSN] ?? "").trim();
    const taxOrig  = (row[I_TAX] ?? "").trim();

    const c = classify(name);
    const conf = c.group ? c.confidence : "unclassified";
    confCounts[conf]++;
    if (c.group) groupCounts[c.group] = (groupCounts[c.group] ?? 0) + 1;

    const brand = extractBrand(name);

    const gstNum = hsnOrig
        ? (parseGstCell(taxOrig) ?? c.gst)
        : c.gst;
    const hsnOut = hsnOrig || c.hsn;

    out.push([
        itemCode,                 // sku (Vyapar Item code becomes SKU)
        name,
        unit,
        brand,
        category,                 // keep original Vyapar Category
        c.group,                  // proposed Group
        hsnOut,
        gstNum != null ? String(gstNum) : "",
        sale,
        mrp,
        stock,
        purch,                    // openingRate ← purchase price
        itemCode,                 // barcode1 also = Item code (looks barcode-y)
        c.confidence,
        c.ruleIdx >= 0 ? RULES[c.ruleIdx].re.source : "",
    ]);
}

writeFileSync(OUTPUT, toCsv(out), "utf8");

const totalIn  = parsed.rows.length;
const totalOut = out.length - 1;
const topGroups = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);

console.log(`\n✓ Wrote ${OUTPUT}`);
console.log(`  rows in:  ${totalIn}`);
console.log(`  rows out: ${totalOut}`);
console.log(`  classification:`);
console.log(`    high          ${confCounts.high}`);
console.log(`    medium        ${confCounts.medium}`);
console.log(`    low           ${confCounts.low}`);
console.log(`    unclassified  ${confCounts.unclassified}`);
console.log(`    coverage      ${((totalOut - confCounts.unclassified) / totalOut * 100).toFixed(1)}%`);
console.log(`\n  Top groups proposed:`);
for (const [g, n] of topGroups) console.log(`    ${n.toString().padStart(4)}  ${g}`);
