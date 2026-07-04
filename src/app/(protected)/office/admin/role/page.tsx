"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    AlertTriangle,
    BadgePercent,
    Boxes,
    Calculator,
    Check,
    ChevronDown,
    ClipboardList,
    Gift,
    HeartHandshake,
    Lock,
    PanelLeft,
    Plus,
    RotateCcw,
    Save,
    Search,
    Settings,
    Shield,
    ShieldCheck,
    ShoppingCart,
    Store,
    Ticket,
    Trash2,
    Users,
    Wallet,
    Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PermissionMatrix as SharedPermissionMatrix, type MatrixColumnGroup, type MatrixRow, type ColumnTint } from "@/shared/components/PermissionMatrix";
import { VOUCHER_MATRIX, VOUCHER_GROUPS, VOUCHER_ACTIONS, ALL_VOUCHER_PERMISSION_IDS, type VoucherGroupKey } from "@/shared/lib/auth/voucherMatrix";
import { SIDEBAR_MODULES, sidebarChildPermissionId, type SidebarChildRow } from "@/shared/lib/auth/sidebarModules";
import { POS_VOUCHER_MATRIX, POS_ACTIONS } from "@/shared/lib/auth/posVoucherMatrix";
import type { LucideIcon } from "lucide-react";
import { BUTTON_BAR_ACTIONS } from "@/utils/constants";
import { createActionPermission } from "@/utils/module-access";

// Column tint per voucher action for the GL voucher matrix.
const VOUCHER_ACTION_TINT: Record<string, ColumnTint> = {
    view: "gray", open: "blue", create: "green", post: "blue", cancel: "amber", delete: "rose",
};
const VOUCHER_COLUMN_GROUPS: MatrixColumnGroup[] = VOUCHER_ACTIONS.map((a) => ({
    key: a.key, label: a.label, tint: VOUCHER_ACTION_TINT[a.key], columns: [{ key: a.key, label: a.label }],
}));
// Voucher rows grouped by economic nature (GL / Trading / Inventory / Optional),
// each rendered as its own matrix so the groups read as separate sections.
const VOUCHER_ROWS_BY_GROUP: { key: VoucherGroupKey; label: string; rows: MatrixRow[] }[] = VOUCHER_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: VOUCHER_MATRIX.filter((r) => r.group === g.key).map((r) => ({
        key: r.type, label: r.label,
        cells: Object.fromEntries(VOUCHER_ACTIONS.map((a) => [a.key, r.perms[a.key]])),
    })),
}));
// Every per-kind voucher permission id — used to keep them out of the loose chips.
const VOUCHER_PERM_SET = new Set<string>(ALL_VOUCHER_PERMISSION_IDS);

// POS voucher matrix (gates the /vouchers/pos UI only). Shown only when the role
// can see POS (the workspace visibility toggle). Sparse cells render as N/A.
const POS_VISIBILITY_ID = sidebarChildPermissionId("workspace", "pos");
const POS_MATRIX_ROWS: MatrixRow[] = POS_VOUCHER_MATRIX.map((r) => ({ key: r.key, label: r.label, cells: { ...r.perms } }));
// POS columns: Create / Cancel·edit / Delete (no Post — POS has no draft; visibility
// is implied by Create, so there is no separate "available" column).
const POS_ACTION_TINT: Record<string, ColumnTint> = { create: "green", cancel: "amber", delete: "rose" };
const POS_COLUMN_GROUPS: MatrixColumnGroup[] = POS_ACTIONS
    .map((a) => ({ key: a.key, label: a.label, tint: POS_ACTION_TINT[a.key] ?? "gray", columns: [{ key: a.key, label: a.label }] }));
// Operator-scoped shift actions for the POS block: managing one's own till on one's
// own counter — start/end the shift (open implies close) and drop cash to the safe.
// Oversight (manage/force-close, view other branches) is a separate management
// concern and falls through to Additional permissions.
const POS_OPERATOR_SHIFT_CHIPS: { label: string; ids: string[] }[] = [
    { label: "Start / End shift", ids: ["pos:shift:open", "pos:shift:close"] },
    { label: "Cash drop", ids: ["pos:shift:drop"] },
];
const POS_BLOCK_SHIFT_IDS = POS_OPERATOR_SHIFT_CHIPS.flatMap((c) => c.ids);

// Quick-action options for the role's button bar — every creatable thing (vouchers
// + Repair + POS), de-duped by the create permission it maps to. Ticking a chip
// grants that create key to the role, so it appears in the role's Quick Actions.
const QUICK_ACTION_OPTIONS: { permission: string; label: string; icon: LucideIcon }[] = (() => {
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

interface Permission {
    id: string;
    label: string;
    module: string;
    description?: string | null;
}

// A Work the role can be granted directly (independent of the department pool).
// A *gated* work carries a `work:<id>` permission — ticking it grants that
// permission. An ungated work has no permission and is open to all staff.
interface WorkRow {
    id: string;
    label: string;
    color: string;
    groupId: string | null;
    permissionId: string | null;
    // "human" works are completed by a person on the Work Inbox; "auto" works are
    // system-run Actions (never gated, never hand-assigned) — excluded from the list.
    kind: string;
}

interface WorkGroupRow {
    id: string;
    label: string;
    color: string;
    order: number;
}

interface RoleDepartment {
    id: string;
    name: string;
    isAllAccess: boolean;
}

interface Department {
    id: string;
    name: string;
    isAllAccess: boolean;
}

interface Role {
    id: string;
    label: string;
    color: string;
    rank: number;
    isSystem: boolean;
    department?: RoleDepartment | null;
    _count: { users: number };
    permissions: { permissionId: string; permission: Permission }[];
}

type RoleForm = {
    label: string;
    color: string;
    rank: number;
    departmentId: string;
};

const EMPTY_ROLE: RoleForm = {
    label: "",
    color: "bg-blue-100 text-blue-600",
    rank: 20,
    departmentId: "",
};

const COLOR_OPTIONS = [
    { label: "Gray", value: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
    { label: "Blue", value: "bg-blue-100 text-blue-600", dot: "bg-blue-500" },
    { label: "Green", value: "bg-green-100 text-green-600", dot: "bg-green-500" },
    { label: "Red", value: "bg-red-100 text-red-600", dot: "bg-red-500" },
    { label: "Purple", value: "bg-purple-100 text-purple-600", dot: "bg-purple-500" },
    { label: "Orange", value: "bg-orange-100 text-orange-600", dot: "bg-orange-500" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-600", dot: "bg-yellow-400" },
    { label: "Teal", value: "bg-teal-100 text-teal-600", dot: "bg-teal-500" },
];

const ROLE_ACCENT: Record<string, string> = {
    "bg-gray-100 text-gray-600": "border-l-gray-300",
    "bg-blue-100 text-blue-600": "border-l-blue-400",
    "bg-green-100 text-green-600": "border-l-green-400",
    "bg-red-100 text-red-600": "border-l-red-400",
    "bg-purple-100 text-purple-600": "border-l-purple-400",
    "bg-orange-100 text-orange-600": "border-l-orange-400",
    "bg-yellow-100 text-yellow-600": "border-l-yellow-300",
    "bg-teal-100 text-teal-600": "border-l-teal-400",
};

const MODULE_META: Record<string, { label: string; description: string; icon: React.ReactNode; chip: string }> = {
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

const MODULE_ORDER = [
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
const NO_COPY_ROLE = "__none__";

const MATRIX_COLUMN_GROUPS = [
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

type MatrixColumnKey = (typeof MATRIX_COLUMN_GROUPS)[number]["columns"][number]["key"];
type MatrixPermissionCell = string | string[];

const MATRIX_ROWS: {
    key: string;
    label: string;
    module: string;
    cells: Partial<Record<MatrixColumnKey, MatrixPermissionCell>>;
}[] = [
        {
            key: "tickets",
            label: "Tickets",
            module: "tickets",
            cells: {
                viewOwn: "assignments:view-team",
                viewBranch: "assignments:view-team",
                viewOrg: "assignments:view-org",
                create: "tickets:create",
                editOwn: "tickets:status:set",
                editBranch: "tickets:substatus:set",
                editOrg: "tickets:manage-participants",
                deleteOwn: "tickets:assign",
                deleteBranch: "tickets:assign",
                deleteOrg: "tickets:assign",
            },
        },
        {
            key: "ticketOwnership",
            label: "Ticket Ownership",
            module: "tickets",
            cells: {
                viewOwn: "assignments:view-team",
                viewBranch: "assignments:view-team",
                viewOrg: "assignments:view-org",
                editOrg: "tickets:assign",
                deleteOwn: "tickets:assign",
                deleteBranch: "tickets:assign",
                deleteOrg: "tickets:assign",
            },
        },
        {
            key: "warranty",
            label: "Warranty",
            module: "tickets",
            cells: {
                viewOwn: "assignments:view-team",
                viewBranch: "assignments:view-team",
                viewOrg: "assignments:view-org",
                editOrg: "warranty:convert",
            },
        },
        {
            key: "buyers",
            label: "Customers/Companies",
            module: "customers",
            cells: {
                viewOwn: "customers:view",
                viewBranch: "customers:view",
                viewOrg: "customers:view",
                create: ["customers:manage", "companies:manage"],
                editOwn: ["customers:manage", "companies:manage"],
                editBranch: ["customers:manage", "companies:manage"],
                editOrg: ["customers:manage", "companies:manage"],
                deleteOwn: ["customers:manage", "companies:manage"],
                deleteBranch: ["customers:manage", "companies:manage"],
                deleteOrg: ["customers:manage", "companies:manage"],
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
            key: "assignments",
            label: "Assignments",
            module: "assignments",
            cells: {
                viewOwn: "assignments:view-team",
                viewBranch: "assignments:view-team",
                viewOrg: "assignments:view-org",
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
        {
            key: "statuses",
            label: "Statuses",
            module: "admin",
            cells: {
                viewOwn: "settings:statuses",
                viewBranch: "settings:statuses",
                viewOrg: "settings:statuses",
                create: "settings:statuses",
                editOwn: "settings:statuses",
                editBranch: "settings:statuses",
                editOrg: "settings:statuses",
                deleteOwn: "settings:statuses",
                deleteBranch: "settings:statuses",
                deleteOrg: "settings:statuses",
            },
        },
        {
            key: "pipelines",
            label: "Pipelines",
            module: "admin",
            cells: {
                viewOwn: "settings:pipelines",
                viewBranch: "settings:pipelines",
                viewOrg: "settings:pipelines",
                create: "settings:pipelines",
                editOwn: "settings:pipelines",
                editBranch: "settings:pipelines",
                editOrg: "settings:pipelines",
                deleteOwn: "settings:pipelines",
                deleteBranch: "settings:pipelines",
                deleteOrg: "settings:pipelines",
            },
        },
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
        // admin:bypass is intentionally removed from the matrix — it is a code-only
        // sentinel grantable only via the env super admin (.env). It must never appear
        // in the UI where it could be ticked by mistake.
    ];

const MATRIX_PERMISSION_IDS = new Set(
    MATRIX_ROWS.flatMap((row) =>
        Object.values(row.cells).flatMap((cell) => (Array.isArray(cell) ? cell : [cell]))
    )
        .filter((permissionId): permissionId is string => Boolean(permissionId))
);

// Simplified Create / Edit / Delete columns for a single-resource matrix row —
// no View, no own/branch/org split, since a sidebar link like Users only needs
// "can create, can edit, can delete" at a glance (same tint language as vouchers).
const CORE_MATRIX_COLUMN_GROUPS: MatrixColumnGroup[] = [
    { key: "create", label: "CREATE", tint: "green", columns: [{ key: "create", label: "Create" }] },
    { key: "edit", label: "EDIT", tint: "amber", columns: [{ key: "edit", label: "Edit" }] },
    { key: "delete", label: "DELETE", tint: "rose", columns: [{ key: "delete", label: "Delete" }] },
];

// Converts a MATRIX_ROWS row into the shared matrix component's simplified
// create/edit/delete row shape. Edit and delete collapse own/branch/org into one
// column — for Users/Role/Organisation those scoped cells are all the same
// underlying permission id anyway, so the first non-null one is representative.
const toSharedMatrixRow = (row: (typeof MATRIX_ROWS)[number]): MatrixRow => {
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
const SIDEBAR_LINK_MATRIX_ROW_KEY: Record<string, string> = {
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
};

// A sidebar link with ONE extra yes/no permission beyond "can see this page" —
// simpler than a full matrix row, for links where only a single additional
// capability makes sense. Shown as a small toggle next to the link's chip,
// only once the link itself is ticked (can't grant an edit on a page the role
// can't open). Keyed by the link's `ui:sidebar:*` permission id.
const SIDEBAR_LINK_EXTRA_TOGGLE: Record<string, { id: string; label: string }> = {
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
const SIDEBAR_LINK_EXTRA_TOGGLE_IDS = new Set(
    Object.values(SIDEBAR_LINK_EXTRA_TOGGLE).map((t) => t.id),
);

function roleToForm(role: Role): RoleForm {
    return {
        label: role.label,
        color: role.color,
        rank: role.rank,
        departmentId: role.department?.id ?? "",
    };
}

function getErrorMessage(error: unknown, fallback: string) {
    return axios.isAxiosError(error) ? error.response?.data?.error ?? fallback : fallback;
}

export default function RolePage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPerms, setAllPerms] = useState<Permission[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    // Works + their groups — assigned directly to a role (not via the pool lens).
    const [works, setWorks] = useState<WorkRow[]>([]);
    const [workGroups, setWorkGroups] = useState<WorkGroupRow[]>([]);
    // Active role's department pool — `null` means all-access (no filtering: every
    // permission is offered). A Set means only those permission ids are in the lens.
    const [poolIds, setPoolIds] = useState<Set<string> | null>(null);
    const [activeRoleId, setActiveRoleId] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [original, setOriginal] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [savingRole, setSavingRole] = useState(false);
    const [savingPerms, setSavingPerms] = useState(false);
    const [newRoleOpen, setNewRoleOpen] = useState(false);
    const [newRole, setNewRole] = useState<RoleForm>(EMPTY_ROLE);
    const [copyFromRoleId, setCopyFromRoleId] = useState(NO_COPY_ROLE);
    const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE);
    const [search, setSearch] = useState("");

    const activeRole = roles.find((role) => role.id === activeRoleId) ?? null;

    const loadData = useCallback(async (preferredRoleId?: string) => {
        try {
            const [rolesRes, permsRes, deptsRes, worksRes, groupsRes] = await Promise.all([
                axios.get<Role[]>("/api/roles"),
                axios.get<Permission[]>("/api/permissions"),
                axios.get<Department[]>("/api/departments"),
                axios.get<WorkRow[]>("/api/works"),
                axios.get<WorkGroupRow[]>("/api/work-groups"),
            ]);
            const fetchedRoles = rolesRes.data;
            const nextActive =
                preferredRoleId && fetchedRoles.some((role) => role.id === preferredRoleId)
                    ? preferredRoleId
                    : fetchedRoles[0]?.id ?? "";

            setRoles(fetchedRoles);
            setAllPerms(permsRes.data);
            setDepartments(deptsRes.data);
            setWorks(worksRes.data);
            setWorkGroups(groupsRes.data);
            setActiveRoleId(nextActive);
        } catch {
            toast.error("Failed to load roles");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!activeRole) return;
        const granted = new Set(activeRole.permissions.map((permission) => permission.permissionId));
        setSelected(granted);
        setOriginal(new Set(granted));
        setRoleForm(roleToForm(activeRole));
        setSearch("");
    }, [activeRole]);

    // Load the active role's department pool — the authoring lens. All-access
    // departments (or a role with no department) leave poolIds null = no filter.
    const activeDeptId = activeRole?.department?.id ?? null;
    useEffect(() => {
        if (!activeDeptId) { setPoolIds(null); return; }
        let cancelled = false;
        axios
            .get<{ isAllAccess: boolean; permissionIds: string[] | null }>(`/api/departments/${activeDeptId}/permissions`)
            .then((res) => {
                if (cancelled) return;
                setPoolIds(res.data.isAllAccess || !res.data.permissionIds ? null : new Set(res.data.permissionIds));
            })
            .catch(() => { if (!cancelled) setPoolIds(null); });
        return () => { cancelled = true; };
    }, [activeDeptId]);

    const hasPermissionChanges = useMemo(() => {
        if (selected.size !== original.size) return true;
        for (const permissionId of selected) {
            if (!original.has(permissionId)) return true;
        }
        return false;
    }, [selected, original]);

    const hasRoleChanges = activeRole
        ? roleForm.label.trim() !== activeRole.label ||
        roleForm.color !== activeRole.color ||
        roleForm.rank !== activeRole.rank ||
        roleForm.departmentId !== (activeRole.department?.id ?? "")
        : false;

    const permissionById = useMemo(() => new Map(allPerms.map((permission) => [permission.id, permission])), [allPerms]);

    // Department lens — a permission is offered if it's in the active role's
    // department pool. A currently-granted permission is always shown (so nothing
    // granted is ever hidden), even in the defensive case it sits outside the pool.
    const inLens = useCallback(
        (id: string) => poolIds === null || poolIds.has(id) || selected.has(id),
        [poolIds, selected],
    );

    const filtered = (search.trim()
        ? allPerms.filter((permission) =>
            [permission.label, permission.id, permission.module, permission.description ?? ""]
                .some((value) => value.toLowerCase().includes(search.toLowerCase()))
        )
        : allPerms
    ).filter((permission) => inLens(permission.id));

    const matrixPermissions = filtered.filter((permission) => MATRIX_PERMISSION_IDS.has(permission.id));
    const additionalPermissions = filtered.filter(
        (permission) => !MATRIX_PERMISSION_IDS.has(permission.id)
            && permission.id !== "admin:bypass"
            // Per-kind voucher perms (GL + inventory) render in the voucher matrices
            // below, not as loose chips. Generic finance:voucher:* fallbacks too.
            && !permission.id.startsWith("finance:voucher:")
            && !VOUCHER_PERM_SET.has(permission.id)
            // Work permissions get their own direct "Works" section (grouped, not
            // pool-filtered) — keep them out of the loose chips to avoid duplication.
            && !permission.id.startsWith("work:")
            // Sidebar link visibility renders in its own "Sidebar links" section.
            && !permission.id.startsWith("ui:sidebar:")
            // POS perms (voucher matrix, shift chips, report tabs) render in the POS
            // section (revealed by the POS toggle) — keep them out of the loose chips.
            && !permission.id.startsWith("pos:voucher:")
            && !permission.id.startsWith("pos:report:")
            // The operator-scoped shift perms (open/close/drop) render as chips in the
            // POS block; the oversight ones (manage / view other branches) fall through
            // to Additional permissions.
            && !POS_BLOCK_SHIFT_IDS.includes(permission.id)
            // Perms rendered as an inline toggle beside their sidebar link (e.g.
            // compliance:tax:edit, pricing:*) — shown there, not as a loose chip.
            && !SIDEBAR_LINK_EXTRA_TOGGLE_IDS.has(permission.id)
    );

    // Show the POS shift block when its perms are seeded (they are, from bootstrap).
    const posShiftChipsAvailable = POS_BLOCK_SHIFT_IDS.some((id) => permissionById.has(id));

    // Voucher matrices — gate per KIND: a kind is offered if the department pool
    // carries ANY of its ids (all-access offers every kind). Once offered, every
    // action cell (View / Open / Create / Post / Cancel / Delete) is selectable
    // independently — a role can have Create without View, etc. — and adding a new
    // action column needs no re-pooling.
    const kindOffered = (row: MatrixRow) =>
        poolIds === null ||
        Object.values(row.cells).some((permId) => typeof permId === "string" && (poolIds.has(permId) || selected.has(permId)));
    const visibleVoucherGroups = VOUCHER_ROWS_BY_GROUP
        .map((g) => ({ ...g, rows: g.rows.filter(kindOffered) }))
        .filter((g) => g.rows.length > 0);

    const selectedCount = selected.size;
    const totalCount = allPerms.length;
    // Size of the active role's lens (the pool). All-access → every permission.
    const lensSize = poolIds === null ? totalCount : allPerms.filter((p) => poolIds.has(p.id)).length;
    const lensIsAllAccess = poolIds === null;
    // Permission ids the active role may hold (its pool) — drives "Select all".
    const lensPermIds = allPerms.filter((p) => poolIds === null ? p.id !== "admin:bypass" : poolIds.has(p.id)).map((p) => p.id);
    const hasBypass = selected.has("admin:bypass");

    const handleTabChange = (roleId: string) => {
        if (hasPermissionChanges && !confirm("Discard unsaved permission changes?")) return;
        setActiveRoleId(roleId);
    };

    const handleCreate = async () => {
        if (!newRole.label.trim()) {
            toast.error("Role name is required");
            return;
        }
        if (!newRole.departmentId) {
            toast.error("Select a department for the role");
            return;
        }

        setSavingRole(true);
        try {
            const res = await axios.post<Role>("/api/roles", newRole);
            if (copyFromRoleId !== NO_COPY_ROLE) {
                const sourceRole = roles.find((role) => role.id === copyFromRoleId);
                const permissionIds = sourceRole?.permissions.map((permission) => permission.permissionId) ?? [];
                await axios.put(`/api/roles/${res.data.id}/permissions`, { permissionIds });
            }
            toast.success("Role created");
            setNewRoleOpen(false);
            setNewRole(EMPTY_ROLE);
            setCopyFromRoleId(NO_COPY_ROLE);
            await loadData(res.data.id);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to create role"));
        } finally {
            setSavingRole(false);
        }
    };

    const handleUpdateRole = async () => {
        if (!activeRole) return;
        if (!roleForm.label.trim()) {
            toast.error("Role name is required");
            return;
        }

        setSavingRole(true);
        try {
            await axios.patch(`/api/roles/${activeRole.id}`, {
                label: roleForm.label,
                color: roleForm.color,
                rank: roleForm.rank,
                departmentId: roleForm.departmentId,
            });
            toast.success("Role updated");
            await loadData(activeRole.id);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to update role"));
        } finally {
            setSavingRole(false);
        }
    };

    const handleDelete = async (role: Role) => {
        if (!confirm(`Delete ${role.label}? Users assigned this role will lose it.`)) return;

        try {
            await axios.delete(`/api/roles/${role.id}`);
            toast.success("Role deleted");
            const nextRole = roles.find((item) => item.id !== role.id)?.id;
            await loadData(nextRole);
        } catch (error) {
            toast.error(getErrorMessage(error, "Failed to delete role"));
        }
    };

    const handleSavePermissions = async () => {
        if (!activeRole) return;

        setSavingPerms(true);
        try {
            await axios.put(`/api/roles/${activeRole.id}/permissions`, {
                permissionIds: [...selected],
            });
            setOriginal(new Set(selected));
            toast.success("Permissions saved");
            await loadData(activeRole.id);
        } catch {
            toast.error("Failed to save permissions");
        } finally {
            setSavingPerms(false);
        }
    };

    const handleDiscardPermissions = () => setSelected(new Set(original));

    const togglePerm = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Set a group of ids on/off together (POS chips that carry more than one id).
    const setPerms = (ids: string[], on: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const id of ids) { if (on) next.add(id); else next.delete(id); }
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading roles...
            </div>
        );
    }

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-3 px-6 pt-3 pb-8 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-foreground">
                            Roles &amp; Permissions
                        </h1>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Create roles, edit role details, and manage permissions from one page.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => {
                            // Default to the first functional (non-all-access) department so new
                            // roles get a narrow lens by default, not the full permission list.
                            setNewRole({ ...EMPTY_ROLE, departmentId: departments.find((d) => !d.isAllAccess)?.id ?? departments[0]?.id ?? "" });
                            setNewRoleOpen(true);
                        }}
                    >
                        <Plus /> New Role
                    </Button>
                </div>

                {roles.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                            <Shield size={36} className="opacity-20" />
                            <p className="text-sm">No roles found. Create one to get started.</p>
                        </CardContent>
                    </Card>
                ) : activeRole && (
                    <>
                        <RoleDetailsCard
                            role={activeRole}
                            form={roleForm}
                            departments={departments}
                            selectedCount={selectedCount}
                            totalCount={totalCount}
                            saving={savingRole}
                            hasChanges={hasRoleChanges}
                            onFormChange={setRoleForm}
                            onSave={handleUpdateRole}
                            onDiscard={() => setRoleForm(roleToForm(activeRole))}
                            onDelete={() => handleDelete(activeRole)}
                        />

                        <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
                            <aside className="xl:sticky xl:top-6 xl:self-start">
                                <RoleList
                                    roles={roles}
                                    activeRoleId={activeRoleId}
                                    totalCount={totalCount}
                                    onSelect={handleTabChange}
                                />
                            </aside>

                            <section className="min-w-0 space-y-3">
                                <Card>
                                    <CardContent className="space-y-3 pt-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <h2 className="text-base font-bold tracking-tight">
                                                    Role: {activeRole.label} <Badge className={`${activeRole.color} ml-2`}>{activeRole.id}</Badge>
                                                </h2>
                                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                                    {activeRole._count.users} {activeRole._count.users === 1 ? "user" : "users"} · {selectedCount}/{totalCount} permissions selected. Changes apply on next login.
                                                </p>
                                            </div>
                                            <div className="flex gap-1.5">
                                                <Button
                                                    size="sm"
                                                    onClick={handleSavePermissions}
                                                    disabled={savingPerms || !hasPermissionChanges}
                                                >
                                                    <Save size={14} />
                                                    {savingPerms ? "Saving..." : "Save permissions"}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleDiscardPermissions}
                                                    disabled={!hasPermissionChanges}
                                                >
                                                    <RotateCcw size={14} />
                                                    Discard
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11px] dark:border-blue-900 dark:bg-blue-950/30">
                                            <Boxes size={13} className="shrink-0 text-blue-600 dark:text-blue-400" />
                                            {lensIsAllAccess ? (
                                                <span className="text-foreground">
                                                    <span className="font-semibold">{activeRole.department?.name ?? "Administration"}</span>
                                                    {` is all-access — all ${totalCount} permissions are available.`}
                                                </span>
                                            ) : (
                                                <span className="text-foreground">
                                                    {"Lens: "}
                                                    <span className="font-semibold">{activeRole.department?.name ?? "—"}</span>
                                                    {` department · showing ${lensSize} of ${totalCount} permissions in its pool. `}
                                                    <span className="text-muted-foreground">Edit the pool on the Departments page.</span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                                            <div className="relative min-w-64 flex-1">
                                                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    value={search}
                                                    onChange={(event) => setSearch(event.target.value)}
                                                    placeholder="Search permissions by name, module, or ID..."
                                                    className="h-7 pl-8 text-xs"
                                                />
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelected(new Set(lensPermIds))}
                                            >
                                                Select all
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelected(new Set())}
                                            >
                                                Clear all
                                            </Button>
                                        </div>

                                        {hasBypass && (
                                            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                                                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-destructive" />
                                                <p className="text-[11px] leading-relaxed text-destructive">
                                                    <span className="font-semibold">admin:bypass active.</span>{" "}
                                                    This role skips every permission check in the system.
                                                </p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="space-y-3 pt-4">
                                        {filtered.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                                <Search size={32} className="mb-3 opacity-20" />
                                                <p className="text-sm">No permissions match your search.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                <PermissionMatrix
                                                    permissions={matrixPermissions}
                                                    permissionById={permissionById}
                                                    search={search}
                                                    selected={selected}
                                                    original={original}
                                                    onTogglePerm={togglePerm}
                                                />
                                                {visibleVoucherGroups.map((group) => (
                                                    <SharedPermissionMatrix
                                                        key={group.key}
                                                        title={`${group.label} — eligibility`}
                                                        description="Per voucher kind: view / open (read) and create / post / cancel (= edit) / delete (write). Each is independent — a role can have Create without View."
                                                        rows={group.rows}
                                                        columnGroups={VOUCHER_COLUMN_GROUPS}
                                                        selected={selected}
                                                        onTogglePerm={togglePerm}
                                                        collapsible
                                                        defaultOpen={false}
                                                    />
                                                ))}
                                                <AdditionalPermissions
                                                    permissions={additionalPermissions}
                                                    selected={selected}
                                                    original={original}
                                                    onTogglePerm={togglePerm}
                                                />
                                            </div>
                                        )}
                                    </CardContent>

                                    <QuickActionsSection
                                        selected={selected}
                                        original={original}
                                        onTogglePerm={togglePerm}
                                        inLens={inLens}
                                    />
                                </Card>

                                <PosVoucherSection
                                    selected={selected}
                                    original={original}
                                    setSelected={setSelected}
                                    onTogglePerm={togglePerm}
                                    posShiftChipsAvailable={posShiftChipsAvailable}
                                />


                                <SidebarVisibilitySection
                                    selected={selected}
                                    original={original}
                                    search={search}
                                    inLens={inLens}
                                    onTogglePerm={togglePerm}
                                />

                                <WorkAccessSection
                                    works={works}
                                    groups={workGroups}
                                    selected={selected}
                                    original={original}
                                    search={search}
                                    onTogglePerm={togglePerm}
                                />
                            </section>
                        </div>
                    </>
                )}

                <NewRoleDialog
                    open={newRoleOpen}
                    onOpenChange={setNewRoleOpen}
                    roles={roles}
                    departments={departments}
                    form={newRole}
                    copyFromRoleId={copyFromRoleId}
                    saving={savingRole}
                    onFormChange={setNewRole}
                    onCopyFromRoleChange={setCopyFromRoleId}
                    onCreate={handleCreate}
                    onCancel={() => {
                        setNewRoleOpen(false);
                        setNewRole(EMPTY_ROLE);
                        setCopyFromRoleId(NO_COPY_ROLE);
                    }}
                />
            </div>
        </ScrollArea>
    );
}

function RoleFields({
    form,
    onChange,
    departments,
}: {
    form: RoleForm;
    onChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    departments: Department[];
}) {
    const selectedDept = departments.find((d) => d.id === form.departmentId);
    return (
        <div className="space-y-2">
            <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Department <span className="font-normal">(authoring lens — which permissions this role can hold)</span>
                </label>
                <Select
                    value={form.departmentId || undefined}
                    onValueChange={(value) => onChange((prev) => ({ ...prev, departmentId: value }))}
                >
                    <SelectTrigger className="h-7 w-full text-xs">
                        <SelectValue placeholder="Select a department…" />
                    </SelectTrigger>
                    <SelectContent>
                        {departments.map((dept) => (
                            <SelectItem key={dept.id} value={dept.id}>
                                {dept.name}{dept.isAllAccess ? " · all-access" : ""}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {selectedDept && !selectedDept.isAllAccess && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                        Only permissions in {selectedDept.name}&apos;s pool are offered. Moving a role to another department strips grants outside the new pool.
                    </p>
                )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_78px_minmax(160px,1fr)]">
                <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Role name
                    </label>
                    <Input
                        value={form.label}
                        onChange={(event) => onChange((prev) => ({ ...prev, label: event.target.value }))}
                        placeholder="e.g. Senior Technician"
                        className="h-7 text-xs"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Rank
                    </label>
                    <Input
                        type="text"
                        inputMode="numeric"
                        value={form.rank}
                        onChange={(event) => onChange((prev) => ({ ...prev, rank: Number(event.target.value) }))}
                        className="h-7 text-xs"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Colour
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {COLOR_OPTIONS.map((color) => (
                            <Button
                                key={color.value}
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                title={color.label}
                                onClick={() => onChange((prev) => ({ ...prev, color: color.value }))}
                                className={[
                                    "h-6 w-6 rounded-md border p-0 transition-all duration-150",
                                    color.dot,
                                    form.color === color.value
                                        ? "scale-105 border-foreground ring-1 ring-border ring-offset-1"
                                        : "border-transparent hover:scale-105 hover:border-border",
                                ].join(" ")}
                            />
                        ))}
                        {form.label && <Badge className={`${form.color} ml-2`}>{form.label}</Badge>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function RoleDetailsCard({
    role,
    form,
    departments,
    selectedCount,
    totalCount,
    saving,
    hasChanges,
    onFormChange,
    onSave,
    onDiscard,
    onDelete,
}: {
    role: Role;
    form: RoleForm;
    departments: Department[];
    selectedCount: number;
    totalCount: number;
    saving: boolean;
    hasChanges: boolean;
    onFormChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    onSave: () => void;
    onDiscard: () => void;
    onDelete: () => void;
}) {
    return (
        <Card className={`border-l-4 ${ROLE_ACCENT[form.color] ?? "border-l-gray-300"}`}>
            <CardContent className="grid gap-3 pt-4 lg:grid-cols-[minmax(160px,0.7fr)_minmax(300px,1.5fr)_auto] lg:items-end">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={`${role.color} font-mono text-xs`}>{role.id}</Badge>
                        {role.isSystem && (
                            <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                <Lock size={9} /> System
                            </span>
                        )}
                    </div>
                    <div>
                        <p className="text-base font-bold leading-tight text-foreground">{role.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {role._count.users} {role._count.users === 1 ? "user" : "users"} · {selectedCount}/{totalCount} permissions
                        </p>
                        {role.department && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground">{role.department.name}</span> department
                                {role.department.isAllAccess ? " · all-access" : ""}
                            </p>
                        )}
                    </div>
                </div>

                <RoleFields form={form} onChange={onFormChange} departments={departments} />

                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                    <Button
                        size="sm"
                        onClick={onSave}
                        disabled={saving || !hasChanges || !form.label.trim()}
                    >
                        <Save size={14} />
                        {saving ? "Saving..." : "Save role"}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onDiscard}
                        disabled={!hasChanges}
                    >
                        <RotateCcw size={14} />
                    </Button>
                    {!role.isSystem && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={onDelete}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete role"
                        >
                            <Trash2 size={14} />
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function NewRoleDialog({
    open,
    onOpenChange,
    roles,
    departments,
    form,
    copyFromRoleId,
    saving,
    onFormChange,
    onCopyFromRoleChange,
    onCreate,
    onCancel,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    roles: Role[];
    departments: Department[];
    form: RoleForm;
    copyFromRoleId: string;
    saving: boolean;
    onFormChange: React.Dispatch<React.SetStateAction<RoleForm>>;
    onCopyFromRoleChange: (roleId: string) => void;
    onCreate: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Create New Role</DialogTitle>
                    <DialogDescription>
                        Create the role details and optionally start with permissions copied from an existing role.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <RoleFields form={form} onChange={onFormChange} departments={departments} />

                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            Copy permissions from
                        </label>
                        <Select value={copyFromRoleId} onValueChange={onCopyFromRoleChange}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Start with no copied permissions" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_COPY_ROLE}>No copied permissions</SelectItem>
                                {roles.map((role) => (
                                    <SelectItem key={role.id} value={role.id}>
                                        {role.label} ({role.id})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            The new role will be created first, then the copied permission set will be applied with the existing API.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button disabled={saving || !form.label.trim()} onClick={onCreate}>
                        {saving ? "Creating..." : "Create Role"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RoleList({
    roles,
    activeRoleId,
    totalCount,
    onSelect,
}: {
    roles: Role[];
    activeRoleId: string;
    totalCount: number;
    onSelect: (roleId: string) => void;
}) {
    return (
        <Card>
            <CardContent className="space-y-2 pt-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Roles
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Select a role to edit its details and permissions.
                    </p>
                </div>

                <div className="space-y-1">
                    {roles.map((role) => {
                        const isActive = role.id === activeRoleId;
                        const permissionCount = role.permissions.length;
                        const accent = ROLE_ACCENT[role.color] ?? "border-l-gray-300";

                        return (
                            <Button
                                key={role.id}
                                type="button"
                                variant="ghost"
                                onClick={() => onSelect(role.id)}
                                className={[
                                    "group h-auto w-full justify-start rounded-md border border-l-4 bg-background px-2 py-1.5 text-left transition-all",
                                    accent,
                                    isActive
                                        ? "border-primary shadow-sm"
                                        : "border-border hover:border-primary/50 hover:bg-muted/40",
                                ].join(" ")}
                            >
                                <div className="flex w-full min-w-0 flex-col gap-1 whitespace-normal">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                            <Badge className={`${role.color} font-mono text-[10px]`}>
                                                {role.id}
                                            </Badge>
                                            {role.isSystem && (
                                                <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                    <Lock size={9} /> System
                                                </span>
                                            )}
                                        </div>
                                        {isActive && (
                                            <span className="shrink-0 text-[10px] font-medium text-primary">Active</span>
                                        )}
                                    </div>
                                    <p className="truncate text-xs font-semibold text-foreground">
                                        {role.label}
                                    </p>
                                    {role.department && (
                                        <p className="truncate text-[10px] text-muted-foreground" title="Authoring department">
                                            {role.department.name}{role.department.isAllAccess ? " · all-access" : ""}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                        <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5">
                                            <Users size={10} />
                                            {role._count.users}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5">
                                            <Shield size={10} />
                                            {permissionCount}/{totalCount}
                                        </span>
                                        <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5">
                                            Rank {role.rank}
                                        </span>
                                    </div>
                                </div>
                            </Button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

function PermissionMatrix({
    permissions,
    permissionById,
    search,
    selected,
    original,
    onTogglePerm,
}: {
    permissions: Permission[];
    permissionById: Map<string, Permission>;
    search: string;
    selected: Set<string>;
    original: Set<string>;
    onTogglePerm: (id: string) => void;
}) {
    // Parked (old UI): this flat cross-module CRUD grid (Tickets/Customers/Users/
    // Roles/…) is hidden temporarily — the new permission UI is being built at the
    // MODULE level instead (see the Sidebar links card's per-link expand-to-matrix,
    // e.g. Users/Role/Organisation). Not deleted; body kept below, commented out.
    return null;
}

// The role's Quick Actions picker — flex list of everything creatable (vouchers +
// POS is a separate UI (/vouchers/pos) with its own voucher lifecycle and
// operator shift/till controls — kept in its own card, not mixed into the
// office voucher matrices above, so the two surfaces read as distinct.
function PosVoucherSection({
    selected,
    original,
    setSelected,
    onTogglePerm,
    posShiftChipsAvailable,
}: {
    selected: Set<string>;
    original: Set<string>;
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
    onTogglePerm: (id: string) => void;
    posShiftChipsAvailable: boolean;
}) {
    // Only relevant once the role can see POS at all (the workspace visibility toggle).
    if (!selected.has(POS_VISIBILITY_ID)) return null;
    return (
        <Card className="border-green-200 dark:border-green-900">
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <ShoppingCart size={15} className="text-green-700 dark:text-green-400" /> Point of Sale
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Separate from office vouchers — gates the /vouchers/pos UI and the operator&rsquo;s own shift &amp; till.
                    </p>
                </div>
                <SharedPermissionMatrix
                    title="POS vouchers — /vouchers/pos UI only"
                    description="Per POS voucher kind: create / cancel (= edit) / delete (no post — POS has no draft; being able to create implies it's visible). Office-equivalent voucher permission also grants each (office ⊇ POS)."
                    rows={POS_MATRIX_ROWS}
                    columnGroups={POS_COLUMN_GROUPS}
                    selected={selected}
                    onTogglePerm={onTogglePerm}
                    collapsible
                    defaultOpen={false}
                />
                {posShiftChipsAvailable && (
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <div className="border-b border-border bg-muted/40 px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">POS Shift &amp; Till</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Operator actions on their own counter — start/end their shift (open implies close) and drop cash to the safe. Oversight (manage, view other branches) is a separate management concern.</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                            {POS_OPERATOR_SHIFT_CHIPS.map((chip) => {
                                // Each chip toggles its id(s) together (Start/End = open + close).
                                const on = chip.ids.every((id) => selected.has(id));
                                const changed = chip.ids.some((id) => selected.has(id) !== original.has(id));
                                return (
                                    <Button
                                        key={chip.label}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setSelected((prev) => {
                                                const next = new Set(prev);
                                                const all = chip.ids.every((id) => next.has(id));
                                                chip.ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
                                                return next;
                                            })
                                        }
                                        title={`${chip.label} — grants ${chip.ids.join(" + ")}`}
                                        className={[
                                            "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                            on
                                                ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                                : "border-border hover:border-primary/60 hover:bg-primary/5",
                                            changed ? "ring-2 ring-primary/20" : "",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                                on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                            ].join(" ")}
                                        >
                                            {on && <Check size={10} strokeWidth={3} />}
                                        </span>
                                        <span className="text-[11px] font-medium leading-tight">{chip.label}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// Repair + POS). Ticking a chip grants that create permission, which makes the "+"
// show in the role's button bar. Reads/writes the same `selected` set as the
// matrix, so the two views stay in sync.
function QuickActionsSection({
    selected,
    original,
    onTogglePerm,
    inLens,
}: {
    selected: Set<string>;
    original: Set<string>;
    onTogglePerm: (id: string) => void;
    // Department-pool lens: a chip is offered only if its create permission is in
    // the pool (or already granted, so nothing granted is ever hidden). Keeps this
    // bar in step with the voucher matrix, which is pool-gated per kind.
    inLens: (id: string) => boolean;
}) {
    const options = QUICK_ACTION_OPTIONS.filter((opt) => inLens(opt.permission));
    // Nothing creatable in this department's pool → drop the whole card (no empty header).
    if (options.length === 0) return null;
    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <Plus size={15} /> Quick Actions
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Tick what this role can create — each shows as a &ldquo;+&rdquo; in the role&rsquo;s Quick Actions bar. Ticking grants that create permission.
                    </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {options.map((opt) => {
                        const Icon = opt.icon;
                        const isOn = selected.has(opt.permission);
                        const changed = isOn !== original.has(opt.permission);
                        return (
                            <Button
                                key={opt.permission}
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onTogglePerm(opt.permission)}
                                title={opt.permission}
                                className={[
                                    "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                    isOn
                                        ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                        : "border-border hover:border-primary/60 hover:bg-primary/5",
                                    changed ? "ring-2 ring-primary/20" : "",
                                ].join(" ")}
                            >
                                <span
                                    className={[
                                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                        isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                    ].join(" ")}
                                >
                                    {isOn && <Check size={10} strokeWidth={3} />}
                                </span>
                                <Icon size={13} className="shrink-0 text-muted-foreground" />
                                <span className="text-[11px] font-medium leading-tight">{opt.label}</span>
                            </Button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

// The role's direct Work assignment. Lists every work grouped by its Work Group
// (friendly sorting only — groups carry no access). Ticking a *gated* work grants
// its `work:<id>` permission; ungated works are open to all and shown read-only.
// This list is NOT filtered by the department pool — works are assigned directly.
function WorkAccessSection({
    works,
    groups,
    selected,
    original,
    search,
    onTogglePerm,
}: {
    works: WorkRow[];
    groups: WorkGroupRow[];
    selected: Set<string>;
    original: Set<string>;
    search: string;
    onTogglePerm: (id: string) => void;
}) {
    // Only gated, human works are hand-assigned: auto works (Actions) run by
    // themselves, and ungated works are open to all so there's nothing to grant.
    const assignableWorks = works.filter((w) => w.kind !== "auto" && w.permissionId);
    const term = search.trim().toLowerCase();
    const matched = term
        ? assignableWorks.filter((w) => `${w.label} ${w.permissionId ?? ""}`.toLowerCase().includes(term))
        : assignableWorks;

    if (assignableWorks.length === 0) return null;

    // Ordered buckets: known groups by their order, then an "Ungrouped" catch-all.
    const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
    const buckets: { id: string | null; label: string; color: string | null; works: WorkRow[] }[] = [
        ...orderedGroups.map((g) => ({ id: g.id, label: g.label, color: g.color, works: matched.filter((w) => w.groupId === g.id) })),
        { id: null, label: "Ungrouped", color: null, works: matched.filter((w) => !w.groupId || !groups.some((g) => g.id === w.groupId)) },
    ].filter((b) => b.works.length > 0);

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <ClipboardList size={15} /> Works
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Assigned directly to the role — not filtered by the department pool. Tick a work to let this role act on it in the Work Inbox. Groups are sorting only.
                    </p>
                </div>

                {buckets.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-muted-foreground">No works match your search.</p>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
                        {buckets.map((bucket) => (
                            <div key={bucket.id ?? "__ungrouped__"} className="px-3 py-2.5">
                                <div className="mb-1.5 flex items-center gap-2">
                                    {bucket.color ? (
                                        <Badge className={`${bucket.color} text-[10px]`}>{bucket.label}</Badge>
                                    ) : (
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{bucket.label}</span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground">
                                        {bucket.works.length} {bucket.works.length === 1 ? "work" : "works"}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {bucket.works.map((work) => {
                                        const permId = work.permissionId;
                                        if (!permId) return null; // filtered out above; guard narrows the type
                                        const isOn = selected.has(permId);
                                        const changed = isOn !== original.has(permId);
                                        return (
                                            <Button
                                                key={work.id}
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => onTogglePerm(permId)}
                                                title={`${work.label} (${permId})`}
                                                className={[
                                                    "h-auto items-start gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                                    isOn
                                                        ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                                        : "border-border hover:border-primary/60 hover:bg-primary/5",
                                                    changed ? "ring-2 ring-primary/20" : "",
                                                ].join(" ")}
                                            >
                                                <span
                                                    className={[
                                                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                                        isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                                    ].join(" ")}
                                                >
                                                    {isOn && <Check size={10} strokeWidth={3} />}
                                                </span>
                                                <span className="flex flex-col">
                                                    <span className="text-[11px] font-medium leading-tight">{work.label}</span>
                                                    <span className="text-[10px] leading-tight text-muted-foreground">{permId}</span>
                                                </span>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// The role's sidebar link picker — "goes inside" each module the department pool
// offers and lists its next-level nav labels. Ticking a link grants its
// `ui:sidebar:<module>:<child>` permission, so the link shows in the role's
// sidebar. Modules outside the department pool offer no links and are dropped, so
// a role only sees links inside the modules its department allows.
function SidebarVisibilitySection({
    selected,
    original,
    search,
    inLens,
    onTogglePerm,
}: {
    selected: Set<string>;
    original: Set<string>;
    search: string;
    inLens: (id: string) => boolean;
    onTogglePerm: (id: string) => void;
}) {
    const term = search.trim().toLowerCase();
    // Which granular matrices are expanded — keyed by the MATRIX ROW, not the link.
    // Several links can map to the same row (e.g. Products + Item Ledger both use
    // products:*); both show a chevron, but they open the SAME single table.
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const toggleRow = (rowKey: string) =>
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(rowKey)) next.delete(rowKey); else next.add(rowKey);
            return next;
        });
    const matrixRowForLink = (node: SidebarChildRow) => {
        const rowKey = SIDEBAR_LINK_MATRIX_ROW_KEY[node.permissionId];
        return rowKey ? MATRIX_ROWS.find((row) => row.key === rowKey) : undefined;
    };

    // Gate per MODULE, not per link: a module is offered if the department pool
    // carries ANY of its links (all-access pools offer everything; Workspace is
    // always offered). Once offered, EVERY current link from constants shows — so
    // adding a nav item (or sub-nav) appears automatically, no re-pooling needed.
    // Then prune only by the search term, keeping ancestors of a match.
    const modules = SIDEBAR_MODULES
        .map((mod) => {
            const moduleOffered = !mod.pooled || mod.childPermissionIds.some((id) => inLens(id));
            if (!moduleOffered) return { ...mod, children: [] as SidebarChildRow[] };
            const moduleMatch = !term || mod.label.toLowerCase().includes(term);
            const prune = (nodes: SidebarChildRow[]): SidebarChildRow[] =>
                nodes.reduce<SidebarChildRow[]>((acc, node) => {
                    const kids = node.children ? prune(node.children) : undefined;
                    const keep = moduleMatch || node.label.toLowerCase().includes(term) || (!!kids && kids.length > 0);
                    if (keep) acc.push({ ...node, children: kids && kids.length ? kids : undefined });
                    return acc;
                }, []);
            return { ...mod, children: prune(mod.children) };
        })
        .filter((mod) => mod.children.length > 0);

    if (modules.length === 0) return null;

    const countLinks = (nodes: SidebarChildRow[]): number =>
        nodes.reduce((n, c) => n + 1 + (c.children ? countLinks(c.children) : 0), 0);

    const chip = (node: SidebarChildRow) => {
        const isOn = selected.has(node.permissionId);
        const changed = isOn !== original.has(node.permissionId);
        const matrixRow = matrixRowForLink(node);
        // Every link mapping to a matrix row gets a chevron; links that share a row
        // open the SAME table (state is keyed by the row, so only one table opens).
        const expanded = matrixRow ? expandedRows.has(matrixRow.key) : false;
        const extraToggle = SIDEBAR_LINK_EXTRA_TOGGLE[node.permissionId];
        // When a ticked link carries its own controls (a create/edit/delete matrix
        // and/or a guard toggle), wrap the whole group in a subtle cluster so those
        // controls read as belonging to THIS link — not the next chip beside it.
        const hasControls = isOn && (!!matrixRow || !!extraToggle);
        return (
            <div
                key={node.permissionId}
                className={[
                    "inline-flex items-stretch gap-1",
                    hasControls ? "rounded-lg border border-border bg-muted/40 p-1" : "",
                ].join(" ")}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onTogglePerm(node.permissionId)}
                    title={node.permissionId}
                    className={[
                        "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                        isOn
                            ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                            : "border-border hover:border-primary/60 hover:bg-primary/5",
                        changed ? "ring-2 ring-primary/20" : "",
                    ].join(" ")}
                >
                    <span
                        className={[
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        ].join(" ")}
                    >
                        {isOn && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span className="text-[11px] font-medium leading-tight">{node.label}</span>
                </Button>
                {/* Some links (Users, Role, Organisation…) also carry a granular
                    create/view/edit/delete grant — this reveals that row inline.
                    Only offered once the link itself is ticked (no point granting
                    Create/Edit/Delete for a link the role can't even see). */}
                {matrixRow && isOn && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => toggleRow(matrixRow.key)}
                        title={`${expanded ? "Hide" : "Show"} granular permissions for ${node.label}`}
                        className="h-auto w-6 shrink-0 rounded-md border border-border text-muted-foreground hover:border-primary/60 hover:bg-primary/5"
                    >
                        <ChevronDown size={12} className={["transition-transform", expanded ? "rotate-180" : ""].join(" ")} />
                    </Button>
                )}
                {/* Single extra yes/no capability on top of "can see this page" (e.g.
                    Tax Classification's edit grant) — only offered once the link
                    itself is ticked. */}
                {extraToggle && isOn && (() => {
                    const extraOn = selected.has(extraToggle.id);
                    const extraChanged = extraOn !== original.has(extraToggle.id);
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onTogglePerm(extraToggle.id)}
                            title={extraToggle.id}
                            className={[
                                "h-auto items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                extraOn
                                    ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                    : "border-border hover:border-primary/60 hover:bg-primary/5",
                                extraChanged ? "ring-2 ring-primary/20" : "",
                            ].join(" ")}
                        >
                            <span
                                className={[
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                    extraOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                ].join(" ")}
                            >
                                {extraOn && <Check size={10} strokeWidth={3} />}
                            </span>
                            <span className="text-[11px] font-medium leading-tight">{extraToggle.label}</span>
                        </Button>
                    );
                })()}
            </div>
        );
    };

    // Leaves wrap in a row; parents render their own chip then an indented block of
    // their children (recursive), so sub-nav shows nested with its own checkboxes.
    const renderLevel = (nodes: SidebarChildRow[]) => {
        const leaves = nodes.filter((n) => !n.children?.length);
        const parents = nodes.filter((n) => n.children?.length);
        // One table per EXPANDED row, even if several leaves at this level map to it
        // (dedupe by row key) — so Products + Item Ledger open a single Products table.
        const expandedRowsAtLevel: (typeof MATRIX_ROWS)[number][] = [];
        const seenRowKeys = new Set<string>();
        for (const n of leaves) {
            const row = matrixRowForLink(n);
            if (row && selected.has(n.permissionId) && expandedRows.has(row.key) && !seenRowKeys.has(row.key)) {
                seenRowKeys.add(row.key);
                expandedRowsAtLevel.push(row);
            }
        }
        return (
            <div className="space-y-1.5">
                {leaves.length > 0 && <div className="flex flex-wrap items-start gap-1.5">{leaves.map(chip)}</div>}
                {expandedRowsAtLevel.map((row) => (
                    <SharedPermissionMatrix
                        key={row.key}
                        title={`${row.label} — granular permissions`}
                        rows={[toSharedMatrixRow(row)]}
                        columnGroups={CORE_MATRIX_COLUMN_GROUPS}
                        selected={selected}
                        onTogglePerm={onTogglePerm}
                    />
                ))}
                {parents.map((p) => {
                    // A parent link can also carry a matrix (e.g. Inventory → Masters,
                    // one create/edit/delete for all the setup tables under it).
                    const pRow = matrixRowForLink(p);
                    const pExpanded = !!pRow && selected.has(p.permissionId) && expandedRows.has(pRow.key);
                    return (
                        <div key={p.permissionId} className="space-y-1">
                            <div className="flex flex-wrap items-start gap-1.5">{chip(p)}</div>
                            {pExpanded && pRow && (
                                <SharedPermissionMatrix
                                    title={`${pRow.label} — granular permissions`}
                                    rows={[toSharedMatrixRow(pRow)]}
                                    columnGroups={CORE_MATRIX_COLUMN_GROUPS}
                                    selected={selected}
                                    onTogglePerm={onTogglePerm}
                                />
                            )}
                            {/* Sub-links are offered only once the parent is ticked — a child
                                shows in the sidebar only under a checked parent. */}
                            {selected.has(p.permissionId) && (
                                <div className="ml-3 border-l border-border pl-2.5">{renderLevel(p.children!)}</div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                        <PanelLeft size={15} /> Sidebar links
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Pick which navigation links this role sees in the sidebar — including nested sub-nav. Workspace is always available; other modules appear only if the role&rsquo;s department pool offers them.
                    </p>
                </div>

                <div className="space-y-2">
                    {modules.map((mod) => (
                        <div key={mod.key} className="overflow-hidden rounded-lg border border-border bg-card px-3 py-2.5">
                            <div className="mb-1.5 flex items-center gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">{mod.label}</span>
                                <span className="text-[10px] text-muted-foreground">
                                    {countLinks(mod.children)} links
                                </span>
                            </div>
                            {renderLevel(mod.children)}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function AdditionalPermissions({
    permissions,
    selected,
    original,
    onTogglePerm,
}: {
    permissions: Permission[];
    selected: Set<string>;
    original: Set<string>;
    onTogglePerm: (id: string) => void;
}) {
    if (permissions.length === 0) return null;

    const modules = [
        ...MODULE_ORDER.filter((module) => permissions.some((permission) => permission.module === module)),
        ...Array.from(new Set(permissions.map((permission) => permission.module)))
            .filter((module) => !MODULE_ORDER.includes(module))
            .sort(),
    ];
    const grouped = modules.map((module) => ({
        module,
        permissions: permissions.filter((permission) => permission.module === module),
    }));

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            {/* <div className="border-b border-border bg-muted/40 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Additional permissions
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Lifecycle, finance, POS, and module toggles not modelled by the CRUD matrix.
                </p>
            </div>
            <div className="divide-y divide-border">
                {grouped.map((group) => (
                    <div key={group.module} className="px-3 py-2.5">
                        <div className="mb-1.5 flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                                {MODULE_META[group.module]?.label ?? group.module}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                {group.permissions.length} {group.permissions.length === 1 ? "permission" : "permissions"}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {group.permissions.map((permission) => {
                                const isOn = selected.has(permission.id);
                                const changed = selected.has(permission.id) !== original.has(permission.id);
                                return (
                                    <Button
                                        key={permission.id}
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onTogglePerm(permission.id)}
                                        title={`${permission.label} (${permission.id})${permission.description ? `\n${permission.description}` : ""}`}
                                        className={[
                                            "h-auto items-start gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                                            isOn
                                                ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                                                : "border-border hover:border-primary/60 hover:bg-primary/5",
                                            changed ? "ring-2 ring-primary/20" : "",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                                isOn ? "border-primary bg-primary text-primary-foreground" : "border-border",
                                            ].join(" ")}
                                        >
                                            {isOn && <Check size={10} strokeWidth={3} />}
                                        </span>
                                        <span className="flex flex-col">
                                            <span className="text-[11px] font-medium leading-tight">{permission.label}</span>
                                            <span className="text-[10px] leading-tight text-muted-foreground">{permission.id}</span>
                                        </span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div> */}
        </div>
    );
}
