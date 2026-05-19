// DUMMY DATA — demo staff Positions + 3 demo user appointments.
// Admin is seeded by bootstrap-seed.ts (production), not here.
// Run only in dev. `pnpm seed:hard-clean` removes the users (Positions + Branches
// survive as structural data; UserPosition records cascade-delete with the user).
//
// Run: pnpm seed:dummy-users  (npx tsx prisma/seeds/dummy-users.ts)
//
// NOTE: Personal till accounts (User.tillAccountId) were removed in the
// counter-based POS refactor (2026-05-14). Till accounts now belong to
// PosCounter rows, not users. Bootstrap seed creates Counter 1 per branch.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Demo Positions — structural seats at HQ branch ───────────────────────────
// Positions survive hard-clean (they're org structure, same as Branches/Departments).
// UserPosition appointments cascade-delete when the user is removed in Phase 4.
// All three reference bootstrap branches (BR-HQ) and departments — ensure
// bootstrap-seed.ts has run first.
const DEMO_POSITIONS = [
    { id: "POS-TECH-HQ",  title: "Repair Technician",   branchId: "BR-HQ", departmentId: "DEP-REPAIR", roleTemplateId: "R2" },
    { id: "POS-FRONT-HQ", title: "Front Desk Officer",  branchId: "BR-HQ", departmentId: "DEP-DESK",   roleTemplateId: "R3" },
    { id: "POS-DES-HQ",   title: "Despatch Officer",    branchId: "BR-HQ", departmentId: "DEP-DESP",   roleTemplateId: "R4" },
] as const;

// ── Demo Users — one per role, each appointed to a Position ──────────────────
const DEMO_USERS = [
    { email: "tech@networkservice.in",  name: "Technician", role: "R2", password: "tech123",  positionId: "POS-TECH-HQ"  },
    { email: "front@networkservice.in", name: "Front Desk", role: "R3", password: "front123", positionId: "POS-FRONT-HQ" },
    { email: "des@networkservice.in",   name: "Despatch",   role: "R4", password: "des123",   positionId: "POS-DES-HQ"   },
] as const;

async function main() {
    console.log("\n⚠️  DUMMY DATA — demo users with predictable passwords. DO NOT run in production.\n");

    // ── Step 1: Upsert Positions ──────────────────────────────────────────────
    console.log("[1/2] Upserting demo Positions at HQ…");
    for (const p of DEMO_POSITIONS) {
        await prisma.position.upsert({
            where:  { id: p.id },
            update: { title: p.title, branchId: p.branchId, departmentId: p.departmentId, roleTemplateId: p.roleTemplateId },
            create: { id: p.id, title: p.title, branchId: p.branchId, departmentId: p.departmentId, roleTemplateId: p.roleTemplateId },
        });
        console.log(`  + ${p.id}: "${p.title}" @ ${p.branchId} · ${p.departmentId} (role ${p.roleTemplateId})`);
    }

    // ── Step 2: Upsert Users + appoint each to their Position ────────────────
    console.log("\n[2/2] Upserting demo users + UserPosition appointments…");
    for (const u of DEMO_USERS) {
        const password = await bcrypt.hash(u.password, 10);
        const user = await prisma.user.upsert({
            where:  { email: u.email },
            update: { role: u.role, name: u.name, password },
            create: { name: u.name, email: u.email, password, role: u.role },
            select: { id: true },
        });
        await prisma.userPosition.upsert({
            where:  { userId_positionId: { userId: user.id, positionId: u.positionId } },
            update: {},
            create: { userId: user.id, positionId: u.positionId },
        });
        console.log(`  + ${u.email} (role ${u.role}) → ${u.positionId}   password: ${u.password}`);
    }

    console.log(`\n✅ Seeded ${DEMO_USERS.length} demo users with position assignments.`);
    console.log("   Posts reference bootstrap branches / departments — run pnpm prisma db seed first.");
    console.log("   Run pnpm seed:hard-clean to return to bootstrap state.\n");
    console.log("   Login table:");
    console.log("   ┌─────────────────────────────────┬────────────┬───────────────────────────────┐");
    console.log("   │ Email                           │ Password   │ Position                      │");
    console.log("   ├─────────────────────────────────┼────────────┼───────────────────────────────┤");
    console.log("   │ admin@networkservice.in         │ admin123   │ System Administrator (org-wide)│");
    console.log("   │ tech@networkservice.in          │ tech123    │ Repair Technician · HQ / Repair│");
    console.log("   │ front@networkservice.in         │ front123   │ Front Desk Officer · HQ / Desk │");
    console.log("   │ des@networkservice.in           │ des123     │ Despatch Officer · HQ / Despatch│");
    console.log("   └─────────────────────────────────┴────────────┴───────────────────────────────┘\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
