// Voucher lifecycle helpers — shared between JournalEntry, InvVoucher, and
// the finance Voucher table. Two tiers:
//
//   POSTED  ──cancel──►  CANCELLED   (reference number kept, GL reversed)
//      ▲                     │
//      └──────restore────────┘        (re-applies exactly what cancel reversed)
//      │
//      └─delete──► row REMOVED, whole graph snapshotted to AuditLog = the
//                  Recycle Bin (restore via POST /api/audit/[id]/restore)
//
// Restore is the mirror of cancel, not a fresh posting: cancel's every artifact
// is identifiable (negative stock-ledger row, gift-card REFUND txn, coupon
// `reversedAt` stamp, REVERSAL_RETURN loyalty rows — all keyed to the voucher's
// OWN spine), so restore deletes those rows and puts the counters back. It is
// gated by the same permission as cancel: whoever may cancel a voucher kind may
// restore it.
//
// There is only ONE delete. The middle soft-delete tier (set `deletedAt`, hide
// from views, restore flips it back) was removed on 2026-08-01: it had no UI
// entry point, no route left, and zero rows in the database — Cancel already
// covers "undo but keep it visible" and hard-delete covers "remove recoverably".
// The `deletedAt` COLUMNS and the `deletedAt: null` read filters deliberately
// remain (dropping them needs a schema push and a sweep through Balance Sheet /
// valuation); they are now always-true guards. Nothing writes `deletedAt`.
//
// The GL / stock reversal logic itself stays in each route handler since it
// differs per voucher type. These helpers cover the bookkeeping boilerplate
// (validation, field shapes, status-string normalisation) so each route stays
// thin.
//
// The legacy `InvoiceLifecycleStatus` enum + `cancelInvoiceFields` helper
// were dropped on 2026-05-24 with the Invoice → InvVoucher consolidation;
// every voucher kind now lives on the shared `VoucherStatus` enum
// (DRAFT / POSTED / CANCELLED).

export type LifecycleStatus = "DRAFT" | "POSTED" | "CANCELLED" | "DRAFT_INV";

export interface LifecycleVoucher {
  status: string;
  cancelledAt?: Date | null;
  deletedAt?: Date | null;
}

export class LifecycleError extends Error {
  constructor(public httpStatus: number, message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

// ── Predicates ────────────────────────────────────────────────────────────

/** True when the voucher has been cancelled. */
export function isCancelled(v: LifecycleVoucher): boolean {
  return v.status === "CANCELLED" || !!v.cancelledAt;
}

/** True when the voucher has been soft-deleted. */
export function isDeleted(v: LifecycleVoucher): boolean {
  return !!v.deletedAt;
}

/** True when the voucher has live GL/stock impact and could be cancelled. */
export function isPosted(v: LifecycleVoucher): boolean {
  return v.status === "POSTED";
}

/** True when the voucher is still a draft (no GL impact). */
export function isDraft(v: LifecycleVoucher): boolean {
  return v.status === "DRAFT";
}

// ── Pre-flight checks (throw LifecycleError on failure) ───────────────────

export function ensureCancelable(v: LifecycleVoucher): void {
  if (isDeleted(v)) throw new LifecycleError(409, "Cannot cancel a deleted voucher — restore it first");
  if (isCancelled(v)) throw new LifecycleError(409, "Voucher is already cancelled");
  if (!isPosted(v)) throw new LifecycleError(409, "Only POSTED vouchers can be cancelled");
}

export function ensureRestorable(v: LifecycleVoucher): void {
  if (isDeleted(v)) throw new LifecycleError(409, "Cannot restore a deleted voucher — use the Recycle Bin");
  if (!isCancelled(v)) throw new LifecycleError(409, "Only cancelled vouchers can be restored");
}

// ── Field-shape helpers for prisma `data` payloads ────────────────────────

/** Cancel-tier field updates for vouchers using VoucherStatus (every voucher kind, post-2026-05-24). */
export function cancelFields(userId: number, reason: string) {
  return {
    status: "CANCELLED" as const,
    cancelledAt: new Date(),
    cancelledById: userId,
    cancelReason: reason,
  };
}

/** Restore-tier field updates — clears every stamp `cancelFields` set. */
export function restoreFields() {
  return {
    status: "POSTED" as const,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
  };
}

// ── Audit-snapshot helper ─────────────────────────────────────────────────

/** Discriminator for the unified AuditLog table. */
export type AuditEntityType = "INV_VOUCHER" | "GL_VOUCHER" | "JOURNAL_ENTRY";

/**
 * Build the payload for an `AuditLog` row written during hard-delete. Caller passes
 * the entity type, the full row (including child relations like lines), the actor,
 * and the reason.
 */
export function auditSnapshot(args: {
  entityType: AuditEntityType;
  subtype?: string | null;
  originalId: number;
  originalRef: string;
  reason?: string | null;
  snapshot: unknown;
  actorId: number;
  action?: string;
}) {
  return {
    entityType: args.entityType,
    subtype: args.subtype ?? null,
    originalId: args.originalId,
    originalRef: args.originalRef,
    action: args.action ?? "HARD_DELETED",
    reason: args.reason ?? null,
    snapshot: args.snapshot as object,
    actorId: args.actorId,
  };
}

// ── HTTP helper for route handlers ────────────────────────────────────────

import { NextResponse } from "next/server";

/** Convert a thrown LifecycleError to a NextResponse; rethrow other errors. */
export function lifecycleErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof LifecycleError) {
    return NextResponse.json({ error: err.message }, { status: err.httpStatus });
  }
  return null;
}
