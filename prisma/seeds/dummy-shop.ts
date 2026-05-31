// DUMMY DATA — demo shop catalog (products, imagery, descriptions).
// Run only in dev; remove manually before production.
// Run: pnpm seed:dummy-shop  (npx tsx prisma/seeds/dummy-shop.ts)

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { DEMO_SHOP_CATALOG } from "./data/demoCatalogSeed";
import { invProductDb } from "../../src/shared/types/inventoryTypes";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Upsert one InvCategory by name (no parent). Returns the id. */
async function upsertCategory(name: string): Promise<number> {
    const existing = await prisma.invCategory.findFirst({ where: { name, parentId: null } });
    if (existing) return existing.id;
    const created = await prisma.invCategory.create({ data: { name, isActive: true } });
    return created.id;
}

/** Upsert one InvAttributeMaster. Key+categoryId is the unique identity. */
async function upsertAttr(key: string, name: string, categoryId: number | null, sortOrder: number) {
    const existing = await prisma.invAttributeMaster.findFirst({ where: { key, categoryId } });
    if (existing) {
        await prisma.invAttributeMaster.update({ where: { id: existing.id }, data: { name, sortOrder, isActive: true } });
    } else {
        await prisma.invAttributeMaster.create({ data: { key, name, categoryId, sortOrder, isActive: true } });
    }
}

/**
 * Upsert InvCategory rows for each demo category, then seed InvAttributeMaster
 * rows (global + per-category). These survive as long as the dummy shop data is
 * present; hard-clean wipes them along with the other inventory masters.
 */
async function upsertDemoAttributes() {
    // ── Categories ────────────────────────────────────────────────────────────
    const catId: Record<string, number> = {};
    for (const name of ["Laptops", "Desktops", "Printers", "CCTV & Security", "Components", "Monitors", "Networking"]) {
        catId[name] = await upsertCategory(name);
    }

    // ── Global attributes (categoryId = null — appear in every category) ───────
    const globals: Array<[string, string]> = [
        ["color",          "Colour"],
        ["condition",      "Condition"],
        ["warranty_period","Warranty Period"],
    ];
    for (const [i, [key, name]] of globals.entries()) {
        await upsertAttr(key, name, null, i);
    }

    // ── Laptops ───────────────────────────────────────────────────────────────
    const laptopAttrs: Array<[string, string]> = [
        ["cpu",     "Processor"],
        ["ram",     "RAM"],
        ["storage", "Storage"],
        ["display", "Screen Size"],
        ["os",      "Operating System"],
        ["gpu",     "Graphics Card"],
        ["battery", "Battery Life"],
    ];
    for (const [i, [key, name]] of laptopAttrs.entries()) {
        await upsertAttr(key, name, catId["Laptops"]!, i);
    }

    // ── Desktops ──────────────────────────────────────────────────────────────
    const desktopAttrs: Array<[string, string]> = [
        ["cpu",         "Processor"],
        ["ram",         "RAM"],
        ["storage",     "Storage"],
        ["os",          "Operating System"],
        ["gpu",         "Graphics Card"],
        ["form_factor", "Form Factor"],
    ];
    for (const [i, [key, name]] of desktopAttrs.entries()) {
        await upsertAttr(key, name, catId["Desktops"]!, i);
    }

    // ── Printers ──────────────────────────────────────────────────────────────
    const printerAttrs: Array<[string, string]> = [
        ["technology",   "Print Technology"],
        ["print_speed",  "Print Speed"],
        ["paper_size",   "Paper Size"],
        ["connectivity", "Connectivity"],
        ["monthly_duty", "Monthly Duty Cycle"],
    ];
    for (const [i, [key, name]] of printerAttrs.entries()) {
        await upsertAttr(key, name, catId["Printers"]!, i);
    }

    // ── CCTV & Security ───────────────────────────────────────────────────────
    const cctvAttrs: Array<[string, string]> = [
        ["resolution",   "Resolution"],
        ["camera_type",  "Camera Type"],
        ["channels",     "Channels"],
        ["lens",         "Lens"],
        ["ir_distance",  "IR Distance"],
        ["storage_type", "Storage Type"],
    ];
    for (const [i, [key, name]] of cctvAttrs.entries()) {
        await upsertAttr(key, name, catId["CCTV & Security"]!, i);
    }

    // ── Components ────────────────────────────────────────────────────────────
    const componentAttrs: Array<[string, string]> = [
        ["component_type", "Component Type"],
        ["capacity",       "Capacity"],
        ["interface",      "Interface"],
        ["speed",          "Speed/Frequency"],
        ["compatibility",  "Compatibility"],
    ];
    for (const [i, [key, name]] of componentAttrs.entries()) {
        await upsertAttr(key, name, catId["Components"]!, i);
    }

    // ── Monitors ──────────────────────────────────────────────────────────────
    const monitorAttrs: Array<[string, string]> = [
        ["display",       "Screen Size"],
        ["resolution",    "Resolution"],
        ["panel",         "Panel Type"],
        ["refresh_rate",  "Refresh Rate"],
        ["response_time", "Response Time"],
        ["ports",         "Ports"],
    ];
    for (const [i, [key, name]] of monitorAttrs.entries()) {
        await upsertAttr(key, name, catId["Monitors"]!, i);
    }

    // ── Networking ────────────────────────────────────────────────────────────
    const networkAttrs: Array<[string, string]> = [
        ["device_type",    "Device Type"],
        ["speed",          "Speed"],
        ["ports",          "Ports"],
        ["wifi_standard",  "WiFi Standard"],
        ["coverage_range", "Coverage Range"],
    ];
    for (const [i, [key, name]] of networkAttrs.entries()) {
        await upsertAttr(key, name, catId["Networking"]!, i);
    }

    const total = globals.length + laptopAttrs.length + desktopAttrs.length +
        printerAttrs.length + cctvAttrs.length + componentAttrs.length +
        monitorAttrs.length + networkAttrs.length;
    console.log(`      ✓ ${Object.keys(catId).length} categories, ${total} attribute masters`);
}

/** Idempotent: upsert full demo catalog for the public shop.
 *  Products live on InvProduct — "PCS" unit is guaranteed by bootstrap-seed.ts.
 */
async function upsertShopDemoCatalog() {
    const pcsUnit = await prisma.invUnit.findUniqueOrThrow({ where: { code: "PCS" } });

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
            effectiveSalePricePaise: row.pricePaise,
            mrpPaise: row.mrpPaise,
            shopBadge: row.badge,
            imageUrl: row.imageUrl,
            galleryJson,
            specsJson,
            isActive: true,
            isListedInShop: true,
            // Demo of the saved Sale Price: badged/featured items have a
            // human-frozen price (POS + shop materialize this when the source is
            // SAVED); the rest follow the additive-margin engine.
            effectiveSalePriceSource: (row.badge ? "SAVED" : "STRATEGY") as "SAVED" | "STRATEGY",
            savedSalePricePaise: row.badge ? row.pricePaise : null,
            salePriceFrozenAt: row.badge ? new Date() : null,
        };
        const db = invProductDb(prisma);
        const existing = await db.findFirst({
            where: { OR: [{ slug: row.slug }, { sku }] },
        });
        if (existing) {
            await db.update({ where: { id: existing.id }, data });
        } else {
            // Default new products to stock=0 (tracked) so Purchase increments
            // actually move the cache. NULL + n = NULL in Postgres.
            await db.create({ data: { ...data, sku, stock: 0 } });
        }
    }

    const keepSlugs = DEMO_SHOP_CATALOG.map((r) => r.slug);
    await invProductDb(prisma).updateMany({
        where: { slug: { notIn: keepSlugs, not: null }, isListedInShop: true },
        data: { isListedInShop: false },
    });

    // Multi-branch inventory: ensure every active product has a stock row per
    // active branch (starting balance = product.stock, defaulting to 0).
    // Voucher posts will upsert into the same table going forward.
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
    const products = await invProductDb(prisma).findMany({ where: { isActive: true } });
    for (const p of products) {
        for (const b of branches) {
            await prisma.invProductBranch.upsert({
                where: { productId_branchId: { productId: p.id, branchId: b.id } },
                update: {},
                create: { productId: p.id, branchId: b.id, stock: 0 },
            });
        }
    }
}

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo shop catalog. DO NOT run in production.\n");

    console.log("[1/2] Upserting categories + attribute masters…");
    await upsertDemoAttributes();

    console.log("[2/2] Upserting shop catalog…");
    await upsertShopDemoCatalog();
    console.log(`      ✓ ${DEMO_SHOP_CATALOG.length} products`);

    console.log("\n✅ Done.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
