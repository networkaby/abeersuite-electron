/**
 * Renumber the vouchers WE made after the Vyapar cut-over. Vyapar's own are left alone.
 *
 * Owner's rule (2026-09-25):
 *   • Vyapar's last day is 10 Sep 2026, AbeerSuite's first is 11 Sep 2026.
 *   • Every voucher the import brought in keeps exactly the number it has.
 *   • A voucher we made but dated UP TO 10 Sep (backdated to match the other party's
 *     date) continues VYAPAR's series — Sale, Receipt (Vyapar's "Payment-In") and Sale
 *     Return, which were the only kinds Vyapar numbered. Every other kind had no number
 *     in Vyapar, so it carries none here either.
 *   • A voucher dated FROM 11 Sep takes OUR format, counter-wise: each (kind, counter)
 *     run restarts at the series' `startFrom`, in date → created → id order, and the
 *     counter's `VoucherSeriesCounter.nextSeq` is left pointing just past it.
 *
 * ── Which vouchers are Vyapar's ─────────────────────────────────────────────
 * The import is one batch: every voucher created before IMPORT_BATCH_END. It is proved,
 * not assumed — the run stops unless
 *   1. the batch's highest Sale / Receipt / Sale Return numbers equal the highest ones
 *      in the Vyapar backup the import was made from, and
 *   2. no batch voucher carries our `XX-<counter><number>-YY` format, and no later one
 *      carries a bare Vyapar number.
 * Dates alone cannot separate them: both apps hold backdated entries around the cut-off.
 *
 * ── What it rewrites ───────────────────────────────────────────────────────
 * `UniversalVoucher.voucherNo`, the number inside its `description`, and
 * `VoucherAllocation.reference`. `updatedAt` is bumped so the tills pull the change.
 * The recycle bin must be EMPTY first: a snapshot restored later would bring an old
 * number back on top of a new one. Empty it from Accountancy → Recycle Bin.
 *
 * Opening Balance entries are not a series and are never touched. Drafts carry no
 * number (a voucher takes one when it posts) and stay that way.
 *
 *   pnpm vyapar:renumber                                  # plan only, against DIRECT_URL
 *   pnpm vyapar:renumber -- --db <url>                    # plan only, another database
 *   pnpm vyapar:renumber -- --db <url> --apply --rollback # run every write, then undo
 *   pnpm vyapar:renumber -- --apply                       # the real thing (live needs a backup < 1 h old)
 *
 * Run it while the tills are quiet and synced: a till holding an unpushed edit to one
 * of these vouchers loses that edit to the newer renumbered row (last write wins).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PoolClient } from "pg";
import { finish, openTarget } from "./liveTarget";
import { assembleReference, type SeriesShape } from "@/modules/accountancy/lib/voucherRef";
import { openVyb } from "./openVyb";

const VYAPAR_BACKUP = "D:/AbeerSuite/11-09-2026_05.55.41_Network_Service_VypBackup.vyb";
/** Last day in Vyapar. A voucher of ours dated on or before it continues Vyapar's series. */
const VYAPAR_LAST_DAY = "2026-09-10";
/** Every voucher created before this is the import batch (it ran 11 Sep, 20:35–20:38). */
const IMPORT_BATCH_END = "2026-09-11 21:00:00";

/** Our kind → the Vyapar txn_type whose series it continues. Anything absent had no number. */
const VYAPAR_SERIES: Record<string, { txnType: number; label: string }> = {
    SALE: { txnType: 1, label: "Sale" },
    POS: { txnType: 1, label: "Sale" },          // a counter sale is a sale invoice in Vyapar
    RECEIPT: { txnType: 3, label: "Payment-In" },
    SALE_RETURN: { txnType: 21, label: "Sale Return" },
};

/** Our number: `SV-930824-26` — type code, counter + padded number, 2-digit year. */
const OUR_FORMAT = /^[A-Z]+-\d+-\d{2}$/;
const VYAPAR_FORMAT = /^\d+$/;

interface Row {
    id: number;
    type: string;
    voucherNo: string | null;
    date: string;
    createdAt: Date;
    status: string;
    description: string;
    counterNumber: number | null;
}

interface Change { id: number; type: string; date: string; from: string | null; to: string | null; why: string }

/** Highest numeric reference per Vyapar txn_type in the backup the import came from. */
function vyaparMaxima(): Map<number, number> {
    const { db, close } = openVyb(VYAPAR_BACKUP, join(tmpdir(), "vy-renumber"));
    try {
        const out = new Map<number, number>();
        const types = [...new Set(Object.values(VYAPAR_SERIES).map((s) => s.txnType))];
        for (const t of types) {
            const r = db.prepare(`
                select max(cast(txn_ref_number_char as integer)) mx from kb_transactions
                where txn_type = ? and txn_date >= '2026-04-01' and txn_ref_number_char glob '[0-9]*'
                  and txn_ref_number_char not glob '*[^0-9]*'
            `).get(t) as { mx: number | null };
            out.set(t, Number(r.mx ?? 0));
        }
        return out;
    } finally {
        close();
    }
}

async function plan(db: PoolClient, binMustBeEmpty: boolean): Promise<{ changes: Change[]; seriesRows: Array<{ kind: string; counterNumber: number; nextSeq: number }> }> {
    // Blocks only a run that keeps its writes; a plan or a rolled-back rehearsal says so and carries on.
    const bin = await db.query(`select count(*)::int n from "AuditLog"`);
    if (bin.rows[0].n > 0) {
        const msg = `The recycle bin still holds ${bin.rows[0].n} cop(ies). Empty it first (Accountancy → Recycle Bin → Empty bin).`;
        if (binMustBeEmpty) throw new Error(msg);
        console.warn(`  ! ${msg}
`);
    }

    const { rows } = await db.query<Row>(`
        select v.id, v.type, v."voucherNo", to_char(v.date, 'YYYY-MM-DD') date, v."createdAt", v.status::text,
               v.description, c."counterNumber"
        from "UniversalVoucher" v left join pos_counters c on c.id = v."sourceCounterId"
        where v.type <> 'OPENING'
        order by v.date, v."createdAt", v.id
    `);
    // `createdAt` is a timestamp WITHOUT time zone; pg hands it back as a local Date.
    // Compare on the text the database itself holds instead of guessing an offset.
    const batch = new Set((await db.query<{ id: number }>(
        `select id from "UniversalVoucher" where "createdAt" < $1::timestamp`, [IMPORT_BATCH_END],
    )).rows.map((r) => r.id));
    const vyapar = rows.filter((r) => batch.has(r.id));
    const ours = rows.filter((r) => !batch.has(r.id));

    // ── Proof 1: the batch IS the Vyapar import.
    const maxima = vyaparMaxima();
    for (const [kind, s] of Object.entries(VYAPAR_SERIES)) {
        if (kind === "POS") continue;
        const inDb = Math.max(0, ...vyapar.filter((r) => r.type === kind && r.voucherNo && VYAPAR_FORMAT.test(r.voucherNo)).map((r) => Number(r.voucherNo)));
        const inBackup = maxima.get(s.txnType) ?? 0;
        if (inDb !== inBackup) {
            throw new Error(`Import check failed: highest ${s.label} number is ${inDb} in the database but ${inBackup} in the Vyapar backup.`);
        }
    }
    // ── Proof 2: the two sets do not share a format.
    const strayOurs = vyapar.filter((r) => r.voucherNo && OUR_FORMAT.test(r.voucherNo));
    if (strayOurs.length) throw new Error(`Import batch holds ${strayOurs.length} voucher(s) in our format, e.g. #${strayOurs[0].id} ${strayOurs[0].voucherNo}.`);
    const strayVyapar = ours.filter((r) => r.voucherNo && VYAPAR_FORMAT.test(r.voucherNo));
    if (strayVyapar.length) throw new Error(`${strayVyapar.length} voucher(s) made after the import carry a bare Vyapar number, e.g. #${strayVyapar[0].id} ${strayVyapar[0].voucherNo}. Look before renumbering.`);

    const seriesRows = (await db.query(`select * from "VoucherSeries"`)).rows as Array<SeriesShape & { kind: string }>;
    const series = new Map(seriesRows.map((s) => [s.kind, s]));

    const changes: Change[] = [];
    const nextVyapar = new Map<number, number>([...maxima]);
    const runs = new Map<string, number>();   // `${kind}|${counter}` → last seq issued

    for (const r of ours) {
        // A draft has no number yet — it takes one when it posts.
        if (r.voucherNo == null && r.status === "DRAFT") continue;

        if (r.date <= VYAPAR_LAST_DAY) {
            const vs = VYAPAR_SERIES[r.type];
            let to: string | null = null;
            if (vs) {
                const n = (nextVyapar.get(vs.txnType) ?? 0) + 1;
                nextVyapar.set(vs.txnType, n);
                to = String(n);
            }
            if (to !== r.voucherNo) {
                changes.push({ id: r.id, type: r.type, date: r.date, from: r.voucherNo, to, why: vs ? `Vyapar ${vs.label} series` : "Vyapar had no number for this kind" });
            }
            continue;
        }

        // POS estimates / orders gained a series only in B3a; the numbers they
        // already carry stay exactly as issued.
        if (r.type === "POS_ESTIMATE" || r.type === "POS_ORDER") continue;
        const s = series.get(r.type);
        if (!s) {
            if (r.voucherNo) console.warn(`  ! #${r.id} ${r.type} ${r.voucherNo}: no VoucherSeries for this kind — left as it is`);
            continue;
        }
        const counter = r.counterNumber && r.counterNumber > 0 ? r.counterNumber : 1;
        const key = `${r.type}|${counter}`;
        const seq = (runs.get(key) ?? 0) + 1;
        runs.set(key, seq);
        const to = assembleReference({ ...s, nextSeq: seq }, counter);
        if (to !== r.voucherNo) changes.push({ id: r.id, type: r.type, date: r.date, from: r.voucherNo, to, why: `counter ${counter}, #${seq}` });
    }

    // Every existing counter row of a renumbered kind is reset — a run that now holds
    // nothing starts again at startFrom — and every run that holds vouchers points past them.
    const existing = (await db.query<{ kind: string; counterNumber: number }>(`select kind, "counterNumber" from "VoucherSeriesCounter"`)).rows;
    const target = new Map<string, number>();
    for (const e of existing) target.set(`${e.kind}|${e.counterNumber}`, 0);
    for (const [key, n] of runs) target.set(key, n);
    const out = [...target].map(([key, nextSeq]) => {
        const [kind, c] = key.split("|");
        return { kind, counterNumber: Number(c), nextSeq };
    });
    return { changes, seriesRows: out };
}

async function apply(db: PoolClient, changes: Change[], seriesRows: Array<{ kind: string; counterNumber: number; nextSeq: number }>): Promise<void> {
    // Allocations are matched on their number TEXT, so read them all before writing
    // any: one voucher's new number is often another's old one, and matching after a
    // write would move an allocation twice.
    const froms = changes.map((c) => c.from).filter((f): f is string => f != null);
    const allocs = (await db.query<{ id: number; reference: string }>(
        `select id, reference from "VoucherAllocation" where reference = any($1)`, [froms],
    )).rows;
    const toOf = new Map(changes.filter((c) => c.from).map((c) => [c.from!, c.to]));
    for (const a of allocs) {
        await db.query(`update "VoucherAllocation" set reference = $2 where id = $1`, [a.id, toOf.get(a.reference) ?? null]);
    }

    for (const c of changes) {
        // The description embeds the number (`PURCHASE PV-10786-26: …`); swap it in place.
        await db.query(`
            update "UniversalVoucher"
               set "voucherNo" = $2,
                   description = case when $3::text is null then description
                                      when $2::text is null then replace(description, ' ' || $3::text, '')
                                      else replace(description, $3::text, $2::text) end,
                   "updatedAt" = now()
             where id = $1
        `, [c.id, c.to, c.from]);
    }
    for (const s of seriesRows) {
        const cur = (await db.query(`select "fyStartYear", "resetGen" from "VoucherSeries" where kind = $1`, [s.kind])).rows[0];
        if (!cur) continue;
        await db.query(`
            insert into "VoucherSeriesCounter" (kind, "counterNumber", "nextSeq", "fyStartYear", "resetGen", "updatedAt")
            values ($1, $2, $3, $4, $5, now())
            on conflict (kind, "counterNumber") do update set "nextSeq" = excluded."nextSeq", "updatedAt" = now()
        `, [s.kind, s.counterNumber, s.nextSeq, cur.fyStartYear, cur.resetGen]);
    }
}

async function main(): Promise<void> {
    const t = await openTarget();
    const { db } = t;
    let ok = false;
    let summary = "";
    try {
        const { changes, seriesRows } = await plan(db, t.keeps);

        const byWhy = new Map<string, Change[]>();
        for (const c of changes) {
            const k = `${c.type} · ${c.why.replace(/, #\d+$/, "")}`;
            byWhy.set(k, [...(byWhy.get(k) ?? []), c]);
        }
        for (const [k, list] of [...byWhy].sort()) {
            console.log(`${k} — ${list.length}`);
            for (const c of list.slice(0, 3)) console.log(`    #${c.id} ${c.date}  ${c.from ?? "(none)"} → ${c.to ?? "(none)"}`);
            if (list.length > 3) console.log(`    … ${list.length - 3} more, last: ${list.at(-1)!.from ?? "(none)"} → ${list.at(-1)!.to ?? "(none)"}`);
        }
        console.log(`\n${changes.length} voucher(s) to renumber.`);
        console.log("Next numbers after the run:");
        for (const s of seriesRows.filter((r) => r.nextSeq > 0)) console.log(`    ${s.kind.padEnd(16)} counter ${String(s.counterNumber).padEnd(3)} nextSeq ${s.nextSeq}`);
        summary = `${changes.length} voucher(s)`;

        if (t.go) {
            await apply(db, changes, seriesRows);

            // Read back: every change landed, and no number of ours is issued twice.
            const ids = changes.map((c) => c.id);
            const back = (await db.query<{ id: number; voucherNo: string | null }>(`select id, "voucherNo" from "UniversalVoucher" where id = any($1)`, [ids])).rows;
            const want = new Map(changes.map((c) => [c.id, c.to]));
            const wrong = back.filter((r) => want.get(r.id) !== r.voucherNo);
            if (wrong.length) throw new Error(`${wrong.length} voucher(s) did not take their new number, e.g. #${wrong[0].id}`);
            const dup = await db.query(`
                select "voucherNo", count(*)::int n from "UniversalVoucher"
                where "voucherNo" ~ '^[A-Z]+-[0-9]+-[0-9]{2}$' group by 1 having count(*) > 1 limit 5`);
            if (dup.rows.length) throw new Error(`Duplicate numbers after the run: ${dup.rows.map((r) => `${r.voucherNo}×${r.n}`).join(", ")}`);
        }
        ok = true;
    } finally {
        await finish(t, ok, summary);
    }
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
