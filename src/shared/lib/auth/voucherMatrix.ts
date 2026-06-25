import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import type { VoucherType } from "@/generated/prisma/client";

/**
 * GL voucher permission matrix — the single source of truth mapping each GL
 * voucher kind to its per-action permission ids. Consumed by:
 *   • the accountancy voucher route guards (resolve the required key by kind),
 *   • the Role page matrix (rows = kinds, columns = actions),
 *   • the Department picker (a dept toggle for a kind = pool that kind's ids).
 *
 * Four actions, matching what the code enforces:
 *   • create  — make a new voucher.
 *   • post    — DRAFT → POSTED (applies GL).
 *   • cancel  — cancel + edit + (future) convert-to-draft. One eligibility.
 *   • delete  — the single removal. Soft-delete was retired (2026-06-09); the
 *               former "hard-delete" is now just "delete" (recoverable from the
 *               Recycle Bin via the audit snapshot).
 * No own/branch/org scope (not enforced for vouchers).
 */

export type VoucherAction = "create" | "post" | "cancel" | "delete";

export const VOUCHER_ACTIONS: { key: VoucherAction; label: string }[] = [
    { key: "create", label: "Create" },
    { key: "post",   label: "Post" },
    { key: "cancel", label: "Cancel / edit" },
    { key: "delete", label: "Delete" },
];

/** The generic (kind-agnostic) keys — kept as an additive fallback in guards. */
export const GENERIC_VOUCHER_PERMISSION: Record<VoucherAction, string> = {
    create: PERMISSIONS.FINANCE_VOUCHER_CREATE,
    post:   PERMISSIONS.FINANCE_VOUCHER_POST,
    cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL,
    delete: PERMISSIONS.FINANCE_VOUCHER_DELETE,
};

export interface VoucherMatrixRow {
    type:  VoucherType;
    label: string;
    perms: Record<VoucherAction, string>;
}

export const GL_VOUCHER_MATRIX: VoucherMatrixRow[] = [
    {
        type: "PAYMENT", label: "Payment voucher",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_PAYMENT,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_PAYMENT,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_PAYMENT,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_PAYMENT,
        },
    },
    {
        type: "RECEIPT", label: "Receipt voucher",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_RECEIPT,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_RECEIPT,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_RECEIPT,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_RECEIPT,
        },
    },
    {
        type: "CONTRA", label: "Contra voucher",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_CONTRA,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_CONTRA,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_CONTRA,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_CONTRA,
        },
    },
    {
        type: "CREDIT_NOTE", label: "Credit note",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_CREDIT_NOTE,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_CREDIT_NOTE,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_CREDIT_NOTE,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_CREDIT_NOTE,
        },
    },
    {
        type: "DEBIT_NOTE", label: "Debit note",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_DEBIT_NOTE,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_DEBIT_NOTE,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_DEBIT_NOTE,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_DEBIT_NOTE,
        },
    },
    {
        type: "JOURNAL", label: "Journal voucher",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_JOURNAL,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_JOURNAL,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_JOURNAL,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_JOURNAL,
        },
    },
];

const ROW_BY_TYPE = new Map<VoucherType, VoucherMatrixRow>(GL_VOUCHER_MATRIX.map(r => [r.type, r]));

/** Every per-kind permission id (all kinds × all actions) — e.g. for pool helpers. */
export const ALL_VOUCHER_PERMISSION_IDS: string[] = GL_VOUCHER_MATRIX.flatMap(r => Object.values(r.perms));

/** The action permission ids for one voucher kind — what a department toggle pools. */
export function voucherKindPermissionIds(type: VoucherType): string[] {
    const row = ROW_BY_TYPE.get(type);
    return row ? Object.values(row.perms) : [];
}

/**
 * Resolve the permission id required to perform `action` on a voucher of `type`,
 * plus the generic fallback. Guards should allow the action if the user holds
 * EITHER (additive — legacy generic grants keep working).
 */
export function requiredVoucherPermission(
    type: VoucherType,
    action: VoucherAction,
): { perKind: string | null; generic: string } {
    const row = ROW_BY_TYPE.get(type);
    return { perKind: row ? row.perms[action] : null, generic: GENERIC_VOUCHER_PERMISSION[action] };
}
