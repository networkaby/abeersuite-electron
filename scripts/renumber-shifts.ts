/**
 * Close the gaps in POS shift numbers. A shift's number IS its row id (`Shift #12`
 * is `pos_shifts.id`), and deleted shifts left holes: live on 2026-09-25 held 12
 * shifts on ids 1, 2, 7, 9–12, 14–18 with the sequence already at 22.
 *
 * Renumbers every shift 1..n in the order it was opened (openedAt, then id) and
 * sets the sequence so the next shift continues at n + 1.
 *
 * ── What moves with the id ──────────────────────────────────────────────────
 *   • pos_cash_drops.shiftId, pos_handovers.fromShiftId / toShiftId and
 *     pos_shifts.handoverToShiftId — all `ON UPDATE CASCADE`, so PostgreSQL moves
 *     them itself. The ids go negative first, then to their new value, so no step
 *     ever lands on an id another shift still holds.
 *   • UniversalVoucher.sourceShiftId — no foreign key, rewritten in one statement.
 *   • "Shift #N" inside voucher description / narration and GL line text (the
 *     variance and handover Journals print it).
 * `updatedAt` is bumped on every row touched, so the tills pull the new rows; their
 * hourly reconcile then drops the ids that no longer exist upstream.
 *
 * Every shift must be CLOSED: an open shift is live on a till, which holds its id.
 *
 *   pnpm pos:renumber-shifts                              # plan only, against DIRECT_URL
 *   pnpm pos:renumber-shifts -- --db <url> --apply --rollback
 *   pnpm pos:renumber-shifts -- --apply                   # live needs a backup < 1 h old
 */

import type { PoolClient } from "pg";
import { finish, openTarget } from "./vyapar/liveTarget";

const SHIFT_REF = /Shift #(\d+)/g;

/** Text columns that can carry a "Shift #N". */
const TEXT_COLUMNS: Array<{ table: string; column: string; bump: boolean }> = [
    { table: "UniversalVoucher", column: "description", bump: true },
    { table: "UniversalVoucher", column: "narration", bump: true },
    { table: "VoucherGlLine", column: "description", bump: false },
];

async function main(): Promise<void> {
    const t = await openTarget();
    const { db } = t;
    let ok = false;
    let summary = "";
    try {
        const shifts = (await db.query<{ id: number; status: string; opened: string; ctr: number }>(`
            select s.id, s.status::text status, to_char(s."openedAt", 'YYYY-MM-DD HH24:MI') opened, c."counterNumber" ctr
            from pos_shifts s join pos_counters c on c.id = s."counterId"
            order by s."openedAt", s.id`)).rows;

        const open = shifts.filter((s) => s.status !== "CLOSED");
        if (open.length) {
            const msg = `${open.length} shift(s) not closed: ${open.map((s) => `#${s.id} ${s.status}`).join(", ")}. Close them first.`;
            if (t.keeps) throw new Error(msg);
            console.warn(`  ! ${msg}\n`);
        }

        const map = new Map<number, number>();
        shifts.forEach((s, i) => { if (s.id !== i + 1) map.set(s.id, i + 1); });
        for (const s of shifts) {
            const to = map.get(s.id);
            console.log(`  #${String(s.id).padEnd(4)} counter ${String(s.ctr).padEnd(3)} opened ${s.opened}  ${to ? `→ #${to}` : "(keeps its number)"}`);
        }
        const nextId = shifts.length + 1;
        console.log(`\n${map.size} of ${shifts.length} shift(s) to renumber; the next shift will be #${nextId}.`);
        summary = `${map.size} shift(s)`;

        if (t.go && map.size > 0) {
            await apply(db, map);
            await verify(db, shifts.length);
        }
        // A sequence ignores ROLLBACK, so only a kept run may move it — a rehearsal
        // would otherwise leave live's next id changed for real.
        if (t.keeps) {
            await db.query(`select setval(pg_get_serial_sequence('pos_shifts', 'id'), $1, false)`, [nextId]);
        }
        ok = true;
    } finally {
        await finish(t, ok, summary);
    }
}

async function apply(db: PoolClient, map: Map<number, number>): Promise<void> {
    const olds = [...map.keys()];
    const pairs = [...map].map(([o, n]) => `(${o}, ${n})`).join(", ");

    // 1. Shift ids — negative, then final. The cascades carry drops and handovers.
    await db.query(`update pos_shifts set id = -id where id = any($1)`, [olds]);
    await db.query(`
        update pos_shifts s set id = m.n, "updatedAt" = now()
        from (values ${pairs}) m(o, n) where s.id = -m.o`);
    // Handovers carry their own watermark; the cascade does not touch updatedAt.
    await db.query(`
        update pos_handovers set "updatedAt" = now()
        where "fromShiftId" in (select n from (values ${pairs}) m(o, n))
           or "toShiftId"   in (select n from (values ${pairs}) m(o, n))`);

    // 2. Vouchers raised on a shift — one statement, so no row is mapped twice.
    const moved = await db.query(`
        update "UniversalVoucher" v set "sourceShiftId" = m.n, "updatedAt" = now()
        from (values ${pairs}) m(o, n) where v."sourceShiftId" = m.o`);
    console.log(`  vouchers re-pointed: ${moved.rowCount}`);

    // 3. "Shift #N" text, rewritten in one pass per value so #1 never eats #12.
    for (const { table, column, bump } of TEXT_COLUMNS) {
        const rows = (await db.query<{ id: number; txt: string }>(
            `select id, "${column}" txt from "${table}" where "${column}" ~ 'Shift #[0-9]'`,
        )).rows;
        let changed = 0;
        for (const r of rows) {
            const next = r.txt.replace(SHIFT_REF, (all, n: string) => {
                const to = map.get(Number(n));
                return to ? `Shift #${to}` : all;
            });
            if (next === r.txt) continue;
            await db.query(
                `update "${table}" set "${column}" = $2${bump ? `, "updatedAt" = now()` : ""} where id = $1`,
                [r.id, next],
            );
            changed++;
        }
        console.log(`  ${table}.${column} text rewritten: ${changed}`);
    }
}

async function verify(db: PoolClient, n: number): Promise<void> {
    const ids = (await db.query<{ id: number }>(`select id from pos_shifts order by id`)).rows.map((r) => r.id);
    if (ids.length !== n || ids.some((id, i) => id !== i + 1)) throw new Error(`Shift ids are not 1..${n} after the run: ${ids.join(", ")}`);
    const orphans = await db.query<{ t: string; n: number }>(`
        select 'voucher' t, count(*)::int n from "UniversalVoucher" where "sourceShiftId" is not null and "sourceShiftId" not in (select id from pos_shifts)
        union all select 'cash drop', count(*)::int from pos_cash_drops where "shiftId" not in (select id from pos_shifts)
        union all select 'handover', count(*)::int from pos_handovers where "fromShiftId" not in (select id from pos_shifts)`);
    const bad = orphans.rows.filter((r) => r.n > 0);
    if (bad.length) throw new Error(`Rows left pointing at no shift: ${bad.map((r) => `${r.t} ×${r.n}`).join(", ")}`);
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
