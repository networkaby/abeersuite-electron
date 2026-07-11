import type { LucideIcon } from "lucide-react";
import { VOUCHER_MATRIX } from "@/shared/lib/auth/voucherMatrix";
import {
    ClipboardList,
    Users,
    Building2,
    UserCog,
    Settings,
    ShieldCheck,
    Wrench,
    Plus,
    FileText,
    Calculator,
    Network,
    Briefcase,
    Monitor,
    ShoppingCart,
    Box,
    Layers,
    Truck,
    ChartArea,
    BadgePercent,
    Wallet,
    Ruler,
    Tag,
    LayoutGrid,
    Calendar,
    Clock,
    Inbox,
    BookOpen,
    ScrollText,
    ListOrdered,
    Undo2,
    Receipt,
    ArrowUpRight,
    ArrowDownRight,
    Hash,
    Tags,
    FolderTree,
    PackageCheck,
    PackageX,
    ArrowLeftRight,
    ClipboardCheck,
    BarChart3,
    ListChecks,
    Percent,
    Printer,
    QrCode,
    Factory,
    Workflow,
    Banknote,
    Database,
    Upload,
    Download,
    AlertTriangle,
    TicketPercent,
    Ticket,
    CreditCard,
    Gift,
    Trash2,
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
    /** Open the href in a new browser tab (e.g. standalone POS). */
    newTab?: boolean;
    action?: "new-ticket";
    // "default" resolves to the pipeline where isDefault === true from /api/pipelines
    pipelineRef?: "default";
    permission?: string;
    disabled?: boolean;
    children?: ModuleChild[];
};

export type ModuleCreateAction = {
    label: string;
    subtitle: string;
    icon: LucideIcon;
    variant?: "default" | "outline";
    href?: string;
    /** Open the href in a new browser tab. */
    newTab?: boolean;
    action?: "new-ticket" | "new-person" | "new-company" | "new-journal-voucher" | "new-debit-note" | "new-contra" | "new-payment" | "new-receipt" | "new-credit-note" | "new-sale" | "new-purchase" | "new-sale-return" | "new-purchase-return" | "new-estimate" | "new-sales-order" | "new-purchase-order" | "new-grn" | "new-challan" | "new-manufacturing-journal" | "new-physical-stock" | "new-branch-transfer" | "new-rejection-in" | "new-rejection-out";
    pipelineRef?: "default";
    permission?: string | null;
    disabled?: boolean;
};

export type ModuleSection = {
    label: string;
    icon: LucideIcon;
    key: string;
    disabled?: boolean;
    /** When set, the entire module is hidden from the sidebar unless the user holds this permission (admin:bypass also passes). */
    permission?: string;
    children: ModuleChild[];
    createActions?: ModuleCreateAction[];
    dashboardHref?: string;
    pathPrefixes?: string[];
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
    /** Direct navigation target. Mutually exclusive with `action`. */
    href?: string;
    /** Open the href in a new browser tab. */
    newTab?: boolean;
    /** Create-action discriminator (voucher kind / ticket / contact). Mutually exclusive with `href`. */
    action?: ModuleCreateAction["action"];
    pipelineRef?: "default";
    /** When set, the action is hidden unless the user holds this permission (admin:bypass also passes). */
    permission?: string | null;
    disabled?: boolean;
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export const WORKSPACE_NAV: NavItem[] = [
    { label: "Inbox", href: "/office/message/inbox", icon: Inbox, permission: null },
    { label: "Work Flow", href: "/office/work-flow-inbox", icon: ClipboardList, permission: null },
    { label: "POS", href: "/vouchers/pos", icon: Monitor, permission: "pos:shift:open" },
    // { label: "CallLog", href: "/office/core/call-log", icon: PhoneCall, permission: null },
    // { label: "Search SLno", href: "/office/core/search-slno", icon: Search, permission: null },

];

export const MODULE_SECTIONS: ModuleSection[] = [

    // POS (manager oversight — shift reports etc.). The operator's register lives
    // in Workspace → POS; this office module is for managers, so it is gated by the
    // shift-report VIEW permission, NOT the operator's `pos:shift:open`. It points at
    // the shift reports page, not the register.
    {
        label: "POS",
        icon: Monitor,
        key: "pos",
        dashboardHref: "/office/pos/shifts",
        pathPrefixes: ["/office/pos"],
        children: [
            { label: "Shift Reports", href: "/office/pos/shifts", icon: Clock },
            { label: "Counters", href: "/office/pos/counters", icon: ClipboardList },
        ],
    },


    // Contacts (people + companies; CRM contact database)
    {
        label: "Contacts",
        icon: Users,
        key: "customers",
        dashboardHref: "/office/customers",
        pathPrefixes: ["/office/customers"],
        createActions: [
            { label: "Person +", subtitle: "Create a new person", icon: Users, variant: "default", action: "new-person", permission: "customers:create" },
            { label: "Companies +", subtitle: "Create a new company", icon: Building2, variant: "outline", action: "new-company", permission: "customers:create" },
        ],
        children: [
            // { label: "All Contacts", href: "/office/customers", icon: Users, permission: "customers:view" },
            { label: "Person", href: "/office/customers/person", icon: Users },
            { label: "Companies", href: "/office/customers/companies", icon: Building2 },
        ],
    },
    // Repair & Warranty
    {
        label: "Repair & Warranty",
        icon: Wrench,
        key: "repair",
        dashboardHref: "/office/repairing",
        // pathPrefixes: ["/office/repairing/tickets", "/office/repairing/service-centers", "/office/repairing/dashboard"],
        pathPrefixes: ["/office/repairing"],
        createActions: [
            { label: "Repair +", subtitle: "Open repair intake", icon: Wrench, variant: "default", action: "new-ticket", pipelineRef: "default" },
        ],
        children: [
            { label: "All Repair", icon: ClipboardList, href: "/office/repairing/tickets", pipelineRef: "default" },
            { label: "Service Centers", icon: Building2, href: "/office/repairing/service-centers" },
        ],
    },


    // Accountancy
    {
        label: "Accountancy",
        icon: Calculator,
        key: "accountancy",
        permission: "accountancy:view",
        dashboardHref: "/office/accountancy",

        pathPrefixes: ["/office/accountancy"],
        createActions: [
            { label: "POS", subtitle: "Open POS register", icon: Monitor, variant: "default", href: "/vouchers/pos/new", newTab: true, permission: "pos:shift:open" },
            { label: "Sale +", subtitle: "New Sale Invoice", icon: Receipt, variant: "default", action: "new-sale" },
            { label: "Purchase +", subtitle: "New Purchase Invoice", icon: ShoppingCart, variant: "outline", action: "new-purchase" },
            { label: "Sale Return +", subtitle: "Customer returns goods (Credit Note)", icon: Receipt, variant: "outline", action: "new-sale-return" },
            { label: "Purchase Return +", subtitle: "Return goods to supplier (Debit Note)", icon: ShoppingCart, variant: "outline", action: "new-purchase-return" },
            { label: "Estimate +", subtitle: "New estimate", icon: ScrollText, variant: "outline", action: "new-estimate" },
            { label: "Payment +", subtitle: "New payment voucher", icon: Wallet, variant: "outline", action: "new-payment", permission: "finance:voucher:create" },
            { label: "Receipt +", subtitle: "New receipt voucher", icon: Wallet, variant: "outline", action: "new-receipt", permission: "finance:voucher:create" },
            { label: "Contra +", subtitle: "New contra voucher", icon: Wallet, variant: "outline", action: "new-contra", permission: "finance:voucher:create" },
            { label: "Credit Note +", subtitle: "New credit note", icon: FileText, variant: "outline", action: "new-credit-note", permission: "finance:voucher:create" },
            { label: "Debit Note +", subtitle: "New debit note", icon: FileText, variant: "outline", action: "new-debit-note", permission: "finance:voucher:create" },
            { label: "Journal +", subtitle: "New journal voucher", icon: FileText, variant: "outline", action: "new-journal-voucher", permission: "finance:voucher:create" },
            { label: "Sales Order +", subtitle: "New sales order", icon: ClipboardList, variant: "outline", action: "new-sales-order", permission: "inventory:manage" },
            { label: "Purchase Order +", subtitle: "New purchase order", icon: ClipboardList, variant: "outline", action: "new-purchase-order", permission: "inventory:manage" },
            { label: "GRN +", subtitle: "New goods receipt", icon: PackageCheck, variant: "outline", action: "new-grn", permission: "inventory:manage" },
            { label: "Challan +", subtitle: "New challan", icon: Truck, variant: "outline", action: "new-challan", permission: "inventory:manage" },
            { label: "Manufacturing Journal +", subtitle: "New manufacturing journal", icon: Factory, variant: "outline", action: "new-manufacturing-journal", permission: "inventory:manage" },
            { label: "Physical Stock +", subtitle: "New physical stock", icon: ClipboardCheck, variant: "outline", action: "new-physical-stock", permission: "inventory:manage" },
            { label: "Branch Transfer +", subtitle: "Move stock between locations", icon: ArrowLeftRight, variant: "outline", action: "new-branch-transfer", permission: "inventory:manage" },
            { label: "Rejection In +", subtitle: "New rejection in", icon: PackageX, variant: "outline", action: "new-rejection-in", permission: "inventory:manage" },
            { label: "Rejection Out +", subtitle: "New rejection out", icon: PackageX, variant: "outline", action: "new-rejection-out", permission: "inventory:manage" },


        ],
        children: [
            { label: "Daybook", icon: ClipboardList, href: "/office/accountancy/reports/day-book", permission: "finance:voucher:create" },
            // { label: "Orders n Estimates", icon: PackageCheck, href: "/office/accountancy/orders-estimates", permission: "finance:voucher:create" },
            { label: "Pending Inventory", icon: ClipboardList, href: "/office/accountancy/reports/pending-vouchers", permission: "finance:voucher:create" },
            { label: "Stock Summary", icon: BarChart3, href: "/office/inventory/stock-summary", permission: "inventory:manage" },
            { label: "Account Ledger", icon: BookOpen, href: "/office/accountancy/account-ledgers", permission: "finance:voucher:create" },
            { label: "Bank Book", icon: Banknote, href: "/office/accountancy/bank-ledgers", permission: "finance:voucher:create" },
            { label: "Cash Book", icon: Wallet, href: "/office/accountancy/cash-ledgers", permission: "finance:voucher:create" },
            { label: "Loans Book", icon: Banknote, href: "/office/accountancy/loan-ledgers", permission: "finance:voucher:create" },

            { label: "Balance Sheet", icon: FolderTree, href: "/office/accountancy/reports/balance-sheet" },
            { label: "Profit & Loss A/c", icon: BookOpen, href: "/office/accountancy/reports/profit-loss" },
            // GST Reports moved to the Compliance module (see below).

            // { label: "Estimates", icon: ScrollText, href: "/office/accountancy/estimates" },

            // { label: "Financial Insights", icon: ChartArea, href: "/office/accountancy/reports" },
            {
                label: "Financial Insights",
                icon: ChartArea,
                href: "/office/accountancy/reports",
                permission: "finance:voucher:create",
                children: [
                    // { label: "Balance Sheet", icon: FolderTree, href: "/office/accountancy/reports/balance-sheet" },
                    // { label: "Profit & Loss A/c", icon: BookOpen, href: "/office/accountancy/reports/profit-loss" },
                    { label: "Trial Balance", icon: Wallet, href: "/office/accountancy/reports/trial-balance" },
                    // { label: "Day Book", icon: ClipboardList, href: "/office/accountancy/reports/day-book" },
                    // { label: "Cash Book", icon: Wallet, href: "/office/accountancy/reports/cash-book" },
                    // { label: "Bank Book", icon: Wallet, href: "/office/accountancy/reports/bank-book" },
                    { label: "Receivables", icon: Wallet, href: "/office/accountancy/reports/receivables" },
                    { label: "Payables", icon: Wallet, href: "/office/accountancy/reports/payables" },
                    { label: "Cash Flow", icon: ClipboardList, href: "/office/accountancy/reports/cash-flow" },
                    { label: "Fund Flow", icon: ClipboardList, href: "/office/accountancy/reports/fund-flow" },
                    { label: "Ratio Analysis", icon: ClipboardList, href: "/office/accountancy/reports/ratio-analysis" },
                    { label: "Statistics", icon: ClipboardList, href: "/office/accountancy/reports/statistics" },
                    { label: "Bank Reconciliation", icon: Wallet, href: "/office/accountancy/reports/bank-reconciliation" },

                ]
            },

            {
                label: "Vouchers Register", icon: ClipboardList, href: "/office/accountancy/vouchers-registers/all", permission: "finance:voucher:create",

            },

            { label: "Recycle Bin", icon: Trash2, href: "/office/accountancy/recycle-bin", permission: "finance:voucher:hard-delete" },

            {
                label: "Masters",
                icon: ChartArea,
                href: "/office/accountancy/masters",
                permission: "finance:voucher:create",
                children: [
                    { label: "Account Groups", icon: FolderTree, href: "/office/accountancy/masters/groups" },
                    { label: "Ledgers", icon: BookOpen, href: "/office/accountancy/masters/ledgers" },
                    { label: "Chart of accounts", icon: Wallet, href: "/office/accountancy/masters/chart-of-accounts" },
                    { label: "Opening Balance", icon: Wallet, href: "/office/accountancy/masters/opening-balance", permission: "finance:opening-balance:manage" },
                ]
            },


        ],
    },

    // Inventory
    {
        label: "Inventory",
        icon: Box,
        key: "inventory",
        dashboardHref: "/office/inventory",
        pathPrefixes: [
            "/office/inventory",

        ],
        createActions: [
            { label: "POS", subtitle: "Open POS register", icon: Monitor, variant: "default", href: "/vouchers/pos/new", newTab: true, permission: "pos:shift:open" },
            { label: "Sale +", subtitle: "New Sale Invoice", icon: Receipt, variant: "default", action: "new-sale" },
            { label: "Purchase +", subtitle: "New Purchase Invoice", icon: ShoppingCart, variant: "outline", action: "new-purchase" },
            { label: "Sale Return +", subtitle: "Customer returns goods (Credit Note)", icon: Receipt, variant: "outline", action: "new-sale-return" },
            { label: "Purchase Return +", subtitle: "Return goods to supplier (Debit Note)", icon: ShoppingCart, variant: "outline", action: "new-purchase-return" },
            { label: "Estimate +", subtitle: "New estimate", icon: ScrollText, variant: "outline", action: "new-estimate" },
            { label: "Payment +", subtitle: "New payment voucher", icon: Wallet, variant: "outline", action: "new-payment", permission: "finance:voucher:create" },
            { label: "Receipt +", subtitle: "New receipt voucher", icon: Wallet, variant: "outline", action: "new-receipt", permission: "finance:voucher:create" },
            { label: "Contra +", subtitle: "New contra voucher", icon: Wallet, variant: "outline", action: "new-contra", permission: "finance:voucher:create" },
            { label: "Credit Note +", subtitle: "New credit note", icon: FileText, variant: "outline", action: "new-credit-note", permission: "finance:voucher:create" },
            { label: "Debit Note +", subtitle: "New debit note", icon: FileText, variant: "outline", action: "new-debit-note", permission: "finance:voucher:create" },
            { label: "Journal +", subtitle: "New journal voucher", icon: FileText, variant: "outline", action: "new-journal-voucher", permission: "finance:voucher:create" },
            { label: "Sales Order +", subtitle: "New sales order", icon: ClipboardList, variant: "default", action: "new-sales-order", permission: "inventory:manage" },
            { label: "Purchase Order +", subtitle: "New purchase order", icon: ClipboardList, variant: "outline", action: "new-purchase-order", permission: "inventory:manage" },
            { label: "GRN +", subtitle: "New goods receipt", icon: PackageCheck, variant: "outline", action: "new-grn", permission: "inventory:manage" },
            { label: "Challan +", subtitle: "New challan", icon: Truck, variant: "outline", action: "new-challan", permission: "inventory:manage" },
            { label: "Manufacturing Journal +", subtitle: "New manufacturing journal", icon: Factory, variant: "outline", action: "new-manufacturing-journal", permission: "inventory:manage" },
            { label: "Physical Stock +", subtitle: "New physical stock", icon: ClipboardCheck, variant: "outline", action: "new-physical-stock", permission: "inventory:manage" },
            { label: "Branch Transfer +", subtitle: "Move stock between locations", icon: ArrowLeftRight, variant: "outline", action: "new-branch-transfer", permission: "inventory:manage" },
            { label: "Rejection In +", subtitle: "New rejection in", icon: PackageX, variant: "outline", action: "new-rejection-in", permission: "inventory:manage" },
            { label: "Rejection Out +", subtitle: "New rejection out", icon: PackageX, variant: "outline", action: "new-rejection-out", permission: "inventory:manage" },


        ],
        children: [

            { label: "Products", icon: Box, href: "/office/inventory/products", permission: "inventory:manage" },
            // { label: "Stock Ledger", icon: BookOpen, href: "/office/inventory/stock-ledger", permission: "inventory:manage" },
            // { label: "Stock Summary", icon: BarChart3, href: "/office/inventory/stock-summary", permission: "inventory:manage" },
            { label: "Item Ledger", icon: ClipboardList, href: "/office/inventory/inventory-details", permission: "inventory:manage" },
            {
                label: "Masters",
                icon: ChartArea,
                href: "/office/inventory/masters",
                permission: "inventory:manage",
                children: [
                    { label: "Brands", icon: Tag, href: "/office/inventory/masters/brands", permission: "inventory:manage" },
                    { label: "Units", icon: Ruler, href: "/office/inventory/masters/units", permission: "inventory:manage" },
                    { label: "Categories", icon: Layers, href: "/office/inventory/masters/categories", permission: "inventory:manage" },
                    { label: "Groups", icon: LayoutGrid, href: "/office/inventory/masters/product-groups", permission: "inventory:manage" },
                    { label: "Warranty Terms", icon: ShieldCheck, href: "/office/inventory/masters/warranty-terms", permission: "inventory:manage" },
                    { label: "Attribute Masters", icon: ListChecks, href: "/office/inventory/masters/attribute-masters", permission: "inventory:manage" },
                    { label: "GST Rates", icon: Percent, href: "/office/inventory/masters/gst-rates", permission: "inventory:manage" },
                    { label: "BOMs", icon: Workflow, href: "/office/inventory/masters/boms", permission: "inventory:manage" },
                ]
            },


        ],
    },

    // CRM
    {
        label: "CRM",
        icon: Network,
        key: "crm",
        dashboardHref: "/office/crm/deals",
        pathPrefixes: ["/office/crm"],
        createActions: [
            { label: "New Deal +", subtitle: "Add a deal to the pipeline", icon: Network, variant: "default", href: "/office/crm/deals?new=1" },
        ],
        children: [
            { label: "Deals", icon: ClipboardList, href: "/office/crm/deals" },
            // Future under CRM: Contacts, Leads (lead-finding) — separate modules.
        ],
    },

    // Orders (O2C backbone — counter + online + office orders on one pipeline)
    {
        label: "Orders",
        icon: ListOrdered,
        key: "orders",
        permission: "accountancy:view",
        dashboardHref: "/office/orders",
        pathPrefixes: ["/office/orders"],
        children: [
            { label: "Orders board", icon: ListOrdered, href: "/office/orders", permission: "accountancy:view" },
            { label: "Delivery", icon: Truck, href: "/office/orders/delivery", permission: "accountancy:view" },
            { label: "Refunds", icon: Undo2, href: "/office/orders/refund", permission: "accountancy:view" },
        ],
    },



    // E-Commerce
    {
        label: "E-Commerce",
        icon: ShoppingCart,
        key: "e-commerce",
        dashboardHref: "/office/ecommerce",
        pathPrefixes: ["/office/ecommerce"],
        children: [
            // Dashboard is the module index (dashboardHref). Categories live in
            // Inventory → Masters; coupons live in Customer Retention.
            { label: "Orders", icon: ClipboardList, href: "/office/ecommerce/orders" },
            { label: "Products", icon: Box, href: "/office/ecommerce/products" },
        ],
    },


    // HRM
    // {
    //     label: "HRM",
    //     icon: UserCog,
    //     key: "hrm",
    //     dashboardHref: "/office/roadmap/hrm",
    //     pathPrefixes: ["/office/roadmap/hrm"],
    //     children: [
    //         // { label: "Overview", icon: ChartArea, href: "/office/roadmap/hrm" },
    //         { label: "Staff directory", icon: Users, href: "/office/roadmap/hrm/directory" },
    //         { label: "Attendance", icon: Clock, href: "/office/roadmap/hrm/attendance" },
    //         { label: "Leave", icon: Calendar, href: "/office/roadmap/hrm/leave" },
    //         { label: "Payroll", icon: Wallet, href: "/office/roadmap/hrm/payroll" },
    //     ],
    // },

    // Delivery
    // {
    //     label: "Delivery",
    //     icon: Truck,
    //     key: "delivery",
    //     dashboardHref: "/office/roadmap/delivery",
    //     pathPrefixes: ["/office/roadmap/delivery"],
    //     children: [
    //         // { label: "Overview", icon: ChartArea, href: "/office/roadmap/delivery" },
    //         { label: "Shipments", icon: Package, href: "/office/roadmap/delivery/shipments" },
    //         { label: "Couriers", icon: Building2, href: "/office/roadmap/delivery/couriers" },
    //         { label: "Proof of delivery", icon: FileText, href: "/office/roadmap/delivery/pod" },
    //     ],
    // },

    // Field Service
    // {
    //     label: "Field Service",
    //     icon: MapPin,
    //     key: "field-service",
    //     dashboardHref: "/office/roadmap/field-service",
    //     pathPrefixes: ["/office/roadmap/field-service"],
    //     children: [
    //         // { label: "Overview", icon: ChartArea, href: "/office/roadmap/field-service" },
    //         { label: "Jobs", icon: Wrench, href: "/office/roadmap/field-service/jobs" },
    //         { label: "Schedule", icon: Calendar, href: "/office/roadmap/field-service/schedule" },
    //         { label: "Van stock", icon: Box, href: "/office/roadmap/field-service/van-stock" },
    //     ],
    // },

    // HelpDesk
    // {
    //     label: "HelpDesk",
    //     icon: HelpCircle,
    //     key: "helpdesk",
    //     dashboardHref: "/office/roadmap/helpdesk",
    //     pathPrefixes: ["/office/roadmap/helpdesk"],
    //     children: [
    //         // { label: "Overview", icon: ChartArea, href: "/office/roadmap/helpdesk" },
    //         { label: "Queues", icon: Inbox, href: "/office/roadmap/helpdesk/queues" },
    //         { label: "Knowledge base", icon: BookOpen, href: "/office/roadmap/helpdesk/knowledge" },
    //         { label: "SLAs", icon: Timer, href: "/office/roadmap/helpdesk/slas" },
    //     ],
    // },

    // Projects
    // {
    //     label: "Projects",
    //     icon: Briefcase,
    //     key: "projects",
    //     dashboardHref: "/office/roadmap/projects",
    //     pathPrefixes: ["/office/roadmap/projects"],
    //     children: [
    //         // { label: "Overview", icon: ChartArea, href: "/office/roadmap/projects" },
    //         { label: "Active", icon: PlayCircle, href: "/office/roadmap/projects/active" },
    //         { label: "Tasks", icon: FolderKanban, href: "/office/roadmap/projects/tasks" },
    //         { label: "Time log", icon: ClipboardList, href: "/office/roadmap/projects/time" },
    //     ],
    // },

    // Intelligence
    // {
    //     label: "Intelligence",
    //     icon: ChartArea,
    //     key: "intelligence",
    //     dashboardHref: "/office/roadmap/intelligence",
    //     pathPrefixes: ["/office/roadmap/intelligence"],
    //     children: [
    //         // { label: "Overview", icon: LayoutDashboard, href: "/office/roadmap/intelligence" },
    //         { label: "Dashboards", icon: BarChart2, href: "/office/roadmap/intelligence/dashboards" },
    //         { label: "Ticket insights", icon: ClipboardList, href: "/office/roadmap/intelligence/tickets" },
    //         { label: "Exports", icon: Download, href: "/office/roadmap/intelligence/exports" },
    //     ],
    // },

    // Administration
    {
        label: "Administration",
        icon: Settings,
        key: "administration",
        dashboardHref: "/office/administration",
        pathPrefixes: ["/office/administration"],
        createActions: [
            { label: "New Task +", subtitle: "Add an internal work item", icon: ListChecks, variant: "default", href: "/office/administration?new=1" },
        ],
        children: [
            { label: "Work Board", icon: ListChecks, href: "/office/administration" },
            // Roadmap placeholders — not yet built:

        ],
    },

    // Retention
    {
        label: "Retention",
        icon: TicketPercent,
        key: "retention",
        dashboardHref: "/office/customer-retention",
        pathPrefixes: ["/office/roadmap/retention", "/office/customer-retention"],
        children: [
            // { label: "Overview", icon: ChartArea, href: "/office/roadmap/retention" },
            { label: "Coupons", icon: Ticket, href: "/office/customer-retention/coupons", permission: "coupons:edit" },
            { label: "Gift Cards", icon: CreditCard, href: "/office/customer-retention/gift-cards", permission: "coupons:edit" },
            { label: "Loyalty", icon: Gift, href: "/office/customer-retention/loyalty", permission: "loyalty:edit" },
            { label: "Spend Tiers", icon: BadgePercent, href: "/office/customer-retention/customer-tiers", permission: "customers:edit" },
            // Campaigns page not built yet — was pointing at the non-existent /office/roadmap/retention/campaigns (404).
            // { label: "Campaigns", icon: Megaphone, href: "/office/roadmap/retention/campaigns" },
        ],
    },

    // Pricing Strategy
    {
        label: "Pricing Strategy",
        icon: Wallet,
        key: "pricing-strategy",
        dashboardHref: "/office/pricing-strategy/strategies",
        pathPrefixes: ["/office/pricing-strategy"],
        children: [
            // { label: "Overview", icon: ChartArea, href: "/office/pricing-strategy" },
            { label: "Strategies", icon: Calculator, href: "/office/pricing-strategy/strategies", permission: "inventory:manage" },
            // { label: "Items", icon: Boxes, href: "/office/pricing-strategy/items", permission: "inventory:manage" },
            { label: "Costing", icon: Truck, href: "/office/pricing-strategy/costing", permission: "inventory:manage" },
            { label: "Needs attention", icon: AlertTriangle, href: "/office/pricing-strategy/needs-attention", permission: "inventory:manage" },
            { label: "Update & print labels", icon: Printer, href: "/office/pricing-strategy/update-print-labels", permission: "inventory:manage" },
        ],
    },
    // Compliance
    {
        label: "Compliance",
        icon: BadgePercent,
        key: "compliance",
        permission: "accountancy:view",
        dashboardHref: "/office/accountancy/reports/gst",
        pathPrefixes: ["/office/accountancy/reports/gst"],
        children: [
            { label: "Outward Supplies", icon: ArrowUpRight, href: "/office/accountancy/reports/gst/outward-supplies" },
            { label: "Inward Supplies", icon: ArrowDownRight, href: "/office/accountancy/reports/gst/inward-supplies" },
            { label: "Net GST Liability", icon: FileText, href: "/office/accountancy/reports/gst/liability" },
            { label: "HSN Summary", icon: Hash, href: "/office/accountancy/reports/gst/hsn-summary" },
            { label: "Tax Classification", icon: Tags, href: "/office/accountancy/reports/gst/classification" },
        ],
    },
];

export const ADMIN_NAV: SettingsNavItem[] = [
    { label: "Users", href: "/office/admin/users", icon: UserCog, permission: "users:edit" },
    { label: "Org Chart", href: "/office/admin/org-chart", icon: Network, permission: "users:edit" },
    { label: "Role", href: "/office/admin/role", icon: ShieldCheck, permission: "roles:edit" },
    { label: "Branches", href: "/office/admin/branches", icon: Building2, permission: "branches:edit" },
    { label: "Departments", href: "/office/admin/departments", icon: Users, permission: "departments:edit" },
    { label: "Positions", href: "/office/admin/positions", icon: Briefcase, permission: "positions:edit" },
    { label: "POS Counters", href: "/office/admin/counters", icon: Monitor, permission: "pos-counters:edit" },
];

export const SETTINGS_NAV: SettingsNavItem[] = [
    { label: "Organisation", href: "/office/settings/organisation", icon: Building2, permission: "settings:manage" },
    { label: "Org Defaults", href: "/office/settings/org-defaults", icon: Settings, permission: "settings:manage" },
    { label: "E-Commerce", href: "/office/settings/ecommerce", icon: ShoppingCart, permission: "settings:manage" },
    { label: "Payment Methods", href: "/office/settings/payment-methods", icon: CreditCard, permission: "settings:manage" },
    { label: "Workflow", href: "/office/settings/workflow", icon: Workflow, permission: "settings:manage" },
    { label: "Naming Convention", icon: ClipboardList, href: "/office/settings/naming-convention", permission: "inventory:manage" },
    { label: "Year Ending", href: "/office/settings/year-ending", icon: Calendar, permission: "settings:manage" },
    { label: "Thermal Printer", href: "/office/settings/printer-settings", icon: Printer, permission: "settings:manage" },
    { label: "QR Display", href: "/office/settings/qr-display-settings", icon: QrCode, permission: "settings:manage" },
    { label: "Voucher Templates", href: "/office/settings/voucher-templates", icon: FileText, permission: "settings:manage" },
    { label: "Voucher Preview", href: "/office/settings/voucher-templates/preview", icon: FileText, permission: "settings:manage" },
    { label: "Backup & Restore", href: "/office/settings/backup-restore", icon: Database, permission: "settings:manage" },
    { label: "Downloads", href: "/office/settings/downloads", icon: Download, permission: "settings:manage" },
    { label: "Item Import", href: "/office/settings/item-import", icon: Upload, permission: "inventory:manage" },
    { label: "Customer Import", href: "/office/settings/customer-import", icon: Upload, permission: "customers:edit" },
    { label: "Customer Tools", href: "/office/settings/customer-tools", icon: Users, permission: "customers:edit" },
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
    CANCELLED: "bg-muted text-muted-foreground",
    DELETED: "bg-rose-100 text-rose-700 line-through",
};

// GL section types — derived from the parent AccountGroup's `type` (Tally GroupType).
// US-style EQUITY rolls up under LIABILITY (Capital Account group); REVENUE → INCOME.
export type GlAccountType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";

export const GL_TYPE_ORDER: GlAccountType[] = ["ASSET", "LIABILITY", "INCOME", "EXPENSE"];

export const GL_TYPE_COLORS: Record<GlAccountType, string> = {
    ASSET: "bg-blue-100 text-blue-700",
    LIABILITY: "bg-orange-100 text-orange-700",
    INCOME: "bg-green-100 text-green-700",
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

// ─── Per-kind voucher create gating for the button bar / create menu ───────────
// Each create action maps to a voucher kind; the kind's per-kind CREATE permission
// (from voucherMatrix.ts — the single source) decides whether the "+" shows for a
// position. This drives the Quick Actions bar so a position sees only the vouchers
// it may create. Non-voucher actions (new-ticket / new-person / new-company) fall
// back to the action's own `permission` field.
const ACTION_TO_VOUCHER_TYPE: Record<string, string> = {
    "new-payment": "PAYMENT", "new-receipt": "RECEIPT", "new-contra": "CONTRA",
    "new-credit-note": "CREDIT_NOTE", "new-debit-note": "DEBIT_NOTE", "new-journal-voucher": "JOURNAL",
    "new-sale": "SALE", "new-purchase": "PURCHASE",
    "new-sale-return": "SALE_RETURN", "new-purchase-return": "PURCHASE_RETURN",
    "new-grn": "GRN", "new-challan": "CHALLAN",
    "new-physical-stock": "PHYSICAL_STOCK", "new-branch-transfer": "BRANCH_TRANSFER",
    "new-manufacturing-journal": "MANUFACTURING_JOURNAL",
    "new-rejection-in": "REJECTION_IN", "new-rejection-out": "REJECTION_OUT",
    "new-estimate": "ESTIMATE", "new-sales-order": "SALES_ORDER", "new-purchase-order": "PURCHASE_ORDER",
};

const CREATE_PERM_BY_TYPE = new Map(VOUCHER_MATRIX.map((r) => [r.type as string, r.perms.create]));

/** action discriminator → its per-kind voucher CREATE permission (undefined = not a voucher). */
export const VOUCHER_CREATE_PERMISSION_BY_ACTION: Record<string, string> = Object.fromEntries(
    Object.entries(ACTION_TO_VOUCHER_TYPE)
        .map(([action, type]) => [action, CREATE_PERM_BY_TYPE.get(type)])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
);

export const BUTTON_BAR_ACTIONS: ButtonBarAction[] = [
    {
        label: "Repair +", subtitle: "Open repair intake", icon: Wrench, variant: "default",
        action: "new-ticket",
        pipelineRef: "default",
    },


    // { label: "POS", subtitle: "Open POS register", icon: Monitor, variant: "default", href: "/vouchers/pos/new", newTab: true, permission: "pos:shift:open" },
    //"/vouchers/pos/orders"
    //"/vouchers/pos/estimates"
    { label: "Sale +", subtitle: "New Sale Invoice", icon: Receipt, variant: "default", action: "new-sale" },
    { label: "Purchase +", subtitle: "New Purchase Invoice", icon: ShoppingCart, variant: "outline", action: "new-purchase" },
    { label: "Sale Return +", subtitle: "Customer returns goods (Credit Note)", icon: Receipt, variant: "outline", action: "new-sale-return" },
    { label: "Purchase Return +", subtitle: "Return goods to supplier (Debit Note)", icon: ShoppingCart, variant: "outline", action: "new-purchase-return" },
    { label: "Estimate +", subtitle: "New estimate", icon: ScrollText, variant: "outline", action: "new-estimate" },
    { label: "Payment +", subtitle: "New payment voucher", icon: Wallet, variant: "outline", action: "new-payment", permission: "finance:voucher:create" },
    { label: "Receipt +", subtitle: "New receipt voucher", icon: Wallet, variant: "outline", action: "new-receipt", permission: "finance:voucher:create" },
    { label: "Contra +", subtitle: "New contra voucher", icon: Wallet, variant: "outline", action: "new-contra", permission: "finance:voucher:create" },
    { label: "Credit Note +", subtitle: "New credit note", icon: FileText, variant: "outline", action: "new-credit-note", permission: "finance:voucher:create" },
    { label: "Debit Note +", subtitle: "New debit note", icon: FileText, variant: "outline", action: "new-debit-note", permission: "finance:voucher:create" },
    { label: "Journal +", subtitle: "New journal voucher", icon: FileText, variant: "outline", action: "new-journal-voucher", permission: "finance:voucher:create" },
    { label: "Sales Order +", subtitle: "New sales order", icon: ClipboardList, variant: "outline", action: "new-sales-order", permission: "inventory:manage" },
    { label: "Purchase Order +", subtitle: "New purchase order", icon: ClipboardList, variant: "outline", action: "new-purchase-order", permission: "inventory:manage" },
    { label: "GRN +", subtitle: "New goods receipt", icon: PackageCheck, variant: "outline", action: "new-grn", permission: "inventory:manage" },
    { label: "Challan +", subtitle: "New challan", icon: Truck, variant: "outline", action: "new-challan", permission: "inventory:manage" },
    { label: "Manufacturing Journal +", subtitle: "New manufacturing journal", icon: Factory, variant: "outline", action: "new-manufacturing-journal", permission: "inventory:manage" },
    { label: "Physical Stock +", subtitle: "New physical stock", icon: ClipboardCheck, variant: "outline", action: "new-physical-stock", permission: "inventory:manage" },
    { label: "Branch Transfer +", subtitle: "Move stock between locations", icon: ArrowLeftRight, variant: "outline", action: "new-branch-transfer", permission: "inventory:manage" },
    { label: "Rejection In +", subtitle: "New rejection in", icon: PackageX, variant: "outline", action: "new-rejection-in", permission: "inventory:manage" },
    { label: "Rejection Out +", subtitle: "New rejection out", icon: PackageX, variant: "outline", action: "new-rejection-out", permission: "inventory:manage" },


];
