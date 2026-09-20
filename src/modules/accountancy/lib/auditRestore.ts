// Faithful restore of a hard-deleted entity from its AuditLog JSON snapshot.
//
// The hard-delete routes snapshot the WHOLE graph into one AuditLog row (voucher +
// lines/charges/tenders/stock-ledger + its JournalEntry + JournalLines). This module
// rebuilds it: re-insert every row with fresh ids but the ORIGINAL reference number
// (the series counter never reuses a deleted number, so it's free), re-link the
// voucher → its new JE, and re-apply the denormalised caches (Account.balance,
// InvProduct.stock / InvProductBranch.stock) ONLY when the restored entity is live
// (POSTED, not cancelled / soft-deleted) — a cancelled/deleted entity's caches were
// already reversed upstream and must stay that way.
//
// Volatile soft-links the voucher carried (shopOrder / ticket / deal / refVoucher) are
// NULLed on restore: their targets may be gone, and re-linking them risks a FK
// violation. The truth path self-corrects from the recreated JE's own status.

import type { Prisma } from "@/generated/prisma/client";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";

type Tx = Prisma.TransactionClient;
type NormalBalance = "DEBIT" | "CREDIT";
type EntryType = "DEBIT" | "CREDIT";

type Num = string | number | { toString(): string };
interface Row { [key: string]: unknown }
interface JeLine extends Row { accountId: number; type: EntryType; amount: Num; account?: { normalBalance?: NormalBalance | null } }
interface JeSnapshot extends Row { lines?: JeLine[]; status?: string; deletedAt?: unknown }
interface VoucherLine extends Row { accountId?: number; type?: EntryType; amount?: unknown; account?: { normalBalance?: NormalBalance | null } }

// Real column names per model, straight from the generated datamodel. Snapshots
// are JSON frozen at delete time, so they drift from the schema in BOTH directions:
//   • columns that have since been dropped (5D-1 journalEntryId, 5D-17 shopOrderId,
//     pre-5C voucherId …) — old snapshots still carry them;
//   • fields that were NEVER columns — the hard-delete routes snapshot an object
//     they assembled, so a VoucherDetail snapshot also carries `type` / `status` /
//     `deletedAt` / the `universalVoucher` relation, synthesised for the response.
// Both make `create()` throw "Unknown argument". A hand-maintained drop list can't
// keep up (it silently misses the next one), so filter to what the model actually
// has instead — anything unrecognised is dropped by construction.
// Read from `information_schema` rather than a generated datamodel: Prisma 7's
// client no longer ships `Prisma.dmmf`. None of these models carry an `@@map`,
// so the model name IS the table name. Cached per process.
const TABLES = ["VoucherDetail", "VoucherInventoryLine", "InvStockLedger", "UniversalVoucher", "VoucherGlLine"] as const;
type TableName = (typeof TABLES)[number];

let columnCache: Map<string, Set<string>> | null = null;

async function loadColumns(tx: Tx): Promise<Map<string, Set<string>>> {
    if (columnCache) return columnCache;
    const rows = await tx.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name
        FROM   information_schema.columns
        WHERE  table_schema = current_schema()
          AND  table_name = ANY(${[...TABLES]}::text[])
    `;
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
        const set = map.get(r.table_name) ?? new Set<string>();
        set.add(r.column_name);
        map.set(r.table_name, set);
    }
    for (const t of TABLES) {
        if (!map.get(t)?.size) throw new Error(`restoreFromAudit: no columns found for table "${t}"`);
    }
    columnCache = map;
    return map;
}

/**
 * Keep only real columns of `table`, minus `id`, `updatedAt` and any explicit drops.
 *
 * `updatedAt` is never carried over from the snapshot. It is the watermark every
 * incremental reader arbitrates on — the Day Book's `updatedAt > since` delta, and
 * sync's last-write-wins in `shared/lib/sync/push.ts` — so a restored row that
 * re-enters the books wearing the timestamp it had at delete time looks OLDER than
 * what those readers already hold. The screen that was told to drop the row on
 * delete never hears that it came back (it stays missing until a full reload), and
 * a counter rejects the push outright. Letting Prisma stamp `@updatedAt` with now()
 * says the true thing: this row changed today. `createdAt` IS carried over — that
 * is genuine history, and nothing windows on it.
 */
function scalarsOf(cols: Map<string, Set<string>>, row: Row, table: TableName, drop: string[] = []): Row {
    const allowed = cols.get(table)!;
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
        if (k === "id" || k === "updatedAt" || drop.includes(k) || !allowed.has(k)) continue;
        out[k] = v;
    }
    return out;
}

/**
 * Re-create the GL spine row (UniversalVoucher + its VoucherGlLine lines) from a
 * snapshot, preserving its reference. Returns the new spine id. Since G5 the spine
 * is the only GL representation, so "journalEntry" in old snapshots IS the spine.
 * The vestigial self-ref / line back-link columns are dropped (they pointed at the
 * now-deleted id and are @unique — re-inserting them risks a collision).
 */
async function recreateJournalEntry(tx: Tx, cols: Map<string, Set<string>>, je: JeSnapshot): Promise<number> {
    const scalars = scalarsOf(cols, je, "UniversalVoucher", ["sourceJournalEntryId"]);
    const lines = (je.lines ?? []).map((l) =>
        scalarsOf(cols, l, "VoucherGlLine", ["universalVoucherId", "sourceJournalLineId"]));
    const created = await tx.universalVoucher.create({
        data: { ...scalars, lines: { create: lines } } as unknown as Prisma.UniversalVoucherUncheckedCreateInput,
    });
    return created.id;
}

/**
 * Apply POSTED, non-deleted lines forward to the cached Account.balance.
 *
 * Nature comes from the LIVE account through the shared writer, not from the
 * snapshot's own `account.normalBalance`: the snapshot may be months old, and a
 * bare normalBalance read skipped every party ledger (they carry null and take
 * their nature from the group), so a restore used to recreate the lines and
 * leave those legs' balance untouched.
 */
async function reapplyBalance(tx: Tx, lines: JeLine[]): Promise<void> {
    // A snapshot line can be account-less; `applyLineBalances` writes per account.
    const withAccount = lines.filter((l): l is JeLine & { accountId: number } => l.accountId != null);
    if (withAccount.length === 0) return;
    await applyLineBalances(tx, withAccount, "apply");
}

function isLive(status: unknown, deletedAt: unknown, cancelledAt: unknown): boolean {
    return status === "POSTED" && !deletedAt && !cancelledAt;
}

/**
 * The user-facing document number of a restored entity — reported back to the
 * Recycle Bin ("Restored SV-26-27-0123"). 5D-6 moved it off the detail onto the
 * spine as `voucherNo`, so a snapshot's own `reference` is absent on anything
 * captured since; reading it alone produced the string "undefined" in the toast.
 */
function referenceOf(snap: Row, spine: JeSnapshot | null): string {
    return String(spine?.voucherNo ?? snap.voucherNo ?? snap.reference ?? "");
}

/** Restore one AuditLog row. Must run inside a transaction. Returns the restored reference. */
export async function restoreFromAudit(
    tx: Tx,
    audit: { entityType: string; snapshot: unknown },
): Promise<string> {
    const snap = audit.snapshot as Row;
    const cols = await loadColumns(tx);

    if (audit.entityType === "JOURNAL_ENTRY") {
        const je = snap as JeSnapshot;
        const newId = await recreateJournalEntry(tx, cols, je);
        if (isLive(je.status, je.deletedAt, undefined)) await reapplyBalance(tx, je.lines ?? []);
        void newId;
        return referenceOf(snap, je);
    }

    if (audit.entityType === "GL_VOUCHER") {
        // Phase 5 5E: the spine IS the GL voucher. The hard-delete snapshot is the
        // spine itself (lines = VoucherGlLine), so recreate it ONCE via the spine
        // rebuilder and re-apply balances if the restored voucher is live.
        const lines = (snap.lines as VoucherLine[]) ?? [];
        await recreateJournalEntry(tx, cols, snap as JeSnapshot);
        if (isLive(snap.status, snap.deletedAt, snap.cancelledAt)) {
            await reapplyBalance(tx, lines.filter((l): l is JeLine => l.accountId != null && l.type != null));
        }
        return referenceOf(snap, snap as JeSnapshot);
    }

    // INV_VOUCHER
    const lines = (snap.lines as Row[]) ?? [];
    const stockEntries = (snap.stockEntries as Row[]) ?? [];
    const journalEntry = (snap.journalEntry as JeSnapshot | null) ?? null;

    const newJeId = journalEntry ? await recreateJournalEntry(tx, cols, journalEntry) : null;
    // G4b: tender/charge input is `settlementJson` (a scalar) — restored via ...scalars.
    // `universalVoucherId` is dropped: the snapshot's value points at the spine that
    // hard-delete destroyed; the freshly recreated one is set below.
    const scalars = scalarsOf(cols, snap, "VoucherDetail", ["universalVoucherId"]);
    await tx.voucherDetail.create({
        data: {
            ...scalars,
            // Link the restored detail to the recreated spine (the JE id IS the spine id since G5).
            universalVoucherId: newJeId,
            // Sever volatile soft-links — targets may be gone; truth path self-corrects.
            refVoucherId: null,
        } as unknown as Prisma.VoucherDetailUncheckedCreateInput,
    });

    // Phase 5 5C: goods lines AND stock rows hang off the SPINE, not the detail.
    // Both are re-created against `newJeId` — the snapshot's own universalVoucherId
    // points at the spine hard-delete destroyed, so it must never be carried over.
    // (This module used to write the pre-5C shape — a nested `lines: { create }` on
    // VoucherDetail and `voucherId` on InvStockLedger. Neither column exists any
    // more, and the `as unknown as` casts hid it from tsc, so restoring any
    // inventory voucher from the Recycle Bin failed at runtime.)
    if (newJeId != null) {
        for (const l of lines) {
            await tx.voucherInventoryLine.create({
                data: { ...scalarsOf(cols, l, "VoucherInventoryLine", ["universalVoucherId"]), universalVoucherId: newJeId } as unknown as Prisma.VoucherInventoryLineUncheckedCreateInput,
            });
        }
        for (const s of stockEntries) {
            await tx.invStockLedger.create({
                data: { ...scalarsOf(cols, s, "InvStockLedger", ["universalVoucherId"]), universalVoucherId: newJeId } as unknown as Prisma.InvStockLedgerUncheckedCreateInput,
            });
        }
    }

    if (isLive(snap.status, snap.deletedAt, snap.cancelledAt)) {
        // Rebuild on-hand from the ledger now that the rows are back, instead of
        // hand-applying each row's delta — same safety net as the edit / cancel /
        // delete paths, and correct for branch transfers and physical stock too.
        await recomputeProductStock(tx, stockEntries.map((s) => s.productId as number));
        // Account.balance forward, from the JE lines (carry account.normalBalance), if the JE is live.
        if (journalEntry && isLive(journalEntry.status, journalEntry.deletedAt, undefined)) {
            await reapplyBalance(tx, journalEntry.lines ?? []);
        }
    }

    return referenceOf(snap, journalEntry);
}
