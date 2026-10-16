import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** The AuditLog fields that say which voucher a Recycle Bin row is a copy OF. */
export interface AuditCopyRef {
    id: number;
    entityType: string;
    subtype: string | null;
    originalId: number;
    originalRef: string;
}

/**
 * The Recycle Bin rows whose voucher is still on the books. Restoring one of them would
 * not bring a voucher back. It would add a second live voucher with the same lines,
 * the same party and the same createdAt. That is how POS-910861/862 (ids 3774/3785)
 * became one bill saved twice: a pre-edit copy was restored the morning after the edit.
 *
 * Two ways to be "still there", and both are checked:
 *   - the original row itself: a VoucherDetail id for INV_VOUCHER, a spine id otherwise;
 *   - a voucher of the same kind under the same number. That covers a copy whose
 *     voucher was deleted and has since been restored under a fresh id.
 *
 * Batched: one query per check whatever the number of rows, so the bin list stays cheap.
 */
export async function liveAuditCopyIds(db: Db, rows: AuditCopyRef[]): Promise<Set<number>> {
    if (rows.length === 0) return new Set();
    const detailIds = rows.filter((r) => r.entityType === "INV_VOUCHER").map((r) => r.originalId);
    const spineIds  = rows.filter((r) => r.entityType !== "INV_VOUCHER").map((r) => r.originalId);
    const refs      = rows.filter((r) => r.originalRef && r.subtype).map((r) => r.originalRef);

    const [details, spines, byNumber] = await Promise.all([
        detailIds.length ? db.voucherDetail.findMany({ where: { id: { in: detailIds } }, select: { id: true } }) : [],
        spineIds.length ? db.universalVoucher.findMany({ where: { id: { in: spineIds } }, select: { id: true } }) : [],
        refs.length ? db.universalVoucher.findMany({ where: { voucherNo: { in: refs } }, select: { voucherNo: true, type: true } }) : [],
    ]);
    const liveDetail = new Set(details.map((d) => d.id));
    const liveSpine  = new Set(spines.map((s) => s.id));
    const liveNumber = new Set(byNumber.map((v) => `${v.type}|${v.voucherNo}`));

    const out = new Set<number>();
    for (const r of rows) {
        const own = r.entityType === "INV_VOUCHER" ? liveDetail.has(r.originalId) : liveSpine.has(r.originalId);
        if (own || (r.subtype && liveNumber.has(`${r.subtype}|${r.originalRef}`))) out.add(r.id);
    }
    return out;
}
