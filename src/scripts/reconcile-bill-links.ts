// Settle the backlog: every POSTED receipt and payment that was never linked to
// the bills it actually paid.
//
// WHY THERE IS A BACKLOG
//
// A bill and the money that settles it are two separate vouchers, joined by a
// `VoucherAllocation` row. The party's ledger balance is right without it — both
// vouchers touch their account — but "which bills are still open" can only be
// answered by the link. Until now only the POS sale's collect-on-the-go surplus
// ever wrote one; the counter's receipt panel and the office Receipt/Payment form
// wrote none. So a customer who paid the same day still showed the bill as open,
// and, since the credit limit reads the same figure, could be refused a credit
// sale for money they had already handed over.
//
// The two doors now link as they save (`autoLinkSettlement`). This script is for
// everything entered before that.
//
// IT PLANS WITH THE VERY SAME CODE THAT WRITES
//
// `planAutoLink` is the planner the live doors use. A dry run built on a second,
// parallel implementation would prove nothing about what `--fix` will do, so
// there is deliberately no second implementation here — this script only prints
// what the real planner returns.
//
//   pnpm reconcile:bill-links               report only, writes NOTHING (exit 1 if work is pending)
//   pnpm reconcile:bill-links --fix         apply the links
//   pnpm reconcile:bill-links --receipts    receivable side only (customers)
//   pnpm reconcile:bill-links --payments    payable side only (suppliers)
//   pnpm reconcile:bill-links --party=7740  one party ledger
//   pnpm reconcile:bill-links --limit=25    stop after N vouchers (a first look)
//
// Safe on live in report mode: it opens a transaction only under `--fix`, and
// even then it writes nothing but link rows — never a GL line, an amount or a
// balance. A link is reversible from the bill-link popup at any time.
//
// BEFORE THE FIRST `--fix`, GET EVERY TILL PUSHED AND IDLE.
//
// `VoucherAllocation` syncs as an `append` table and the push upserts a row by
// its PRIMARY KEY, but the table also carries `@@unique([targetType, targetId,
// sourceType, sourceId])`. So if a counter has an unpushed link for the same
// (bill, settlement) pair sitting in its `_outbox` while this script writes the
// office's own row for that pair, the till's push takes its CREATE half and
// trips the unique constraint. That is a dead-lettered row, and one failing row
// stalls the whole 50-row drain for that till — not just this table.
//
// There is also NO live/demo guard in this script, or in any script in this
// folder: `DIRECT_URL` points at whatever the env files say, which on this
// machine is live Supabase. `--fix` writes to the real books on the first run,
// with no prompt.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { planAutoLink, type AutoLinkOutcome } from "@/modules/accountancy/lib/autoLinkPlan";
import { assertLinkPlan, createLink, BillLinkError } from "@/modules/accountancy/lib/billLink";

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(rawUrl);
const pool = new Pool({ connectionString: rawUrl, ssl: isLocalDb ? false : { rejectUnauthorized: false }, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ARGV = process.argv.slice(2);
const FIX = ARGV.includes("--fix");
const flag = (name: string): string | null => {
    const hit = ARGV.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};
const ONLY_PARTY = flag("party") ? Number(flag("party")) : null;
const LIMIT      = flag("limit") ? Number(flag("limit")) : null;
// Neither flag = both sides. Naming one narrows to it.
const WANT_RECEIPTS = ARGV.includes("--receipts") || !ARGV.includes("--payments");
const WANT_PAYMENTS = ARGV.includes("--payments") || !ARGV.includes("--receipts");

const inr = (n: number): string => `₹${n.toFixed(2)}`;
const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

type Candidate = {
    id:          number;
    type:        string;
    ref:         string;
    date:        Date;
    accountId:   number;
    accountName: string;
};

/** Every posted settlement that names a party, newest last so the listing reads
 *  like the day book. Vouchers with no party at all cannot be linked by anyone —
 *  they are counted and pointed at `pnpm repair:bill-links`, which is the script
 *  that stamps the party on. */
async function loadCandidates(): Promise<{ rows: Candidate[]; noParty: number }> {
    const types = [
        ...(WANT_RECEIPTS ? ["RECEIPT"] : []),
        ...(WANT_PAYMENTS ? ["PAYMENT"] : []),
    ];
    const vouchers = await prisma.universalVoucher.findMany({
        where: {
            type:      { in: types },
            status:    "POSTED",
            deletedAt: null,
            ...(ONLY_PARTY !== null ? { partyAccountId: ONLY_PARTY } : {}),
        },
        select:  { id: true, type: true, voucherNo: true, date: true, partyAccountId: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    const noParty = vouchers.filter((v) => v.partyAccountId === null).length;
    const withParty = vouchers.filter((v) => v.partyAccountId !== null);

    const accounts = await prisma.account.findMany({
        where:  { id: { in: [...new Set(withParty.map((v) => v.partyAccountId!))] } },
        select: { id: true, name: true },
    });
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));

    return {
        noParty,
        rows: withParty.map((v) => ({
            id:          v.id,
            type:        v.type,
            ref:         v.voucherNo ?? `UV-${v.id}`,
            date:        v.date,
            accountId:   v.partyAccountId!,
            accountName: nameById.get(v.partyAccountId!) ?? `account ${v.partyAccountId}`,
        })),
    };
}

/** Apply one voucher's planned links. Mirrors `autoLinkSettlement`'s write half,
 *  but re-plans inside the transaction so a plan made minutes ago on a big run
 *  cannot place money on a bill someone has settled in the meantime. */
async function applyOne(c: Candidate): Promise<AutoLinkOutcome> {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4711, ${c.accountId})`;
        const planned = await planAutoLink(tx, { voucherId: c.id, accountId: c.accountId });
        if (planned.links.length === 0) return planned;

        const plan = await assertLinkPlan(tx, {
            accountId: c.accountId,
            voucherId: c.id,
            links:     planned.links.map((l) => ({ voucherId: l.universalVoucherId, amount: l.amount })),
            mode:      "set",
        });
        for (const link of plan) {
            await createLink(tx, {
                targetId:  link.targetId,
                sourceId:  link.sourceId,
                amount:    link.amount,
                reference: c.ref,
                userId:    SYSTEM_USER_ID,
                mode:      "set",
            });
        }
        return planned;
    }, { timeout: 30_000, maxWait: 10_000 });
}

/** Link rows record who made them (`createdById` is required). A reconciliation
 *  run is not a person, so it is stamped to the lowest-numbered user — the same
 *  account that would otherwise have had to sit and click through the popup.
 *  `--actor=<id>` names someone else. Only needed under `--fix`; a dry run never
 *  writes a row, so it must not fail on an empty user table. */
let SYSTEM_USER_ID = 0;
async function resolveActor(): Promise<void> {
    const wanted = flag("actor") ? Number(flag("actor")) : null;
    const u = wanted !== null
        ? await prisma.user.findUnique({ where: { id: wanted }, select: { id: true } })
        : await prisma.user.findFirst({ select: { id: true }, orderBy: { id: "asc" } });
    if (!u) {
        if (FIX) throw new Error(wanted !== null ? `No user ${wanted} to stamp the links to.` : "No user to stamp the links to.");
        return;
    }
    SYSTEM_USER_ID = u.id;
}

async function main(): Promise<void> {
    const sides = WANT_RECEIPTS && WANT_PAYMENTS ? "receipts + payments"
        : WANT_RECEIPTS ? "receipts only" : "payments only";
    console.log(`\n=== bill-wise link reconciliation ===${FIX ? "" : "  (DRY RUN — nothing is written)"}`);
    console.log(`    ${sides}${ONLY_PARTY !== null ? ` · party ${ONLY_PARTY}` : ""}${LIMIT !== null ? ` · first ${LIMIT}` : ""}`);
    if (FIX) {
        const host = /@([^:/]+)/.exec(rawUrl)?.[1] ?? "unknown host";
        console.log(`    WRITING to ${host}`);
        console.log(`    Every till should be pushed and idle — see the note at the top of this file.`);
    }
    console.log("");

    await resolveActor();
    const { rows, noParty } = await loadCandidates();

    let scanned = 0, wouldLink = 0, linkedValue = 0, advanceValue = 0, skipped = 0;
    const skipReasons = new Map<string, number>();
    let lastParty = "";

    // Dry run only. Nothing is written, so the next plan would otherwise read the
    // same bill as still fully open and the listing would promise the same money
    // twice. Under `--fix` this stays empty: each link is committed before the
    // next voucher is planned, so the database itself carries the running total.
    const reserved = new Map<number, number>();

    for (const c of rows) {
        if (LIMIT !== null && scanned >= LIMIT) break;
        scanned += 1;

        const outcome = FIX
            ? await applyOne(c)
            : await planAutoLink(prisma, { voucherId: c.id, accountId: c.accountId, reserved });
        if (!FIX) {
            for (const l of outcome.links) {
                reserved.set(l.universalVoucherId, (reserved.get(l.universalVoucherId) ?? 0) + l.amount);
            }
        }

        if (outcome.links.length === 0) {
            skipped += 1;
            const why = outcome.skipped ?? "nothing to place";
            skipReasons.set(why, (skipReasons.get(why) ?? 0) + 1);
            continue;
        }

        // Party heading, printed once, only when that party actually has work.
        const heading = `${c.accountName}  (account ${c.accountId})`;
        if (heading !== lastParty) {
            console.log(`\n${heading}`);
            lastParty = heading;
        }

        wouldLink   += 1;
        linkedValue += outcome.linkedTotal;
        advanceValue += outcome.leftAsAdvance;

        const when = c.date.toISOString().slice(0, 10);
        console.log(`  ${pad(c.type, 7)} ${pad(c.ref, 8)} ${when}  settles ${lpad(inr(outcome.linkedTotal), 12)}`
            + (outcome.leftAsAdvance > 0.005 ? `   (${inr(outcome.leftAsAdvance)} stays as advance)` : ""));
        for (const l of outcome.links) {
            console.log(`      → ${pad(l.voucherType, 11)} ${pad(l.ref, 8)} due ${l.dueDate.slice(0, 10)}`
                + `  ${lpad(inr(l.amount), 11)} of ${inr(l.open)} open`);
        }
    }

    console.log(`\n${"─".repeat(64)}`);
    console.log(`  settlements examined     : ${scanned}`);
    console.log(`  would link               : ${wouldLink}`);
    console.log(`  money placed on bills    : ${inr(linkedValue)}`);
    console.log(`  left as party advances   : ${inr(advanceValue)}`);
    console.log(`  nothing to do            : ${skipped}`);
    for (const [why, n] of [...skipReasons.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${lpad(String(n), 4)} — ${why}`);
    }
    if (noParty > 0) {
        console.log(`\n  ${noParty} settlement(s) name no party at all, so nothing can be linked against them.`);
        console.log(`  Those are a different repair: run  pnpm repair:bill-links  first.`);
    }

    if (wouldLink === 0) {
        console.log(`\n✓ Nothing to reconcile.\n`);
        return;
    }
    if (FIX) {
        console.log(`\n✓ Linked ${wouldLink} settlement(s), placing ${inr(linkedValue)} on bills.\n`);
    } else {
        console.log(`\nDRY RUN — nothing was written. Re-run with --fix to apply.\n`);
        process.exitCode = 1;
    }
}

main()
    .catch((e: unknown) => {
        if (e instanceof BillLinkError) console.error(`Refused: ${e.message}`);
        else console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
