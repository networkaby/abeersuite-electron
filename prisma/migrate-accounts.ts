import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never) as PrismaClient;

async function main() {
    const persons = await prisma.person.findMany({
        where: { account: null },
    });

    console.log(`Creating accounts for ${persons.length} persons without accounts...`);

    for (const p of persons) {
        await prisma.account.create({ data: { personId: p.id, name: p.name } });
        console.log(`  Created account for person #${p.id} (${p.name})`);
    }

    console.log("Done.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
