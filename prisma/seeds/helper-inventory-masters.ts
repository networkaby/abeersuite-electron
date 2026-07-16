// HELPER SEED — trade-specific inventory reference data.
//
// These masters are SPECIFIC to a computer / CCTV / printer / networking
// retail business. They are deliberately kept OUT of bootstrap-seed.ts
// (which only seeds data universal to every trade — units, GST slabs,
// warranty terms, chart of accounts, RBAC, workflow). A different trade
// would ship its own helper instead of this one.
//
// Seeds two masters, all idempotent (upsert-by-name):
//   1. InvCategory     — 7 use-case categories (Laptops, Desktops, …)
//   2. InvProductGroup — HSN/GST tax-spine tree (parent → leaf, each leaf
//                        carries an HSN code + GST slab so products inherit
//                        tax classification by walking up the parent chain)
//
// Brands live in their own helper — see helper-brands.ts (pnpm seed:helper-brands).
//
// Run: pnpm seed:helper-inventory   (after `pnpm prisma db seed`)
//
// Removed by `pnpm seed:hard-clean` — all three live in the hard-clean
// INVENTORY_MASTERS list, so a clean drops them and you re-run this helper.
//
// Sources:
//   • Brands extracted from the real product catalog + popular Indian-market brands.
//   • Group tree (HSN/GST) curated for this trade — see the mental model below.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ════════════════════════════════════════════════════════════════════════════
// 1 — Categories (use-case axis — separate from the HSN/GST group spine)
// ════════════════════════════════════════════════════════════════════════════
const CATEGORIES = [
    "Laptops", "Desktops", "Printers", "CCTV & Security",
    "Components", "Monitors", "Networking",
];

// ════════════════════════════════════════════════════════════════════════════
// 2 — Product Group tree (HSN/GST spine)
// ════════════════════════════════════════════════════════════════════════════
// Two levels (parent → sub-group). Each leaf carries an HSN code + GST rate so
// the cascade resolves automatically when InvProduct.gstRateId / hsnCode are
// left null — products inherit GST rate + HSN by walking up the parent chain
// to the highest-set value. Category (use-case axis) and Tags (collections) are
// separate classifiers and don't appear here.
//
// Naming rule: every Group name is globally unique (the schema enforces
// @@unique([name])). Sub-groups use descriptive names rather than short labels
// like "Cameras" to avoid collisions across top-level groups.

type GstSlab = "0" | "5" | "12" | "18" | "28";

type GroupSpec = {
    name: string;
    hsn?: string;
    gst?: GstSlab;
    description?: string;
    children?: GroupSpec[];
};

const TREE: GroupSpec[] = [
    {
        name: "0 CCTV & Network",
        gst: "18",
        description: "Surveillance hardware + networking equipment.",
        children: [
            { name: "Surveillance Cameras",     hsn: "85258090", gst: "18", description: "DOME, BULLET, IP — analog & IP cameras." },
            { name: "Surveillance Recorders",   hsn: "85219090", gst: "18", description: "DVRs and NVRs." },
            { name: "CCTV Storage Drives",      hsn: "85235100", gst: "18", description: "Surveillance-grade HDDs." },
            { name: "CCTV Power Supplies",      hsn: "85044090", gst: "18", description: "12V SMPS and adapters for CCTV gear." },
            { name: "CCTV Cabling & Connectors",hsn: "85444299", gst: "18", description: "Coax, BNC, video baluns, Cat6 for surveillance." },
            { name: "Surveillance Mounts & Misc",hsn: "83024900", gst: "18", description: "Wall mounts, microphones, accessories." },
            { name: "Network Switches & Routers",hsn: "85176290", gst: "18", description: "Switches, routers, gateways." },
            { name: "Wifi & Bluetooth Adapters",hsn: "85176290", gst: "18", description: "USB wifi and Bluetooth dongles." },
            { name: "Network Hardware",         hsn: "85369090", gst: "18", description: "Keystone jacks, face plates, mount boxes, patch panels." },
            { name: "LAN Accessories",          hsn: "85369090", gst: "18", description: "RJ45 boots, LAN clips, PCI LAN cards." },
        ],
    },
    {
        name: "1 Paper, Ink & Stationery",
        gst: "18",
        description: "Print consumables and office paper.",
        children: [
            { name: "Office Paper",      hsn: "48025690", gst: "12", description: "A4 / DMP paper — 70 / 75 / 80 gsm." },
            { name: "Photo Paper",       hsn: "48119099", gst: "18", description: "Glossy / matte photo paper, 175–254 gsm." },
            { name: "Thermal Paper",     hsn: "48239090", gst: "18", description: "Thermal POS / receipt rolls." },
            { name: "Lamination Material",hsn: "39204900", gst: "18", description: "Rolls, jackets, pouches." },
            { name: "Lamination Machines",hsn: "84729090", gst: "18", description: "Tabletop laminators." },
            { name: "PVC & ID Cards",    hsn: "39204900", gst: "18", description: "PVC blanks and card printing trays." },
            { name: "Office Stationery", hsn: "96120010", gst: "18", description: "Rubber stamps, tags, misc office items." },
        ],
    },
    {
        name: "2 Computer, Printer & Parts",
        gst: "18",
        description: "IT hardware — finished units, components, spares.",
        children: [
            { name: "Laptops",            hsn: "84713010", gst: "18", description: "Notebook computers." },
            { name: "Desktop Systems",    hsn: "84715000", gst: "18", description: "Pre-built desktops + cabinet bundles." },
            { name: "Printers",           hsn: "84433100", gst: "18", description: "Inkjet, laser, all-in-one printers." },
            { name: "Monitors",           hsn: "85285200", gst: "18", description: "Standalone displays." },
            { name: "CPUs",               hsn: "85423100", gst: "18", description: "Desktop processors." },
            { name: "Motherboards",       hsn: "84733020", gst: "18", description: "Desktop mainboards." },
            { name: "Memory (RAM)",       hsn: "84733010", gst: "18", description: "DDR3 / DDR4 desktop & laptop RAM." },
            { name: "Internal Storage Drives",hsn: "84717020", gst: "18", description: "Desktop SSDs and HDDs sold as components." },
            { name: "Cabinets & SMPS",    hsn: "84733099", gst: "18", description: "Desktop chassis, PSUs, cabinet+SMPS combos." },
            { name: "Cooling Components", hsn: "84733099", gst: "18", description: "CPU fans, thermal paste, heatsinks." },
            { name: "Optical Drives",     hsn: "84717030", gst: "18", description: "DVD-RW desktop / laptop drives." },
            { name: "Graphics Cards",     hsn: "84733030", gst: "18", description: "PCIe GPUs." },
            { name: "Computer Mice",      hsn: "84716090", gst: "18", description: "Wired and wireless mice." },
            { name: "Computer Keyboards", hsn: "84716060", gst: "18", description: "Wired and wireless keyboards." },
            { name: "Keyboard-Mouse Combos",hsn: "84716090", gst: "18", description: "Combo / bundled input sets." },
            { name: "Webcams",            hsn: "85258020", gst: "18", description: "USB webcams." },
            { name: "USB Hubs & Converters",hsn: "85369090", gst: "18", description: "USB hubs, HDMI/VGA converters." },
            { name: "Barcode Scanners",   hsn: "84717090", gst: "18", description: "Handheld and counter scanners." },
            { name: "Laptop Batteries",   hsn: "85076000", gst: "18", description: "OEM and compatible laptop batteries." },
            { name: "Laptop Adapters",    hsn: "85044090", gst: "18", description: "OEM and compatible laptop chargers." },
            { name: "Laptop Display Screens",hsn: "85285200", gst: "18", description: "LCD / LED replacement panels." },
            { name: "Laptop Cosmetic Accessories",hsn: "39269099", gst: "18", description: "Keypad protectors, screen guards, skins." },
            { name: "Laptop Cooling Pads",hsn: "84149090", gst: "18", description: "External cooling pads." },
            { name: "Printer Fusers & Rollers",hsn: "84439990", gst: "18", description: "Replacement fuser assemblies, pickup rollers." },
            { name: "Printer Heads",      hsn: "84439990", gst: "18", description: "Replacement print heads." },
            { name: "Toner Cartridges",   hsn: "32151900", gst: "18", description: "OEM and compatible toner cartridges." },
            { name: "Toner Powder",       hsn: "32151990", gst: "18", description: "Refill toner powder." },
            { name: "Printer Ink",        hsn: "32151110", gst: "18", description: "Bottled and cartridge ink." },
            { name: "Printer Ribbons",    hsn: "96121010", gst: "18", description: "Dot-matrix ribbons." },
        ],
    },
    {
        name: "3 Mobile & Audio",
        gst: "18",
        description: "Mobile accessories, speakers, audio cables.",
        children: [
            { name: "Mobile Data Cables", hsn: "85444299", gst: "18", description: "Micro USB, Type-C, Lightning." },
            { name: "Bluetooth Speakers", hsn: "85182200", gst: "18", description: "Portable BT speakers." },
            { name: "Earphones & Headsets",hsn: "85183000", gst: "18", description: "Wired and wireless earphones." },
            { name: "Audio Adapters",     hsn: "85176290", gst: "18", description: "USB sound cards, BT adapters." },
            { name: "AUX & RCA Cables",   hsn: "85444299", gst: "18", description: "3.5mm aux, RCA, AV cables." },
            { name: "TV Remotes & Set-top",hsn: "85299090", gst: "18", description: "Replacement remotes, set-top accessories." },
            { name: "Mobile Connectors & OTG",hsn: "85176290", gst: "18", description: "OTG, mobile-side adapters." },
            { name: "Phone Mounts & Holders",hsn: "83024900", gst: "18", description: "Wall / car / desk holders." },
        ],
    },
    {
        name: "4 Other",
        gst: "18",
        description: "Catch-all — software, services, accessories, lifestyle.",
        children: [
            { name: "Accounting Software",hsn: "85234990", gst: "18", description: "Tally, etc. (boxed / licence)." },
            { name: "Antivirus Software", hsn: "85234990", gst: "18", description: "NPAV, Quick Heal, etc." },
            { name: "Installation Services",hsn: "998739",   gst: "18", description: "SAC 998739 — service-charge SKUs." },
            { name: "Repair Tools",       hsn: "82054000", gst: "18", description: "Wire cutters, screwdrivers, multimeters." },
            { name: "Mouse Pads",         hsn: "39269099", gst: "18", description: "Standard and gaming mouse pads." },
            { name: "Wall Mounts & Stands",hsn: "83024900", gst: "18", description: "LCD/LED mounts, brackets, racks." },
            { name: "Laptop Bags & Backpacks",hsn: "42021290", gst: "18", description: "Laptop carrying bags." },
            { name: "Lifestyle & Misc",   hsn: "94054090", gst: "18", description: "Solar lights, GPS trackers, oddballs." },
        ],
    },
    {
        name: "5 Storage Media",
        gst: "18",
        description: "Removable storage sold standalone (not as build components).",
        children: [
            { name: "USB Flash Drives",   hsn: "85235100", gst: "18", description: "Pen drives — Kingston, Sandisk, etc." },
            { name: "Memory Cards",       hsn: "85235100", gst: "18", description: "SD, microSD." },
            { name: "Optical Discs",      hsn: "85234120", gst: "18", description: "CD-R, DVD-R (recordable blanks)." },
            { name: "External Storage Casings",hsn: "84733099", gst: "18", description: "2.5\"/3.5\" / NVMe enclosures." },
        ],
    },
    {
        name: "6 Power & Backup",
        gst: "18",
        description: "UPS units, batteries, power conditioning.",
        children: [
            { name: "UPS Systems",        hsn: "85044090", gst: "18", description: "Offline / line-interactive UPS units." },
            { name: "UPS Batteries",      hsn: "85072000", gst: "18", description: "Sealed lead-acid replacement batteries." },
            { name: "CMOS & Coin Batteries",hsn: "85068000", gst: "18", description: "CR2032, CR1220, button cells." },
            { name: "Power Cables",       hsn: "85444299", gst: "18", description: "Desktop / printer power cords (kettle, C13)." },
        ],
    },
];

// Bootstrap seeds labels "GST 12%", "GST 18%", "Nil (0%)" etc. — see
// prisma/seeds/bootstrap-seed.ts section 8 (GST Rate master).
const gstLabelBySlab: Record<GstSlab, string> = {
    "0":  "Nil (0%)",
    "5":  "GST 5%",
    "12": "GST 12%",
    "18": "GST 18%",
    "28": "GST 28%",
};

async function resolveGstRateId(slab: GstSlab | undefined): Promise<number | null> {
    if (!slab) return null;
    const label = gstLabelBySlab[slab];
    const row = await prisma.gstRate.findUnique({ where: { label } });
    if (!row) {
        console.warn(`      ⚠ GstRate "${label}" missing — run pnpm prisma db seed first`);
        return null;
    }
    return row.id;
}

/** Upsert one group node, returning its id. Sets parentId, gstRateId, hsnCode. */
async function upsertGroupNode(spec: GroupSpec, parentId: number | null, indent: string): Promise<number> {
    const gstRateId = await resolveGstRateId(spec.gst);
    const data = {
        name: spec.name,
        parentId,
        gstRateId,
        hsnCode: spec.hsn ?? null,
        // taxability stays null → resolver treats as "TAXABLE" by default.
        isActive: true,
    };
    const existing = await prisma.invProductGroup.findUnique({ where: { name: spec.name } });
    if (existing) {
        await prisma.invProductGroup.update({ where: { id: existing.id }, data });
        console.log(`${indent}↻ ${spec.name}${spec.hsn ? `  [hsn ${spec.hsn}]` : ""}${spec.gst ? `  [gst ${spec.gst}%]` : ""}`);
        return existing.id;
    }
    const created = await prisma.invProductGroup.create({ data });
    console.log(`${indent}+ ${spec.name}${spec.hsn ? `  [hsn ${spec.hsn}]` : ""}${spec.gst ? `  [gst ${spec.gst}%]` : ""}`);
    return created.id;
}

async function seedGroupTree(nodes: GroupSpec[], parentId: number | null, depth: number): Promise<number> {
    let count = 0;
    for (const node of nodes) {
        const id = await upsertGroupNode(node, parentId, "  ".repeat(depth + 1));
        count++;
        if (node.children?.length) {
            count += await seedGroupTree(node.children, id, depth + 1);
        }
    }
    return count;
}

async function main(): Promise<void> {
    console.log("\n━━━ HELPER SEED — trade-specific inventory masters ━━━━━━━━━━━━━━━━━");

    // ── Categories ──────────────────────────────────────────────────────
    let catsCreated = 0;
    for (const name of CATEGORIES) {
        const existing = await prisma.invCategory.findFirst({ where: { name, parentId: null } });
        if (existing) {
            await prisma.invCategory.update({ where: { id: existing.id }, data: { isActive: true } });
        } else {
            await prisma.invCategory.create({ data: { name, isActive: true } });
            catsCreated++;
        }
    }
    console.log(`  ✓ Categories: ${CATEGORIES.length} total (${catsCreated} new)`);

    // ── Product groups (HSN/GST spine) ──────────────────────────────────
    console.log("  Seeding Product Group tree (HSN/GST spine)…");
    const groupTotal = await seedGroupTree(TREE, null, 0);
    console.log(`  ✓ Product groups: ${groupTotal} upserted`);

    console.log("━━━ Done ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
