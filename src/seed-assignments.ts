import { PrismaClient } from './generated/prisma/client';
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
    console.log("Seeding assignment permissions...");

    // ── New permissions ───────────────────────────────────────────────────────
    await prisma.permission.createMany({
        data: [
            {
                id: "tickets:assign",
                label: "Assign Tickets",
                description: "Claim, pass, or reject ticket primary ownership",
                module: "tickets",
            },
            {
                id: "tickets:manage-participants",
                label: "Manage Ticket Participants",
                description: "Add or remove secondary owners on tickets",
                module: "tickets",
            },
        ],
        skipDuplicates: true,
    });

    // ── Grant tickets:assign to R1 (Admin), R2 (Technician), R3 (Front Desk), R4 (Despatch) ──
    await prisma.userRolePermission.createMany({
        data: [
            { roleId: "R1", permissionId: "tickets:assign" },
            { roleId: "R2", permissionId: "tickets:assign" },
            { roleId: "R3", permissionId: "tickets:assign" },
            { roleId: "R4", permissionId: "tickets:assign" },
        ],
        skipDuplicates: true,
    });

    // ── Grant tickets:manage-participants to R1 (Admin) and R2 (Technician) only ──
    await prisma.userRolePermission.createMany({
        data: [
            { roleId: "R1", permissionId: "tickets:manage-participants" },
            { roleId: "R2", permissionId: "tickets:manage-participants" },
        ],
        skipDuplicates: true,
    });

    console.log("Done. Permissions seeded:");
    console.log("  tickets:assign         → R1, R2, R3, R4");
    console.log("  tickets:manage-participants → R1, R2");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
