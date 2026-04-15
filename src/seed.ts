import { PrismaClient, Role, Status, Priority } from './generated/prisma'
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding started...");

    // 🔐 Create Users
    const password = await bcrypt.hash("admin123", 10);

    const admin = await prisma.user.upsert({
        where: { email: "admin@service.com" },
        update: {},
        create: {
            name: "Admin User",
            email: "admin@service.com",
            password,
            role: Role.ADMIN,
        },
    });

    const technician = await prisma.user.upsert({
        where: { email: "tech@service.com" },
        update: {},
        create: {
            name: "Technician",
            email: "tech@service.com",
            password,
            role: Role.TECHNICIAN,
        },
    });

    console.log("✅ Users created");

    // 👤 Create Customer
    const customer = await prisma.customer.create({
        data: {
            name: "Rahim Uddin",
            phone: "9876543210",
            email: "rahim@example.com",
            agreedToTerms: true,
            agreedAt: new Date(),
        },
    });

    console.log("✅ Customer created");

    // 💻 Create Device
    const device = await prisma.device.create({
        data: {
            type: "Laptop",
            brand: "Dell",
            model: "Inspiron 15",
            problem: "Not turning on",
            customerId: customer.id,
        },
    });

    console.log("✅ Device created");

    // 🎫 Create Ticket
    const ticket = await prisma.ticket.create({
        data: {
            status: Status.RECEIVED,
            priority: Priority.NORMAL,
            notes: "Customer reported sudden shutdown",
            deviceId: device.id,
            technicianId: technician.id,
        },
    });

    console.log("✅ Ticket created");

    // 📝 Ticket Log
    await prisma.ticketLog.create({
        data: {
            ticketId: ticket.id,
            status: Status.RECEIVED,
            note: "Ticket created",
            userId: admin.id,
        },
    });

    console.log("✅ Ticket log created");

    // 🏢 Service Center
    await prisma.serviceCenter.create({
        data: {
            name: "Dell Authorized Service",
            phone: "1800-123-456",
            email: "support@dell.com",
            address: "Guwahati Service Center",
        },
    });

    console.log("✅ Service center created");

    console.log("🎉 Seeding finished!");
}

main()
    .catch((e) => {
        console.error("❌ Seed error:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });