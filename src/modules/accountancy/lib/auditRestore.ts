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
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";

type Tx = Prisma.TransactionClient;
type NormalBalance = "DEBIT" | "CREDIT";
type EntryType = "DEBIT" | "CREDIT";

type Num = string | number | { toString(): string };
interface Row { [key: string]: unknown }
interface JeLine extends Row { accountId: number; type: EntryType; amount: Num; account?: { normalBalance?: NormalBalance | null } }
interface JeSnapshot extends Row { lines?: JeLine[]; status?: string; deletedAt?: unknown }
interface VoucherLine extends Row { accountId?: number; type?: EntryType; amount?: unknown; account?: { normalBalance?: NormalBalance | null } }

/** Strip relation includes + id from a row, leaving scalar columns safe to re-insert. */
function scalarsOf(row: Row, drop: string[]): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
        if (k === "id" || drop.includes(k)) continue;
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
async function recreateJournalEntry(tx: Tx, je: JeSnapshot): Promise<number> {
    const scalars = scalarsOf(je, ["lines", "actor", "createdBy", "cancelledBy", "deletedBy", "invVoucher", "voucher", "sourceJournalEntryId"]);
    const lines = (je.lines ?? []).map((l) =>
        scalarsOf(l, ["universalVoucherId", "universalVoucher", "account", "branch", "additionalCostAllocations", "sourceJournalLineId"]));
    const created = await tx.universalVoucher.create({
        data: { ...scalars, lines: { create: lines } } as unknown as Prisma.UniversalVoucherUncheckedCreateInput,
    });
    return created.id;
}

/**
 * Apply POSTED, non-deleted lines forward to the cached Account.balance. Lines may
 * carry an `account.normalBalance` (voucher-line snapshots) or be scalar-only (spine
 * GL-line snapshots); the latter resolve normalBalance from the DB in one lookup.
 */
async function reapplyBalance(tx: Tx, lines: JeLine[]): Promise<void> {
    if (lines.length === 0) return;
    const ids = [...new Set(lines.map((l) => l.accountId).filter((x): x is number => x != null))];
    const rows = await tx.account.findMany({ where: { id: { in: ids } }, select: { id: true, normalBalance: true } });
    const nbById = new Map(rows.map((a) => [a.id, a.normalBalance]));
    for (const l of lines) {
        const nb = l.account?.normalBalance ?? nbById.get(l.accountId);
        if (!nb) continue;
        await tx.account.update({
            where: { id: l.accountId },
            data: { balance: { increment: balanceDelta(nb, l.type, toNumber(l.amount)) } },
        });
    }
}

function isLive(status: unknown, deletedAt: unknown, cancelledAt: unknown): boolean {
    return status === "POSTED" && !deletedAt && !cancelledAt;
}

/** Restore one AuditLog row. Must run inside a transaction. Returns the restored reference. */
export async function restoreFromAudit(
    tx: Tx,
    audit: { entityType: string; snapshot: unknown },
): Promise<string> {
    const snap = audit.snapshot as Row;

    if (audit.entityType === "JOURNAL_ENTRY") {
        const je = snap as JeSnapshot;
        const newId = await recreateJournalEntry(tx, je);
        if (isLive(je.status, je.deletedAt, undefined)) await reapplyBalance(tx, je.lines ?? []);
        void newId;
        return String(snap.reference);
    }

    if (audit.entityType === "GL_VOUCHER") {
        const lines = (snap.lines as VoucherLine[]) ?? [];
        const journalEntry = (snap.journalEntry as JeSnapshot | null) ?? null;
        const newJeId = journalEntry ? await recreateJournalEntry(tx, journalEntry) : null;
        const scalars = scalarsOf(snap, ["lines", "createdBy", "journalEntry"]);
        await tx.voucher.create({
            data: {
                ...scalars,
                journalEntryId: newJeId,
                lines: { create: lines.map((l) => scalarsOf(l, ["voucherId", "account"])) },
            } as unknown as Prisma.VoucherUncheckedCreateInput,
        });
        // Balance re-apply uses the VOUCHER lines (they carry account.normalBalance; the GL
        // JE snapshot's lines don't). Only when the restored voucher is live.
        if (isLive(snap.status, snap.deletedAt, snap.cancelledAt)) {
            await reapplyBalance(tx, lines.filter((l): l is JeLine => l.accountId != null && l.type != null));
        }
        return String(snap.reference);
    }

    // INV_VOUCHER
    const lines = (snap.lines as Row[]) ?? [];
    const stockEntries = (snap.stockEntries as Row[]) ?? [];
    const journalEntry = (snap.journalEntry as JeSnapshot | null) ?? null;

    const newJeId = journalEntry ? await recreateJournalEntry(tx, journalEntry) : null;
    // G4b: tender/charge input is `settlementJson` (a scalar) — restored via ...scalars.
    const scalars = scalarsOf(snap, ["lines", "charges", "tenders", "stockEntries", "createdBy", "journalEntry"]);
    const voucher = await tx.invVoucher.create({
        data: {
            ...scalars,
            journalEntryId: newJeId,
            // Sever volatile soft-links — targets may be gone; truth path self-corrects.
            shopOrderId: null, ticketId: null, dealId: null, refVoucherId: null,
            lines: { create: lines.map((l) => scalarsOf(l, ["voucherId", "product"])) },
        } as unknown as Prisma.InvVoucherUncheckedCreateInput,
    });

    // Re-create the immutable stock-ledger rows (no nested relation — own FK to voucher).
    for (const s of stockEntries) {
        await tx.invStockLedger.create({
            data: { ...scalarsOf(s, ["voucherId", "product", "branch"]), voucherId: voucher.id } as unknown as Prisma.InvStockLedgerUncheckedCreateInput,
        });
    }

    if (isLive(snap.status, snap.deletedAt, snap.cancelledAt)) {
        // Stock caches forward (re-apply each row's net inQty - outQty).
        for (const s of stockEntries) {
            const delta = Math.round(toNumber(s.inQty as Num)) - Math.round(toNumber(s.outQty as Num));
            if (delta === 0) continue;
            const upd = delta > 0 ? { increment: delta } : { decrement: -delta };
            await tx.invProductBranch.upsert({
                where: { productId_branchId: { productId: s.productId as number, branchId: s.branchId as string } },
                create: { productId: s.productId as number, branchId: s.branchId as string, stock: delta },
                update: { stock: upd },
            });
            await tx.invProduct.update({ where: { id: s.productId as number }, data: { stock: upd } });
        }
        // Account.balance forward, from the JE lines (carry account.normalBalance), if the JE is live.
        if (journalEntry && isLive(journalEntry.status, journalEntry.deletedAt, undefined)) {
            await reapplyBalance(tx, journalEntry.lines ?? []);
        }
    }

    return String(snap.reference);
}
