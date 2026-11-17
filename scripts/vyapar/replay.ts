/**
 * Replay the current financial year's Vyapar vouchers into AbeerSuite.
 *
 * Openings are already in place as at 31-Mar-2026 (see resolve.ts), so this posts
 * 1-Apr-2026 onward on top of them. Strictly in date order, then id, so stock
 * costing and allocations see the sequence the business actually lived.
 *
 * Dry-run by default. The dry run builds every voucher and reports what it would
 * write, including how far each one was from balancing before Round Off absorbed
 * the difference — which is the number that says whether the model is right.
 *
 *   pnpm vyapar:replay              # build everything, write nothing
 *   pnpm vyapar:replay -- --apply
 *   pnpm vyapar:replay -- --limit 50 --apply     # first 50, for a cautious first pass
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { FY_START, extractItems, extractParties } from "./extract";
import { buildMaps, type Maps } from "./mapping";
import { openVyb } from "./openVyb";
import { ROUNDING_TOLERANCE, buildSpec, type Ledgers, type VyaparTxn } from "./voucherSpec";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const inr = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");

/** Posts nothing to the books: documents, and void invoices. */
const POSTS_NOTHING = new Set([27, 30, 65]);
/** Types the spec builder handles. Anything else is reported and held back. */
const BUILDABLE = new Set([1, 2, 3, 4, 7, 21, 23, 29, 60, 61]);

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const limitArg = process.argv.indexOf("--limit");
    const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

    const url = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: local copy only, never live.");

    const { db, close } = openVyb(process.argv.find((a) => a.endsWith(".vyb")) ?? DEFAULT_VYB, join(tmpdir(), "vy-replay"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    const named = (sql: string) => {
        const m = new Map<number, string>();
        for (const r of db.prepare(sql).all() as Array<Record<string, unknown>>) m.set(Number(r.id), String(r.nm).trim());
        return m;
    };
    const { maps, unresolved } = await buildMaps(
        pool, extractParties(db), extractItems(db),
        named(`select paymentType_id id, paymentType_name nm from kb_paymentTypes`),
        named(`select name_id id, full_name nm from kb_names where name_type = 2`),
        named(`select name_id id, full_name nm from kb_names where name_type = 3`),
    );
    if (unresolved.length) {
        throw new Error(`${unresolved.length} mapping gap(s) — run vyapar:replay-check first:\n  ${unresolved.slice(0, 5).join("\n  ")}`);
    }

    const L: Ledgers = {
        sales: maps.ledger("Sales A/c"), salesReturns: maps.ledger("Sales Returns"),
        purchases: maps.ledger("Purchase A/c"), purchaseReturns: maps.ledger("Purchase Returns"),
        cgst: maps.ledger("CGST"), sgst: maps.ledger("SGST"), igst: maps.ledger("IGST"),
        roundOff: maps.ledger("Round Off"),
        discountAllowed: maps.ledger("Discount Allowed"),
        discountReceived: maps.ledger("Income Discount Received"),
        loyaltyRedeemed: maps.ledger("Loyalty Points Redeemed"),
        shippingIncome: maps.ledger("Shipping Income"),
        freightInward: maps.ledger("Exp Freight Inward (Purchase Courier)"),
        fixedAsset: maps.ledger("Office Equipment"),
        serviceExpense: maps.ledger("Repair & Maintenance"),
    };

    const branch = (await pool.query(`select id from "Branch" order by "createdAt" limit 1`)).rows[0];
    if (!branch) throw new Error("no Branch row — stock movements need one");
    const user = (await pool.query(`select id from "User" order by id limit 1`)).rows[0];
    if (!user) throw new Error("no User row — the engine stamps createdById");

    const txns = loadTxns(db, maps, limit);
    const contras = loadContras(db, maps);

    // Ledger ids by name, for the movements that live outside kb_transactions.
    const acct = new Map<string, number>();
    for (const r of (await pool.query(`select id, name from "Account"`)).rows) acct.set(String(r.name), Number(r.id));
    const V = JSON.parse(readFileSync("prisma/seeds/data/vyapar-opening-31mar2026.json", "utf8")) as OpeningFile;
    const extras = [...loadLoanTxns(db, maps, acct, V), ...loadChequeTransfers(db, maps, acct, V)];

    // ── Build every spec first ──────────────────────────────────────────────
    const built: Array<{ t: VyaparTxn; spec: ReturnType<typeof buildSpec> }> = [];
    const failures: string[] = [];
    const skipped = new Map<string, number>();
    let worstResidual = 0, worstId = 0, overTolerance = 0;

    for (const t of txns) {
        if (POSTS_NOTHING.has(t.type)) {
            skipped.set(t.type === 65 ? "cancelled sale" : "document (estimate/challan)",
                (skipped.get(t.type === 65 ? "cancelled sale" : "document (estimate/challan)") ?? 0) + 1);
            continue;
        }
        if (!BUILDABLE.has(t.type)) {
            skipped.set(`type ${t.type} — no builder`, (skipped.get(`type ${t.type} — no builder`) ?? 0) + 1);
            continue;
        }
        try {
            const spec = buildSpec(t, L, branch.id, { stockDate: t.date });
            // A voucher worth nothing produces no legs, and enginePost would return
            // quietly having written nothing — leaving "built 3,188, posted 3,187" and
            // no error to explain the gap. Three in this window are genuinely ₹0
            // (two sales and a receipt). Count them as skipped so the two numbers
            // always agree and a real loss could never hide in the difference.
            if (spec.spec.glLines.length === 0 && spec.spec.stockMoves.length === 0) {
                skipped.set("zero value — nothing to post", (skipped.get("zero value — nothing to post") ?? 0) + 1);
                continue;
            }
            if (Math.abs(spec.residual) > Math.abs(worstResidual)) { worstResidual = spec.residual; worstId = t.txnId; }
            if (Math.abs(spec.residual) > ROUNDING_TOLERANCE) overTolerance++;
            built.push({ t, spec });
        } catch (e) {
            failures.push(`txn ${t.txnId} (type ${t.type}): ${(e as Error).message}`);
        }
    }

    // Money that moved between our OWN ledgers — cash banked, bank to bank. These are
    // not transactions in Vyapar's sense and are in none of the tables the loop above
    // reads, so the first version of this replay simply lost them: ₹22,51,824 of till
    // takings never left Petty Cash, and every bank was short by what it was paid.
    // Nothing caught it, because a contra moves money without touching a party or a
    // product, and reconcile.ts only checked parties and products.
    for (const c of contras) {
        built.push({
            t: { date: c.date, partyAccountId: null, txnId: c.id } as unknown as VyaparTxn,
            spec: {
                spec: {
                    type: "CONTRA", date: c.date, reference: undefined,
                    narration: c.note || null, description: `CONTRA ${c.id}`,
                    glLines: [
                        { accountId: c.toAccountId, type: "DEBIT", amount: c.amount.toFixed(2) },
                        { accountId: c.fromAccountId, type: "CREDIT", amount: c.amount.toFixed(2) },
                    ],
                    stockMoves: [],
                },
                residual: 0,
            } as unknown as ReturnType<typeof buildSpec>,
        });
    }

    // Loan repayments and cheque deposits. Vyapar keeps both outside kb_transactions
    // — loans in `loan_transactions`, cheque banking in `kb_cheque_status` — so the
    // first replay lost them entirely: three loan balances never moved, ₹49,884 of
    // interest never reached the P&L, and ₹31,100 of banked cheques stayed stuck in
    // Cheques in Hand. Each also moves a BANK, which is why Bandhan 0020 was wrong in
    // sympathy. Found by checking against the owner's own Balance Sheet exports, not
    // by anything in this repo.
    for (const e of extras) {
        built.push({
            t: { date: e.date, partyAccountId: null, txnId: e.id } as unknown as VyaparTxn,
            spec: {
                spec: {
                    type: e.type, date: e.date, reference: undefined,
                    narration: e.note || null, description: `${e.type} ${e.id}`,
                    glLines: e.lines, stockMoves: [],
                },
                residual: 0,
            } as unknown as ReturnType<typeof buildSpec>,
        });
    }

    console.log(`\nbuilt ${built.length} voucher(s) from ${txns.length} in the window` +
        ` (incl. ${contras.length} contra + ${extras.length} loan/cheque movement(s))`);
    for (const [k, n] of skipped) console.log(`  ${String(n).padStart(5)}  skipped — ${k}`);
    if (failures.length) {
        console.log(`\n⚠ ${failures.length} could not be built:`);
        for (const f of failures.slice(0, 10)) console.log(`    ${f}`);
    }
    console.log(`\n  worst rounding residual ${inr(worstResidual)} (txn ${worstId})` +
        ` · ${overTolerance} voucher(s) above the ₹${ROUNDING_TOLERANCE} tolerance`);

    const drTotal = built.reduce((s, b) => s + b.spec.spec.glLines.filter((l) => l.type === "DEBIT").reduce((a, l) => a + Number(l.amount), 0), 0);
    const stockRows = built.reduce((s, b) => s + b.spec.spec.stockMoves.length, 0);
    console.log(`  ${inr(drTotal)} of debits · ${stockRows} stock movement(s)`);

    // A voucher that misses balance by more than rounding is a modelling error, and
    // Round Off would bury it. Refuse the whole run rather than post one.
    if (overTolerance > 0 || failures.length > 0) {
        console.log(`\nREFUSING to apply — fix the above first.\n`);
        await pool.end(); close();
        process.exit(1);
    }

    if (!apply) {
        console.log(`\nNothing written. Re-run with --apply.\n`);
        await pool.end(); close();
        return;
    }

    // ── Refuse to post on top of a previous run ─────────────────────────────
    //
    // The replay is all-or-nothing over the window and carries no per-voucher source
    // id, so a second run would post all 3,188 again rather than recognise them.
    // Every other duplication in this migration came from a record that could not be
    // matched; this one would come from not looking at all. Re-running means purging
    // the window first — `pnpm seed:purge-vouchers` keeps opening balances and masters
    // and clears exactly what this writes.
    const already = await pool.query(
        `select count(*)::int n from "UniversalVoucher" where date >= $1::date`, [FY_START],
    );
    if (Number(already.rows[0].n) > 0) {
        console.log(`\nREFUSING: ${already.rows[0].n} voucher(s) already exist on or after ${FY_START}.` +
            `\nThis script cannot tell them from the ones it is about to write, so re-running would` +
            `\ndouble-post. Clear them first:  pnpm seed:purge-vouchers\n`);
        await pool.end(); close();
        process.exit(1);
    }

    // ── Post ────────────────────────────────────────────────────────────────
    const { prisma } = await import("@/shared/lib/prisma/prismaClient");
    const { enginePost } = await import("@/modules/accountancy/lib/transactionEngine");

    let done = 0;
    const started = Date.now();
    // Chunked so a failure costs one chunk, not the whole run, and so progress is
    // visible on a 3,000-voucher pass.
    const CHUNK = 50;
    for (let i = 0; i < built.length; i += CHUNK) {
        const slice = built.slice(i, i + CHUNK);
        await prisma.$transaction(async (tx) => {
            for (const b of slice) {
                const res = await enginePost(tx, b.spec.spec, user.id, { branchId: branch.id, postedAt: b.t.date });
                // enginePost does not carry the party onto the spine: TransactionSpec has
                // no such field, because the app normally creates a DRAFT spine holding
                // the party and then posts into it, while this creates and posts in one
                // step. Left unset, every voucher's Party column in the Day Book is blank
                // and party filters find nothing — the ledgers are still right, since the
                // GL lines name the account, but the denormalised pointer the UI reads is
                // empty. Set it here rather than widen shared engine code for a migration.
                if (b.t.partyAccountId != null && res.universalVoucherId != null) {
                    await tx.universalVoucher.update({
                        where: { id: res.universalVoucherId },
                        data: { partyAccountId: b.t.partyAccountId },
                    });
                }
            }
        }, { timeout: 120_000, maxWait: 30_000 });
        done += slice.length;
        if (done % 500 === 0 || done === built.length) {
            const rate = done / ((Date.now() - started) / 1000);
            console.log(`  ${String(done).padStart(5)} / ${built.length}   ${rate.toFixed(0)}/s`);
        }
    }
    console.log(`\nposted ${done} voucher(s) in ${((Date.now() - started) / 1000).toFixed(0)}s`);

    // Rebuild the caches the engine maintains incrementally. Skipping this let the
    // Balance Sheet show stock at ₹68,427 against a true ₹8,38,393 — purge-vouchers
    // zeroes InvProduct.stock, the replay increments it, and the two drift. The
    // reconcile never caught it because it sums InvStockLedger directly, so the only
    // wrong number was the one on the screen. Done here rather than left as a step
    // someone has to remember, because for weeks nobody did.
    const { spawnSync } = await import("node:child_process");
    for (const [label, script, flag] of [
        ["stock caches", "src/scripts/recompute-caches.ts", "--fix"],
        ["ledger balances", "prisma/seeds/recompute-balances.ts", "--apply"],
    ] as const) {
        const r = spawnSync("npx", ["tsx", "--tsconfig", "scripts/vyapar/tsconfig.json", script, flag],
            { stdio: "pipe", shell: process.platform === "win32", encoding: "utf8" });
        const tail = String(r.stdout ?? "").trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
        console.log(`  ${label}: ${r.status === 0 ? tail : `FAILED — run ${script} ${flag} by hand`}`);
    }
    console.log("");

    await pool.end();
    close();
}

/** Pull the window out of Vyapar and shape it for the spec builder. */
function loadTxns(db: ReturnType<typeof openVyb>["db"], maps: Maps, limit: number): VyaparTxn[] {
    const lines = new Map<number, VyaparTxn["lines"]>();
    for (const r of db.prepare(`
        select l.lineitem_txn_id tid, l.item_id iid, coalesce(l.quantity, 0) qty,
               coalesce(l.total_amount, 0) total, coalesce(l.lineitem_tax_amount, 0) tax,
               coalesce(c.tax_code_name, '') code
        from kb_lineitems l
        join kb_transactions t on t.txn_id = l.lineitem_txn_id
        left join kb_tax_code c on c.tax_code_id = l.lineitem_tax_id
        where t.txn_date >= '${FY_START}'
    `).all() as Array<Record<string, unknown>>) {
        const tid = Number(r.tid);
        const productId = maps.product.get(Number(r.iid));
        if (productId == null) continue;              // replay-check guarantees this cannot happen
        lines.set(tid, [...(lines.get(tid) ?? []), {
            productId, qty: Number(r.qty), total: Number(r.total), tax: Number(r.tax),
            igst: String(r.code).toUpperCase().startsWith("IGST"),
        }]);
    }

    const tenders = new Map<number, VyaparTxn["tenders"]>();
    for (const r of db.prepare(`
        select m.txn_id tid, m.payment_id pid, coalesce(m.amount, 0) amt
        from txn_payment_mapping m join kb_transactions t on t.txn_id = m.txn_id
        where t.txn_date >= '${FY_START}'
    `).all() as Array<Record<string, unknown>>) {
        const accountId = maps.payment.get(Number(r.pid));
        if (accountId == null) continue;
        const tid = Number(r.tid);
        tenders.set(tid, [...(tenders.get(tid) ?? []), { accountId, amount: Number(r.amt) }]);
    }

    const out: VyaparTxn[] = [];
    for (const r of db.prepare(`
        select txn_id, txn_type ty, txn_date dt, txn_ref_number_char ref, txn_description descr,
               txn_name_id nid, txn_category_id cat,
               coalesce(txn_cash_amount, 0) cash, coalesce(txn_balance_amount, 0) bal,
               coalesce(txn_discount_amount, 0) disc, coalesce(txn_round_off_amount, 0) roff,
               coalesce(txn_ac1_amount, 0) + coalesce(txn_ac2_amount, 0) + coalesce(txn_ac3_amount, 0) charges,
               coalesce(loyalty_amount, 0) loy
        from kb_transactions where txn_date >= '${FY_START}'
        order by txn_date, txn_id
    `).all() as Array<Record<string, unknown>>) {
        if (out.length >= limit) break;
        const ty = Number(r.ty);
        const nid = r.nid == null ? null : Number(r.nid);
        out.push({
            txnId: Number(r.txn_id), type: ty,
            date: new Date(String(r.dt).slice(0, 10) + "T00:00:00Z"),
            ref: (r.ref as string) || null,
            description: (r.descr as string) || null,
            // Type 29 points txn_name_id at an income head, not a customer.
            partyAccountId: ty === 29 ? null : (nid != null ? maps.party.get(nid)?.accountId ?? null : null),
            headAccountId: ty === 7 ? (r.cat != null ? maps.expenseHead.get(Number(r.cat)) ?? null : null)
                : ty === 29 ? (nid != null ? maps.incomeHead.get(nid) ?? null : null)
                    : null,
            cash: Number(r.cash), balance: Number(r.bal),
            discount: Number(r.disc), roundOff: Number(r.roff),
            charges: Number(r.charges), loyalty: Number(r.loy),
            tenders: tenders.get(Number(r.txn_id)) ?? [],
            lines: lines.get(Number(r.txn_id)) ?? [],
        });
    }
    return out;
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });

/**
 * Transfers between our own money ledgers, from `kb_bank_adjustments`.
 *
 * Vyapar keeps these apart from `kb_transactions` because no party is involved —
 * cash banked at the end of a day, a sweep from one account to another. They still
 * move real money, so without them the till never empties and the banks never fill.
 * Only two of the five adjustment types occur in this window; the rest (balance
 * corrections, FD withdrawals, card payments) are all pre-2026 and would need a
 * second ledger each, so they are reported rather than guessed at.
 */
function loadContras(db: ReturnType<typeof openVyb>["db"], maps: Maps): Array<{
    id: number; date: Date; amount: number; fromAccountId: number; toAccountId: number; note: string;
}> {
    const CASH_ID = 1;               // kb_paymentTypes id for plain "Cash"
    const BANKED = 14, TRANSFER = 25; // cash → bank, and ledger → ledger
    const out: Array<{ id: number; date: Date; amount: number; fromAccountId: number; toAccountId: number; note: string }> = [];
    const skipped = new Map<number, number>();

    for (const r of db.prepare(`
        select bank_adj_id id, bank_adj_type ty, bank_adj_bank_id b, bank_adj_to_bank_id tb,
               bank_adj_amount amt, bank_adj_date dt, bank_adj_description note
        from kb_bank_adjustments where date(bank_adj_date) >= ? order by bank_adj_date, bank_adj_id
    `).all(FY_START) as Array<Record<string, unknown>>) {
        const ty = Number(r.ty);
        const fromId = ty === BANKED ? CASH_ID : Number(r.b);
        const toId = ty === BANKED ? Number(r.b) : Number(r.tb);
        if (ty !== BANKED && ty !== TRANSFER) { skipped.set(ty, (skipped.get(ty) ?? 0) + 1); continue; }

        const from = maps.payment.get(fromId), to = maps.payment.get(toId);
        // A ledger the owner chose to drop is still a real place money went. Posting
        // only one leg would silently unbalance the books, so the whole transfer is
        // held back and reported instead.
        if (from == null || to == null) { skipped.set(-ty, (skipped.get(-ty) ?? 0) + 1); continue; }

        out.push({
            id: Number(r.id), date: new Date(String(r.dt).slice(0, 10) + "T00:00:00Z"),
            amount: Number(r.amt), fromAccountId: from, toAccountId: to, note: String(r.note ?? "").trim(),
        });
    }
    for (const [ty, n] of skipped) {
        console.log(ty > 0
            ? `  ${String(n).padStart(5)}  contra skipped — adjustment type ${ty} has no builder`
            : `  ${String(n).padStart(5)}  contra skipped — type ${-ty} names a ledger that was not migrated`);
    }
    return out;
}

/** The 31-Mar opening file also names the loan and cheque ledgers these need. */
type OpeningFile = {
    loans: Array<{ vyapar: string; account: string | null; interestLedger: string }>;
    chequeClearing: { account: string };
};
type Extra = { id: number; date: Date; type: "PAYMENT" | "RECEIPT" | "CONTRA" | "JOURNAL";
               note: string; lines: Array<{ accountId: number; type: "DEBIT" | "CREDIT"; amount: string }> };

const ledgerId = (acct: Map<string, number>, name: string): number => {
    const id = acct.get(name);
    if (id == null) throw new Error(`ledger "${name}" is missing — run pnpm vyapar:payments -- --apply first`);
    return id;
};

/**
 * Loan repayments and drawdowns, from `loan_transactions`.
 *
 * Type 43 is an instalment — principal reduces the loan, interest is an expense, and
 * both leave the bank named by `payment_acc_id`. Type 42 is money received into that
 * bank against the loan. The other types (40 loan taken, 44 opening) are all pre-2026
 * and are already inside the 31-Mar opening, so replaying them would double-count.
 */
function loadLoanTxns(db: ReturnType<typeof openVyb>["db"], maps: Maps, acct: Map<string, number>, V: OpeningFile): Extra[] {
    const EMI = 43, RECEIVED = 42;
    const byVyapar = new Map(V.loans.map((l) => [l.vyapar, l]));
    const out: Extra[] = [];
    const skipped = new Map<string, number>();

    for (const r of db.prepare(`
        select t.loan_txn_id id, a.loan_account_name nm, t.loan_txn_type ty,
               t.principal_amount p, t.interest_amount i, t.payment_acc_id pay,
               t.txn_date dt, t.txn_desc note
        from loan_transactions t join loan_accounts a on a.loan_account_id = t.loan_account_id
        where date(t.txn_date) >= ? order by t.txn_date, t.loan_txn_id
    `).all(FY_START) as Array<Record<string, unknown>>) {
        const ty = Number(r.ty);
        if (ty !== EMI && ty !== RECEIVED) { skipped.set(`type ${ty}`, (skipped.get(`type ${ty}`) ?? 0) + 1); continue; }

        const loan = byVyapar.get(String(r.nm).trim());
        const bank = maps.payment.get(Number(r.pay));
        if (!loan?.account || bank == null) { skipped.set("unmapped loan or bank", (skipped.get("unmapped loan or bank") ?? 0) + 1); continue; }

        const principal = Number(r.p) || 0, interest = Number(r.i) || 0;
        if (principal + interest <= 0) continue;
        const date = new Date(String(r.dt).slice(0, 10) + "T00:00:00Z");
        const note = String(r.note ?? "").trim() || `${r.nm} ${ty === EMI ? "instalment" : "drawdown"}`;
        const lines: Extra["lines"] = [];

        if (ty === RECEIVED) {
            lines.push({ accountId: bank, type: "DEBIT", amount: (principal + interest).toFixed(2) });
            lines.push({ accountId: ledgerId(acct, loan.account), type: "CREDIT", amount: (principal + interest).toFixed(2) });
        } else {
            if (principal > 0) lines.push({ accountId: ledgerId(acct, loan.account), type: "DEBIT", amount: principal.toFixed(2) });
            if (interest > 0) lines.push({ accountId: ledgerId(acct, loan.interestLedger), type: "DEBIT", amount: interest.toFixed(2) });
            lines.push({ accountId: bank, type: "CREDIT", amount: (principal + interest).toFixed(2) });
        }
        out.push({ id: Number(r.id), date, type: ty === RECEIVED ? "RECEIPT" : "PAYMENT", note, lines });
    }
    for (const [k, n] of skipped) console.log(`  ${String(n).padStart(5)}  loan txn skipped — ${k}`);
    return out;
}

/**
 * Cheques banked, from `kb_cheque_status`.
 *
 * A cheque taken in tender debits Cheques in Hand; it stays there until it clears.
 * Vyapar shows that ledger at nil on both 31-Mar and 11-Sep because every cheque was
 * deposited — we posted the receipt and never the deposit, so ₹31,100 sat stranded and
 * the receiving bank was short by the same amount. `transferred_To_Account` is a
 * kb_paymentTypes id, so it resolves through the same map as any tender leg.
 */
function loadChequeTransfers(db: ReturnType<typeof openVyb>["db"], maps: Maps, acct: Map<string, number>, V: OpeningFile): Extra[] {
    const DEPOSITED = 1;
    const held = ledgerId(acct, V.chequeClearing.account);
    const out: Extra[] = [];

    for (const r of db.prepare(`
        select c.cheque_id id, c.transferred_To_Account pay, c.cheque_transfer_date dt, t.txn_cash_amount amt
        from kb_cheque_status c join kb_transactions t on t.txn_id = c.cheque_txn_id
        where c.cheque_current_status = ? and date(c.cheque_transfer_date) >= ?
        order by c.cheque_transfer_date, c.cheque_id
    `).all(DEPOSITED, FY_START) as Array<Record<string, unknown>>) {
        const bank = maps.payment.get(Number(r.pay));
        const amt = Number(r.amt) || 0;
        if (bank == null || amt <= 0) continue;
        out.push({
            id: Number(r.id), date: new Date(String(r.dt).slice(0, 10) + "T00:00:00Z"),
            type: "CONTRA", note: "cheque banked",
            lines: [
                { accountId: bank, type: "DEBIT", amount: amt.toFixed(2) },
                { accountId: held, type: "CREDIT", amount: amt.toFixed(2) },
            ],
        });
    }
    return out;
}
