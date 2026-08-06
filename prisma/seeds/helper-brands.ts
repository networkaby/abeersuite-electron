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

// Simple Icons CDN slugs — verified to resolve (HTTP 200) at seed-authoring
// time. Only global tech brands are covered by Simple Icons; regional/niche
// brands (CP Plus, Zicom, Hola, iBall, Beetel, …) have no icon here and stay
// logo-less until someone uploads one via /office/ecommerce/masters. Hex
// suffix pins the brand's official colour where known; omitted = CDN default.
const LOGO_SLUGS: Record<string, string> = {
    Acer: "acer/83B81A",
    AMD: "amd/ED1C24",
    Apple: "apple/000000",
    Asus: "asus/000000",
    Dell: "dell/007DB8",
    HP: "hp/0096D6",
    HCL: "hcl",
    Intel: "intel/0071C5",
    Lenovo: "lenovo/E2231A",
    LG: "lg/A50034",
    MSI: "msibusiness/FF0000",
    Samsung: "samsung/1428A0",
    Sony: "sony/000000",
    Corsair: "corsair",
    Seagate: "seagate/6FBE44",
    Toshiba: "toshiba",
    Epson: "epson",
    Kyocera: "kyocera",
    Panasonic: "panasonic",
    Bosch: "bosch",
    Cisco: "cisco",
    Netgear: "netgear",
    "TP-Link": "tplink/4ACBD6",
    Ubiquiti: "ubiquiti",
    Boat: "boat",
    Nvidia: "nvidia/76B900",
};

/** Plain URL-safe slug for a brand's own storefront page ("TP-Link" -> "tp-link"). */
function slugifyBrand(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
    console.log("\n━━━ HELPER SEED — trade-specific brands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const uniqueBrands = [...new Set(BRANDS)];
    let brandsCreated = 0;
    let logosSet = 0;
    for (const name of uniqueBrands) {
        const logoSlug = LOGO_SLUGS[name];
        const imageUrl = logoSlug ? `https://cdn.simpleicons.org/${logoSlug}` : undefined;
        const brandSlug = slugifyBrand(name);
        const existing = await prisma.invBrand.findFirst({ where: { name } });
        if (existing) {
            await prisma.invBrand.update({
                where: { id: existing.id },
                data: {
                    isActive: true,
                    ...(imageUrl && !existing.imageUrl ? { imageUrl } : {}),
                    ...(!existing.slug ? { slug: brandSlug } : {}),
                },
            });
        } else {
            await prisma.invBrand.create({ data: { name, isActive: true, imageUrl, slug: brandSlug } });
            brandsCreated++;
        }
        if (imageUrl) logosSet++;
    }
    console.log(`  ✓ Brands: ${uniqueBrands.length} total (${brandsCreated} new, ${logosSet} with a seeded logo)`);

    console.log("━━━ Done ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
