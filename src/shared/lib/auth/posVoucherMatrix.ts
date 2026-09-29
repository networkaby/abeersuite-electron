import { VOUCHER_MATRIX, type VoucherAction } from "@/shared/lib/auth/voucherMatrix";
import { crudSatisfied } from "@/shared/lib/auth/crudLadder";
import type { VoucherType, InvVoucherType } from "@/generated/prisma/client";

/**
 * POS voucher matrix — the POS UI's own voucher components (Sale, Order, Estimate,
 * Receipt, Expense…) in a dedicated `pos:voucher:<action>:<kind>` family.
 *
 * Actions: Create / Cancel·edit / Delete. There is NO "post" — POS creates-and-
 * commits directly (no draft). Visibility is implied by Create: if a role can
 * create a kind it can see it, so there is no separate "available/view" gate.
 *
 * Cross-scope rule (office ⊇ POS): the POS guard allows the action if the holder
 * has the POS id OR the office-equivalent voucher permission. Use `canDoPosVoucher`
 * for the check.
 *
 * Where a POS grant reaches the office: only for the three channel kinds that are
 * SAVED as their own voucher type (POS Sale → POS, POS Order → POS_ORDER, POS
 * Estimate → POS_ESTIMATE; see `posKindForVoucherType`). They have no row in the
 * office voucher matrix, so their Day Book Edit / Cancel / Delete ride this row.
 * The other three save as office kinds (SALE_RETURN / RECEIPT / PAYMENT) and are
 * gated in the office by the office matrix alone.
 *
 * Single source of truth — consumed by the Role page POS section, the POS guards,
 * and the bootstrap seed (`posVoucherPermissionSeeds`).
 */

export type PosAction = "create" | "cancel" | "delete";

export const POS_ACTIONS: { key: PosAction; label: string }[] = [
    { key: "create", label: "Create" },
    { key: "cancel", label: "Cancel / edit" },
    { key: "delete", label: "Delete" },
];

export const posVoucherPermissionId = (action: PosAction, kind: string) =>
    `pos:voucher:${action}:${kind}`;

interface PosKindDef {
    key: string;
    label: string;
    /** Office voucher kind this maps to — powers the office ⊇ POS OR-check. */
    officeType: VoucherType | InvVoucherType;
    /** The voucher `type` it is saved as, when that is its own channel kind
     *  (not an office kind) — lets the Day Book find this row from a voucher. */
    savedAs?: string;
}

// Every POS kind supports Available / Create / Cancel / Delete.
const POS_KINDS: PosKindDef[] = [
    { key: "sale",        label: "POS Sale",        officeType: "SALE",        savedAs: "POS" },
    { key: "sale-return", label: "POS Sale Return", officeType: "SALE_RETURN" },
    { key: "order",       label: "POS Order",       officeType: "SALES_ORDER", savedAs: "POS_ORDER" },
    { key: "estimate",    label: "POS Estimate",    officeType: "ESTIMATE",    savedAs: "POS_ESTIMATE" },
    { key: "receipt",     label: "POS Receipt",     officeType: "RECEIPT" },
    { key: "expense",     label: "POS Expense",     officeType: "PAYMENT" },
];

/** The POS row a saved voucher belongs to — "sale" for a POS voucher, "order"
 *  for POS_ORDER, "estimate" for POS_ESTIMATE — or null for every other type. */
export function posKindForVoucherType(type: string): string | null {
    return POS_KINDS.find((k) => k.savedAs === type)?.key ?? null;
}

const OFFICE_ROW_BY_TYPE = new Map(VOUCHER_MATRIX.map((r) => [r.type, r]));

export interface PosVoucherMatrixRow {
    key: string;
    label: string;
    officeType: VoucherType | InvVoucherType;
    /** POS permission id per action. */
    perms: Record<PosAction, string>;
}

export const POS_VOUCHER_MATRIX: PosVoucherMatrixRow[] = POS_KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    officeType: k.officeType,
    perms: Object.fromEntries(
        POS_ACTIONS.map((a) => [a.key, posVoucherPermissionId(a.key, k.key)]),
    ) as Record<PosAction, string>,
}));

/** Every POS voucher permission id — used to keep them out of the loose chips. */
export const ALL_POS_VOUCHER_PERMISSION_IDS: string[] =
    POS_VOUCHER_MATRIX.flatMap((r) => Object.values(r.perms));

/** The office-equivalent voucher permission for a POS action (superset OR-check). */
export function officeEquivalentPosPermission(kind: string, action: PosAction): string | null {
    const def = POS_KINDS.find((k) => k.key === kind);
    if (!def) return null;
    const row = OFFICE_ROW_BY_TYPE.get(def.officeType);
    return row ? row.perms[action as VoucherAction] : null;
}

/**
 * POS guard: may the holder perform `action` on POS `kind`? True if they hold
 * the POS permission OR the office-equivalent (office ⊇ POS; not for "view").
 * Admin bypass passes. Office guards consult it only for the channel kinds
 * (`posKindForVoucherType`) — for every office kind the POS grant is ignored.
 */
export function canDoPosVoucher(
    kind: string,
    action: PosAction,
    held: Set<string> | string[],
    isAdmin = false,
): boolean {
    if (isAdmin) return true;
    // crudSatisfied honours the ladder on both families: a POS delete grant
    // covers cancel/create; an office delete/cancel/post grant covers the lower
    // office-equivalent action (office ⊇ POS).
    const set = Array.isArray(held) ? new Set(held) : held;
    const office = officeEquivalentPosPermission(kind, action);
    return crudSatisfied(set, posVoucherPermissionId(action, kind))
        || (!!office && crudSatisfied(set, office));
}

const ACTION_LABEL: Record<PosAction, string> =
    Object.fromEntries(POS_ACTIONS.map((a) => [a.key, a.label])) as Record<PosAction, string>;

/** Permission rows for the POS voucher perms, for the bootstrap seed (module "pos"). */
export function posVoucherPermissionSeeds(): { id: string; label: string; module: string; description: string }[] {
    return POS_VOUCHER_MATRIX.flatMap((r) =>
        POS_ACTIONS.map((a) => ({
            id: r.perms[a.key],
            label: `${r.label} — ${ACTION_LABEL[a.key]}`,
            module: "pos",
            description: `${ACTION_LABEL[a.key]} a ${r.label} in the POS UI. The office-equivalent voucher permission also grants this.`,
        })),
    );
}
