/**
 * Incremental delivery-method applier — seeds the default courier options
 * (DeliveryMethod rows) into the live DB WITHOUT running the full bootstrap.
 *
 * Why: same reasoning as apply-permissions.ts — a full `pnpm prisma db seed`
 * re-touches all master data and is wasteful/risky on the production DB when a
 * change only ADDS a few config rows. This upserts just the DeliveryMethod
 * defaults, create-if-absent by kind, so an admin's rate edits are never
 * clobbered. Idempotent, no prune.
 *
 * Run AFTER `pnpm prisma db push` has added the delivery_methods table:
 *   pnpm tsx prisma/seeds/apply-delivery-methods.ts
 *
 * Keep these rows identical to Section 17 of bootstrap-seed.ts.
 */
import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { DELIVERY_METHOD_DEFAULTS } from "../../src/modules/delivery/lib/deliveryMethodConfig";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// Single source: the hard-coded courier catalog lives in deliveryMethodConfig.ts and
// is also what the app ensures on load — this applier just mirrors it into the DB.
const DEFAULTS = DELIVERY_METHOD_DEFAULTS.map((d) => ({
    ...d,
    configJson: d.configJson as Prisma.InputJsonValue,
}));

async function main() {
    const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
        .replace(/[?&]sslmode=[^&]*/g, "")
        .replace(/[?&]$/, "");
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");

    const pool = new Pool({
        connectionString: rawUrl,
        ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
        max: 5,
    });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        let created = 0;
        for (const m of DEFAULTS) {
            const exists = await prisma.deliveryMethod.findFirst({ where: { kind: m.kind }, select: { id: true } });
            if (!exists) { await prisma.deliveryMethod.create({ data: m }); created++; }
        }
        console.log(`✓ Delivery methods ensured (${created} new, ${DEFAULTS.length - created} already present).`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
