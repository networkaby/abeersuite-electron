import { PrismaClient } from "@/generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    const password = await bcrypt.hash("admin123", 10);

    await prisma.user.upsert({
        where: { email: "admin@service.com" },
        update: {},
        create: {
            name: "Admin",
            email: "admin@service.com",
            password,
            role: "ADMIN",
        },
    });

    console.log("✅ Seed done — admin@service.com / admin123");
}

main().catch(console.error).finally(() => prisma.$disconnect());