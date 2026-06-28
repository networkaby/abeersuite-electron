// DUMMY DATA — sample accounting vouchers + a pricing-strategy cost-pool demo.
//
// Seeds just enough so the new "Costing" page (pricing-strategy additional-cost
// allocation) renders with real data in dev:
//   • a dedicated EXPENSE AccountGroup "Courier & Shipping Cost Pool"
//   • a courier ledger under it ("DTDC Counter")
//   • OrgDefaults.shippingPoolGroupId pointed at that group
//   • a POSTED Payment journal entry (Dr courier / Cr Cash ₹5,000) + a matching
//     PAYMENT Voucher (PMT-DEMO-1) so the Costing page can show a real voucher
//     number (not the internal GL ref)
//   • one ALLOCATION row (per-unit surcharge onto a product) + one DISMISSAL row
//
// Decision-support layer only — AdditionalCostAllocation never posts to the GL;
// the single Payment entry above is the only GL movement (ordinary demo expense).
//
// Idempotent per-piece — safe to re-run. Run: pnpm seed:dummy-vouchers

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

// 5D-7: the spine has no `reference` string — its `id` is the Universal Voucher No.
const VOUCHER_REF = "PMT-DEMO-1";          // the Payment voucher number shown in the UI
const POOL_GROUP_NAME = "Courier & Shipping Cost Pool";
const COURIER_LEDGER_NAME = "DTDC Counter";

async function seedCostPoolDemo(): Promise<void> {
    const admin = await prisma.user.findFirst({ orderBy: { id: "asc" } });
    const cash = await prisma.account.findFirst({ where: { name: "Cash" } });
    const product = await prisma.invProduct.findFirst({ orderBy: { id: "asc" } });
    if (!admin || !cash || !product) {
        console.log("    missing admin / Cash ledger / product — skipping cost-pool demo.");
        return;
    }

    // 1. Dedicated EXPENSE pool group + courier ledger.
    const poolGroup =
        (await prisma.accountGroup.findFirst({ where: { name: POOL_GROUP_NAME } })) ??
        (await prisma.accountGroup.create({ data: { name: POOL_GROUP_NAME, type: "EXPENSE", sortOrder: 90, isActive: true } }));
    const courier =
        (await prisma.account.findFirst({ where: { name: COURIER_LEDGER_NAME } })) ??
        (await prisma.account.create({ data: { name: COURIER_LEDGER_NAME, normalBalance: "DEBIT", groupId: poolGroup.id, isActive: true } }));

    // 2. Nominate the pool group on OrgDefaults (singleton row id=1).
    await prisma.orgDefaults.upsert({
        where: { id: 1 },
        create: { id: 1, shippingPoolGroupId: poolGroup.id },
        update: { shippingPoolGroupId: poolGroup.id },
    });

    const today = new Date();

    // 3. POSTED Payment spine row (Dr courier ₹5,000 / Cr Cash ₹5,000) — the GL.
    //    Since G5 the UniversalVoucher spine IS the GL; this seed bypasses the
    //    engine, so it writes the spine directly and self-refs it (matching
    //    engineGlArm, which sets sourceJournalEntryId = the spine's own id).
    let spine = await prisma.universalVoucher.findFirst({ where: { voucherNo: VOUCHER_REF }, include: { lines: true } });
    if (!spine) {
        spine = await prisma.universalVoucher.create({
            data: {
                type: "PAYMENT", voucherNo: VOUCHER_REF, date: today,   // 5D-7: id is the UVNo; no reference
                description: "Courier payment to DTDC (dummy)", narration: "Courier payment to DTDC (dummy)",
                status: "POSTED", postedAt: today, createdById: admin.id,
                lines: {
                    create: [
                        { accountId: courier.id, type: "DEBIT", amount: 5000, description: "Courier charges", seq: 0 },
                        { accountId: cash.id, type: "CREDIT", amount: 5000, description: "Paid in cash", seq: 1 },
                    ],
                },
            },
            include: { lines: true },
        });
        await prisma.universalVoucher.update({ where: { id: spine.id }, data: { sourceJournalEntryId: spine.id } });
        // Keep Account.balance in step (engineGlArm maintains it for engine-posted
        // vouchers; this seed bypasses the engine). Courier (expense, Dr) +5000;
        // Cash (asset, Cr) −5000.
        await prisma.account.update({ where: { id: courier.id }, data: { balance: { increment: 5000 } } });
        await prisma.account.update({ where: { id: cash.id },    data: { balance: { decrement: 5000 } } });
    }

    // 4. Phase 5 5E: the spine IS the PAYMENT voucher (Voucher table dropped). The
    //    user-facing number lives on the spine's `voucherNo` (= VOUCHER_REF), set
    //    in step 3 — no separate Voucher row to create.

    // 5. Draws against the ₹5,000 entry: ₹2,000 onto a product, ₹3,000 dismissed.
    //    Cost-pool rows reference the SPINE debit line (G2).
    const spineCourierLine = spine.lines.find((l) => l.accountId === courier.id && l.type === "DEBIT");
    if (!spineCourierLine) { console.log("    spine courier line missing — skipping draws."); return; }
    if ((await prisma.additionalCostAllocation.count({ where: { sourceVoucherGlLineId: spineCourierLine.id } })) === 0) {
        await prisma.additionalCostAllocation.createMany({
            data: [
                {
                    kind: "ALLOCATION", sourceVoucherGlLineId: spineCourierLine.id, amountPaise: 200000,
                    productId: product.id, perUnitPaise: 2000, quantity: 100,
                    note: "Inbound freight share", date: today, createdById: admin.id,
                },
                {
                    kind: "DISMISSAL", sourceVoucherGlLineId: spineCourierLine.id, amountPaise: 300000,
                    note: "Office courier — not product freight", date: today, createdById: admin.id,
                },
            ],
        });
    }

    console.log(`    ✓ cost-pool demo: group "${POOL_GROUP_NAME}", ledger "${COURIER_LEDGER_NAME}", voucher ${VOUCHER_REF}, ₹5,000 payment, 2 rows.`);
}

async function main() {
    console.log("\n⚠️  DUMMY DATA — sample vouchers + cost-pool demo.");
    await seedCostPoolDemo();
    console.log("");
    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
