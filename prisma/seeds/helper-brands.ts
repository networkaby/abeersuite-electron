// HELPER SEED — trade-specific brand master.
//
// Brands SPECIFIC to a computer / CCTV / printer / networking retail business.
// Kept OUT of bootstrap-seed.ts (which only seeds data universal to every
// trade). A different trade would ship its own brand helper instead.
//
// Seeds one master, idempotent (upsert-by-name):
//   InvBrand — ~60 brands (computers, storage, CCTV, networking, peripherals…)
//
// Run: pnpm seed:helper-brands   (after `pnpm prisma db seed`)
//
// Removed by `pnpm seed:hard-clean` (InvBrand is in its INVENTORY_MASTERS list)
// — a clean drops brands and you re-run this helper.

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

const BRANDS = [
    // Computers & Laptops
    "Acer", "AMD", "Apple", "Asus", "Dell", "Gigabyte", "HP", "HCL",
    "Intel", "Lenovo", "LG", "MSI", "Samsung", "Sony",
    // Storage
    "Corsair", "Crucial", "Kingston", "SanDisk", "Seagate", "Toshiba",
    "Transcend", "WD",
    // Printers & Consumables
    "Brother", "Canon", "Epson", "Kyocera", "Lexmark", "Panasonic",
    "Ricoh", "TVS", "Xerox",
    // CCTV & Security
    "Annke", "Axis", "Bosch", "CP Plus", "Dahua", "Ezviz", "Godrej",
    "Hanwha", "Hikvision", "Honeywell", "Reolink", "Zicom",
    // Networking
    "Cisco", "D-Link", "Grandstream", "Netgear", "Tenda", "TP-Link", "Ubiquiti",
    // Peripherals & Accessories
    "APC", "Beetel", "Belkin", "Boat", "Hola", "iBall", "Intex",
    "Logitech", "Luminous", "Microtek", "Nvidia", "Stanley", "Zebronics",
];

async function main(): Promise<void> {
    console.log("\n━━━ HELPER SEED — trade-specific brands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const uniqueBrands = [...new Set(BRANDS)];
    let brandsCreated = 0;
    for (const name of uniqueBrands) {
        const existing = await prisma.invBrand.findFirst({ where: { name } });
        if (existing) {
            await prisma.invBrand.update({ where: { id: existing.id }, data: { isActive: true } });
        } else {
            await prisma.invBrand.create({ data: { name, isActive: true } });
            brandsCreated++;
        }
    }
    console.log(`  ✓ Brands: ${uniqueBrands.length} total (${brandsCreated} new)`);

    console.log("━━━ Done ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
