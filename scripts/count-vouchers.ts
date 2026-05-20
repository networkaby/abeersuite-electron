import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
const url = (process.env.DIRECT_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never) as PrismaClient;

(async () => {
    const [invV, gl, je, users, persons, branches] = await Promise.all([
        prisma.invVoucher.count(),
        prisma.voucher.count(),
        prisma.journalEntry.count(),
        prisma.user.count(),
        prisma.person.count(),
        prisma.branch.count(),
    ]);
    console.log("Row counts:", { invVouchers: invV, glVouchers: gl, journalEntries: je, users, persons, branches });

    if (invV > 0) {
        const sample = await prisma.invVoucher.findMany({
            take: 5,
            orderBy: { date: "desc" },
            select: { id: true, type: true, status: true, date: true, branchId: true, deletedAt: true },
        });
        console.log("Recent InvVouchers:", sample);
    }
    if (gl > 0) {
        const sample = await prisma.voucher.findMany({
            take: 5,
            orderBy: { date: "desc" },
            select: { id: true, type: true, status: true, date: true, deletedAt: true },
        });
        console.log("Recent GL Vouchers:", sample);
    }
    await prisma.$disconnect();
})();
