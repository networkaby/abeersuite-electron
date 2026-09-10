import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { scoreProductSearch, looseProductScore, rawOverlapScore } from "@/shared/lib/inventory/productCodes";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    const rows = await prisma.invProduct.findMany({
        where: { isActive: true },
        select: { name: true, sku: true, attrsJson: true, brand: { select: { name: true } }, codes: { select: { value: true } } },
    });
    console.log(`catalogue: ${rows.length} active products\n`);

    for (const q of ["abc"]) {
        for (const [kind, fn, keepZero] of [["exact", scoreProductSearch, false], ["fuzzy", looseProductScore, false], ["guess", rawOverlapScore, true]] as const) {
            const hits = rows.map((p) => ({ p, s: (fn as (a: typeof p, b: string) => number)(p, q) }))
                .filter((r) => keepZero || r.s > 0)
                .sort((a, b) => b.s - a.s);
            console.log(`--- "${q}" ${kind}: ${hits.length} matched, top 12 ---`);
            for (const r of hits.slice(0, 12)) console.log(`  ${String(r.s).padStart(6)}  ${(r.p.sku ?? "").padEnd(8)} ${r.p.name}`);
            if (hits.length > 0) break;
        }
        console.log("");
    }
}
main().finally(() => { void prisma.$disconnect(); void pool.end(); });
