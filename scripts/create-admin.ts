import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config();

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
    const password = await bcrypt.hash("admin123", 10);

    const user = await prisma.user.upsert({
        where: { email: "admin@service.com" },
        update: {},
        create: {
            name: "Admin",
            email: "admin@service.com",
            password,
            role: "ADMIN",
        },
    });

    console.log("✅ Admin created:", user);
}

main().catch(console.error).finally(() => prisma.$disconnect());