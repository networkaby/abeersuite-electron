/**
 * Propose a mapping from Vyapar's expense heads and payment accounts onto the
 * chart of accounts AbeerSuite already has, and write it where the resolver and
 * a human can both read it.
 *
 * This is the one part of the migration that genuinely needs judgement. Vyapar's
 * heads carry a manual sort hack ("1 Electricity Bill", "z Udaan Capital",
 * "0 SBI CC A/c"), and the ledgers here were deliberately renamed to something
 * cleaner — so a plain name match finds almost nothing. But the renaming was not
 * random, and two patterns make most of it recoverable:
 *
 *   • the old Vyapar wording is often kept verbatim in parentheses —
 *     "Printing & Stationery (Office Exp/Packaging Materials)"
 *   • one ledger per person in the Salary group — "Aka Salary" for "Salary Aka"
 *
 * So this scores every pair on shared words and proposes the best fit, then
 * reports its own confidence honestly. What it cannot place is NOT guessed: it
 * is marked for quarantine, to be created with a `vyapar-` prefix in an isolated
 * group where it is obvious and easy to re-home by hand.
 *
 * Output is a JSON file, because the proposal is meant to be EDITED. Nothing
 * reads the scores at import time — only the decisions.
 *
 *   pnpm vyapar:ledger-map              # propose, print, write the JSON
 *   pnpm vyapar:ledger-map -- --check   # re-read the JSON and report gaps only
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { extractExpenseHeads, extractIncomeHeads, extractPaymentLedgers } from "./extract";
import { openVyb } from "./openVyb";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VYB = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
const OUT = "prisma/seeds/data/vyapar-ledger-map.json";

/** Books begin here — only this FY is replayed, so only this FY decides relevance. */
const FY_START = "2026-04-01";

/**
 * The owner's decisions, which override scoring entirely.
 *
 * Word-overlap got the obvious matches; these are the ones that needed someone
 * who knows the business. Two were scoring failures worth recording: "Salary
 * Prokash" lost to a spelling difference against the "Prakash Salary" ledger, and
 * "Bank Charges Current & SB" was killed by our own "bank" stop-word — added to
 * stop wrong-bank matches, it took a right one with it.
 *
 * A `null` here means the owner deliberately chose NOT to migrate the head.
 */
const DECISIONS: Record<string, string | null> = {
    // ── payment ───────────────────────────────────────────────────────────
    "Cash": "Petty Cash",
    "Cheque": "Cheques in Hand",
    "3 Routing A/c": "3 Routing A/c",
    "Amazon Pay 5009": "Amazon Pay 5009",
    "Amazon Pay Balance Income": "Amazon Pay Balance Income",
    "UNI BB Visa 2797": "UNI BB Visa 2797",
    // ── other income (name_type = 3) ──────────────────────────────────────
    // Type-29 vouchers point at these instead of a customer, so they need ledgers
    // like any expense head does.
    "Bank Interest Income": "Interest Received",
    "GST Invoice Income/Any Other Income": "income Other Revenue",
    "Vyapar Commission": "Income Commission Received",
    "Purona Baki": "income Other Revenue",
    // ── expense ───────────────────────────────────────────────────────────
    "Salary Prokash": "Prakash Salary",
    "Bank Charges Current & SB": "Exp Bank Charges",
    "3 GST EXP": "Tax Payable",
    "1 Donations/Chanda": "Exp Tea & Donation (Counter)",
    "Gust / Customer Refreshment": "Exp Tea & Donation (Counter)",
    "Online Promotion exp": "Exp Advertisement",
    "Travel Allowance": "Travelling Expenses",
    "3 ITR Exp /CA Exp / Legal Exp": "Exp Audit Fees",
    "exp customer delivery": "Freight Charges (Courier Charges)",
};

/**
 * Ledgers the owner asked to CREATE rather than match — they have no counterpart
 * in the chart of accounts yet. Group matters: it decides where each lands on the
 * balance sheet, and getting it wrong is the kind of error that only shows up in
 * a year-end review.
 */
const CREATE_UNDER: Record<string, string> = {
    "Cheques in Hand": "Current Assets",
    "3 Routing A/c": "Bank Accounts",
    "Amazon Pay 5009": "Wallets",
    "Amazon Pay Balance Income": "Wallets",
    "UNI BB Visa 2797": "Credit Card",
};

/** Words that carry no signal — they appear on both sides and only add noise. */
const STOP = new Set(["a", "ac", "acc", "account", "amp", "and", "charges", "charge",
    "exp", "expense", "expenses", "the", "of", "for", "on", "to", "in", "&",
    // "bank" and "card" appear on both sides of nearly every payment ledger, so
    // they match everything and distinguish nothing: "z HDFC BANK" scored against
    // "Bandhan Bank Loan 0193" on that word alone. What actually identifies a bank
    // ledger is its name and its last four digits, both of which survive here.
    "bank", "card", "credit"]);

/**
 * Reduce a ledger name to the words that identify it.
 * Drops Vyapar's leading sort character ("1 ", "z ", "0 "), keeps the contents of
 * parentheses (that is where the old Vyapar wording was preserved), and splits on
 * anything that is not a letter or digit — so "SBI CC A/c 873" and "0 SBI CC A/c"
 * both reduce to roughly {sbi, cc, 873}.
 */
function tokens(name: string): Set<string> {
    const cleaned = name
        .replace(/^\s*[0-9a-zA-Z]\s+(?=[A-Za-z])/, "")   // leading sort character
        .replace(/[()]/g, " ")
        .toLowerCase();
    return new Set(
        cleaned.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)),
    );
}

/** Overlap coefficient — how much of the SMALLER name the two share. Kinder than
 *  Jaccard to "Electricity Charges" vs "1 Electricity Bill", where one side is
 *  longer by design. A shared digit run (an account's last four) counts double,
 *  because "4022" matching is far stronger evidence than "bank" matching. */
function score(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const w of a) if (b.has(w)) hits += /^\d{3,}$/.test(w) ? 2 : 1;
    return hits / Math.min(a.size, b.size);
}

/**
 * Which account groups a Vyapar head could plausibly belong to.
 *
 * Word overlap alone produces confident nonsense: "z HDFC BANK" (a bank account)
 * scored highest against "Exp Bank Charges", and "exp customer delivery" landed on
 * a customer in Sundry Debtors. Both share a word; neither is a sane home. A head
 * that pays money out is an expense or an asset, never a debtor — so a match into
 * the wrong family is rejected outright rather than merely scored lower, and the
 * head goes to quarantine where a human will see it.
 */
const PLAUSIBLE: Record<"expense" | "income" | "payment", readonly string[]> = {
    expense: [
        "Indirect Expenses", "Direct Expenses", "Salary", "Misc. Expenses (Asset)",
        "Fixed Assets", "Duties & Taxes", "Purchase Accounts", "Provisions",
        "Loans (Liability)", "Secured Loans", "Unsecured Loans", "Current Liabilities",
    ],
    income: ["Indirect Incomes", "Direct Incomes", "Current Liabilities"],
    payment: [
        "Cash-in-Hand", "Bank Accounts", "Bank OD A/c", "Credit Card", "Wallets",
        "Payment Gateway", "BNPL A/c", "Loans (Liability)", "Secured Loans",
        "Unsecured Loans", "Current Assets", "Current Liabilities",
    ],
};

type Decision = {
    vyapar: string;
    kind: "expense" | "income" | "payment";
    /** Rupees that moved through this head over the WHOLE file — three years. */
    amount: number;
    /** Rupees and vouchers inside the replayed window only — what actually decides relevance. */
    fyAmount: number;
    fyTxns: number;
    /**
     * map    — point it at an existing ledger
     * create — mint a new ledger (see `group`)
     * drop   — do not migrate: nothing moved this FY and nothing is owed
     */
    action: "map" | "create" | "drop";
    account: string | null;
    group: string | null;
    confidence: "high" | "likely" | "weak" | "none" | "owner";
    alternatives?: string[];
};

async function main(): Promise<void> {
    const check = process.argv.includes("--check");
    const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("REFUSING: run this against the local copy, not live.");

    const { db, close } = openVyb(process.argv[2]?.endsWith(".vyb") ? process.argv[2] : DEFAULT_VYB, join(tmpdir(), "vy-ledgermap"));
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 });

    // Only real ledgers — the 3,543 party accounts are not expense heads.
    const ledgers = (await pool.query(`
        select a.name, coalesce(g.name, '(no group)') gname
        from "Account" a left join "AccountGroup" g on g.id = a."groupId"
        where a."personId" is null and a."companyId" is null
        order by a.name
    `)).rows as Array<{ name: string; gname: string }>;
    const indexed = ledgers.map((l) => ({ ...l, tok: tokens(l.name) }));

    // Activity INSIDE the replayed window. A head that saw nothing this FY carries
    // nothing into the new books, so it is not worth a ledger — that is the owner's
    // drop rule, and it removes 25 of the 60 heads outright.
    const fyExpense = new Map<string, { n: number; amt: number }>();
    for (const r of db.prepare(`
        select n.full_name nm, count(*) n,
               round(coalesce(sum(t.txn_cash_amount + t.txn_balance_amount), 0), 2) amt
        from kb_names n join kb_transactions t on t.txn_category_id = n.name_id
        where n.name_type = 2 and t.txn_date >= '${FY_START}'
        group by n.name_id
    `).all() as Array<Record<string, unknown>>) {
        fyExpense.set(String(r.nm).trim(), { n: Number(r.n), amt: Number(r.amt) });
    }

    // Income heads attach through txn_name_id, not txn_category_id.
    const fyIncome = new Map<string, { n: number; amt: number }>();
    for (const r of db.prepare(`
        select n.full_name nm, count(*) n,
               round(coalesce(sum(t.txn_cash_amount + t.txn_balance_amount), 0), 2) amt
        from kb_names n join kb_transactions t on t.txn_name_id = n.name_id
        where n.name_type = 3 and t.txn_date >= '${FY_START}'
        group by n.name_id
    `).all() as Array<Record<string, unknown>>) {
        fyIncome.set(String(r.nm).trim(), { n: Number(r.n), amt: Number(r.amt) });
    }

    const fyPayment = new Map<string, { n: number; amt: number }>();
    for (const r of db.prepare(`
        select p.paymentType_name nm, count(*) n, round(coalesce(sum(m.amount), 0), 2) amt
        from kb_paymentTypes p
        join txn_payment_mapping m on m.payment_id = p.paymentType_id
        join kb_transactions t on t.txn_id = m.txn_id
        where t.txn_date >= '${FY_START}'
        group by p.paymentType_id
    `).all() as Array<Record<string, unknown>>) {
        fyPayment.set(String(r.nm).trim(), { n: Number(r.n), amt: Number(r.amt) });
    }

    const sources: Array<{ kind: Decision["kind"]; name: string; amount: number }> = [
        ...extractExpenseHeads(db).map((h) => ({ kind: "expense" as const, name: h.name, amount: h.total })),
        ...extractIncomeHeads(db).map((h) => ({ kind: "income" as const, name: h.name, amount: h.total })),
        ...extractPaymentLedgers(db).filter((p) => p.used > 0)
            .map((p) => ({ kind: "payment" as const, name: p.name, amount: p.total })),
    ];

    const prior: Record<string, Decision> = existsSync(OUT)
        ? Object.fromEntries((JSON.parse(readFileSync(OUT, "utf8")).mappings as Decision[]).map((d) => [d.vyapar, d]))
        : {};
    void prior;

    const decisions: Decision[] = sources.map((s) => {
        const fy = (s.kind === "expense" ? fyExpense : s.kind === "income" ? fyIncome : fyPayment)
            .get(s.name) ?? { n: 0, amt: 0 };
        const base = { vyapar: s.name, kind: s.kind, amount: s.amount, fyAmount: fy.amt, fyTxns: fy.n };

        // ── The owner's drop rule: nothing moved this FY AND nothing is owed, so
        // there is nothing to carry into the new books.
        //
        // Only the activity half is tested. The balance half is checked, but not
        // here: deriving a Vyapar bank balance means combining four tables
        // (txn_payment_mapping, kb_bank_adjustments, loan_transactions and the
        // opening balance) through undocumented type codes, and a first attempt at
        // it was confidently wrong — it put ₹1.43cr of cash on hand because bank
        // deposits were not being taken off. Rather than trust that, the nine idle
        // ledgers were checked against Vyapar's own Banks screen: every one shows
        // ₹0. Activity alone therefore gives the identical answer here, without
        // resting on a derivation we know to be unreliable. If a future file has an
        // idle-but-funded ledger, it belongs in DECISIONS above.
        if (fy.n === 0) {
            return { ...base, action: "drop" as const, account: null, group: null, confidence: "owner" as const };
        }

        // ── An explicit decision beats every heuristic.
        const chosen = DECISIONS[s.name];
        if (chosen !== undefined) {
            if (chosen === null) {
                return { ...base, action: "drop" as const, account: null, group: null, confidence: "owner" as const };
            }
            const existing = indexed.find((l) => l.name === chosen);
            return {
                ...base,
                action: existing ? ("map" as const) : ("create" as const),
                account: chosen,
                group: existing ? existing.gname : (CREATE_UNDER[chosen] ?? null),
                confidence: "owner" as const,
            };
        }

        const tok = tokens(s.name);
        const ok = PLAUSIBLE[s.kind];
        const ranked = indexed
            .map((l) => ({ l, sc: score(tok, l.tok) }))
            .filter((x) => x.sc > 0 && ok.includes(x.l.gname))
            .sort((a, b) => b.sc - a.sc);

        const best = ranked[0];
        let confidence: Decision["confidence"] =
            !best ? "none" : best.sc >= 0.8 ? "high" : best.sc >= 0.5 ? "likely" : "weak";

        // A tie inside one group means the words did not actually distinguish the
        // ledgers — "Cash" scores the same against every counter till, and picking
        // one would silently park ₹1.68cr on a single cashier. Ambiguity like that
        // is a question for a human, not a coin toss.
        if (best && ranked.length > 1 && ranked[1].sc === best.sc && ranked[1].l.gname === best.l.gname) {
            confidence = "weak";
        }

        const adopt = confidence === "high" || confidence === "likely";
        return {
            ...base,
            // Only a confident match is adopted. "weak" keeps its candidates visible
            // as alternatives but maps to nothing — an unmapped head is obvious and a
            // mis-mapped one is invisible, so quarantine is the safe default.
            action: adopt ? ("map" as const) : ("create" as const),
            account: adopt ? best.l.name : null,
            group: adopt ? best.l.gname : null,
            confidence,
            ...(ranked.length && confidence !== "high"
                ? { alternatives: ranked.slice(0, 3).map((x) => `${x.l.name}  [${x.l.gname}]`) }
                : {}),
        };
    });

    // ── Report ──────────────────────────────────────────────────────────────
    const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
    const MARK = { owner: "●", high: "✓", likely: "~", weak: "?", none: "✗" } as const;

    for (const kind of ["payment", "expense", "income"] as const) {
        const rows = decisions.filter((d) => d.kind === kind).sort((a, b) => b.fyAmount - a.fyAmount);
        for (const action of ["map", "create", "drop"] as const) {
            const set = rows.filter((d) => d.action === action);
            if (!set.length) continue;
            const label = { map: "→ existing ledger", create: "→ CREATE new ledger", drop: "dropped (idle this FY)" }[action];
            console.log(`\n${kind.toUpperCase()}  ${label}  (${set.length})`);
            for (const d of set) {
                const fy = d.fyTxns ? `${d.fyTxns} txn · ${inr(d.fyAmount)}` : "—";
                console.log(`  ${MARK[d.confidence]} ${d.vyapar.slice(0, 32).padEnd(34)}${fy.padStart(20)}` +
                    (d.account ? `  →  ${d.account}${d.group ? `  [${d.group}]` : ""}` : ""));
                if (action === "create" && !d.account && d.alternatives?.length) {
                    for (const alt of d.alternatives.slice(0, 2)) console.log(`        candidate: ${alt}`);
                }
            }
        }
    }

    const kept = decisions.filter((d) => d.action !== "drop");
    const toCreate = decisions.filter((d) => d.action === "create");
    const homeless = toCreate.filter((d) => !d.account);
    console.log(`\n${kept.length} heads migrate (${decisions.length - kept.length} dropped as idle)` +
        ` · ${decisions.filter((d) => d.action === "map").length} map to existing` +
        ` · ${toCreate.length} need creating`);
    if (homeless.length) {
        console.log(`  ⚠ ${homeless.length} have no home yet (${inr(homeless.reduce((s, d) => s + d.fyAmount, 0))} this FY)` +
            ` — add them to DECISIONS in this script.`);
    } else {
        console.log(`  every migrating head has a home — nothing quarantined.`);
    }

    if (!check) {
        writeFileSync(OUT, JSON.stringify({
            $comment:
                "Vyapar ledger -> AbeerSuite account. GENERATED by scripts/vyapar/ledger-map.ts; " +
                "edit DECISIONS/CREATE_UNDER in that script rather than this file, so a re-run keeps the choices. " +
                "action: map = point at an existing ledger, create = mint a new one under `group`, " +
                "drop = do not migrate (no transaction in FY 2026-27 and nothing owed).",
            fyStart: FY_START,
            generatedAt: new Date().toISOString(),
            mappings: decisions,
        }, null, 2) + "\n");
        console.log(`\nwritten: ${OUT}\n`);
    }

    await pool.end();
    close();
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
