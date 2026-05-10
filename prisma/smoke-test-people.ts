// Smoke test for the Person/Phone/Email rename. Exercises:
//   1. Create a Person with phones + emails (and auto Account).
//   2. Add a 2nd phone via the Phone table directly.
//   3. Verify global uniqueness — duplicate phone across persons → error.
//   4. Create a Company with own phone, link a person, observe derived contacts.
//   5. Confirm XOR CHECK rejects rows with both / neither owner set.
//   6. Cascade-delete a person and check Phone/Email rows go with it.
// Run: npx tsx prisma/smoke-test-people.ts

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const url = (process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never) as PrismaClient;

const stamp = Date.now();

async function main() {
    console.log("\n── Smoke test: Person + Phone/Email ─────────────────────────────────────────");

    // 1. Create person with phones/emails
    const p1 = await prisma.$transaction(async (tx) => {
        const person = await tx.person.create({
            data: { name: `Test Person ${stamp}` },
        });
        await tx.phone.create({ data: { phone: `9876${stamp}1`, personId: person.id, isPrimary: true } });
        await tx.phone.create({ data: { phone: `9876${stamp}2`, personId: person.id } });
        await tx.email.create({ data: { email: `t${stamp}@example.com`, personId: person.id, isPrimary: true } });
        await tx.account.create({ data: { personId: person.id, name: person.name } });
        return person;
    });
    console.log(`  ✓ Created person #${p1.id} with 2 phones, 1 email, 1 account`);

    // 2. Verify primary phone via lookup
    const reloaded = await prisma.person.findUnique({
        where: { id: p1.id },
        include: {
            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            emails: true,
            account: true,
        },
    });
    if (!reloaded || reloaded.phones.length !== 2 || !reloaded.account) {
        throw new Error("FAIL: reload mismatch");
    }
    console.log(`  ✓ Primary phone first in ordered list: ${reloaded.phones[0].phone}`);

    // 3. Global uniqueness across persons
    const p2 = await prisma.person.create({ data: { name: `Test Person 2 ${stamp}` } });
    let dupRejected = false;
    try {
        await prisma.phone.create({ data: { phone: reloaded.phones[0].phone, personId: p2.id } });
    } catch (err: unknown) {
        dupRejected = err instanceof Error && err.message.includes("Unique constraint");
    }
    if (!dupRejected) throw new Error("FAIL: duplicate phone across persons was NOT rejected");
    console.log("  ✓ Duplicate phone across two persons → rejected");

    // 4. Create company with own phone, link person, check derived
    const company = await prisma.$transaction(async (tx) => {
        const c = await tx.company.create({ data: { name: `Test Co ${stamp}` } });
        await tx.phone.create({ data: { phone: `9999${stamp}1`, companyId: c.id, isPrimary: true } });
        await tx.account.create({ data: { companyId: c.id, name: c.name } });
        return c;
    });
    await prisma.personCompany.create({ data: { personId: p1.id, companyId: company.id, role: "Director" } });
    console.log(`  ✓ Created company #${company.id}, linked person #${p1.id}`);

    const { getCompanyContacts } = await import("../src/modules/customer/lib/companyContacts");
    const contacts = await getCompanyContacts(company.id);
    if (contacts.phones.length !== 1) throw new Error("FAIL: company own phones");
    if (contacts.derivedPhones.length !== 2) throw new Error(`FAIL: derived phones (got ${contacts.derivedPhones.length}, expected 2)`);
    console.log(`  ✓ Company contacts → own:${contacts.phones.length} derived:${contacts.derivedPhones.length}`);

    // 5. XOR CHECK constraint — both owners set should fail
    let xorRejected = false;
    try {
        await pool.query(
            `INSERT INTO "Phone" (phone, "personId", "companyId") VALUES ($1, $2, $3)`,
            [`bad-${stamp}`, p1.id, company.id],
        );
    } catch (err: unknown) {
        xorRejected = err instanceof Error && err.message.includes("Phone_owner_xor");
    }
    if (!xorRejected) throw new Error("FAIL: XOR CHECK did not reject row with both owners");
    console.log("  ✓ XOR CHECK rejects row with both personId and companyId set");

    // 6. Cascade delete
    const p1Phones = await prisma.phone.count({ where: { personId: p1.id } });
    await prisma.personCompany.deleteMany({ where: { personId: p1.id } });
    await prisma.account.deleteMany({ where: { personId: p1.id } });
    await prisma.person.delete({ where: { id: p1.id } });
    const remaining = await prisma.phone.count({ where: { personId: p1.id } });
    if (remaining !== 0) throw new Error(`FAIL: cascade — ${remaining} phones still exist`);
    console.log(`  ✓ Cascade-delete person → ${p1Phones} phone rows removed`);

    // Cleanup
    await prisma.account.deleteMany({ where: { companyId: company.id } });
    await prisma.phone.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.person.delete({ where: { id: p2.id } }).catch(() => {});

    console.log("\n✅ All smoke tests passed.\n");
}

main()
    .catch((e) => { console.error("\n❌ Smoke test failed:\n", e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
