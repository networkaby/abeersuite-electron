import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // Bridge sub-statuses: warrantyScope = "any" so they appear in both warranty & non-warranty
    await prisma.ticketSubStatus.upsert({
        where: { id: "SS36" },
        create: {
            id: "SS36",
            label: "Warranty Voided — Customer Approval Needed",
            color: "bg-red-100 text-red-600",
            group: "customer_comm",
            order: 36,
            applicableStatusIds: [],
            allowedRoles: [],
            notifyRoles: ["R3"],
            warrantyScope: "any",
            actionLabel: "Call customer — warranty void, confirm paid repair",
        },
        update: {
            warrantyScope: "any",
        },
    });

    await prisma.ticketSubStatus.upsert({
        where: { id: "SS37" },
        create: {
            id: "SS37",
            label: "Confirmed Under Warranty — Proceeding",
            color: "bg-green-100 text-green-700",
            group: "customer_comm",
            order: 37,
            applicableStatusIds: [],
            allowedRoles: [],
            notifyRoles: ["R3"],
            warrantyScope: "any",
            actionLabel: "Inform customer — covered under warranty, no charge",
        },
        update: {
            warrantyScope: "any",
        },
    });

    console.log("Phase 2 seed complete: SS36, SS37 bridge sub-statuses ready.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => { prisma.$disconnect(); pool.end(); });
