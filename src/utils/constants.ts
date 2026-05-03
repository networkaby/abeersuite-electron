import type { LucideIcon } from "lucide-react";
import {
    ClipboardList,
    Users,
    Building2,
    UserCog,
    Settings,
    ShieldCheck,
    GitBranch,
    Wrench,
    Plus,
    FileText,
    Calculator,
    Bell,
    Network,
    Briefcase,
    PhoneCall,
    Search,
    ShoppingCart,
    Box,
    Layers,
    Truck,
    MapPin,
    HelpCircle,
    ChartArea,
    TicketPercent,
    Gift,
    BadgePercent,
    Wallet,

} from "lucide-react";

// Keys match the Priority enum: LOW | MEDIUM | HIGH | URGENT
export const PRIORITY_META: Record<string, { label: string; color: string }> = {
    LOW: { label: "Low", color: "bg-gray-100 text-gray-500" },
    MEDIUM: { label: "Normal", color: "bg-blue-50 text-blue-500" },
    HIGH: { label: "High", color: "bg-orange-100 text-orange-500" },
    URGENT: { label: "Urgent", color: "bg-red-100 text-red-600" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type NavItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    permission?: string | null;
    children?: NavItem[];
};

export type ModuleChild = {
    label: string;
    icon: LucideIcon;
    href?: string;
    action?: "new-ticket";
    // "default" resolves to the pipeline where isDefault === true from /api/pipelines
    pipelineRef?: "default";
    permission?: string;
    disabled?: boolean;
};

export type ModuleSection = {
    label: string;
    icon: LucideIcon;
    key: string;
    disabled?: boolean;
    children: ModuleChild[];
};

export type SettingsNavItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    permission: string;
};

export type ButtonBarAction = {
    label: string;
    subtitle: string;
    icon: LucideIcon;
    variant: "default" | "outline";
    action: "new-ticket";
    pipelineRef?: "default";
    disabled?: boolean;
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export const WORKSPACE_NAV: NavItem[] = [
    { label: "My Assignments", href: "/office/assignments", icon: ClipboardList, permission: null },
    { label: "CallLog", href: "/office/call-log", icon: PhoneCall, permission: null },
    { label: "Search SLno", href: "/office/search-slno", icon: Search, permission: null },

];

export const MODULE_SECTIONS: ModuleSection[] = [
    {
        label: "Customers",
        icon: Users,
        key: "customers",
        children: [
            { label: "New People", href: "/office/customers/new", icon: Plus, permission: "customers:view" },
            { label: "New Companies", href: "/office/companies/new", icon: Plus, permission: "customers:view" },
            { label: "All Customers", href: "/office/all", icon: Users, permission: "customers:view" },
            { label: "People", href: "/office/customers", icon: Users, permission: "customers:view" },
            { label: "Companies", href: "/office/companies", icon: Building2, permission: "customers:view" },

        ],
    },
    {
        label: "Repair & Warranty",
        icon: Wrench,
        key: "repair",
        children: [
            { label: "New Repair", icon: Plus, action: "new-ticket", pipelineRef: "default" },
            { label: "All Repair", icon: ClipboardList, href: "/office/tickets", pipelineRef: "default" },
            { label: "Service Centers", icon: Building2, href: "/office/service-centers", permission: "service-centers:view" },
        ],
    },
    {
        label: "CRM",
        icon: Network,
        key: "crm",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: PhoneCall, href: "/office/crm/dummy1", disabled: true },
            { label: "Dummy2", icon: Search, href: "/office/crm/dummy2", disabled: true },
        ],
    },
    {
        label: "E-Commerce",
        icon: ShoppingCart,
        key: "e-commerce",
        children: [
            { label: "Dashboard", icon: ChartArea, href: "/office/ecommerce", permission: "ecommerce:manage" },
            { label: "Orders", icon: ClipboardList, href: "/office/ecommerce/orders", permission: "ecommerce:manage" },
            { label: "Products", icon: Box, href: "/office/ecommerce/products", permission: "ecommerce:manage" },
            { label: "Categories", icon: Layers, href: "/office/ecommerce/categories", permission: "ecommerce:manage" },
            { label: "Coupons", icon: BadgePercent, href: "/office/ecommerce/coupons", permission: "ecommerce:manage" },
        ],
    },
    {
        label: "Tally",
        icon: Calculator,
        key: "tally",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: Calculator, href: "/office/tally/dummy1", disabled: true },
            { label: "Dummy2", icon: ClipboardList, href: "/office/tally/dummy2", disabled: true },
        ],
    },
    {
        label: "Inventory",
        icon: Box,
        key: "inventory",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: Box, href: "/office/inventory/dummy1", disabled: true },
            { label: "Dummy2", icon: Search, href: "/office/inventory/dummy2", disabled: true },
        ],
    },
    {
        label: "HRM",
        icon: UserCog,
        key: "hrm",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: Users, href: "/office/hrm/dummy1", disabled: true },
            { label: "Dummy2", icon: Briefcase, href: "/office/hrm/dummy2", disabled: true },
        ],
    },
    {
        label: "Delivery",
        icon: Truck,
        key: "delivery",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: MapPin, href: "/office/delivery/dummy1", disabled: true },
            { label: "Dummy2", icon: ClipboardList, href: "/office/delivery/dummy2", disabled: true },
        ],
    },
    {
        label: "Field Service",
        icon: MapPin,
        key: "field-service",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: Wrench, href: "/office/field-service/dummy1", disabled: true },
            { label: "Dummy2", icon: PhoneCall, href: "/office/field-service/dummy2", disabled: true },
        ],
    },
    {
        label: "HelpDesk",
        icon: HelpCircle,
        key: "helpdesk",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: HelpCircle, href: "/office/helpdesk/dummy1", disabled: true },
            { label: "Dummy2", icon: Bell, href: "/office/helpdesk/dummy2", disabled: true },
        ],
    },
    {
        label: "Projects",
        icon: Briefcase,
        key: "projects",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: ClipboardList, href: "/office/projects/dummy1", disabled: true },
            { label: "Dummy2", icon: GitBranch, href: "/office/projects/dummy2", disabled: true },
        ],
    },
    {
        label: "Intelligence",
        icon: ChartArea,
        key: "intelligence",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: ChartArea, href: "/office/intelligence/dummy1", disabled: true },
            { label: "Dummy2", icon: Search, href: "/office/intelligence/dummy2", disabled: true },
        ],
    },
    {
        label: "Administration",
        icon: Settings,
        key: "administration",
        // disabled: true,
        children: [
            { label: "Dummy1", icon: Building2, href: "/office/administration/dummy1", disabled: true },
            { label: "Dummy2", icon: Settings, href: "/office/administration/dummy2", disabled: true },
        ],
    },
    {
        label: "Retention",
        icon: TicketPercent,
        key: "retention",
        children: [
            { label: "Create Coupon", icon: BadgePercent, href: "/office/retention/create-coupon", disabled: true },
            { label: "Loyalty Program", icon: Gift, href: "/office/retention/loyalty-program", disabled: true },
        ],
    },
    {
        label: "Pricing Strategy",
        icon: Wallet,
        key: "pricing-strategy",
        children: [
            { label: "Pricing Rules", icon: Calculator, href: "/office/pricing-strategy/pricing-rules", disabled: true },
            { label: "Discount Matrix", icon: FileText, href: "/office/pricing-strategy/discount-matrix", disabled: true },
        ],
    },
];

export const ADMIN_NAV: SettingsNavItem[] = [
    { label: "Users", href: "/office/users", icon: UserCog, permission: "users:manage" },
    { label: "Org Chart", href: "/office/org-chart", icon: Network, permission: "users:manage" },
    { label: "Role", href: "/office/role", icon: ShieldCheck, permission: "role:manage" },
    { label: "Branches", href: "/office/branches", icon: Building2, permission: "settings:manage" },
    { label: "Departments", href: "/office/departments", icon: Users, permission: "settings:manage" },
    { label: "Posts", href: "/office/posts", icon: Briefcase, permission: "settings:manage" },
];

export const SETTINGS_NAV: SettingsNavItem[] = [
    { label: "Statuses", href: "/office/settings/statuses", icon: Settings, permission: "settings:statuses" },
    { label: "Sub-Statuses", href: "/office/settings/sub-statuses", icon: Settings, permission: "settings:statuses" },
    { label: "Pipelines", href: "/office/settings/pipelines", icon: GitBranch, permission: "settings:pipelines" },
];

// ─── ButtonBar ────────────────────────────────────────────────────────────────

// ─── Finance ──────────────────────────────────────────────────────────────────

export function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export const INVOICE_STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SENT: "bg-blue-100 text-blue-700",
    PARTIAL: "bg-yellow-100 text-yellow-700",
    PAID: "bg-green-100 text-green-700",
    VOID: "bg-destructive/10 text-destructive",
};

export const JOURNAL_STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-yellow-100 text-yellow-700",
    POSTED: "bg-green-100 text-green-700",
    VOIDED: "bg-muted text-muted-foreground",
};

export type GlAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export const GL_TYPE_ORDER: GlAccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

export const GL_TYPE_COLORS: Record<GlAccountType, string> = {
    ASSET: "bg-blue-100 text-blue-700",
    LIABILITY: "bg-orange-100 text-orange-700",
    EQUITY: "bg-purple-100 text-purple-700",
    REVENUE: "bg-green-100 text-green-700",
    EXPENSE: "bg-red-100 text-red-700",
};

// ─── Badge colours (settings pages) ──────────────────────────────────────────

export const COLOR_OPTIONS = [
    { label: "Gray", value: "bg-gray-100 text-gray-600" },
    { label: "Dim gray", value: "bg-gray-100 text-gray-400" },
    { label: "Blue", value: "bg-blue-100 text-blue-600" },
    { label: "Yellow", value: "bg-yellow-100 text-yellow-700" },
    { label: "Orange", value: "bg-orange-100 text-orange-600" },
    { label: "Purple", value: "bg-purple-100 text-purple-600" },
    { label: "Green", value: "bg-green-100 text-green-700" },
    { label: "Red", value: "bg-red-100 text-red-600" },
    { label: "Teal", value: "bg-teal-100 text-teal-600" },
    { label: "Indigo", value: "bg-indigo-100 text-indigo-600" },
    { label: "Pink", value: "bg-pink-100 text-pink-600" },
] as const;

export const WARRANTY_SCOPE_OPTIONS = [
    { value: "any", label: "Any (shown for all tickets)" },
    { value: "warranty_only", label: "Warranty only" },
    { value: "non_warranty_only", label: "Non-warranty only" },
] as const;

// ─── ButtonBar ────────────────────────────────────────────────────────────────

export const BUTTON_BAR_ACTIONS: ButtonBarAction[] = [
    {
        label: "Repair +",
        subtitle: "Open repair intake",
        icon: Wrench,
        variant: "default",
        action: "new-ticket",
        pipelineRef: "default",
    },
    {
        label: "Dummy Create +",
        subtitle: "Coming soon",
        icon: Plus,
        variant: "outline",
        action: "new-ticket",
        disabled: true,
    },
    {
        label: "Dummy Create2 +",
        subtitle: "Coming soon",
        icon: Plus,
        variant: "outline",
        action: "new-ticket",
        disabled: true,
    },
];
