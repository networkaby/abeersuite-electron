/**
 * Targeted applier — turns the orphan "customer-support" pipeline (P2) into the
 * new front-desk **Help Desk** (flavour "help" → TicketHelp), WITHOUT a full seed.
 *
 * Mirrors the P2 block in `bootstrap-seed.ts`: pipeline P2 → name "help-desk",
 * label "Help Desk", entityType "help", stages Open (S10) → Reviewing (S11) →
 * Closed (S16). The old middle stages (S12–S15) are removed — but only when no
 * ticket still points at them (FK-safe), since a live DB could in theory carry
 * one. Idempotent: re-running just re-asserts the same rows.
 *
 * Run once after `prisma db push`:  `pnpm tsx prisma/seeds/apply-help-pipeline.ts`
 * (or a full `pnpm prisma db seed`, which re-asserts everything).
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const PIPELINE = {
    id: "P2",
    name: "help-desk",
    label: "Help Desk",
    description: "Front-desk enquiries & first response — price, availability, technical info, warranty help",
    color: "bg-teal-100 text-teal-700",
    order: 2,
    entityType: "help",
};

const STATUSES = [
    { id: "S10", label: "Open", color: "bg-gray-100 text-gray-600", order: 1, isEntryPoint: true, isTerminal: false, pipelineId: "P2" },
    { id: "S11", label: "Reviewing", color: "bg-yellow-100 text-yellow-700", order: 2, isEntryPoint: false, isTerminal: false, pipelineId: "P2" },
    { id: "S16", label: "Closed", color: "bg-gray-100 text-gray-400", order: 3, isEntryPoint: false, isTerminal: true, pipelineId: "P2" },
];

// Old customer-support stages no longer part of the Help Desk flow.
const RETIRED_STATUS_IDS = ["S12", "S13", "S14", "S15"];

async function main() {
    const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
        .replace(/[?&]sslmode=[^&]*/g, "")
        .replace(/[?&]$/, "");
    if (!rawUrl) throw new Error("No DIRECT_URL / DATABASE_URL in env");

    const pool = new Pool({
        connectionString: rawUrl,
        ssl: /@(localhost|127\.0\.0\.1)/.test(rawUrl) ? false : { rejectUnauthorized: false },
        max: 5,
    });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        // 1) Reflavour the pipeline row (id stays P2 so nothing that references it breaks).
        await prisma.pipeline.upsert({
            where: { id: PIPELINE.id },
            update: PIPELINE,
            create: { ...PIPELINE, isDefault: false, isActive: true },
        });

        // 2) Assert the three canonical stages.
        for (const s of STATUSES) {
            await prisma.ticketStatus.upsert({ where: { id: s.id }, update: s, create: s });
        }

        // 3) Drop the retired stages — only if no ticket still sits on them.
        const stuck = await prisma.ticket.findMany({
            where: { status: { in: RETIRED_STATUS_IDS } },
            select: { id: true, status: true },
        });
        if (stuck.length) {
            console.warn(
                `⚠ Kept ${stuck.length} old stage(s) — ticket(s) still on them: ` +
                stuck.map((t) => `#${t.id}→${t.status}`).join(", "),
            );
        } else {
            const { count } = await prisma.ticketStatus.deleteMany({ where: { id: { in: RETIRED_STATUS_IDS } } });
            console.log(`✓ Removed ${count} retired customer-support stage(s).`);
        }

        console.log(`✓ P2 is now "${PIPELINE.label}" (flavour ${PIPELINE.entityType}).`);
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
