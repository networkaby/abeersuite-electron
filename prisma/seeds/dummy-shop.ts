// DUMMY DATA — demo shop catalog (products, imagery, descriptions).
// Run only in dev; remove manually before production.
// Run: pnpm seed:dummy-shop  (npx tsx prisma/seeds/dummy-shop.ts)

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { DEMO_SHOP_CATALOG } from "../../src/lib/shop/demo-catalog-seed";
import { invProductDb } from "../../src/lib/inventory/types";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Idempotent: upsert full demo catalog for the public shop.
 *  Products live on InvProduct — a "PCS" unit is created if absent.
 */
async function upsertShopDemoCatalog() {
    const pcsUnit = await prisma.invUnit.upsert({
        where: { code: "PCS" },
        update: {},
        create: { code: "PCS", label: "Piece", decimals: 0, isActive: true },
    });

    for (const row of DEMO_SHOP_CATALOG) {
        const galleryJson = row.galleryUrls;
        const specsJson = row.specs;
        const sku = row.slug.toUpperCase().replace(/-/g, "_");
        const data = {
            name: row.name,
            unitId: pcsUnit.id,
            slug: row.slug,
            shopSubheading: row.subheading,
            shopDescription: row.description,
            shopCategory: row.category,
            pricePaise: row.pricePaise,
            mrpPaise: row.mrpPaise,
            shopBadge: row.badge,
            imageUrl: row.imageUrl,
            galleryJson,
            specsJson,
            isActive: true,
            isListedInShop: true,
        };
        const db = invProductDb(prisma);
        const existing = await db.findFirst({
            where: { OR: [{ slug: row.slug }, { sku }] },
        });
        if (existing) {
            await db.update({ where: { id: existing.id }, data });
        } else {
            await db.create({ data: { ...data, sku } });
        }
    }

    const keepSlugs = DEMO_SHOP_CATALOG.map((r) => r.slug);
    await invProductDb(prisma).updateMany({
        where: { slug: { notIn: keepSlugs, not: null }, isListedInShop: true },
        data: { isListedInShop: false },
    });
}

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo shop catalog. DO NOT run in production.\n");

    await upsertShopDemoCatalog();

    console.log(`\n✅ Upserted demo shop catalog (${DEMO_SHOP_CATALOG.length} products).`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
