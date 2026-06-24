// DUMMY DATA — rich org chart demo data.
// Seeds: Headquarters (Mumbai) with Board / CEO / C-Level / Central Depts,
//        plus 4 Regional Branches (Guwahati, Abhayapuri, Bongaigaon, Kokrajhar)
//        each with a Branch Manager and dept staff.
//
// Designed to make the Org Chart → Regions / Hierarchy / Levels tabs look
// like a real organisation chart instead of just 3 demo posts.
//
// Run: pnpm seed:dummy-org-rich
//
// Cleanup: pnpm seed:hard-clean removes the demo users (their UserPosts
// cascade-delete with them). Branches, Departments, and Posts survive
// hard-clean as structural data and come back populated on re-run.

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
import { upsertPositionWithRoles } from "./lib/positionSeedSync";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new Pool({ connectionString: rawUrl, ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Branches ────────────────────────────────────────────────────────────────
// Reuses BR-HQ (renamed to Headquarters – Mumbai) and adds 4 regional branches.
const BRANCHES = [
    { id: "BR-HQ",          name: "Headquarters – Mumbai", address: "Mumbai, Maharashtra" },
    { id: "BR-GUWAHATI",    name: "Guwahati Branch",       address: "Guwahati, Assam" },
    { id: "BR-ABHAYAPURI",  name: "Abhayapuri Branch",     address: "Abhayapuri, Assam" },
    { id: "BR-BONGAIGAON",  name: "Bongaigaon Branch",     address: "Bongaigaon, Assam" },
    { id: "BR-KOKRAJHAR",   name: "Kokrajhar Branch",      address: "Kokrajhar, Assam" },
];

// ── Departments (all org-wide; positions tag the specific branch) ──────────
const DEPARTMENTS = [
    { id: "DEP-FIN",     name: "Finance & Accounts",  description: "Finance, accounting, books, reporting" },
    { id: "DEP-HR",      name: "Human Resources",     description: "People ops, recruitment, payroll" },
    { id: "DEP-IT",      name: "IT & Technology",     description: "Systems, infrastructure, tech" },
    { id: "DEP-MKT",     name: "Marketing",           description: "Brand, demand-gen, communications" },
    { id: "DEP-LEGAL",   name: "Legal & Compliance",  description: "Legal, contracts, compliance" },
    { id: "DEP-AUDIT",   name: "Internal Audit",      description: "Internal controls & audits" },
    { id: "DEP-OPS",     name: "Operations",          description: "Operational excellence" },
    { id: "DEP-SALES",   name: "Sales",               description: "Revenue, customer acquisition" },
    { id: "DEP-SUPPORT", name: "Customer Support",    description: "After-sale support & service" },
    { id: "DEP-STORE",   name: "Store / Warehouse",   description: "Inventory & warehouse" },
];

// ── Users (no login expected; password set to "demo123" anyway) ─────────────
const USERS = [
    // Board
    { email: "rajan.sharma@demo.in",   name: "Rajan Sharma" },
    { email: "meena.agarwal@demo.in",  name: "Meena Agarwal" },
    { email: "suresh.verma@demo.in",   name: "Suresh Verma" },
    { email: "lata.bose@demo.in",      name: "Lata Bose" },
    // CEO + C-Level
    { email: "anil.das@demo.in",       name: "Anil Das" },
    { email: "priya.nair@demo.in",     name: "Priya Nair" },
    { email: "sneha.roy@demo.in",      name: "Sneha Roy" },
    { email: "farhan.ali@demo.in",     name: "Farhan Ali" },
    { email: "kaberi.nath@demo.in",    name: "Kaberi Nath" },
    { email: "nandita.sen@demo.in",    name: "Nandita Sen" },
    // HQ Central Dept Heads
    { email: "anita.bora@demo.in",     name: "Anita Bora" },
    { email: "puja.das@demo.in",       name: "Puja Das" },
    { email: "amit.patgiri@demo.in",   name: "Amit Patgiri" },
    { email: "smita.roy@demo.in",      name: "Smita Roy" },
    { email: "ravi.soni@demo.in",      name: "Ravi Soni" },
    { email: "vinay.kohli@demo.in",    name: "Vinay Kohli" },
    { email: "dimal.hazra@demo.in",    name: "Dimal Hazra" },
    // Branch Managers
    { email: "pallabi.devi@demo.in",   name: "Pallabi Devi" },
    { email: "imran.hussain@demo.in",  name: "Imran Hussain" },
    { email: "jitu.baruah@demo.in",    name: "Jitu Baruah" },
    { email: "anita.boro@demo.in",     name: "Anita Boro" },
    // Branch staff — Guwahati
    { email: "ritu.guw@demo.in",       name: "Ritu" },
    { email: "nayan.guw@demo.in",      name: "Nayan" },
    { email: "rubul.guw@demo.in",      name: "Rubul" },
    { email: "lina.guw@demo.in",       name: "Lina" },
    // Branch staff — Abhayapuri
    { email: "komal.abh@demo.in",      name: "Komal" },
    { email: "hiran.abh@demo.in",      name: "Hiran" },
    { email: "diva.abh@demo.in",       name: "Diva" },
    { email: "mausi.abh@demo.in",      name: "Mausi" },
    // Branch staff — Bongaigaon
    { email: "sanju.bon@demo.in",      name: "Sanju" },
    { email: "rohan.bon@demo.in",      name: "Rohan" },
    { email: "puja.bon@demo.in",       name: "Puja" },
    { email: "rekha.bon@demo.in",      name: "Rekha" },
    // Branch staff — Kokrajhar
    { email: "dipak.kok@demo.in",      name: "Dipak" },
    { email: "prashant.kok@demo.in",   name: "Prashant" },
    { email: "biki.kok@demo.in",       name: "Biki" },
];

interface PositionDef {
    id: string;
    title: string;
    branchId: string | null;
    departmentId: string | null;
    roleTemplateId: string;
    holders: string[]; // user emails
}

const POSITIONS: PositionDef[] = [
    // ─────────────── HEADQUARTERS — Board of Directors ───────────────
    { id: "POS-CHAIRMAN",     title: "Chairman",              branchId: null, departmentId: null,        roleTemplateId: "R1", holders: ["rajan.sharma@demo.in"] },
    { id: "POS-BOARD-MEENA",  title: "Board Director",        branchId: null, departmentId: null,        roleTemplateId: "R1", holders: ["meena.agarwal@demo.in"] },
    { id: "POS-BOARD-SURESH", title: "Board Director",        branchId: null, departmentId: null,        roleTemplateId: "R1", holders: ["suresh.verma@demo.in"] },
    { id: "POS-BOARD-LATA",   title: "Independent Director",  branchId: null, departmentId: null,        roleTemplateId: "R1", holders: ["lata.bose@demo.in"] },

    // ─────────────── HEADQUARTERS — Chief Executive ───────────────
    { id: "POS-CEO",          title: "CEO",                   branchId: null, departmentId: null,        roleTemplateId: "R1", holders: ["anil.das@demo.in"] },

    // ─────────────── HEADQUARTERS — C-Level Executives ───────────────
    { id: "POS-CFO",          title: "CFO",                   branchId: null, departmentId: "DEP-FIN",   roleTemplateId: "R1", holders: ["priya.nair@demo.in"] },
    { id: "POS-CTO",          title: "CTO",                   branchId: null, departmentId: "DEP-IT",    roleTemplateId: "R1", holders: ["sneha.roy@demo.in"] },
    { id: "POS-CMO",          title: "CMO",                   branchId: null, departmentId: "DEP-MKT",   roleTemplateId: "R1", holders: ["farhan.ali@demo.in"] },
    { id: "POS-COO",          title: "COO",                   branchId: null, departmentId: "DEP-OPS",   roleTemplateId: "R1", holders: ["kaberi.nath@demo.in"] },
    { id: "POS-CIO",          title: "CIO",                   branchId: null, departmentId: "DEP-IT",    roleTemplateId: "R1", holders: ["nandita.sen@demo.in"] },

    // ─────────────── HEADQUARTERS — Central Department Heads ───────────────
    { id: "POS-HEAD-FIN",     title: "Finance Head",          branchId: null, departmentId: "DEP-FIN",   roleTemplateId: "R3", holders: ["anita.bora@demo.in"] },
    { id: "POS-HEAD-HR",      title: "HR Head",               branchId: null, departmentId: "DEP-HR",    roleTemplateId: "R3", holders: ["puja.das@demo.in"] },
    { id: "POS-HEAD-IT",      title: "IT Head",               branchId: null, departmentId: "DEP-IT",    roleTemplateId: "R3", holders: ["amit.patgiri@demo.in"] },
    { id: "POS-HEAD-MKT",     title: "Marketing Head",        branchId: null, departmentId: "DEP-MKT",   roleTemplateId: "R3", holders: ["smita.roy@demo.in"] },
    { id: "POS-HEAD-LEGAL",   title: "Legal Head",            branchId: null, departmentId: "DEP-LEGAL", roleTemplateId: "R3", holders: ["ravi.soni@demo.in"] },
    { id: "POS-HEAD-AUDIT",   title: "Audit Head",            branchId: null, departmentId: "DEP-AUDIT", roleTemplateId: "R3", holders: ["vinay.kohli@demo.in"] },
    { id: "POS-HEAD-OPS",     title: "Operations Head",       branchId: null, departmentId: "DEP-OPS",   roleTemplateId: "R3", holders: ["dimal.hazra@demo.in"] },

    // ─────────────── GUWAHATI BRANCH ───────────────
    { id: "POS-BM-GUW",       title: "Branch Manager",        branchId: "BR-GUWAHATI",   departmentId: null,         roleTemplateId: "R3", holders: ["pallabi.devi@demo.in"] },
    { id: "POS-GUW-SALES-1",  title: "Sales Executive",       branchId: "BR-GUWAHATI",   departmentId: "DEP-SALES",  roleTemplateId: "R3", holders: ["ritu.guw@demo.in"] },
    { id: "POS-GUW-SALES-2",  title: "Sales Executive",       branchId: "BR-GUWAHATI",   departmentId: "DEP-SALES",  roleTemplateId: "R3", holders: ["nayan.guw@demo.in"] },
    { id: "POS-GUW-IT-1",     title: "IT Support",            branchId: "BR-GUWAHATI",   departmentId: "DEP-IT",     roleTemplateId: "R2", holders: ["rubul.guw@demo.in"] },
    { id: "POS-GUW-ACC-1",    title: "Accountant",            branchId: "BR-GUWAHATI",   departmentId: "DEP-FIN",    roleTemplateId: "R3", holders: ["lina.guw@demo.in"] },

    // ─────────────── ABHAYAPURI BRANCH ───────────────
    { id: "POS-BM-ABH",       title: "Branch Manager",        branchId: "BR-ABHAYAPURI", departmentId: null,         roleTemplateId: "R3", holders: ["imran.hussain@demo.in"] },
    { id: "POS-ABH-SALES-1",  title: "Sales Executive",       branchId: "BR-ABHAYAPURI", departmentId: "DEP-SALES",  roleTemplateId: "R3", holders: ["komal.abh@demo.in"] },
    { id: "POS-ABH-SALES-2",  title: "Sales Executive",       branchId: "BR-ABHAYAPURI", departmentId: "DEP-SALES",  roleTemplateId: "R3", holders: ["hiran.abh@demo.in"] },
    { id: "POS-ABH-SUP-1",    title: "Support Agent",         branchId: "BR-ABHAYAPURI", departmentId: "DEP-SUPPORT",roleTemplateId: "R2", holders: ["diva.abh@demo.in"] },
    { id: "POS-ABH-STORE-1",  title: "Store Staff",           branchId: "BR-ABHAYAPURI", departmentId: "DEP-STORE",  roleTemplateId: "R4", holders: ["mausi.abh@demo.in"] },

    // ─────────────── BONGAIGAON BRANCH ───────────────
    { id: "POS-BM-BON",       title: "Branch Manager",        branchId: "BR-BONGAIGAON", departmentId: null,         roleTemplateId: "R3", holders: ["jitu.baruah@demo.in"] },
    { id: "POS-BON-SALES-1",  title: "Sales Executive",       branchId: "BR-BONGAIGAON", departmentId: "DEP-SALES",  roleTemplateId: "R3", holders: ["sanju.bon@demo.in"] },
    { id: "POS-BON-SUP-1",    title: "Support Agent",         branchId: "BR-BONGAIGAON", departmentId: "DEP-SUPPORT",roleTemplateId: "R2", holders: ["rohan.bon@demo.in"] },
    { id: "POS-BON-ACC-1",    title: "Accountant",            branchId: "BR-BONGAIGAON", departmentId: "DEP-FIN",    roleTemplateId: "R3", holders: ["puja.bon@demo.in"] },
    { id: "POS-BON-HR-1",     title: "HR Officer",            branchId: "BR-BONGAIGAON", departmentId: "DEP-HR",     roleTemplateId: "R3", holders: ["rekha.bon@demo.in"] },

    // ─────────────── KOKRAJHAR BRANCH ───────────────
    { id: "POS-BM-KOK",       title: "Branch Manager",        branchId: "BR-KOKRAJHAR",  departmentId: null,         roleTemplateId: "R3", holders: ["anita.boro@demo.in"] },
    { id: "POS-KOK-SALES-1",  title: "Sales Executive",       branchId: "BR-KOKRAJHAR",  departmentId: "DEP-SALES",  roleTemplateId: "R3", holders: ["dipak.kok@demo.in"] },
    { id: "POS-KOK-SUP-1",    title: "Support Agent",         branchId: "BR-KOKRAJHAR",  departmentId: "DEP-SUPPORT",roleTemplateId: "R2", holders: ["prashant.kok@demo.in"] },
    { id: "POS-KOK-IT-1",     title: "IT Support",            branchId: "BR-KOKRAJHAR",  departmentId: "DEP-IT",     roleTemplateId: "R2", holders: ["biki.kok@demo.in"] },
];

async function main() {
    console.log("\n⚠️  DUMMY DATA — rich org chart demo. DO NOT run in production.\n");

    // ── Step 1: Branches ─────────────────────────────────────────────────────
    console.log("[1/4] Upserting branches…");
    for (const b of BRANCHES) {
        await pool.query(
            `INSERT INTO "Branch" (id, name, address, "isActive")
             VALUES ($1, $2, $3, true)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, "isActive" = true`,
            [b.id, b.name, b.address],
        );
        console.log(`  + ${b.id.padEnd(16)} ${b.name}`);
    }

    // ── Step 2: Departments (org-wide) ───────────────────────────────────────
    console.log("\n[2/4] Upserting departments…");
    for (const d of DEPARTMENTS) {
        await pool.query(
            `INSERT INTO "Department" (id, name, description, "branchId")
             VALUES ($1, $2, $3, NULL)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
            [d.id, d.name, d.description],
        );
        console.log(`  + ${d.id.padEnd(14)} ${d.name}`);
    }

    // ── Step 3: Users ────────────────────────────────────────────────────────
    console.log("\n[3/4] Upserting demo users…");
    const password = await bcrypt.hash("demo123", 10);
    const userIdByEmail = new Map<string, number>();
    for (const u of USERS) {
        const user = await prisma.user.upsert({
            where:  { email: u.email },
            update: { name: u.name, password },
            create: { name: u.name, email: u.email, password, role: null },
            select: { id: true },
        });
        userIdByEmail.set(u.email, user.id);
    }
    console.log(`  ✓ ${USERS.length} users (password: demo123)`);

    // ── Step 4: Positions + UserPosition appointments ────────────────────────
    console.log("\n[4/4] Upserting positions + appointments…");
    for (const p of POSITIONS) {
        await upsertPositionWithRoles(prisma, {
            id: p.id,
            title: p.title,
            branchId: p.branchId,
            departmentId: p.departmentId,
            roleTemplateIds: [p.roleTemplateId],
        });
        for (const email of p.holders) {
            const userId = userIdByEmail.get(email);
            if (!userId) { console.warn(`    ⚠ user not found: ${email}`); continue; }
            await prisma.userPosition.upsert({
                where:  { userId_positionId: { userId, positionId: p.id } },
                update: {},
                create: { userId, positionId: p.id },
            });
        }
    }
    console.log(`  ✓ ${POSITIONS.length} positions with ${POSITIONS.reduce((s, p) => s + p.holders.length, 0)} appointments`);

    // ── Summary ──────────────────────────────────────────────────────────────
    const boardCount = POSITIONS.filter(p => !p.branchId && /(chairman|board|director)/i.test(p.title)).length;
    const cLevelCount = POSITIONS.filter(p => !p.branchId && /^(ceo|cfo|cto|coo|cio|cmo|cso)\b/i.test(p.title)).length;
    const headCount   = POSITIONS.filter(p => !p.branchId && /head/i.test(p.title)).length;
    const branchPositionCount = POSITIONS.filter(p => p.branchId).length;

    console.log("\n✅ Rich org chart seeded:");
    console.log(`   • Headquarters (Mumbai):`);
    console.log(`       Board of Directors:    ${boardCount}`);
    console.log(`       CEO + C-Level:         ${cLevelCount}`);
    console.log(`       Central Dept Heads:    ${headCount}`);
    console.log(`   • Regional Branches:       4 (Guwahati / Abhayapuri / Bongaigaon / Kokrajhar)`);
    console.log(`       Total branch positions: ${branchPositionCount}`);
    console.log(`\n   Open /office/admin/org-chart → try Regions / Hierarchy / Levels tabs.\n`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
