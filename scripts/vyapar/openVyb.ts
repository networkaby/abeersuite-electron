/**
 * Open a Vyapar `.vyb` backup and hand back a read-only SQLite handle.
 *
 * A `.vyb` is an ordinary ZIP holding one `.vyp`, and a `.vyp` is a plain,
 * unencrypted SQLite 3 database. Nothing exotic — but the file arrives off a
 * phone or a sync folder, so it can be TRUNCATED MID-WRITE and still look
 * plausible. One such file cost us a morning: 3.6 MB instead of 12 MB, a valid
 * ZIP *local* header, and a database SQLite rejected as "disk image is
 * malformed" only after it had been unpacked.
 *
 * So verification is not optional here and there is no flag to skip it:
 *   1. the ZIP end-of-central-directory record must exist  → the archive finished
 *   2. the entry's CRC-32 must match after inflation       → the bytes are intact
 *   3. `pragma integrity_check` must return "ok"           → the database is sound
 *
 * Discovering a bad source halfway through a 23,551-voucher replay is the
 * expensive way to learn this.
 *
 * Uses only Node built-ins (`node:sqlite` needs Node 22.5+; this repo is on 24),
 * so a one-off migration adds no dependency to the app.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

/** Minimal single-entry ZIP reader — enough for a `.vyb`, and strict about truncation. */
function unzipSingleEntry(vybPath: string): { name: string; data: Buffer } {
    const buf = readFileSync(vybPath);

    // ── 1. End-of-central-directory. Its absence IS the truncation signal, so
    // this check comes first and fails loudest. Scan backwards: the record is
    // last in the file, and only its trailing comment (max 64 KB) can follow.
    const EOCD = 0x06054b50;
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) {
        throw new Error(
            `${basename(vybPath)} is TRUNCATED — no ZIP end-of-central-directory record.\n` +
            `The backup never finished writing. Take a fresh backup from Vyapar; ` +
            `nothing can be salvaged from this one.`,
        );
    }

    const entries = buf.readUInt16LE(eocd + 10);
    if (entries !== 1) throw new Error(`expected 1 entry in ${basename(vybPath)}, found ${entries}`);

    // ── 2. Central directory → the authoritative name, sizes and CRC.
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error("bad central directory signature");

    const method = buf.readUInt16LE(cdOffset + 10);
    const expectedCrc = buf.readUInt32LE(cdOffset + 16);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString("utf8", cdOffset + 46, cdOffset + 46 + nameLen);
    void extraLen; void commentLen;

    // ── 3. Local header — its own name/extra lengths decide where the data starts.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("bad local header signature");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;

    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);

    // ── 4. CRC — catches corruption that kept the file's shape but not its bytes.
    const actualCrc = crc32(data) >>> 0;
    if (actualCrc !== expectedCrc) {
        throw new Error(
            `${name} failed its CRC check (expected ${expectedCrc.toString(16)}, ` +
            `got ${actualCrc.toString(16)}) — the backup is corrupt.`,
        );
    }

    return { name, data };
}

export type OpenedVyb = {
    db: DatabaseSync;
    /** Where the `.vyp` was unpacked — handy for `sqlite3` spot-checks. */
    vypPath: string;
    close: () => void;
};

/**
 * Verify and open a `.vyb`. Throws with a plain-English reason if the backup is
 * not sound — never returns a half-good database.
 *
 * `workDir` receives the unpacked `.vyp` (~42 MB); pass a scratch directory.
 */
export function openVyb(vybPath: string, workDir: string): OpenedVyb {
    const { name, data } = unzipSingleEntry(vybPath);

    mkdirSync(workDir, { recursive: true });
    const vypPath = join(workDir, name);
    writeFileSync(vypPath, data);

    // Index the unpacked copy before opening it read-only.
    //
    // Vyapar ships its tables with NO secondary indexes at all — kb_transactions has
    // none — so every lookup is a full scan. One correlated subquery over 3,800
    // parties hung for minutes at roughly 89 million row visits, and the replay does
    // far more of that. These are OUR throwaway copy, never the owner's backup, and
    // they cost a couple of seconds to build once.
    {
        const w = new DatabaseSync(vypPath);
        for (const sql of [
            `create index if not exists ix_txn_name on kb_transactions(txn_name_id)`,
            `create index if not exists ix_txn_date on kb_transactions(txn_date)`,
            `create index if not exists ix_txn_type on kb_transactions(txn_type)`,
            `create index if not exists ix_txn_cat on kb_transactions(txn_category_id)`,
            `create index if not exists ix_li_txn on kb_lineitems(lineitem_txn_id)`,
            `create index if not exists ix_li_item on kb_lineitems(item_id)`,
            `create index if not exists ix_pay_txn on txn_payment_mapping(txn_id)`,
            `create index if not exists ix_pay_pid on txn_payment_mapping(payment_id)`,
            `create index if not exists ix_loy_txn on loyalty_txn(txn_id)`,
            `create index if not exists ix_adj_bank on kb_bank_adjustments(bank_adj_bank_id)`,
        ]) w.exec(sql);
        w.exec("analyze");
        w.close();
    }

    const db = new DatabaseSync(vypPath, { readOnly: true });

    const check = db.prepare("pragma integrity_check").get() as { integrity_check?: string } | undefined;
    if (check?.integrity_check !== "ok") {
        db.close();
        throw new Error(`${name}: SQLite integrity_check returned "${check?.integrity_check}" — the database is damaged.`);
    }

    return { db, vypPath, close: () => db.close() };
}

/** One-line provenance for a run log: what was opened, and what is inside it. */
export function describeVyb(db: DatabaseSync): string {
    const q = (sql: string) => (db.prepare(sql).get() as Record<string, unknown>) ?? {};
    const { n: txns } = q("select count(*) n from kb_transactions") as { n: number };
    const { n: items } = q("select count(*) n from kb_items") as { n: number };
    const { n: parties } = q("select count(*) n from kb_names") as { n: number };
    const span = q("select min(txn_date) lo, max(txn_date) hi from kb_transactions") as { lo: string; hi: string };
    const day = (s: string) => (s ?? "").slice(0, 10);
    return `${items} items · ${parties} parties · ${txns} txns · ${day(span.lo)} → ${day(span.hi)}`;
}
