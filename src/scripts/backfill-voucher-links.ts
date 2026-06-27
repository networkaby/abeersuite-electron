// Phase 5 5A backfill — populate VoucherLink from the legacy InvVoucher workflow
// FK columns (ticketId / dealId / shopOrderId / orderPipelineId / orderStatusId)
// for every voucher that already has a spine. Idempotent (upsert by
// universalVoucherId+kind), safe to re-run. The columns are kept until 5A-3.
//
// Run:  pnpm tsx src/scripts/backfill-voucher-links.ts

import { PrismaClient, type VoucherLinkKind } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    const vouchers = await prisma.invVoucher.findMany({
        where: {
            universalVoucherId: { not: null },
            OR: [
                { ticketId: { not: null } }, { dealId: { not: null } }, { shopOrderId: { not: null } },
                { orderPipelineId: { not: null } }, { orderStatusId: { not: null } },
            ],
        },
        select: {
            universalVoucherId: true,
            ticketId: true, dealId: true, shopOrderId: true, orderPipelineId: true, orderStatusId: true,
        },
    });

    let n = 0;
    for (const v of vouchers) {
        const uv = v.universalVoucherId!;
        const links: [VoucherLinkKind, string | null][] = [
            ["TICKET",         v.ticketId        != null ? String(v.ticketId)    : null],
            ["DEAL",           v.dealId          != null ? String(v.dealId)      : null],
            ["SHOP_ORDER",     v.shopOrderId     != null ? String(v.shopOrderId) : null],
            ["ORDER_PIPELINE", v.orderPipelineId],
            ["ORDER_STATUS",   v.orderStatusId],
        ];
        for (const [kind, targetId] of links) {
            if (targetId == null) continue;
            await prisma.voucherLink.upsert({
                where:  { universalVoucherId_kind: { universalVoucherId: uv, kind } },
                create: { universalVoucherId: uv, kind, targetId },
                update: { targetId },
            });
            n++;
        }
    }

    console.log(`backfill-voucher-links: upserted ${n} link(s) across ${vouchers.length} voucher(s) with workflow FKs.`);
    await prisma.$disconnect();
    await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
