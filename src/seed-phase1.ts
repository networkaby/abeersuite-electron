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

const PERMISSIONS = [
    { id: "admin:bypass",          label: "Admin bypass all checks",     module: "core" },
    { id: "tickets:status:set",    label: "Set ticket status",           module: "service" },
    { id: "tickets:substatus:set", label: "Set ticket sub-status",       module: "service" },
    { id: "tickets:create",        label: "Create tickets",              module: "service" },
    { id: "warranty:convert",      label: "Convert warranty status",     module: "service" },
    { id: "tasks:view:own",        label: "View own tasks",              module: "tasks" },
    { id: "tasks:view:team",       label: "View team tasks",             module: "tasks" },
    { id: "tasks:view:org",        label: "View all org tasks",          module: "tasks" },
    { id: "tasks:create",          label: "Create tasks",                module: "tasks" },
    { id: "tasks:pickup",          label: "Pick up another user's task", module: "tasks" },
    { id: "users:manage",          label: "Create/edit/delete users",    module: "admin" },
    { id: "roles:manage",          label: "Create/edit custom roles",    module: "admin" },
    { id: "settings:statuses",     label: "Manage ticket statuses",      module: "admin" },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    R1: PERMISSIONS.map(p => p.id),
    R2: [
        "tickets:status:set", "tickets:substatus:set", "tickets:create",
        "warranty:convert",
        "tasks:view:own", "tasks:view:team", "tasks:create",
    ],
    R3: [
        "tickets:status:set", "tickets:substatus:set", "tickets:create",
        "tasks:view:own", "tasks:view:team", "tasks:create",
    ],
    R4: [
        "tickets:substatus:set",
        "tasks:view:own", "tasks:view:team", "tasks:create",
    ],
};

async function main() {
    console.log("Phase 1 seed: permissions + UserRole backfill...");

    // 1. Mark system roles
    await prisma.role.updateMany({
        where: { id: { in: ["R1", "R2", "R3", "R4"] } },
        data: { isSystem: true },
    });
    console.log("✓ Marked R1-R4 as system roles");

    // 2. Seed permissions (upsert — safe to re-run)
    for (const perm of PERMISSIONS) {
        await prisma.permission.upsert({
            where: { id: perm.id },
            create: perm,
            update: { label: perm.label, module: perm.module },
        });
    }
    console.log(`✓ Seeded ${PERMISSIONS.length} permissions`);

    // 3. Seed role-permission grants
    for (const [roleId, permIds] of Object.entries(ROLE_PERMISSIONS)) {
        for (const permissionId of permIds) {
            await prisma.userRolePermission.upsert({
                where: { roleId_permissionId: { roleId, permissionId } },
                create: { roleId, permissionId },
                update: {},
            });
        }
    }
    console.log("✓ Seeded role-permission grants");

    // 4. Backfill UserRole from existing User.role
    const users = await prisma.user.findMany({ select: { id: true, role: true } });
    for (const user of users) {
        await prisma.userRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: user.role } },
            create: { userId: user.id, roleId: user.role, isPrimary: true },
            update: {},
        });
    }
    console.log(`✓ Backfilled UserRole for ${users.length} users`);

    console.log("Phase 1 seed complete.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
