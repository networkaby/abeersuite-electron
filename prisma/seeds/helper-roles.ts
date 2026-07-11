// HELPER SEED — trade-specific starter roles.
//
// These roles are SPECIFIC to a computer / CCTV / printer / networking retail
// business. They are deliberately kept OUT of bootstrap-seed.ts (which seeds
// only R1 — the Admin role universal to every trade). A different trade would
// ship its own helper, or an admin would build the set from the Role Matrix UI.
//
// They are created as NON-system roles (`isSystem: false`) so an admin can
// freely rename, re-grant, or delete them — unlike the locked R1.
//
// Seeds 6 roles + their permission grants, idempotent (upsert-by-id, grants
// fully rewritten each run). Permission rows themselves come from bootstrap, so
// run this AFTER `pnpm prisma db seed`.
//
// Run: pnpm seed:helper-roles   (after `pnpm prisma db seed`)
//
// Removed by `pnpm seed:hard-clean` — non-system roles are wiped back to the
// R1-only bootstrap state and restored by re-running this helper.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ════════════════════════════════════════════════════════════════════════════
// Role templates — all NON-system (admin-editable).
// ════════════════════════════════════════════════════════════════════════════
// Each role is homed in one department — its authoring lens (the Role Matrix
// shows only that department's permission pool). R5 Branch Manager is
// cross-functional (spans Sales/Repair/Finance/POS), which one department's pool
// can't hold, so it lives in the all-access department (DEP-ADMIN). NOTE: the
// intended end-state for branch managers is a multi-position holder (one role
// per department, scope = BRANCH) rather than this single mega-role — R5 is kept
// here only so the existing demo/appointment seeds stay runnable.
const ROLES = [
    { id: "R5", label: "Role-Branch Manager",   color: "bg-amber-100 text-amber-700",   isSystem: false, rank: 80, departmentId: "DEP-ADMIN" },
    { id: "R2", label: "Role-Service Engineer", color: "bg-blue-100 text-blue-600",     isSystem: false, rank: 70, departmentId: "DEP-REPAIR" },
    { id: "R6", label: "Role-Accountant",       color: "bg-indigo-100 text-indigo-700", isSystem: false, rank: 60, departmentId: "DEP-FIN" },
    { id: "R7", label: "Role-Sales Executive",  color: "bg-teal-100 text-teal-700",     isSystem: false, rank: 50, departmentId: "DEP-SALES" },
    { id: "R3", label: "Role-Counter / Cashier",color: "bg-green-100 text-green-600",   isSystem: false, rank: 30, departmentId: "DEP-DESK" },
    { id: "R4", label: "Role-Stores & Despatch",color: "bg-purple-100 text-purple-600", isSystem: false, rank: 30, departmentId: "DEP-DESP" },
] as const;

// Departments whose pool is "everything" (no DepartmentPermission rows).
const ALL_ACCESS_DEPTS = new Set<string>(["DEP-ADMIN"]);

// Per-kind GL voucher permission helper — mirrors src/shared/lib/auth/voucherMatrix.ts
// (kept inline so this seed has no src `@/` alias dependency).
const GL_VOUCHER_KINDS = ["payment", "receipt", "contra", "credit-note", "debit-note", "journal"] as const;
const voucherPerms = (actions: string[]): string[] =>
    GL_VOUCHER_KINDS.flatMap(k => actions.map(a => `finance:voucher:${a}:${k}`));

const ROLE_PERMISSIONS: Record<string, string[]> = {
    // R5 — Branch Manager: full branch authority; no global settings/roles.
    R5: [
        "customers:view",
        "customers:create", "customers:edit", "customers:delete",
        "companies:manage",
        ...voucherPerms(["create", "post", "cancel", "delete"]),
        "finance:allocation:manage",
        "inventory:manage",
        // inventory:manage no longer passes product/masters CRUD routes — the
        // granular keys below are required (manage keeps only admin/config:
        // naming-convention writes, item import, pricing, voucher-register nav).
        "products:create", "products:edit", "products:delete",
        "inventory:masters:create", "inventory:masters:edit", "inventory:masters:delete",
        "inventory:view", "inventory:edit",
        "inventory:voucher:cancel", "inventory:voucher:delete",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop",
        "pos:shift:view", "pos:shift:manage",
        "accountancy:view",
        "deals:view", "deals:manage",
        "administration:tasks:view", "administration:tasks:manage",
    ],

    // R2 — Service Engineer: repair & diagnostics workflow.
    R2: [
        "customers:view",
    ],

    // R6 — Accountant: books, GST, vouchers, reconciliation. No admin/POS/tickets.
    R6: [
        "customers:view",
        "companies:manage",
        "finance:journal:cancel", "finance:journal:delete",
        ...voucherPerms(["create", "post", "cancel", "delete"]),
        "finance:allocation:manage",
        "finance:opening-balance:manage",
        "inventory:view",
        "pos:shift:view",
        // Accountancy reads via the flat view gate; writes come from the voucher
        // matrix above (create/post/cancel/delete) + masters, not a scope ladder.
        "accountancy:view",
    ],

    // R7 — Sales Executive: CRM, customer acquisition, ecommerce, counter sales.
    R7: [
        "customers:view",
        "customers:create", "customers:edit", "customers:delete",
        "companies:manage",
        "deals:view", "deals:manage",
        "ecommerce:manage",
        "inventory:view",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop", "pos:shift:view",
    ],

    // R3 — Counter / Cashier: POS, customer intake, ticket triage, branch inventory.
    R3: [
        "customers:view", "customers:create", "customers:edit", "customers:delete", "companies:manage",
        "deals:view", "deals:manage",
        "inventory:view", "inventory:edit",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop", "pos:shift:view",
    ],

    // R4 — Stores & Despatch: stock vouchers, goods in/out, repair item handoff.
    R4: [
        "customers:view",
        "inventory:view", "inventory:edit",
        "pos:shift:open", "pos:shift:close", "pos:shift:drop",
    ],
};

async function main(): Promise<void> {
    console.log("Seeding trade-specific starter roles (non-system)…\n");

    for (const r of ROLES) {
        await prisma.role.upsert({
            where:  { id: r.id },
            update: { label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank, departmentId: r.departmentId },
            create: { id: r.id, label: r.label, color: r.color, isSystem: r.isSystem, rank: r.rank, departmentId: r.departmentId },
        });
    }

    const roleIds = Object.keys(ROLE_PERMISSIONS);
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    const grants = Object.entries(ROLE_PERMISSIONS).flatMap(([roleId, ids]) =>
        ids.map((permissionId) => ({ roleId, permissionId })),
    );
    await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });

    // Department permission pools — the Role Matrix authoring lens. Each functional
    // department's pool = the union of permissions used by the roles homed in it,
    // so a role can never grant a permission outside its department's pool (keeps
    // the editor filter and the pool-removal cascade consistent). All-access
    // departments carry no rows (their pool is "everything").
    const poolByDept = new Map<string, Set<string>>();
    for (const r of ROLES) {
        if (ALL_ACCESS_DEPTS.has(r.departmentId)) continue;
        const set = poolByDept.get(r.departmentId) ?? new Set<string>();
        for (const pid of ROLE_PERMISSIONS[r.id] ?? []) set.add(pid);
        poolByDept.set(r.departmentId, set);
    }
    // DEP-FIN offers the FULL GL voucher matrix (every kind × every action,
    // incl. hard-delete) so the role editor shows all columns; individual roles
    // (e.g. R6) then grant a subset. Department decides "what", role decides
    // "eligibility" — so the pool is kind-complete even where no seeded role
    // holds hard-delete yet.
    if (poolByDept.has("DEP-FIN")) {
        const fin = poolByDept.get("DEP-FIN")!;
        for (const pid of voucherPerms(["create", "post", "cancel", "delete"])) fin.add(pid);
    }
    const poolDeptIds = [...poolByDept.keys()];
    await prisma.departmentPermission.deleteMany({ where: { departmentId: { in: poolDeptIds } } });
    const poolRows = [...poolByDept.entries()].flatMap(([departmentId, perms]) =>
        [...perms].map((permissionId) => ({ departmentId, permissionId })),
    );
    await prisma.departmentPermission.createMany({ data: poolRows, skipDuplicates: true });

    console.log(`  ✓ ${ROLES.length} roles · ${grants.length} grants · ${poolRows.length} pool entries across ${poolDeptIds.length} departments`);
    for (const r of ROLES) console.log(`    + ${r.id}: ${r.label}  →  ${r.departmentId}`);
    console.log("\nDone. Admins can rename / re-grant / delete these from the Role Matrix.\n");

    await prisma.$disconnect();
    await pool.end();
}

main().catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
});
