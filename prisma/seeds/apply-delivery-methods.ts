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

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const DEFAULTS: {
    kind: string;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: Prisma.InputJsonValue;
}[] = [
    { kind: "OWN_BOY", displayName: "Local delivery", isActive: true, sortOrder: 0, configJson: { pincodes: [], flatPaise: 4900, freeAbovePaise: 0, baseGrams: 500, stepGrams: 500, neighbourhoods: {} } },
    { kind: "CUSTOM", displayName: "Standard courier", isActive: true, sortOrder: 1, configJson: { flatPaise: 9900, freeAbovePaise: 500000 } },
    { kind: "SHIPROCKET", displayName: "Shiprocket", isActive: false, sortOrder: 2, configJson: { pickupLocation: "Primary", pickupPincode: "", defaultItemWeightGrams: 500, length: 15, breadth: 15, height: 10 } },
    { kind: "SHIPWAY", displayName: "Shipway", isActive: false, sortOrder: 3, configJson: { pickupLocation: "Primary", pickupPincode: "", defaultItemWeightGrams: 500, length: 15, breadth: 15, height: 10 } },
];

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
