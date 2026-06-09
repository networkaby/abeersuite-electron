// Voucher lifecycle helpers — shared between JournalEntry, InvVoucher, and
// the finance Voucher table. Tally-style three-tier model:
//
//   POSTED  ──cancel──►  CANCELLED   (reference number kept, GL reversed)
//      │
//      └─delete──► (deletedAt set, hidden from views, GL reversed; restore flips it back)
//                  │
//                  └─hard-delete──► row removed, snapshot to audit table
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

export function ensureDeletable(v: LifecycleVoucher): void {
  if (isDeleted(v)) throw new LifecycleError(409, "Voucher is already deleted");
  if (isCancelled(v)) {
    throw new LifecycleError(
      409,
      "Cannot delete a cancelled voucher — its GL impact is already reversed (marked CANCELLED). Hard-delete instead.",
    );
  }
}

export function ensureRestorable(v: LifecycleVoucher): void {
  if (!isDeleted(v)) throw new LifecycleError(409, "Voucher is not deleted");
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

/** Delete-tier field updates. Status is left untouched (still POSTED/SENT/whatever). */
export function deleteFields(userId: number, reason: string) {
  return {
    deletedAt: new Date(),
    deletedById: userId,
    deleteReason: reason,
  };
}

/** Inverse of delete — clears the soft-delete metadata. */
export function restoreFields() {
  return {
    deletedAt: null,
    deletedById: null,
    deleteReason: null,
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
  originalId: number;
  originalRef: string;
  reason?: string | null;
  snapshot: unknown;
  actorId: number;
  action?: string;
}) {
  return {
    entityType: args.entityType,
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
