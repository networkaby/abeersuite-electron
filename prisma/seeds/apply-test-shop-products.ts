/**
 * TEST DATA — a handful of fully-complete shop products (image + description +
 * price + group + brand), used ONLY to have something visible/testable while the
 * real 1,413-product catalog is being edited (backfilled) product-by-product.
 *
 * Why this exists separately from `dummy-shop.ts`: that seed (a) models its own
 * fictional InvCategory-based catalog and (b) unlists every OTHER listed product
 * not in its list — exactly the wrong behaviour here, where the real catalog's
 * `isListedInShop` flags must be left completely alone. This script only ever
 * INSERTs/UPDATEs rows it owns (sku prefixed `TEST-`), and never touches anything
 * else. Idempotent — safe to re-run.
 *
 * Images are simple placehold.co placeholders (no external account needed) —
 * swap for real photos once the real catalog is backfilled; delete this file's
 * rows (or the whole file) once it's no longer needed for testing.
 *
 * Run: npx tsx prisma/seeds/apply-test-shop-products.ts
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { invProductDb } from "../../src/shared/types/inventoryTypes";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// groupPath / brandName are resolved to ids at runtime (both masters already
// exist in the DB — see the taxonomy probe: 27 groups, 64 brands, mostly
// unpopulated on real products today).
const TEST_PRODUCTS: Array<{
    sku: string;
    slug: string;
    name: string;
    groupPath: string; // "Root > Child > Leaf" — must match an existing InvProductGroup chain
    brandName: string | null;
    pricePaise: number;
    mrpPaise: number;
    description: string;
    color: string; // placehold.co background colour (hex, no #)
}> = [
    {
        sku: "TEST-MOUSE-HP-M100",
        slug: "test-hp-wired-mouse-m100",
        name: "HP Wired Mouse M100",
        groupPath: "IT Products > Mouse",
        brandName: "HP",
        pricePaise: 39900,
        mrpPaise: 49900,
        description: "Reliable HP wired USB mouse with a 1000 DPI optical sensor, ambidextrous design and a 1.5m cable — built for everyday desktop use.",
        color: "0ea5e9",
    },
    {
        sku: "TEST-KEYBOARD-DELL-KB216",
        slug: "test-dell-wired-keyboard-kb216",
        name: "Dell Wired Keyboard KB216",
        groupPath: "IT Products > Keyboard",
        brandName: "Dell",
        pricePaise: 69900,
        mrpPaise: 84900,
        description: "Full-size Dell KB216 wired keyboard with spill-resistant keys and a quiet, comfortable typing feel for office use.",
        color: "6366f1",
    },
    {
        sku: "TEST-MONITOR-SAMSUNG-F22",
        slug: "test-samsung-22-inch-monitor-f22",
        name: 'Samsung 22" FHD Monitor F22',
        groupPath: "IT Products > Monitor",
        brandName: "Samsung",
        pricePaise: 899900,
        mrpPaise: 1099900,
        description: '22-inch Full HD (1920x1080) LED monitor from Samsung with slim bezels, HDMI + VGA input, ideal for home and office desks.',
        color: "1d4ed8",
    },
    {
        sku: "TEST-SSD-WD-GREEN-480",
        slug: "test-wd-green-480gb-sata-ssd",
        name: "WD Green 480GB SATA SSD",
        groupPath: "Storage Products > HDD & SSD > SATA SSD",
        brandName: "WD",
        pricePaise: 249900,
        mrpPaise: 299900,
        description: "Western Digital Green 480GB 2.5-inch SATA III SSD — faster boot and load times over a traditional hard drive, drop-in upgrade for any laptop or desktop.",
        color: "16a34a",
    },
    {
        sku: "TEST-SSD-WD-NVME-500",
        slug: "test-wd-nvme-500gb-ssd",
        name: "WD Blue SN570 500GB NVMe SSD",
        groupPath: "Storage Products > HDD & SSD > NVME SSD",
        brandName: "WD",
        pricePaise: 349900,
        mrpPaise: 429900,
        description: "WD Blue SN570 500GB M.2 NVMe Gen3 SSD — up to 3,500MB/s read speed for a snappier system than SATA SSDs.",
        color: "0891b2",
    },
    {
        sku: "TEST-HDD-WD-1TB",
        slug: "test-wd-1tb-desktop-hdd",
        name: "WD Blue 1TB Desktop HDD",
        groupPath: "Storage Products > HDD & SSD > HDD",
        brandName: "WD",
        pricePaise: 329900,
        mrpPaise: 389900,
        description: "WD Blue 1TB 3.5-inch SATA desktop hard drive, 7200RPM — reliable everyday storage for desktops and NAS.",
        color: "2563eb",
    },
    {
        sku: "TEST-CCTV-CPPLUS-DOME-2MP",
        slug: "test-cp-plus-2mp-dome-camera",
        name: "CP Plus 2MP HD Dome Camera",
        groupPath: "CCTV & Surveillance > HD CCTV > HD Dome",
        brandName: "CP Plus",
        pricePaise: 129900,
        mrpPaise: 159900,
        description: "CP Plus 2MP HD dome camera with night vision up to 20m — indoor mount, ideal for shops, homes and offices.",
        color: "b91c1c",
    },
    {
        sku: "TEST-CCTV-CPPLUS-BULLET-2MP",
        slug: "test-cp-plus-2mp-bullet-camera",
        name: "CP Plus 2MP HD Bullet Camera",
        groupPath: "CCTV & Surveillance > HD CCTV > HD Bullet",
        brandName: "CP Plus",
        pricePaise: 139900,
        mrpPaise: 169900,
        description: "CP Plus 2MP HD bullet camera, weatherproof housing, night vision up to 40m — built for outdoor perimeter coverage.",
        color: "dc2626",
    },
    {
        sku: "TEST-PRINTER-EPSON-L3250",
        slug: "test-epson-l3250-ink-tank-printer",
        name: "Epson L3250 Ink Tank Printer",
        groupPath: "Paper & Stationary", // no dedicated Printer group yet — parked on root, see PROJECT_BRAIN
        brandName: "Epson",
        pricePaise: 1699900,
        mrpPaise: 1899900,
        description: "Epson L3250 Wi-Fi ink tank all-in-one printer — print, scan, copy, with low-cost-per-page ink bottles instead of cartridges.",
        color: "ea580c",
    },
    {
        sku: "TEST-PENDRIVE-SANDISK-32GB",
        slug: "test-sandisk-32gb-pendrive",
        name: "SanDisk Ultra 32GB Pen Drive",
        groupPath: "Storage Products > Pen Drive",
        brandName: null, // SanDisk not in the current InvBrand master
        pricePaise: 49900,
        mrpPaise: 59900,
        description: "SanDisk Ultra 32GB USB 3.0 flash drive with up to 100MB/s read speed — compact, reliable everyday storage.",
        color: "9333ea",
    },
];

async function resolveGroupId(path: string): Promise<number> {
    const parts = path.split(">").map((s) => s.trim());
    let parentId: number | null = null;
    let id: number | null = null;
    for (const name of parts) {
        // Explicit annotation: without it tsc reports TS7022, because the
        // inferred Prisma row type references `parentId` which is being assigned
        // from that same row inside the loop.
        const row: { id: number } | null = await prisma.invProductGroup.findFirst({
            where: { name, parentId },
            select: { id: true },
        });
        if (!row) throw new Error(`Group path not found: "${path}" (missing segment "${name}")`);
        id = row.id;
        parentId = row.id;
    }
    return id!;
}

async function resolveBrandId(name: string | null): Promise<number | null> {
    if (!name) return null;
    const row = await prisma.invBrand.findUnique({ where: { name } });
    if (!row) throw new Error(`Brand not found: "${name}"`);
    return row.id;
}

async function main() {
    console.log("\n⚠️  TEST DATA — a handful of complete shop products for taxonomy testing.\n");

    const pcsUnit = await prisma.invUnit.findUniqueOrThrow({ where: { code: "PCS" } });
    const db = invProductDb(prisma);

    for (const t of TEST_PRODUCTS) {
        const groupId = await resolveGroupId(t.groupPath);
        const brandId = await resolveBrandId(t.brandName);
        const imageUrl = `https://placehold.co/800x800/${t.color}/ffffff.png?text=${encodeURIComponent(t.name)}`;

        const data = {
            name: t.name,
            unitId: pcsUnit.id,
            groupId,
            brandId,
            slug: t.slug,
            shopSubheading: t.name,
            shopDescription: t.description,
            effectiveSalePricePaise: t.pricePaise,
            mrpPaise: t.mrpPaise,
            effectiveSalePriceSource: "SAVED" as const,
            savedSalePricePaise: t.pricePaise,
            salePriceFrozenAt: new Date(),
            imageUrl,
            galleryJson: [imageUrl],
            isActive: true,
            isListedInShop: true,
        };

        const existing = await db.findFirst({ where: { sku: t.sku } });
        if (existing) {
            await db.update({ where: { id: existing.id }, data });
            console.log(`  ↻ updated ${t.sku}`);
        } else {
            await db.create({ data: { ...data, sku: t.sku, stock: 10 } });
            console.log(`  + created ${t.sku}`);
        }
    }

    console.log(`\n✅ Done — ${TEST_PRODUCTS.length} test products upserted.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
