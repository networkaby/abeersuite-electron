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

const PAYMENT_REF = "DUMMY-COURIER-PAY-1"; // JournalEntry reference (GL side)
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

    // 3. POSTED Payment entry (Dr courier ₹5,000 / Cr Cash ₹5,000) — find or create.
    let je = await prisma.journalEntry.findUnique({ where: { reference: PAYMENT_REF }, include: { lines: true } });
    if (!je) {
        je = await prisma.journalEntry.create({
            data: {
                date: today, reference: PAYMENT_REF, description: "Courier payment to DTDC (dummy)",
                status: "POSTED", postedAt: today, createdById: admin.id,
                lines: {
                    create: [
                        { accountId: courier.id, type: "DEBIT", amount: 5000, description: "Courier charges" },
                        { accountId: cash.id, type: "CREDIT", amount: 5000, description: "Paid in cash" },
                    ],
                },
            },
            include: { lines: true },
        });
    }
    const courierLine = je.lines.find((l) => l.accountId === courier.id && l.type === "DEBIT");
    if (!courierLine) { console.log("    courier debit line missing — skipping."); return; }

    // 4. A PAYMENT Voucher tied to that JE → the real voucher number the UI shows.
    if (!(await prisma.voucher.findUnique({ where: { reference: VOUCHER_REF } }))) {
        await prisma.voucher.create({
            data: {
                type: "PAYMENT", reference: VOUCHER_REF, date: today,
                narration: "Courier payment to DTDC (dummy)", totalAmount: 5000,
                status: "POSTED", postedAt: today, journalEntryId: je.id, createdById: admin.id,
            },
        });
    }

    // 4b. Phase 4 dual-write parity: mirror the dummy JE into the universal-voucher
    //     spine (this seed creates the JE directly, bypassing the engine, so the
    //     spine must be written explicitly to stay consistent — §5).
    if (!(await prisma.universalVoucher.findUnique({ where: { reference: PAYMENT_REF } }))) {
        await prisma.universalVoucher.create({
            data: {
                type: "PAYMENT", reference: PAYMENT_REF, friendlyRef: VOUCHER_REF, date: today,
                description: "Courier payment to DTDC (dummy)", narration: "Courier payment to DTDC (dummy)",
                status: "POSTED", postedAt: today, createdById: admin.id, sourceJournalEntryId: je.id,
                lines: {
                    create: [
                        { accountId: courier.id, type: "DEBIT", amount: 5000, description: "Courier charges" },
                        { accountId: cash.id, type: "CREDIT", amount: 5000, description: "Paid in cash" },
                    ],
                },
            },
        });
    }

    // 5. Draws against the ₹5,000 entry: ₹2,000 onto a product, ₹3,000 dismissed.
    if ((await prisma.additionalCostAllocation.count({ where: { sourceJournalLineId: courierLine.id } })) === 0) {
        await prisma.additionalCostAllocation.createMany({
            data: [
                {
                    kind: "ALLOCATION", sourceJournalLineId: courierLine.id, amountPaise: 200000,
                    productId: product.id, perUnitPaise: 2000, quantity: 100,
                    note: "Inbound freight share", date: today, createdById: admin.id,
                },
                {
                    kind: "DISMISSAL", sourceJournalLineId: courierLine.id, amountPaise: 300000,
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
