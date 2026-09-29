import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import type { VoucherType, InvVoucherType } from "@/generated/prisma/client";

/**
 * Voucher permission matrix — the single source of truth mapping each voucher
 * kind to its per-action permission ids. Consumed by:
 *   • the voucher route guards (resolve the required key by kind),
 *   • the Role page matrix (rows = kinds, columns = actions),
 *   • the Department picker (a dept toggle for a kind = pool that kind's ids),
 *   • the bootstrap seed (mints a Permission row per id — see voucherPermissionSeeds).
 *
 * Every voucher kind is independent: granting "Sale" never implies "Purchase".
 * GL (accounting) kinds live in the `finance:voucher:*` namespace and are
 * already enforced by the accountancy routes. Inventory kinds live in the
 * `inventory:voucher:*` namespace; their per-kind enforcement is wired in a
 * later phase — until then the inventory routes fall back to the generic
 * `inventory:edit/voucher:*` keys (see requiredVoucherPermission).
 *
 * Four write-lifecycle actions, enforced by the voucher route guards. They form
 * a ladder — a higher rung implies the lowers (see crudLadder.ts), so only the
 * highest granted rung is stored/carried:
 *   • create  — make a new voucher (draft).
 *   • post    — DRAFT → POSTED (applies stock + GL).
 *   • cancel  — cancel + edit + (future) convert-to-draft. One eligibility.
 *   • delete  — the single removal (recoverable from the Recycle Bin).
 * Read access (view/open) is NOT gated per kind — reads are default-open; seeing
 * the rows rides the module sidebar nav. No own/branch/org scope either.
 *
 * POS / online channel variants (POS, POS_ORDER, POS_ESTIMATE, ONLINE_ORDER,
 * ONLINE_INVOICE) are intentionally NOT here — they are not hand-created from the
 * voucher menu. POS Sale / Order / Estimate ride the POS matrix instead
 * (posVoucherMatrix.ts) for Create and for their Day Book Edit / Cancel / Delete;
 * online orders are gated by their own flow.
 */

// The write actions enforced by the voucher route guards — also the matrix
// columns (view/open retired: reads are default-open). A create⇒post⇒cancel⇒
// delete ladder (crudLadder.ts) means only the highest granted rung is stored.
export type VoucherAction = "create" | "post" | "cancel" | "delete";

export const VOUCHER_ACTIONS: { key: VoucherAction; label: string }[] = [
    { key: "create", label: "Create" },
    { key: "post",   label: "Post" },
    { key: "cancel", label: "Cancel / edit" },
    { key: "delete", label: "Delete" },
];

/**
 * Vouchers are grouped by their *economic nature* (which legs they post), not by
 * module:
 *   • gl        — GL leg only, no stock (Payment, Receipt, Journal…).
 *   • trading   — both legs: GL + stock (Sale, Purchase, and their returns).
 *   • inventory — stock leg only, no GL (Physical Stock, Branch Transfer, GRN…).
 *   • optional  — no real transaction: neither GL nor stock (Estimate, Orders).
 */
export type VoucherGroupKey = "gl" | "trading" | "inventory" | "optional";

export const VOUCHER_GROUPS: { key: VoucherGroupKey; label: string }[] = [
    { key: "gl",        label: "GL vouchers" },
    { key: "trading",   label: "Trading vouchers" },
    { key: "inventory", label: "Inventory vouchers" },
    { key: "optional",  label: "Optional vouchers" },
];

// Rows carry the four write-action ids (matching the existing constants).
interface RawVoucherRow {
    type:   VoucherType | InvVoucherType;
    label:  string;
    group:  VoucherGroupKey;
    module: "finance" | "inventory";
    perms:  Record<VoucherAction, string>;
}

export interface VoucherMatrixRow {
    type:   VoucherType | InvVoucherType;
    label:  string;
    group:  VoucherGroupKey;
    module: "finance" | "inventory";
    perms:  Record<VoucherAction, string>;
}

// ── Accounting (GL) kinds — finance:voucher:<action>:<kind> ──────────────────
// Ids match the PERMISSIONS constants exactly; kept explicit so the existing,
// already-enforced GL keys are obvious at a glance.
const GL_ROWS: RawVoucherRow[] = [
    {
        type: "PAYMENT", label: "Payment voucher", group: "gl", module: "finance",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_PAYMENT,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_PAYMENT,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_PAYMENT,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_PAYMENT,
        },
    },
    {
        type: "RECEIPT", label: "Receipt voucher", group: "gl", module: "finance",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_RECEIPT,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_RECEIPT,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_RECEIPT,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_RECEIPT,
        },
    },
    {
        type: "CONTRA", label: "Contra voucher", group: "gl", module: "finance",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_CONTRA,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_CONTRA,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_CONTRA,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_CONTRA,
        },
    },
    {
        type: "CREDIT_NOTE", label: "Credit note", group: "gl", module: "finance",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_CREDIT_NOTE,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_CREDIT_NOTE,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_CREDIT_NOTE,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_CREDIT_NOTE,
        },
    },
    {
        type: "DEBIT_NOTE", label: "Debit note", group: "gl", module: "finance",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_DEBIT_NOTE,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_DEBIT_NOTE,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_DEBIT_NOTE,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_DEBIT_NOTE,
        },
    },
    {
        type: "JOURNAL", label: "Journal voucher", group: "gl", module: "finance",
        perms: {
            create: PERMISSIONS.FINANCE_VOUCHER_CREATE_JOURNAL,
            post:   PERMISSIONS.FINANCE_VOUCHER_POST_JOURNAL,
            cancel: PERMISSIONS.FINANCE_VOUCHER_CANCEL_JOURNAL,
            delete: PERMISSIONS.FINANCE_VOUCHER_DELETE_JOURNAL,
        },
    },
];

// ── Inventory kinds — inventory:voucher:<action>:<kind> ──────────────────────
// Defined compactly; the per-action ids + seed entries are derived below.
const INV_KINDS: { type: InvVoucherType; label: string; slug: string; group: VoucherGroupKey }[] = [
    // Trading — both legs (GL + stock)
    { type: "SALE",            label: "Sale",            slug: "sale",            group: "trading" },
    { type: "PURCHASE",        label: "Purchase",        slug: "purchase",        group: "trading" },
    { type: "SALE_RETURN",     label: "Sale Return",     slug: "sale-return",     group: "trading" },
    { type: "PURCHASE_RETURN", label: "Purchase Return", slug: "purchase-return", group: "trading" },
    // Inventory — stock leg only (no GL)
    { type: "GRN",                   label: "GRN",                   slug: "grn",                   group: "inventory" },
    { type: "CHALLAN",               label: "Challan",               slug: "challan",               group: "inventory" },
    { type: "PHYSICAL_STOCK",        label: "Physical Stock",        slug: "physical-stock",        group: "inventory" },
    { type: "BRANCH_TRANSFER",       label: "Branch Transfer",       slug: "branch-transfer",       group: "inventory" },
    { type: "MANUFACTURING_JOURNAL", label: "Manufacturing Journal", slug: "manufacturing-journal", group: "inventory" },
    { type: "REJECTION_IN",          label: "Rejection In",          slug: "rejection-in",          group: "inventory" },
    { type: "REJECTION_OUT",         label: "Rejection Out",         slug: "rejection-out",         group: "inventory" },
    // Optional — no real transaction (neither GL nor stock)
    { type: "ESTIMATE",       label: "Estimate",       slug: "estimate",       group: "optional" },
    { type: "SALES_ORDER",    label: "Sales Order",    slug: "sales-order",    group: "optional" },
    { type: "PURCHASE_ORDER", label: "Purchase Order", slug: "purchase-order", group: "optional" },
];

const invPermId = (action: VoucherAction, slug: string) => `inventory:voucher:${action}:${slug}`;

const INV_ROWS: RawVoucherRow[] = INV_KINDS.map((k) => ({
    type: k.type,
    label: k.label,
    group: k.group,
    module: "inventory",
    perms: {
        create: invPermId("create", k.slug),
        post:   invPermId("post", k.slug),
        cancel: invPermId("cancel", k.slug),
        delete: invPermId("delete", k.slug),
    },
}));

/** Every hand-created voucher kind (GL + inventory), in display order. */
export const VOUCHER_MATRIX: VoucherMatrixRow[] = [...GL_ROWS, ...INV_ROWS];

/** GL-only view — kept for callers that only deal with accountancy vouchers. */
export const GL_VOUCHER_MATRIX: VoucherMatrixRow[] = GL_ROWS;

const ROW_BY_TYPE = new Map<VoucherType | InvVoucherType, VoucherMatrixRow>(
    VOUCHER_MATRIX.map((r) => [r.type, r]),
);

/** Every per-kind permission id (all kinds × all actions) — e.g. for pool helpers. */
export const ALL_VOUCHER_PERMISSION_IDS: string[] = VOUCHER_MATRIX.flatMap((r) => Object.values(r.perms));

/** The action permission ids for one voucher kind — what a department toggle pools. */
export function voucherKindPermissionIds(type: VoucherType | InvVoucherType): string[] {
    const row = ROW_BY_TYPE.get(type);
    return row ? Object.values(row.perms) : [];
}

/**
 * The per-kind permission id required to perform `action` on a voucher of `type`,
 * or null for kinds with no matrix row (POS / online channel variants). The old
 * generic (kind-agnostic) fallback keys were retired — authorization is per-kind.
 */
export function requiredVoucherPermission(
    type: VoucherType | InvVoucherType | string,
    action: VoucherAction,
): string | null {
    const row = ROW_BY_TYPE.get(type as VoucherType);
    return row ? row.perms[action] : null;
}

// ── Seed helper ──────────────────────────────────────────────────────────────
const SEED_TEXT: Record<VoucherAction, (label: string) => { label: string; description: string }> = {
    create: (l) => ({ label: `Create ${l}`,        description: `Create a ${l} voucher (draft).` }),
    post:   (l) => ({ label: `Post ${l}`,          description: `Post a ${l} voucher (applies stock + GL). Implies Create.` }),
    cancel: (l) => ({ label: `Cancel / edit ${l}`, description: `Cancel, edit, or revert a ${l} voucher. Implies Post + Create.` }),
    delete: (l) => ({ label: `Delete ${l}`,        description: `Remove a ${l} voucher (recoverable from the Recycle Bin). Implies Cancel + Post + Create.` }),
};

/**
 * Permission rows for the voucher matrix, for the bootstrap seed: the INVENTORY
 * write ids (create/post/cancel/delete). The GL write ids are seeded explicitly
 * in bootstrap-seed.ts (already enforced), so they are not repeated here. View /
 * open ids were retired (reads are default-open). Generated so nothing drifts.
 */
export function voucherPermissionSeeds(): { id: string; label: string; module: string; description: string }[] {
    const actions: VoucherAction[] = ["create", "post", "cancel", "delete"];
    return VOUCHER_MATRIX.flatMap((r) =>
        r.module === "inventory"
            ? actions.map((a) => {
                const text = SEED_TEXT[a](r.label);
                return { id: r.perms[a], label: text.label, module: r.module, description: text.description };
            })
            : [],
    );
}
