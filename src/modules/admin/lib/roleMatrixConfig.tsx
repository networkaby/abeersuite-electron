// ── Role-page config: matrices, form types + helpers ─────────────────────────
// Extracted from office/admin/role/page.tsx (which had grown past 2,200 lines).
// Pure data + types + two tiny helpers — no state, no components.


import axios from "axios";
import { type MatrixColumnGroup, type MatrixRow, type ColumnTint } from "@/shared/components/PermissionMatrix";
import {
    VOUCHER_MATRIX,
    VOUCHER_GROUPS,
    VOUCHER_ACTIONS,
    type VoucherGroupKey,
} from "@/shared/lib/auth/voucherMatrix";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
import { POS_VOUCHER_MATRIX, POS_ACTIONS } from "@/shared/lib/auth/posVoucherMatrix";
import type { LucideIcon } from "lucide-react";
import { BUTTON_BAR_ACTIONS } from "@/shared/lib/constants/quickActions";
import { createActionPermission } from "@/utils/module-access";

// Column tint per voucher action for the GL voucher matrix.
export const VOUCHER_ACTION_TINT: Record<string, ColumnTint> = {
    view: "gray", open: "blue", create: "green", post: "blue", cancel: "amber", delete: "rose",
};
export const VOUCHER_COLUMN_GROUPS: MatrixColumnGroup[] = VOUCHER_ACTIONS.map((a) => ({
    key: a.key, label: a.label, tint: VOUCHER_ACTION_TINT[a.key], columns: [{ key: a.key, label: a.label }],
}));
// Voucher rows grouped by economic nature (GL / Trading / Inventory / Optional),
// each rendered as its own matrix so the groups read as separate sections.
export const VOUCHER_ROWS_BY_GROUP: { key: VoucherGroupKey; label: string; rows: MatrixRow[] }[] = VOUCHER_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: VOUCHER_MATRIX.filter((r) => r.group === g.key).map((r) => ({
        key: r.type, label: r.label,
        cells: Object.fromEntries(VOUCHER_ACTIONS.map((a) => [a.key, r.perms[a.key]])),
    })),
}));
// POS voucher matrix (gates the /vouchers/pos UI only). Shown only when the role
// can see POS (the workspace visibility toggle). Sparse cells render as N/A.
export const POS_VISIBILITY_ID = sidebarChildPermissionId("workspace", "pos");
export const POS_MATRIX_ROWS: MatrixRow[] = POS_VOUCHER_MATRIX.map((r) => ({ key: r.key, label: r.label, cells: { ...r.perms } }));
// POS columns: Create / Cancel·edit / Delete (no Post — POS has no draft; visibility
// is implied by Create, so there is no separate "available" column).
export const POS_ACTION_TINT: Record<string, ColumnTint> = { create: "green", cancel: "amber", delete: "rose" };
export const POS_COLUMN_GROUPS: MatrixColumnGroup[] = POS_ACTIONS
    .map((a) => ({ key: a.key, label: a.label, tint: POS_ACTION_TINT[a.key] ?? "gray", columns: [{ key: a.key, label: a.label }] }));
// Operator-scoped shift actions for the POS block: managing one's own till on one's
// own counter — start/end the shift (open implies close) and drop cash to the safe.
// Oversight (manage/force-close, view other branches) is a separate management
// concern and falls through to Additional permissions.
export const POS_OPERATOR_SHIFT_CHIPS: { label: string; ids: string[] }[] = [
    { label: "Start / End shift", ids: ["pos:shift:open", "pos:shift:close"] },
    { label: "Cash drop", ids: ["pos:shift:drop"] },
];
export const POS_BLOCK_SHIFT_IDS = POS_OPERATOR_SHIFT_CHIPS.flatMap((c) => c.ids);

// Quick-action options for the role's button bar — every creatable thing (vouchers
// + Repair + POS), de-duped by the create permission it maps to. Ticking a chip
// grants that create key to the role, so it appears in the role's Quick Actions.
// `ids` is everything the chip grants together: "POS +" is pos:shift:open, and a
// shift that can be opened must be closable, so it takes the same open + close
// pair as the "Start / End shift" chip — the two chips can never disagree.
export const QUICK_ACTION_OPTIONS: { permission: string; ids: string[]; label: string; icon: LucideIcon }[] = (() => {
    const seen = new Set<string>();
    const out: { permission: string; ids: string[]; label: string; icon: LucideIcon }[] = [];
    for (const a of BUTTON_BAR_ACTIONS) {
        const permission = createActionPermission(a);
        if (!permission || seen.has(permission)) continue;
        seen.add(permission);
        const ids = POS_OPERATOR_SHIFT_CHIPS.find((c) => c.ids.includes(permission))?.ids ?? [permission];
        out.push({ permission, ids, label: a.label.replace(/\s*\+$/, "").trim(), icon: a.icon });
    }
    return out;
})();

// Workspace/universal permissions — offerable to ANY role regardless of the
// department pool (like the Workspace sidebar items: Inbox, Work Flow, POS).
// The Role Matrix lens always includes these so they can be granted in any
// department. Module-scoped actions (deals:create, tasks:create, vouchers) are
// NOT here — those stay pool-gated to the departments that carry their module.
export const POOL_EXEMPT_PERMISSION_IDS = new Set<string>([
    "quick-actions:more",
    "auth:login:outside-counter",
    "mobile:stock:view",
    "mobile:parties:view",
]);

export interface Permission {
    id: string;
    label: string;
    module: string;
    description?: string | null;
}

// A Work the role can be granted directly (independent of the department pool).
// A *gated* work carries a `work:<id>` permission — ticking it grants that
// permission. An ungated work has no permission and is open to all staff.
export interface WorkRow {
    id: string;
    label: string;
    color: string;
    // A work can carry MULTIPLE group tags (many-to-many). In the role grid it
    // sorts under each of its groups' buckets; empty = Ungrouped.
    groupIds: string[];
    permissionId: string | null;
    // "human" works are completed by a person on the Work Inbox; "auto" works are
    // system-run Actions (never gated, never hand-assigned) — excluded from the list.
    kind: string;
}

export interface WorkGroupRow {
    id: string;
    label: string;
    color: string;
    order: number;
}

export interface RoleDepartment {
    id: string;
    name: string;
    isAllAccess: boolean;
}

export interface Department {
    id: string;
    name: string;
    isAllAccess: boolean;
}

export interface Role {
    id: string;
    label: string;
    color: string;
    rank: number;
    isSystem: boolean;
    department?: RoleDepartment | null;
    _count: { users: number };
    permissions: { permissionId: string; permission: Permission }[];
}

export type RoleForm = {
    label: string;
    color: string;
    rank: number;
    departmentId: string;
};

export const EMPTY_ROLE: RoleForm = {
    label: "",
    color: "bg-blue-100 text-blue-600",
    rank: 20,
    departmentId: "",
};

export const COLOR_OPTIONS = [
    { label: "Gray", value: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
    { label: "Blue", value: "bg-blue-100 text-blue-600", dot: "bg-blue-500" },
    { label: "Green", value: "bg-green-100 text-green-600", dot: "bg-green-500" },
    { label: "Red", value: "bg-red-100 text-red-600", dot: "bg-red-500" },
    { label: "Purple", value: "bg-purple-100 text-purple-600", dot: "bg-purple-500" },
    { label: "Orange", value: "bg-orange-100 text-orange-600", dot: "bg-orange-500" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600", dot: "bg-yellow-400" },
    { label: "Teal", value: "bg-teal-100 text-teal-600", dot: "bg-teal-500" },
];

export const ROLE_ACCENT: Record<string, string> = {
    "bg-gray-100 text-gray-600": "border-l-gray-300",
    "bg-blue-100 text-blue-600": "border-l-blue-400",
    "bg-green-100 text-green-600": "border-l-green-400",
    "bg-red-100 text-red-600": "border-l-red-400",
    "bg-purple-100 text-purple-600": "border-l-purple-400",
    "bg-orange-100 text-orange-600": "border-l-orange-400",
    "bg-yellow-100 text-yellow-600": "border-l-yellow-300",
    "bg-teal-100 text-teal-600": "border-l-teal-400",
};

export const NO_COPY_ROLE = "__none__";

export const MATRIX_COLUMN_GROUPS = [
    {
        key: "create",
        label: "CREATE",
        columns: [
            { key: "create", label: "own" },
        ],
    },
    {
        key: "view",
        label: "VIEW",
        columns: [
            { key: "viewOwn", label: "own" },
            { key: "viewBranch", label: "br" },
            { key: "viewOrg", label: "org" },
        ],
    },
    {
        key: "edit",
        label: "EDIT",
        columns: [
            { key: "editOwn", label: "own" },
            { key: "editBranch", label: "br" },
            { key: "editOrg", label: "org" },
        ],
    },
    {
        key: "delete",
        label: "DELETE",
        columns: [
            { key: "deleteOwn", label: "own" },
            { key: "deleteBranch", label: "br" },
            { key: "deleteOrg", label: "org" },
        ],
    },
] as const;

export type MatrixColumnKey = (typeof MATRIX_COLUMN_GROUPS)[number]["columns"][number]["key"];
export type MatrixPermissionCell = string | string[];

export const MATRIX_ROWS: {
    key: string;
    label: string;
    module: string;
    cells: Partial<Record<MatrixColumnKey, MatrixPermissionCell>>;
}[] = [
        // Repair — the ticket resource, rebuilt the new sidebar-link + CRUD way:
        // one flat create/edit/delete set (tickets:*) surfaced under the "All Repair"
        // link. Tickets carry no branch radius (open to all staff), so the own/branch/
        // org cells all resolve to the same flat id, like Contacts.
        {
            key: "tickets",
            label: "Tickets",
            module: "repair",
            cells: {
                viewOwn: "tickets:create", viewBranch: "tickets:create", viewOrg: "tickets:create",
                create: "tickets:create",
                editOwn: "tickets:edit", editBranch: "tickets:edit", editOrg: "tickets:edit",
                deleteOwn: "tickets:delete", deleteBranch: "tickets:delete", deleteOrg: "tickets:delete",
            },
        },
        // Help Desk — the front-desk enquiry ticket, same flat CRUD shape as repair
        // tickets (no branch radius; open to all staff, gated only by holding the id).
        {
            key: "help",
            label: "Help Tickets",
            module: "help",
            cells: {
                viewOwn: "help:create", viewBranch: "help:create", viewOrg: "help:create",
                create: "help:create",
                editOwn: "help:edit", editBranch: "help:edit", editOrg: "help:edit",
                deleteOwn: "help:delete", deleteBranch: "help:delete", deleteOrg: "help:delete",
            },
        },
        // CRM deals and internal Administration tasks — same flat CRUD shape as the
        // two ticket families above. Neither carries a branch radius, so the own/
        // branch/org cells all resolve to the same flat id.
        {
            key: "deals",
            label: "Deals",
            module: "crm",
            cells: {
                viewOwn: "deals:create", viewBranch: "deals:create", viewOrg: "deals:create",
                create: "deals:create",
                editOwn: "deals:edit", editBranch: "deals:edit", editOrg: "deals:edit",
                deleteOwn: "deals:delete", deleteBranch: "deals:delete", deleteOrg: "deals:delete",
            },
        },
        {
            key: "tasks",
            label: "Tasks",
            module: "administration",
            cells: {
                viewOwn: "tasks:create", viewBranch: "tasks:create", viewOrg: "tasks:create",
                create: "tasks:create",
                editOwn: "tasks:edit", editBranch: "tasks:edit", editOrg: "tasks:edit",
                deleteOwn: "tasks:delete", deleteBranch: "tasks:delete", deleteOrg: "tasks:delete",
            },
        },
        {
            key: "users",
            label: "Users",
            module: "admin",
            cells: {
                viewOwn: "users:manage",
                viewBranch: "users:manage",
                viewOrg: "users:manage",
                create: "users:create",
                editOwn: "users:edit",
                editBranch: "users:edit",
                editOrg: "users:edit",
                deleteOwn: "users:delete",
                deleteBranch: "users:delete",
                deleteOrg: "users:delete",
            },
        },
        {
            key: "roles",
            label: "Roles",
            module: "admin",
            cells: {
                viewOwn: "roles:manage",
                viewBranch: "roles:manage",
                viewOrg: "roles:manage",
                create: "roles:create",
                editOwn: "roles:edit",
                editBranch: "roles:edit",
                editOrg: "roles:edit",
                deleteOwn: "roles:delete",
                deleteBranch: "roles:delete",
                deleteOrg: "roles:delete",
            },
        },
        {
            key: "branches",
            label: "Branches",
            module: "admin",
            cells: {
                viewOwn: "branches:manage",
                viewBranch: "branches:manage",
                viewOrg: "branches:manage",
                create: "branches:create",
                editOwn: "branches:edit",
                editBranch: "branches:edit",
                editOrg: "branches:edit",
                deleteOwn: "branches:delete",
                deleteBranch: "branches:delete",
                deleteOrg: "branches:delete",
            },
        },
        {
            key: "departments",
            label: "Departments",
            module: "admin",
            cells: {
                viewOwn: "departments:manage",
                viewBranch: "departments:manage",
                viewOrg: "departments:manage",
                create: "departments:create",
                editOwn: "departments:edit",
                editBranch: "departments:edit",
                editOrg: "departments:edit",
                deleteOwn: "departments:delete",
                deleteBranch: "departments:delete",
                deleteOrg: "departments:delete",
            },
        },
        {
            key: "positions",
            label: "Positions",
            module: "admin",
            cells: {
                viewOwn: "positions:manage",
                viewBranch: "positions:manage",
                viewOrg: "positions:manage",
                create: "positions:create",
                editOwn: "positions:edit",
                editBranch: "positions:edit",
                editOrg: "positions:edit",
                deleteOwn: "positions:delete",
                deleteBranch: "positions:delete",
                deleteOrg: "positions:delete",
            },
        },
        {
            key: "posCounters",
            label: "POS Counters",
            module: "admin",
            cells: {
                viewOwn: "pos-counters:manage",
                viewBranch: "pos-counters:manage",
                viewOrg: "pos-counters:manage",
                create: "pos-counters:create",
                editOwn: "pos-counters:edit",
                editBranch: "pos-counters:edit",
                editOrg: "pos-counters:edit",
                deleteOwn: "pos-counters:delete",
                deleteBranch: "pos-counters:delete",
                deleteOrg: "pos-counters:delete",
            },
        },
        // Org Settings / Statuses / Pipelines rows removed — the whole Settings
        // surface (incl. workflow masters) is gated only by the Settings sidebar
        // ticks; there is no separate settings:manage capability to grant here.
        // Retention — plain create/edit/delete per page (view rides the sidebar
        // link). Changing the discount / balance is part of Edit, not a separate gate.
        {
            key: "coupons",
            label: "Coupons",
            module: "coupons",
            cells: {
                viewOwn: "coupons:manage", viewBranch: "coupons:manage", viewOrg: "coupons:manage",
                create: "coupons:create",
                editOwn: "coupons:edit", editBranch: "coupons:edit", editOrg: "coupons:edit",
                deleteOwn: "coupons:delete", deleteBranch: "coupons:delete", deleteOrg: "coupons:delete",
            },
        },
        {
            key: "giftCards",
            label: "Gift Cards",
            module: "coupons",
            cells: {
                viewOwn: "gift-cards:manage", viewBranch: "gift-cards:manage", viewOrg: "gift-cards:manage",
                create: "gift-cards:create",
                editOwn: "gift-cards:edit", editBranch: "gift-cards:edit", editOrg: "gift-cards:edit",
                deleteOwn: "gift-cards:delete", deleteBranch: "gift-cards:delete", deleteOrg: "gift-cards:delete",
            },
        },
        {
            key: "loyalty",
            label: "Loyalty",
            module: "loyalty",
            cells: {
                viewOwn: "loyalty:manage", viewBranch: "loyalty:manage", viewOrg: "loyalty:manage",
                create: "loyalty:create",
                editOwn: "loyalty:edit", editBranch: "loyalty:edit", editOrg: "loyalty:edit",
                deleteOwn: "loyalty:delete", deleteBranch: "loyalty:delete", deleteOrg: "loyalty:delete",
            },
        },
        {
            key: "spendTiers",
            label: "Spend Tiers",
            module: "crm",
            cells: {
                viewOwn: "tiers:manage", viewBranch: "tiers:manage", viewOrg: "tiers:manage",
                create: "tiers:create",
                editOwn: "tiers:edit", editBranch: "tiers:edit", editOrg: "tiers:edit",
                deleteOwn: "tiers:delete", deleteBranch: "tiers:delete", deleteOrg: "tiers:delete",
            },
        },

        // Inventory — Products (catalog) and Masters (all 8 setup tables, gated
        // together). inventory:manage is the umbrella (shown in the view cells).
        {
            key: "products",
            label: "Products",
            module: "inventory",
            cells: {
                viewOwn: "inventory:manage", viewBranch: "inventory:manage", viewOrg: "inventory:manage",
                create: "products:create",
                editOwn: "products:edit", editBranch: "products:edit", editOrg: "products:edit",
                deleteOwn: "products:delete", deleteBranch: "products:delete", deleteOrg: "products:delete",
            },
        },
        {
            key: "inventoryMasters",
            label: "Masters",
            module: "inventory",
            cells: {
                viewOwn: "inventory:manage", viewBranch: "inventory:manage", viewOrg: "inventory:manage",
                create: "inventory:masters:create",
                editOwn: "inventory:masters:edit", editBranch: "inventory:masters:edit", editOrg: "inventory:masters:edit",
                deleteOwn: "inventory:masters:delete", deleteBranch: "inventory:masters:delete", deleteOrg: "inventory:masters:delete",
            },
        },
        // Accountancy Masters — the chart of accounts (Account Groups, Ledgers,
        // Chart of Accounts) gated together. View rides accountancy:view;
        // create/edit/delete are their own keys. Opening Balance is separate.
        {
            key: "accountancyMasters",
            label: "Masters",
            module: "accountancy",
            cells: {
                viewOwn: "accountancy:view", viewBranch: "accountancy:view", viewOrg: "accountancy:view",
                create: "accountancy:masters:create",
                editOwn: "accountancy:masters:edit", editBranch: "accountancy:masters:edit", editOrg: "accountancy:masters:edit",
                deleteOwn: "accountancy:masters:delete", deleteBranch: "accountancy:masters:delete", deleteOrg: "accountancy:masters:delete",
            },
        },
        // Contacts module (key "customers") — Person (people) AND Companies share
        // ONE flat create/edit/delete set (customers:*), so both links open the same
        // table. Contacts carry no branch, so there is no radius: any branch may CRUD.
        // View rides customers:view; edit/delete are the flat customers:edit /
        // customers:delete (the old own/branch/dept/org ladder is retired).
        {
            key: "contacts",
            label: "Contacts",
            module: "customers",
            cells: {
                viewOwn: "customers:view", viewBranch: "customers:view", viewOrg: "customers:view",
                create: "customers:create",
                editOwn: "customers:edit", editBranch: "customers:edit", editOrg: "customers:edit",
                deleteOwn: "customers:delete", deleteBranch: "customers:delete", deleteOrg: "customers:delete",
            },
        },
        // admin:bypass is intentionally removed from the matrix — it is a code-only
        // sentinel grantable only via the env super admin (.env). It must never appear
        // in the UI where it could be ticked by mistake.
    ];

// Simplified Create / Edit / Delete columns for a single-resource matrix row —
// no View, no own/branch/org split, since a sidebar link like Users only needs
// "can create, can edit, can delete" at a glance (same tint language as vouchers).
export const CORE_MATRIX_COLUMN_GROUPS: MatrixColumnGroup[] = [
    { key: "create", label: "CREATE", tint: "green", columns: [{ key: "create", label: "Create" }] },
    { key: "edit", label: "EDIT", tint: "amber", columns: [{ key: "edit", label: "Edit" }] },
    { key: "delete", label: "DELETE", tint: "rose", columns: [{ key: "delete", label: "Delete" }] },
];

// Converts a MATRIX_ROWS row into the shared matrix component's simplified
// create/edit/delete row shape. Edit and delete collapse own/branch/org into one
// column — for Users/Role/Organisation those scoped cells are all the same
// underlying permission id anyway, so the first non-null one is representative.
export const toSharedMatrixRow = (row: (typeof MATRIX_ROWS)[number]): MatrixRow => {
    const firstOf = (...keys: MatrixColumnKey[]): string | null => {
        for (const key of keys) {
            const cell = row.cells[key];
            if (typeof cell === "string") return cell;
        }
        return null;
    };
    return {
        key: row.key,
        label: row.label,
        cells: {
            create: firstOf("create"),
            edit: firstOf("editOwn", "editBranch", "editOrg"),
            delete: firstOf("deleteOwn", "deleteBranch", "deleteOrg"),
        },
    };
};

// Flat "record" resources — non-voucher, user-creatable things with a plain
// create/edit/delete grant (Repair, Help Desk, Deals, Tasks, Contacts). Rendered
// as their OWN eligibility card near the top of the page, same visual language as
// the voucher matrices and sitting directly above Quick Actions — these are
// exactly what the "New X" quick-action chips create, so seeing create/edit/
// delete together with the "+" chip reads as one decision instead of two.
const RECORD_ROW_KEYS = ["tickets", "help", "deals", "tasks", "contacts"] as const;
export const RECORD_ELIGIBILITY_ROWS: MatrixRow[] = RECORD_ROW_KEYS
    .map((key) => MATRIX_ROWS.find((r) => r.key === key))
    .filter((r): r is (typeof MATRIX_ROWS)[number] => Boolean(r))
    .map(toSharedMatrixRow);

// These five now render in the top-level Records eligibility card, so their
// inline chevron/table under Sidebar links is suppressed (same grant, one place
// to edit it) — the sidebar LINK chip itself (ui:sidebar:*, nav visibility) still
// renders there as normal; only the CRUD table moves up. See matrixRowForLink in
// RolePageSections.tsx.
export const INLINE_HIDDEN_MATRIX_ROW_KEYS = new Set<string>(RECORD_ROW_KEYS);

// Sidebar links whose resource also carries a granular CRUD row in MATRIX_ROWS
// (Users, Role, Organisation…) — keyed by the link's `ui:sidebar:*` permission id
// → the matching MATRIX_ROWS key. The Sidebar links card expands that row inline
// (same look as the voucher matrices) so a role's "Users" link and its actual
// create/view/edit/delete grant sit in one place.
export const SIDEBAR_LINK_MATRIX_ROW_KEY: Record<string, string> = {
    // Repair — the "All Repair" link expands the ticket create/edit/delete matrix.
    [sidebarChildPermissionId("repair", "all-repair")]: "tickets",
    // Help Desk / CRM Deals / Administration Work Board — each board link expands
    // its own record's create/edit/delete matrix, same as the repair ticket above.
    [sidebarChildPermissionId("help", "help-desk")]: "help",
    [sidebarChildPermissionId("crm", "deals")]: "deals",
    [sidebarChildPermissionId("administration", "work-board")]: "tasks",
    [sidebarChildPermissionId("admin", "users")]: "users",
    [sidebarChildPermissionId("admin", "role")]: "roles",
    [sidebarChildPermissionId("admin", "branches")]: "branches",
    [sidebarChildPermissionId("admin", "departments")]: "departments",
    [sidebarChildPermissionId("admin", "positions")]: "positions",
    [sidebarChildPermissionId("admin", "pos-counters")]: "posCounters",
    // Retention — create/edit/delete matrix per link. Protection has NO matrix
    // row: it is a single yes/no "manage" capability, so the nav-link chip alone
    // is the grant (a create/edit/delete table where every cell resolves to the
    // same id would just be noise).
    [sidebarChildPermissionId("retention", "coupons")]: "coupons",
    [sidebarChildPermissionId("retention", "gift-cards")]: "giftCards",
    [sidebarChildPermissionId("retention", "loyalty")]: "loyalty",
    [sidebarChildPermissionId("retention", "spend-tiers")]: "spendTiers",
    // Inventory — Products (leaf) + Masters (parent; all 8 setup tables together).
    // Item Ledger reuses the SAME products matrix — it also has Add/Edit Product,
    // so a role granted only Item Ledger can still get products:create/edit there.
    [sidebarChildPermissionId("inventory", "products")]: "products",
    [sidebarChildPermissionId("inventory", "item-ledger")]: "products",
    [sidebarChildPermissionId("inventory", "masters")]: "inventoryMasters",
    // Accountancy — the three chart-of-accounts pages share one matrix (like
    // Products + Item Ledger). Each shows a chevron opening the SAME table; Opening
    // Balance has its own access, so it's deliberately NOT here (no chevron).
    [sidebarChildPermissionId("accountancy", "account-groups")]: "accountancyMasters",
    [sidebarChildPermissionId("accountancy", "ledgers")]: "accountancyMasters",
    [sidebarChildPermissionId("accountancy", "chart-of-accounts")]: "accountancyMasters",
    // The ledger "books" (Account Ledger + Cash/Bank/Loans) render the same
    // explorer with an in-page "Create ledger" — so they reuse the SAME
    // accountancyMasters table.
    [sidebarChildPermissionId("accountancy", "account-ledger")]: "accountancyMasters",
    [sidebarChildPermissionId("accountancy", "cash-book")]: "accountancyMasters",
    [sidebarChildPermissionId("accountancy", "bank-book")]: "accountancyMasters",
    [sidebarChildPermissionId("accountancy", "loans-book")]: "accountancyMasters",
    // Stock Summary has an inline "Edit product master" pencil (InvProductDialog),
    // so it reuses the SAME products table (Products / Item Ledger).
    [sidebarChildPermissionId("accountancy", "stock-summary")]: "products",
    // Contacts module — Person (people) and Companies share ONE create/edit/delete
    // matrix (customers:*); both chevrons open the same table.
    [sidebarChildPermissionId("customers", "person")]: "contacts",
    [sidebarChildPermissionId("customers", "companies")]: "contacts",
};

// The granular permission ids a sidebar link "unlocks" — every cell id of the
// matrix row it expands to (see SIDEBAR_LINK_MATRIX_ROW_KEY). The Department pool
// pools MODULE VISIBILITY (the `ui:sidebar:*` links); the granular create/edit/
// delete LEVEL is a per-role decision. So the role-permissions save API allows a
// granular id whenever its owning link is pooled, using this map — otherwise the
// editor would let you tick e.g. Contacts → Create (customers:create) but the pool
// filter would silently drop it on save. Keyed by the link's `ui:sidebar:*` id.
export const SIDEBAR_LINK_GRANULAR_IDS: Record<string, string[]> = Object.fromEntries(
    Object.entries(SIDEBAR_LINK_MATRIX_ROW_KEY).map(([linkId, rowKey]) => {
        const row = MATRIX_ROWS.find((r) => r.key === rowKey);
        const ids = row
            ? [...new Set(
                Object.values(row.cells)
                    .flatMap((cell) => (Array.isArray(cell) ? cell : [cell]))
                    .filter((id): id is string => Boolean(id))
            )]
            : [];
        return [linkId, ids];
    })
);

// A sidebar link with extra yes/no permissions beyond "can see this page" —
// simpler than a full matrix row, for links where a handful of additional
// capabilities make sense. Shown as small toggles next to the link's chip,
// only once the link itself is ticked (can't grant an edit on a page the role
// can't open). Keyed by the link's `ui:sidebar:*` permission id; a single
// toggle may be written bare instead of as a one-item list.
export type ExtraToggle = { id: string; label: string };
export const SIDEBAR_LINK_EXTRA_TOGGLE: Record<string, ExtraToggle | ExtraToggle[]> = {
    // POS counters board — seeing it is oversight; the extra toggle grants the
    // authority to emergency-close a stuck operator shift from it.
    [sidebarChildPermissionId("pos", "counters")]: {
        id: "pos:shift:force-close",
        label: "Can force-close shift",
    },
    [sidebarChildPermissionId("compliance", "tax-classification")]: {
        id: "compliance:tax:edit",
        label: "Can change tax",
    },
    // Pricing Strategy — no per-page edit toggle. Setting points, costing draws
    // and applying barcode prices are the ordinary work of these pages, so the
    // page tick itself allows them. Reset is the one guard: it clears every point
    // in one click and reprices the whole catalogue.
    [sidebarChildPermissionId("pricing-strategy", "strategies")]: {
        id: "pricing:strategy:reset",
        label: "Can reset all points",
    },
    // Customize Home — editing the page is the page tick's own work. The locked
    // permanent fallback sections are the one guard.
    [sidebarChildPermissionId("e-commerce", "customize-home")]: {
        id: "ecommerce:fallback:unlock",
        label: "Can unlock fallback",
    },
    // Retention pages are plain create/edit/delete matrices (no extra toggle) —
    // changing the discount / balance is part of "Edit", not a separate control.
    // HR & People — each page opens on its link; these are the write rights on it.
    // Attendance and the holiday list share one key, so both links carry the box.
    [sidebarChildPermissionId("hr", "staff")]: { id: "hr:staff:edit", label: "Can edit staff records" },
    [sidebarChildPermissionId("hr", "attendance")]: { id: "hr:attendance:edit", label: "Can mark attendance & holidays" },
    [sidebarChildPermissionId("hr", "holidays")]: { id: "hr:attendance:edit", label: "Can mark attendance & holidays" },
    [sidebarChildPermissionId("hr", "leave")]: { id: "hr:leave:approve", label: "Can approve leave" },
    [sidebarChildPermissionId("hr", "payroll")]: { id: "hr:payroll:run", label: "Can run payroll" },
    // Backup & Restore — the page opens on its link; taking a backup or restoring
    // one is settings:manage (which also allows the repair ticket's dev override).
    [sidebarChildPermissionId("settings", "backup-restore")]: { id: "settings:manage", label: "Can back up & restore" },
};

/** The extra toggles for a link, as a list (bare entries normalise to one item). */
export function extraTogglesFor(linkPermissionId: string): ExtraToggle[] {
    const v = SIDEBAR_LINK_EXTRA_TOGGLE[linkPermissionId];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
}

// A MODULE-level extra toggle: one yes/no capability that spans the whole module
// rather than a single link, so it renders on its own after the module's links
// (not tucked beside one chip). Shown once ANY of its `showWhenAnyLinkId` links
// is ticked. Contacts → "Show suppliers (creditors)" filters BOTH the Person and
// Companies lists, so it belongs to neither link alone.
//
// `global: true` marks a toggle that affects behaviour OUTSIDE its native module
// (e.g. voucher party dropdowns). Global toggles render in the dedicated Global
// section instead of inside SidebarVisibilitySection.
export const MODULE_EXTRA_TOGGLE: Record<string, {
    id: string;
    label: string;
    showWhenAnyLinkId: string[];
    global?: boolean;
    /** Shown in the Global section to explain where this permission applies. */
    globalDescription?: string;
}> = {
    customers: {
        id: "customers:view:creditors",
        label: "Show suppliers (creditors)",
        showWhenAnyLinkId: [
            sidebarChildPermissionId("customers", "person"),
            sidebarChildPermissionId("customers", "companies"),
        ],
        global: true,
        globalDescription: "Filters suppliers (Sundry Creditors) from Contacts lists and voucher party dropdowns. Absent → browses customers only.",
    },
    auth: {
        id: "auth:login:outside-counter",
        label: "Can login outside counter",
        showWhenAnyLinkId: [],
        global: true,
        globalDescription: "When granted, this user can log in from any machine. Without it, login is restricted to counter machines (with bridge) only.",
    },
    // The phone app (/m) — one tick per screen. Signing in on a phone still needs
    // "Can login outside counter" above.
    mobileStock: {
        id: "mobile:stock:view",
        label: "Mobile: stock & price",
        showWhenAnyLinkId: [],
        global: true,
        globalDescription: "Phone app (/m): search products, see available quantity per branch and sale price. Needs 'Can login outside counter' to sign in.",
    },
    mobileParties: {
        id: "mobile:parties:view",
        label: "Mobile: party balance",
        showWhenAnyLinkId: [],
        global: true,
        globalDescription: "Phone app (/m): search parties, see balance and unpaid bills. Needs 'Can login outside counter' to sign in.",
    },
};

/**
 * Every permission id a set of sidebar links unlocks beyond the links themselves:
 * the granular create/edit/delete ids behind each link, the link's extra toggles,
 * and module toggles shown once any of their trigger links is present. The
 * role-permissions save uses this to ALLOW them; the department pool save uses
 * it to STRIP them when the links go — so a module removed from a department is
 * a clean removal, not a page hidden with its actions still granted.
 */
export function idsUnlockedByLinks(linkIds: Iterable<string>): Set<string> {
    const links = new Set(linkIds);
    const out = new Set<string>();
    for (const linkId of links) {
        for (const id of SIDEBAR_LINK_GRANULAR_IDS[linkId] ?? []) out.add(id);
        for (const t of extraTogglesFor(linkId)) out.add(t.id);
    }
    for (const t of Object.values(MODULE_EXTRA_TOGGLE)) {
        if (t.showWhenAnyLinkId.some((id) => links.has(id))) out.add(t.id);
    }
    return out;
}

export function roleToForm(role: Role): RoleForm {
    return {
        label: role.label,
        color: role.color,
        rank: role.rank,
        departmentId: role.department?.id ?? "",
    };
}

export function getErrorMessage(error: unknown, fallback: string) {
    return axios.isAxiosError(error) ? error.response?.data?.error ?? fallback : fallback;
}

