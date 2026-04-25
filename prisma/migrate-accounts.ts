import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never) as PrismaClient;

async function main() {
    const customers = await prisma.customer.findMany({
        where: { account: null },
    });

    console.log(`Creating accounts for ${customers.length} customers without accounts...`);

    for (const c of customers) {
        await prisma.account.create({ data: { customerId: c.id, name: c.name } });
        console.log(`  Created account for customer #${c.id} (${c.name})`);
    }

    console.log("Done.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
