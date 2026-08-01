/**
 * Shop catalog diagnostic — READ ONLY. Explains why the storefront shows
 * "Catalog · 0 products" by re-running the exact gate chain the store home page
 * runs, and reporting which gate each product fails.
 *
 * Why this exists: the storefront filters silently. A product marked "list in
 * shop" simply vanishes when it misses a publish rule, with nothing on the
 * public page to say so. This prints the reason per product.
 *
 * Mirrors src/app/(external)/(store)/page.tsx:64-73. If that pipeline changes,
 * change this too — or delete this script, it is a scratchpad not a record.
 *
 * Writes nothing. Safe on the live DB.
 *
 *   pnpm tsx prisma/seeds/diagnose-shop-catalog.ts
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import {
    normalizeShopPublishRules,
    shopQualification,
} from "../../src/modules/ecommerce/lib/shopQualification";
import { normalizeStockPolicy, resolveAvailability } from "../../src/modules/ecommerce/lib/shopStock";
import { normalizeBarcodeBands, barcodeTagPaise } from "../../src/shared/lib/pricing/barcodePrice";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Same connection dance as the other seed scripts: strip sslmode (Supabase's
// chain is self-signed, so verify-full fails) and skip TLS for a local DB.
const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");
const pool = new Pool({
    connectionString: rawUrl,
    ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
    max: 2,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: {
            shopPublishRulesJson: true,
            shopOutOfStockPolicy: true,
            barcodeBandsJson: true,
        },
    });

    const rules = normalizeShopPublishRules(od?.shopPublishRulesJson);
    const policy = normalizeStockPolicy(od?.shopOutOfStockPolicy);
    const bands = normalizeBarcodeBands(od?.barcodeBandsJson);

    const active = Object.entries(rules)
        .filter(([, on]) => on)
        .map(([k]) => k);

    console.log("\n=== Org config ===");
    console.log("Publish rules ON :", active.join(", ") || "(none)");
    console.log("Out-of-stock     :", policy);
    console.log("OrgDefaults row  :", od ? "found" : "MISSING (all defaults assumed)");

    // Gate 1 + 2 — the DB query the page runs.
    const total = await prisma.invProduct.count();
    const listed = await prisma.invProduct.findMany({
        where: { isListedInShop: true, isActive: true },
        include: { category: { select: { name: true } } },
        orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
    });

    const listedNotActive = await prisma.invProduct.count({
        where: { isListedInShop: true, isActive: false },
    });

    console.log("\n=== Gate 1+2 — isListedInShop && isActive ===");
    console.log("Products in DB               :", total);
    console.log("isListedInShop && isActive   :", listed.length);
    console.log("isListedInShop but INACTIVE  :", listedNotActive);

    if (listed.length === 0) {
        console.log(
            "\n>>> Nothing is flagged for the shop. The catalog is empty because no product\n" +
                "    has isListedInShop = true. Publish products from the office product form.\n",
        );
        return;
    }

    // Gates 3 + 4 — availability, then the publish-rule qualification, on the
    // PUBLIC shape (shopDescription / shopCategory / barcode tag price), which is
    // what the gate actually reads — not the inventory fields of the same name.
    const failures: Record<string, string[]> = {};
    let passed = 0;

    for (const p of listed) {
        const label = `#${p.id} ${p.name}`;

        const avail = resolveAvailability(p.stock, p.allowBackorder, policy, p.reserved);
        if (!avail.visible) {
            (failures["hidden by out-of-stock policy (stock 0, policy HIDE)"] ??= []).push(label);
            continue;
        }

        const gallery = Array.isArray(p.galleryJson)
            ? p.galleryJson.filter((x): x is string => typeof x === "string")
            : [];

        const q = shopQualification(
            {
                pricePaise:
                    barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) ??
                    p.effectiveSalePricePaise ??
                    0,
                imageUrl: p.imageUrl,
                galleryUrls: gallery.length > 0 ? gallery : p.imageUrl ? [p.imageUrl] : [],
                description: p.shopDescription,
                category: p.shopCategory ?? p.category?.name ?? "Accessories",
                mrpPaise: p.mrpPaise,
                stock: p.stock,
            },
            rules,
        );

        if (q.qualified) {
            passed++;
        } else {
            (failures[`missing: ${q.missing.join(" + ")}`] ??= []).push(label);
        }
    }

    console.log("\n=== Gate 3+4 — availability + publish rules ===");
    console.log("Products the storefront shows :", passed);

    const blocked = listed.length - passed;
    if (blocked === 0) {
        console.log(
            "\n>>> All listed products qualify. If the live site still shows 0, the\n" +
                "    deployment is reading a different database than this script.\n",
        );
        return;
    }

    console.log(`Blocked                       : ${blocked}\n`);
    for (const [reason, items] of Object.entries(failures).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${items.length} × ${reason}`);
        for (const item of items.slice(0, 15)) console.log(`      ${item}`);
        if (items.length > 15) console.log(`      … and ${items.length - 15} more`);
    }

    console.log(
        "\nNote: the description gate reads shopDescription and the category gate reads\n" +
            "shopCategory — the storefront fields, not the inventory description/category.\n" +
            "A product can look complete in the inventory form and still fail here.\n",
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
