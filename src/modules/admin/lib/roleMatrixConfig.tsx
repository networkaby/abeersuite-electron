// ── Role-page config: matrices, module metadata, form types + helpers ────────
// Extracted from office/admin/role/page.tsx (which had grown past 2,200 lines).
// Pure data + types + two tiny helpers — no state, no components.


import axios from "axios";
import {
    BadgePercent,
    Boxes,
    Calculator,
    ClipboardList,
    Gift,
    HeartHandshake,
    Settings,
    ShieldCheck,
    ShoppingCart,
    Store,
    Ticket,
    Users,
    Wallet,
    Wrench,
} from "lucide-react";
import { type MatrixColumnGroup, type MatrixRow, type ColumnTint } from "@/shared/components/PermissionMatrix";
import {
    VOUCHER_MATRIX,
    VOUCHER_GROUPS,
    VOUCHER_ACTIONS,
    ALL_VOUCHER_PERMISSION_IDS,
    type VoucherGroupKey,
} from "@/shared/lib/auth/voucherMatrix";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
import { POS_VOUCHER_MATRIX, POS_ACTIONS } from "@/shared/lib/auth/posVoucherMatrix";
import type { LucideIcon } from "lucide-react";
import { BUTTON_BAR_ACTIONS } from "@/utils/constants";
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
// Every per-kind voucher permission id — used to keep them out of the loose chips.
export const VOUCHER_PERM_SET = new Set<string>(ALL_VOUCHER_PERMISSION_IDS);

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
export const QUICK_ACTION_OPTIONS: { permission: string; label: string; icon: LucideIcon }[] = (() => {
    const seen = new Set<string>();
    const out: { permission: string; label: string; icon: LucideIcon }[] = [];
    for (const a of BUTTON_BAR_ACTIONS) {
        const permission = createActionPermission(a);
        if (!permission || seen.has(permission)) continue;
        seen.add(permission);
        out.push({ permission, label: a.label.replace(/\s*\+$/, "").trim(), icon: a.icon });
    }
    return out;
})();

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
    groupId: string | null;
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

export const MODULE_META: Record<string, { label: string; description: string; icon: React.ReactNode; chip: string }> = {
    core: {
        label: "Core",
        description: "System-level access controls",
        icon: <ShieldCheck size={13} />,
        chip: "bg-red-50 border-red-200 text-red-700",
    },
    customers: {
        label: "Customers",
        description: "Customer and company record access",
        icon: <Users size={13} />,
        chip: "bg-blue-50 border-blue-200 text-blue-700",
    },
    tickets: {
        label: "Tickets",
        description: "Ticket workflow and ownership",
        icon: <Ticket size={13} />,
        chip: "bg-indigo-50 border-indigo-200 text-indigo-700",
    },
    assignments: {
        label: "Assignments",
        description: "Work Inbox visibility scopes",
        icon: <ClipboardList size={13} />,
        chip: "bg-emerald-50 border-emerald-200 text-emerald-700",
    },
    service: {
        label: "Service",
        description: "Service centers and warranty fields",
        icon: <Wrench size={13} />,
        chip: "bg-orange-50 border-orange-200 text-orange-700",
    },
    admin: {
        label: "Administration",
        description: "System settings and user management",
        icon: <Settings size={13} />,
        chip: "bg-purple-50 border-purple-200 text-purple-700",
    },
    accountancy: {
        label: "Accountancy",
        description: "Books, ledgers, and financial reports",
        icon: <Calculator size={13} />,
        chip: "bg-slate-50 border-slate-200 text-slate-700",
    },
    finance: {
        label: "Finance",
        description: "Voucher, invoice, journal, and payment lifecycle",
        icon: <Wallet size={13} />,
        chip: "bg-cyan-50 border-cyan-200 text-cyan-700",
    },
    inventory: {
        label: "Inventory",
        description: "Stock scopes and inventory voucher lifecycle",
        icon: <Boxes size={13} />,
        chip: "bg-amber-50 border-amber-200 text-amber-700",
    },
    pos: {
        label: "Point of Sale",
        description: "Shift, till, and handover controls",
        icon: <ShoppingCart size={13} />,
        chip: "bg-green-50 border-green-200 text-green-700",
    },
    loyalty: {
        label: "Loyalty",
        description: "Earn/redeem wallet config and adjustments",
        icon: <HeartHandshake size={13} />,
        chip: "bg-pink-50 border-pink-200 text-pink-700",
    },
    coupons: {
        label: "Coupons",
        description: "Promotions and gift-card management",
        icon: <Gift size={13} />,
        chip: "bg-rose-50 border-rose-200 text-rose-700",
    },
    crm: {
        label: "CRM",
        description: "Customer relationship and sales pipeline",
        icon: <BadgePercent size={13} />,
        chip: "bg-violet-50 border-violet-200 text-violet-700",
    },
    ecommerce: {
        label: "E-commerce",
        description: "Online storefront management",
        icon: <Store size={13} />,
        chip: "bg-teal-50 border-teal-200 text-teal-700",
    },
};

export const MODULE_ORDER = [
    "core",
    "customers",
    "tickets",
    "assignments",
    "service",
    "admin",
    "accountancy",
    "finance",
    "inventory",
    "pos",
    "loyalty",
    "coupons",
    "crm",
    "ecommerce",
];
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
        // Repair (Tickets / Ticket Ownership / Warranty / Assignments) rows removed —
        // the repair permission layer is being rebuilt the new sidebar-link + CRUD way.
        {
            key: "buyers",
            label: "Customers/Companies",
            module: "customers",
            cells: {
                viewOwn: "customers:view",
                viewBranch: "customers:view",
                viewOrg: "customers:view",
                create: ["customers:create", "companies:manage"],
                editOwn: ["customers:edit", "companies:manage"],
                editBranch: ["customers:edit", "companies:manage"],
                editOrg: ["customers:edit", "companies:manage"],
                deleteOwn: ["customers:delete", "companies:manage"],
                deleteBranch: ["customers:delete", "companies:manage"],
                deleteOrg: ["customers:delete", "companies:manage"],
            },
        },
        {
            key: "invoices",
            label: "Invoices",
            module: "customers",
            cells: {
                viewOwn: "customers:view",
                viewBranch: "customers:view",
                viewOrg: "customers:view",
            },
        },
        {
            key: "serviceCenters",
            label: "Service Centers",
            module: "service",
            cells: {
                viewOwn: "service-centers:view",
                viewBranch: "service-centers:view",
                viewOrg: "service-centers:view",
                create: "service-centers:manage",
                editOwn: "service-centers:manage",
                editBranch: "service-centers:manage",
                editOrg: "service-centers:manage",
                deleteOwn: "service-centers:manage",
                deleteBranch: "service-centers:manage",
                deleteOrg: "service-centers:manage",
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
                editOwn: "users:edit:org",
                editBranch: "users:edit:org",
                editOrg: "users:edit:org",
                deleteOwn: "users:delete:org",
                deleteBranch: "users:delete:org",
                deleteOrg: "users:delete:org",
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
                editOwn: "roles:edit:org",
                editBranch: "roles:edit:org",
                editOrg: "roles:edit:org",
                deleteOwn: "roles:delete:org",
                deleteBranch: "roles:delete:org",
                deleteOrg: "roles:delete:org",
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
        {
            key: "orgSettings",
            label: "Org Settings",
            module: "admin",
            cells: {
                viewOwn: "settings:manage",
                viewBranch: "settings:manage",
                viewOrg: "settings:manage",
                create: "settings:manage",
                editOwn: "settings:manage",
                editBranch: "settings:manage",
                editOrg: "settings:manage",
                deleteOwn: "settings:manage",
                deleteBranch: "settings:manage",
                deleteOrg: "settings:manage",
            },
        },
        // Statuses / Pipelines rows removed — workflow masters are part of Settings
        // and ride settings:manage (the Org Settings row above).
        {
            key: "accountancy",
            label: "Accountancy",
            module: "accountancy",
            cells: {
                create: "accountancy:create:own",
                viewOwn: "accountancy:view:own",
                viewBranch: "accountancy:view:br",
                viewOrg: "accountancy:view:org",
                editOwn: "accountancy:edit:own",
                editBranch: "accountancy:edit:br",
                editOrg: "accountancy:edit:org",
                deleteOwn: "accountancy:delete:own",
                deleteBranch: "accountancy:delete:br",
                deleteOrg: "accountancy:delete:org",
            },
        },
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
        // Chart of Accounts) gated together. View rides accountancy:view:org;
        // create/edit/delete are their own keys. Opening Balance is separate.
        {
            key: "accountancyMasters",
            label: "Masters",
            module: "accountancy",
            cells: {
                viewOwn: "accountancy:view:org", viewBranch: "accountancy:view:org", viewOrg: "accountancy:view:org",
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

export const MATRIX_PERMISSION_IDS = new Set(
    MATRIX_ROWS.flatMap((row) =>
        Object.values(row.cells).flatMap((cell) => (Array.isArray(cell) ? cell : [cell]))
    )
        .filter((permissionId): permissionId is string => Boolean(permissionId))
);

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

// Sidebar links whose resource also carries a granular CRUD row in MATRIX_ROWS
// (Users, Role, Organisation…) — keyed by the link's `ui:sidebar:*` permission id
// → the matching MATRIX_ROWS key. The Sidebar links card expands that row inline
// (same look as the voucher matrices) so a role's "Users" link and its actual
// create/view/edit/delete grant sit in one place.
export const SIDEBAR_LINK_MATRIX_ROW_KEY: Record<string, string> = {
    [sidebarChildPermissionId("admin", "users")]: "users",
    [sidebarChildPermissionId("admin", "role")]: "roles",
    [sidebarChildPermissionId("admin", "branches")]: "branches",
    [sidebarChildPermissionId("admin", "departments")]: "departments",
    [sidebarChildPermissionId("admin", "positions")]: "positions",
    [sidebarChildPermissionId("admin", "pos-counters")]: "posCounters",
    [sidebarChildPermissionId("settings", "organisation")]: "orgSettings",
    // Retention — create/edit/delete matrix per link.
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

// A sidebar link with ONE extra yes/no permission beyond "can see this page" —
// simpler than a full matrix row, for links where only a single additional
// capability makes sense. Shown as a small toggle next to the link's chip,
// only once the link itself is ticked (can't grant an edit on a page the role
// can't open). Keyed by the link's `ui:sidebar:*` permission id.
export const SIDEBAR_LINK_EXTRA_TOGGLE: Record<string, { id: string; label: string }> = {
    [sidebarChildPermissionId("compliance", "tax-classification")]: {
        id: "compliance:tax:edit",
        label: "Can change tax",
    },
    // Pricing Strategy — one edit toggle per page. "Needs attention" isn't here:
    // it edits the product, so its edit rides inventory:manage, not a pricing key.
    [sidebarChildPermissionId("pricing-strategy", "strategies")]: {
        id: "pricing:strategy:set",
        label: "Can set strategy",
    },
    [sidebarChildPermissionId("pricing-strategy", "costing")]: {
        id: "pricing:costing:manage",
        label: "Can manage costing",
    },
    [sidebarChildPermissionId("pricing-strategy", "update-print-labels")]: {
        id: "pricing:labels:apply",
        label: "Can apply & print",
    },
    // Retention pages are plain create/edit/delete matrices (no extra toggle) —
    // changing the discount / balance is part of "Edit", not a separate control.
};

// Every permission surfaced as an inline "extra toggle" beside its sidebar link —
// kept out of the loose "Additional permissions" chips so it isn't shown twice.
export const SIDEBAR_LINK_EXTRA_TOGGLE_IDS = new Set(
    Object.values(SIDEBAR_LINK_EXTRA_TOGGLE).map((t) => t.id),
);

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

