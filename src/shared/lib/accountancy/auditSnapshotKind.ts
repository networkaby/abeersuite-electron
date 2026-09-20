// Which kind of copy a Recycle Bin row is.
//
// Two very different things land in `AuditLog`, and until now nothing told them
// apart on screen:
//
//   DELETE — the voucher was removed from the books. This row IS the voucher's
//            last surviving copy; restoring it brings the voucher back.
//   EDIT   — the voucher was edited in place and this is how it looked BEFORE
//            that edit. The voucher itself is still alive under the same number;
//            restoring this row brings back the older version of it.
//
// It matters for the permanent delete: destroying an EDIT copy only costs you the
// ability to go back to that older version, while destroying the DELETE copy ends
// the voucher for good — so that one takes every other copy of the voucher with it.
//
// Rows written from 2026-09-20 carry `action: "PRE_EDIT"`, which is the real
// answer. Everything written before that day defaulted to "HARD_DELETED" whatever
// it was, so the reason line — which the edit routes have always written as
// "Edit (in-place) of …" — is what identifies those. Read, never rewritten: the
// audit trail is evidence and does not get tidied up after the fact.

export type AuditSnapshotKind = "DELETE" | "EDIT";

/** The `action` stamped on a pre-edit snapshot. */
export const PRE_EDIT_ACTION = "PRE_EDIT";

export function auditSnapshotKind(row: { action?: string | null; reason?: string | null }): AuditSnapshotKind {
    if (row.action === PRE_EDIT_ACTION) return "EDIT";
    if (row.reason?.startsWith("Edit (in-place) of")) return "EDIT";
    return "DELETE";
}
