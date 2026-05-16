// DUMMY DATA — brand master for computer / CCTV / peripherals business (India).
// Run: pnpm seed:dummy-brands  (npx tsx prisma/seeds/dummy-brands.ts)
//
// Sources:
//   • Extracted from "Export Items.xlsx" product catalog (brands found in names)
//   • Popular Indian market brands added for future products

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Brand list ───────────────────────────────────────────────────────────────
// Sorted alphabetically. Edit freely — upsert on name, safe to re-run.
const BRANDS = [
    // Computers & Laptops
    "Acer",
    "AMD",
    "Apple",
    "Asus",
    "Dell",
    "Gigabyte",
    "HP",
    "HCL",
    "Intel",
    "Lenovo",
    "LG",
    "MSI",
    "Samsung",
    "Sony",

    // Storage
    "Corsair",
    "Crucial",
    "Kingston",
    "SanDisk",
    "Seagate",
    "Toshiba",
    "Transcend",
    "WD",

    // Printers & Consumables
    "Brother",
    "Canon",
    "Epson",
    "Kyocera",
    "Lexmark",
    "Panasonic",
    "Ricoh",
    "TVS",
    "Xerox",

    // CCTV & Security
    "Annke",
    "Axis",
    "Bosch",
    "CP Plus",
    "Dahua",
    "Ezviz",
    "Godrej",
    "Hanwha",
    "Hikvision",
    "Honeywell",
    "Reolink",
    "Zicom",

    // Networking
    "Cisco",
    "D-Link",
    "Grandstream",
    "Netgear",
    "Tenda",
    "TP-Link",
    "Ubiquiti",

    // Peripherals & Accessories
    "APC",
    "Beetel",
    "Belkin",
    "Boat",
    "Hola",
    "iBall",
    "Intex",
    "Logitech",
    "Luminous",
    "Microtek",
    "Nvidia",
    "Panasonic",
    "Stanley",
    "Zebronics",
];

// deduplicate (Panasonic appears twice above — safe but clean it up)
const UNIQUE_BRANDS = [...new Set(BRANDS)];

async function main() {
    console.log("\n━━━ BRAND SEED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    let created = 0;
    let skipped = 0;

    for (const name of UNIQUE_BRANDS) {
        const existing = await prisma.invBrand.findFirst({ where: { name } });
        if (existing) {
            skipped++;
        } else {
            await prisma.invBrand.create({ data: { name, isActive: true } });
            created++;
        }
    }

    console.log(`  ✓ ${created} brands created, ${skipped} already existed`);
    console.log(`  Total: ${UNIQUE_BRANDS.length} brands in list`);
    console.log("━━━ Done ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
