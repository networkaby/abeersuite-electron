/**
 * The office sidebar — every link, in order, with its icon and gate.
 *
 * Edit these lists to add / remove / reorder links. Workspace sits on top, the
 * module sections under it, then the two "Admin Only" groups (Admin, Settings).
 * `sidebarModules.ts` derives the `ui:sidebar:*` permission ids from them, so
 * the Department picker and the Role page never drift from what is shown here.
 *
 * The Quick Actions bar and the POS rail are in `quickActions.ts`.
 */
import type { LucideIcon } from "lucide-react";
import {
    Activity,
    ArrowDownUp,
    Globe,
    WalletCards,
    AlertTriangle,
    ArrowDownLeft,
    ArrowDownRight,
    ArrowDownToLine,
    ArrowLeftRight,
    ArrowRightLeft,
    ArrowUpDown,
    ArrowUpFromLine,
    ArrowUpRight,
    BadgeCheck,
    BadgeIndianRupee,
    BadgePercent,
    Banknote,
    BarChart3,
    Barcode,
    Bike,
    Blocks,
    BookOpen,
    Box,
    Briefcase,
    Building,
    Building2,
    Calculator,
    Calendar,
    CalendarCheck,
    CalendarClock,
    CalendarDays,
    CalendarOff,
    CalendarRange,
    ChartArea,
    ChartBarStacked,
    ChartColumn,
    ChartLine,
    ChartPie,
    CircleArrowUp,
    CircleDollarSign,
    ClipboardCheck,
    Clock,
    Coins,
    ConciergeBell,
    Contact,
    CreditCard,
    Crown,
    Database,
    Divide,
    Download,
    Factory,
    FileBadge2,
    FileCheck2,
    FileInput,
    FileMinus,
    FilePlus,
    Files,
    FileStack,
    FileUp,
    FolderTree,
    Gauge,
    Gift,
    GitCompare,
    Goal,
    Grid2x2,
    Group,
    Hammer,
    Handshake,
    Hash,
    HeartPulse,
    Hourglass,
    IdCard,
    Inbox,
    Kanban,
    Landmark,
    Layers,
    LayoutGrid,
    LayoutTemplate,
    Library,
    LifeBuoy,
    ListTree,
    MapPin,
    Milestone,
    MonitorCog,
    MonitorSmartphone,
    Network,
    NotebookPen,
    PackageCheck,
    PackageOpen,
    PackageSearch,
    PackageX,
    Palmtree,
    Percent,
    PhoneCall,
    PiggyBank,
    Printer,
    QrCode,
    Receipt,
    ReceiptIndianRupee,
    ReceiptText,
    Repeat,
    RotateCcw,
    RotateCw,
    Ruler,
    Scale,
    ScanBarcode,
    ScanSearch,
    ScrollText,
    Settings,
    ShieldAlert,
    ShieldCheck,
    ShoppingBasket,
    ShoppingCart,
    Shuffle,
    Sigma,
    SlidersHorizontal,
    Snowflake,
    Sparkles,
    SpellCheck,
    Split,
    SquareCheckBig,
    Store,
    Tag,
    Tags,
    Target,
    Terminal,
    Ticket,
    TicketPercent,
    Trash2,
    TrendingDown,
    TrendingUp,
    Truck,
    Umbrella,
    Upload,
    UserCog,
    UserMinus,
    Users,
    UsersRound,
    Voicemail,
    Wallet,
    WalletMinimal,
    Wand2,
    Warehouse,
    Waves,
    WifiOff,
    Workflow,
    Wrench,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavItemBase = {
    label: string;
    icon: LucideIcon;
    /**
     * Stable slug for the sidebar-visibility permission id
     * (`ui:sidebar:<module>:<sidebarKey>`). Defaults to slug(label) when omitted —
     * set it when the display label may change but the granted permission id
     * must stay put. Read by sidebarModules.ts (makeChildren).
     */
    sidebarKey?: string;
    permission?: string | null;
};

export type NavLinkItem = NavItemBase & {
    href: string;
    action?: never;
    children?: NavLinkItem[];
};

/** Opens an office-wide dialog instead of navigating (Sidebar's Workspace block). */
export type NavActionItem = NavItemBase & {
    action: "sl-search";
    href?: never;
    children?: never;
};

export type NavItem = NavLinkItem | NavActionItem;

export type ModuleChild = {
    label: string;
    icon: LucideIcon;
    href?: string;
    /**
     * Stable slug for the sidebar-visibility permission id
     * (`ui:sidebar:<module>:<sidebarKey>`). Defaults to slug(label) when omitted —
     * set it when the display label may change but the granted permission id
     * must stay put. Read by sidebarModules.ts (makeChildren).
     */
    sidebarKey?: string;
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
    /** Owning module key — drives the action's colour. See ButtonBarAction.module. */
    module?: string;
    variant?: "default" | "outline";
    href?: string;
    /** Open the href in a new browser tab. */
    newTab?: boolean;
    action?: "more" | "new-ticket" | "new-help-ticket" | "new-person" | "new-company" | "new-deal" | "new-task" | "new-journal-voucher" | "new-debit-note" | "new-contra" | "new-payment" | "new-receipt" | "new-credit-note" | "new-sale" | "new-purchase" | "new-sale-return" | "new-purchase-return" | "new-estimate" | "new-sales-order" | "new-purchase-order" | "new-grn" | "new-challan" | "new-manufacturing-journal" | "new-physical-stock" | "new-branch-transfer" | "new-rejection-in" | "new-rejection-out";
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
    /**
     * Stable slug for the sidebar-visibility permission id
     * (`ui:sidebar:<module>:<sidebarKey>`). Defaults to slug(label) when omitted.
     * Set this when the display label changes but the granted permission id must
     * stay put — e.g. "Voucher Templates" → "Print Templates" keeps `voucher-templates`
     * so existing grants (and the route) don't break.
     */
    sidebarKey?: string;
    /**
     * Only meaningful inside the installed desktop app (it drives the Electron
     * window itself). The sidebar hides the link in a web browser; the `ui:sidebar:*`
     * grant still decides who sees it in the app.
     */
    desktopOnly?: boolean;
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export const WORKSPACE_NAV: NavItem[] = [
    { label: "Inbox", href: "/office/message/inbox", icon: Inbox, permission: null },
    { label: "Work Flow", href: "/office/work-flow-inbox", icon: Workflow, permission: null },
    { label: "POS Register", sidebarKey: "pos", href: "/vouchers/pos", icon: Store, permission: "pos:shift:open" },
    // A dialog, not a page — a walk-in with no bill is answered from wherever the
    // staff member already is. See SlSearchDialog.
    { label: "SL Search", action: "sl-search", icon: ScanSearch, permission: null },
];

export const MODULE_SECTIONS: ModuleSection[] = [

    // POS (manager oversight — shift reports etc.). The operator's register lives
    // in Workspace → POS; this office module is for managers, so it is gated by the
    // shift-report VIEW permission, NOT the operator's `pos:shift:open`. It points at
    // the shift reports page, not the register.
    {
        label: "POS Shift",
        icon: CalendarClock,
        key: "pos",
        dashboardHref: "/office/pos/shifts",
        pathPrefixes: ["/office/pos"],
        children: [
            { label: "Shift Reports", href: "/office/pos/shifts", icon: Clock },
            { label: "Counters", href: "/office/pos/counters", icon: MonitorSmartphone },
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
            { label: "Repair +", subtitle: "Open repair intake", icon: Wrench, variant: "default", action: "new-ticket", pipelineRef: "default", permission: "tickets:create" },
        ],
        children: [
            { label: "All Repair", icon: Hammer, href: "/office/repairing/tickets", pipelineRef: "default" },
            { label: "Device Location", icon: MapPin, href: "/office/repairing/device-location" },
            // { label: "Service Centers", icon: Building2, href: "/office/repairing/service-centers" },

        ],
    },


    // Accountancy
    {
        label: "Accountancy",
        icon: Calculator,
        key: "accountancy",
        dashboardHref: "/office/accountancy",

        pathPrefixes: ["/office/accountancy"],
        createActions: [
            { label: "POS +", subtitle: "New POS bill", icon: ScanBarcode, variant: "default", href: "/vouchers/pos/new", newTab: true, permission: "pos:shift:open" },
            { label: "Sale +", subtitle: "New Sale Invoice", icon: Receipt, variant: "default", action: "new-sale" },
            { label: "Purchase +", subtitle: "New Purchase Invoice", icon: ShoppingCart, variant: "outline", action: "new-purchase" },
            { label: "Sale Return +", subtitle: "Customer returns goods (Credit Note)", icon: RotateCcw, variant: "outline", action: "new-sale-return" },
            { label: "Purchase Return +", subtitle: "Return goods to supplier (Debit Note)", icon: RotateCw, variant: "outline", action: "new-purchase-return" },
            { label: "Estimate +", subtitle: "New estimate", icon: ScrollText, variant: "outline", action: "new-estimate" },
            { label: "Payment +", subtitle: "New payment voucher", icon: ArrowUpFromLine, variant: "outline", action: "new-payment", permission: "finance:voucher:create" },
            { label: "Receipt +", subtitle: "New receipt voucher", icon: ArrowDownToLine, variant: "outline", action: "new-receipt", permission: "finance:voucher:create" },
            { label: "Contra +", subtitle: "New contra voucher", icon: ArrowRightLeft, variant: "outline", action: "new-contra", permission: "finance:voucher:create" },
            { label: "Credit Note +", subtitle: "New credit note", icon: FileMinus, variant: "outline", action: "new-credit-note", permission: "finance:voucher:create" },
            { label: "Debit Note +", subtitle: "New debit note", icon: FilePlus, variant: "outline", action: "new-debit-note", permission: "finance:voucher:create" },
            { label: "Journal +", subtitle: "New journal voucher", icon: NotebookPen, variant: "outline", action: "new-journal-voucher", permission: "finance:voucher:create" },
            { label: "Sales Order +", subtitle: "New sales order", icon: FileCheck2, variant: "outline", action: "new-sales-order" },
            { label: "Purchase Order +", subtitle: "New purchase order", icon: FileInput, variant: "outline", action: "new-purchase-order" },
            { label: "GRN +", subtitle: "New goods receipt", icon: PackageCheck, variant: "outline", action: "new-grn" },
            { label: "Challan +", subtitle: "New challan", icon: Truck, variant: "outline", action: "new-challan" },
            { label: "Manufacturing Journal +", subtitle: "New manufacturing journal", icon: Factory, variant: "outline", action: "new-manufacturing-journal" },
            { label: "Physical Stock +", subtitle: "New physical stock", icon: ClipboardCheck, variant: "outline", action: "new-physical-stock" },
            { label: "Branch Transfer +", subtitle: "Move stock between locations", icon: ArrowLeftRight, variant: "outline", action: "new-branch-transfer" },
            { label: "Rejection In +", subtitle: "New rejection in", icon: PackageX, variant: "outline", action: "new-rejection-in" },
            { label: "Rejection Out +", subtitle: "New rejection out", icon: PackageX, variant: "outline", action: "new-rejection-out" },


        ],
        children: [
            { label: "Daybook", icon: CalendarDays, href: "/office/accountancy/reports/day-book", permission: "finance:voucher:create" },
            // { label: "Orders n Estimates", icon: PackageCheck, href: "/office/accountancy/orders-estimates", permission: "finance:voucher:create" },
            { label: "Pending Inventory", icon: Hourglass, href: "/office/accountancy/reports/pending-vouchers", permission: "finance:voucher:create" },
            { label: "Stock Summary", icon: BarChart3, href: "/office/inventory/stock-summary" },
            { label: "Account Ledger", icon: BookOpen, href: "/office/accountancy/account-ledgers", permission: "finance:voucher:create" },
            { label: "Bank Book", icon: Banknote, href: "/office/accountancy/bank-ledgers", permission: "finance:voucher:create" },
            { label: "Cash Book", icon: Coins, href: "/office/accountancy/cash-ledgers", permission: "finance:voucher:create" },
            { label: "Loans Book", icon: Banknote, href: "/office/accountancy/loan-ledgers", permission: "finance:voucher:create" },
            // Same shape as Account Ledger / Cash Book above; `sidebarKey` only pins the
            // Role Matrix id (ui:sidebar:accountancy:group-report) against a label rename.
            { label: "Group Report", icon: ChartBarStacked, href: "/office/accountancy/group-report", sidebarKey: "group-report", permission: "finance:voucher:create" },
            // Spending capacity = cash + bank + wallets, plus unused OD / card / BNPL
            // headroom. UI-only design preview for now (mock numbers, nothing wired).
            { label: "Usable Fund", icon: PiggyBank, href: "/office/accountancy/usable-fund", sidebarKey: "usable-fund" },

            { label: "Balance Sheet", icon: Library, href: "/office/accountancy/reports/balance-sheet" },
            { label: "Profit & Loss A/c", icon: ChartColumn, href: "/office/accountancy/reports/profit-loss" },
            // GST Reports moved to the Compliance module (see below).

            // { label: "Estimates", icon: ScrollText, href: "/office/accountancy/estimates" },

            // { label: "Financial Insights", icon: ChartArea, href: "/office/accountancy/reports" },
            {
                label: "Financial Insights",
                icon: ChartArea,
                href: "/office/accountancy/reports",
                permission: "finance:voucher:create",
                children: [

                    { label: "Trial Balance", icon: Scale, href: "/office/accountancy/reports/trial-balance" },
                    { label: "Receivables", icon: ArrowDownLeft, href: "/office/accountancy/reports/receivables" },
                    { label: "Payables", icon: CircleArrowUp, href: "/office/accountancy/reports/payables" },
                    { label: "Cash Flow", icon: Waves, href: "/office/accountancy/reports/cash-flow" },
                    { label: "Fund Flow", icon: Shuffle, href: "/office/accountancy/reports/fund-flow" },
                    { label: "Ratio Analysis", icon: Divide, href: "/office/accountancy/reports/ratio-analysis" },
                    { label: "Statistics", icon: Sigma, href: "/office/accountancy/reports/statistics" },
                    { label: "Bank Reconciliation", icon: Landmark, href: "/office/accountancy/reports/bank-reconciliation" },

                ]
            },

            {
                label: "Vouchers Register", icon: Files, href: "/office/accountancy/vouchers-registers/all", permission: "finance:voucher:create",

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
                    { label: "Chart of accounts", icon: ListTree, href: "/office/accountancy/masters/chart-of-accounts" },
                    { label: "Opening Balance", icon: Milestone, href: "/office/accountancy/masters/opening-balance", permission: "finance:opening-balance:manage" },
                ]
            },


        ],
    },

    // Business Intelligence (management decision reports — customer/item profit,
    // FSN, movement. Distinct from the accountant's operational reports under
    // Accountancy → Financial Insights.)
    {
        label: "Business Intelligence",
        icon: BarChart3,
        key: "bi",
        dashboardHref: "/office/bi",
        pathPrefixes: ["/office/bi"],
        children: [
            { label: "Customer Profit", icon: CircleDollarSign, href: "/office/bi/customer-profit" },
            { label: "Bill Profit", icon: ReceiptText, href: "/office/bi/bill-profit" },
            { label: "Top Customers", icon: Crown, href: "/office/bi/top-customers" },
            { label: "RFM Segmentation", icon: Target, href: "/office/bi/rfm" },
            { label: "Party Sale & Purchase", icon: Split, href: "/office/bi/party-sale-purchase" },
            { label: "GST Purchase Planning", icon: CalendarRange, href: "/office/bi/gst-purchase-planning", sidebarKey: "gst-purchase-planning" },
            { label: "Item Profit", icon: BadgeIndianRupee, href: "/office/bi/item-profit" },
            { label: "Item by Party", icon: Grid2x2, href: "/office/bi/item-by-party" },
            { label: "ABC Analysis", icon: ChartPie, href: "/office/bi/abc" },
            { label: "FSN & Dead Stock", icon: Snowflake, href: "/office/bi/fsn" },
            { label: "Stock Health", icon: HeartPulse, href: "/office/bi/stock-health" },
            { label: "Stock Turnover", icon: TrendingUp, href: "/office/bi/stock-turnover" },
            { label: "Movement Register", icon: ArrowDownUp, href: "/office/bi/movement-register" },
            { label: "Sales Trend", icon: ChartLine, href: "/office/bi/sales-trend" },
            { label: "Branch Comparison", icon: GitCompare, href: "/office/bi/branch-comparison" },
            { label: "Discount Impact", icon: TicketPercent, href: "/office/bi/discount-impact" },
            { label: "Basket Analysis", icon: ShoppingBasket, href: "/office/bi/basket" },
            { label: "Supplier Purchases", icon: Warehouse, href: "/office/bi/supplier-purchases" },
            { label: "Price Variance", icon: ArrowUpDown, href: "/office/bi/purchase-price-variance" },
            { label: "Inactive Customers", icon: UserMinus, href: "/office/bi/inactive-customers" },
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
            { label: "POS +", subtitle: "New POS bill", icon: ScanBarcode, variant: "default", href: "/vouchers/pos/new", newTab: true, permission: "pos:shift:open" },
            { label: "Sale +", subtitle: "New Sale Invoice", icon: Receipt, variant: "default", action: "new-sale" },
            { label: "Purchase +", subtitle: "New Purchase Invoice", icon: ShoppingCart, variant: "outline", action: "new-purchase" },
            { label: "Sale Return +", subtitle: "Customer returns goods (Credit Note)", icon: RotateCcw, variant: "outline", action: "new-sale-return" },
            { label: "Purchase Return +", subtitle: "Return goods to supplier (Debit Note)", icon: RotateCw, variant: "outline", action: "new-purchase-return" },
            { label: "Estimate +", subtitle: "New estimate", icon: ScrollText, variant: "outline", action: "new-estimate" },
            { label: "Payment +", subtitle: "New payment voucher", icon: ArrowUpFromLine, variant: "outline", action: "new-payment", permission: "finance:voucher:create" },
            { label: "Receipt +", subtitle: "New receipt voucher", icon: ArrowDownToLine, variant: "outline", action: "new-receipt", permission: "finance:voucher:create" },
            { label: "Contra +", subtitle: "New contra voucher", icon: ArrowRightLeft, variant: "outline", action: "new-contra", permission: "finance:voucher:create" },
            { label: "Credit Note +", subtitle: "New credit note", icon: FileMinus, variant: "outline", action: "new-credit-note", permission: "finance:voucher:create" },
            { label: "Debit Note +", subtitle: "New debit note", icon: FilePlus, variant: "outline", action: "new-debit-note", permission: "finance:voucher:create" },
            { label: "Journal +", subtitle: "New journal voucher", icon: NotebookPen, variant: "outline", action: "new-journal-voucher", permission: "finance:voucher:create" },
            { label: "Sales Order +", subtitle: "New sales order", icon: FileCheck2, variant: "default", action: "new-sales-order" },
            { label: "Purchase Order +", subtitle: "New purchase order", icon: FileInput, variant: "outline", action: "new-purchase-order" },
            { label: "GRN +", subtitle: "New goods receipt", icon: PackageCheck, variant: "outline", action: "new-grn" },
            { label: "Challan +", subtitle: "New challan", icon: Truck, variant: "outline", action: "new-challan" },
            { label: "Manufacturing Journal +", subtitle: "New manufacturing journal", icon: Factory, variant: "outline", action: "new-manufacturing-journal" },
            { label: "Physical Stock +", subtitle: "New physical stock", icon: ClipboardCheck, variant: "outline", action: "new-physical-stock" },
            { label: "Branch Transfer +", subtitle: "Move stock between locations", icon: ArrowLeftRight, variant: "outline", action: "new-branch-transfer" },
            { label: "Rejection In +", subtitle: "New rejection in", icon: PackageX, variant: "outline", action: "new-rejection-in" },
            { label: "Rejection Out +", subtitle: "New rejection out", icon: PackageX, variant: "outline", action: "new-rejection-out" },


        ],
        children: [

            { label: "Products", icon: Box, href: "/office/inventory/products" },
            { label: "Item Ledger", icon: PackageSearch, href: "/office/inventory/inventory-details" },
            { label: "Reorder", icon: TrendingDown, href: "/office/inventory/reorder" },
            {
                label: "Masters",
                icon: ChartArea,
                href: "/office/inventory/masters",
                children: [
                    { label: "Brands", icon: Tag, href: "/office/inventory/masters/brands" },
                    { label: "Units", icon: Ruler, href: "/office/inventory/masters/units" },
                    { label: "Categories", icon: Layers, href: "/office/inventory/masters/categories" },
                    { label: "Groups", icon: LayoutGrid, href: "/office/inventory/masters/product-groups" },
                    { label: "Warranty Terms", icon: FileBadge2, href: "/office/inventory/masters/warranty-terms" },
                    { label: "Attribute Masters", icon: SlidersHorizontal, href: "/office/inventory/masters/attribute-masters" },
                    { label: "GST Rates", icon: Percent, href: "/office/inventory/masters/gst-rates" },
                    { label: "BOMs", icon: Blocks, href: "/office/inventory/masters/boms" },
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
            { label: "New Deal +", subtitle: "Add a deal to the pipeline", icon: Handshake, variant: "default", action: "new-deal", permission: "deals:create" },
        ],
        children: [
            { label: "Deals", icon: Handshake, href: "/office/crm/deals" },
            { label: "Reconnect", icon: PhoneCall, href: "/office/crm/reconnect" },
            { label: "Call Log", icon: Voicemail, href: "/office/crm/call-log" },

        ],
    },

    // Help Desk (front-desk enquiry / first-response tickets — counter + office)
    {
        label: "Help Desk",
        icon: LifeBuoy,
        key: "help",
        dashboardHref: "/office/help",
        pathPrefixes: ["/office/help"],
        createActions: [
            { label: "New Help +", subtitle: "Log a front-desk enquiry", icon: LifeBuoy, variant: "default", action: "new-help-ticket", permission: "help:create" },
        ],
        children: [
            { label: "Help Desk", icon: LifeBuoy, href: "/office/help" },
        ],
    },




    // E-Commerce
    {
        label: "E-Commerce",
        icon: ShoppingCart,
        key: "e-commerce",
        dashboardHref: "/office/ecommerce/orders",
        pathPrefixes: ["/office/ecommerce"],
        children: [
            // Dashboard is the module index (dashboardHref). Group/Category/Brand
            // MASTER DATA (name, hierarchy, GST) lives in Inventory → Masters;
            // this Masters link is the storefront-PRESENTATION editor (slug,
            // image, description) for those same rows — see the ecommerce
            // masters page's own doc comment. Coupons live in Customer Retention.
            { label: "Orders", icon: PackageOpen, href: "/office/ecommerce/orders" },
            { label: "Products", icon: Box, href: "/office/ecommerce/products" },
            { label: "Masters", icon: LayoutGrid, href: "/office/ecommerce/masters" },
            { label: "Customize Home", icon: LayoutTemplate, href: "/office/ecommerce/home" },
        ],
    },


    // HR & People — the staff record. Staff = User + an HR profile (no separate
    // employee table); attendance, leave and payroll join this section in later
    // releases. `sidebarKey` pins the permission id (ui:sidebar:hr:staff) so a
    // relabel never drops a grant.
    {
        label: "HR & People",
        icon: IdCard,
        key: "hr",
        // "/office/hr" rather than a fixed page: HR is ticked page by page, so the
        // landing route picks the first page this person actually holds.
        dashboardHref: "/office/hr",
        pathPrefixes: ["/office/hr"],
        children: [
            // No "My Portal" link: the name and photo at the top of the sidebar open
            // /office/me for everyone, so a second door here only repeated it.
            { label: "Staff Directory", icon: Contact, href: "/office/hr/staff", sidebarKey: "staff" },
            { label: "Attendance", icon: CalendarCheck, href: "/office/hr/attendance", sidebarKey: "attendance" },
            // The register says what the month came to; this one says why — a
            // person at a time, day by day, down to the stretches they were active.
            { label: "Employee Activity", icon: Activity, href: "/office/hr/activity", sidebarKey: "activity" },
            { label: "Leave", icon: Palmtree, href: "/office/hr/leave", sidebarKey: "leave" },
            { label: "Calendar & Hours", icon: CalendarOff, href: "/office/hr/holidays", sidebarKey: "holidays" },
            { label: "Pay Rules", icon: WalletCards, href: "/office/hr/pay-rules", sidebarKey: "payRules" },
            { label: "Targets & Commission", icon: Goal, href: "/office/hr/commission", sidebarKey: "commission" },
            { label: "Payroll", icon: WalletMinimal, href: "/office/hr/payroll", sidebarKey: "payroll" },
        ],
    },

    // Delivery
    // {
    //     label: "Delivery",
    //     icon: Truck,
    //     key: "delivery",
    //     dashboardHref: "",
    //     pathPrefixes: [""],
    //     children: [
    //         // Live: the Delivery board (P8) is under Ecommerce → Orders (order
    //         // detail delivery panel); courier config (Shiprocket / Custom / Local
    //         // boy) is under Settings → Couriers (/office/settings/couriers).
    //         // Still roadmap:
    //         // { label: "Proof of delivery", icon: FileText, href: "/office/roadmap/delivery/pod" },
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



    // Administration
    {
        label: "Administration",
        icon: Settings,
        key: "administration",
        dashboardHref: "/office/administration",
        pathPrefixes: ["/office/administration"],
        createActions: [
            { label: "New Task +", subtitle: "Add an internal work item", icon: SquareCheckBig, variant: "default", action: "new-task", permission: "tasks:create" },
        ],
        children: [
            { label: "Work Board", icon: Kanban, href: "/office/administration" },
            // sidebarKey pinned so renaming the label can never change the minted
            // permission id (ui:sidebar:administration:recurring-tasks) and drop grants.
            { label: "Recurring Tasks", sidebarKey: "recurring-tasks", icon: Repeat, href: "/office/administration/recurring" },
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
            { label: "Coupons", icon: Ticket, href: "/office/customer-retention/coupons", permission: "coupons:edit" },
            { label: "Gift Cards", icon: Gift, href: "/office/customer-retention/gift-cards", permission: "coupons:edit" },
            { label: "Loyalty", icon: Sparkles, href: "/office/customer-retention/loyalty", permission: "loyalty:edit" },
            { label: "Spend Tiers", icon: BadgePercent, href: "/office/customer-retention/customer-tiers", permission: "customers:edit" },
            { label: "Protection", icon: Umbrella, href: "/office/customer-retention/protection", permission: "retention:protection:manage" },


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
            { label: "Strategies", icon: Calculator, href: "/office/pricing-strategy/strategies" },
            { label: "Costing", icon: Gauge, href: "/office/pricing-strategy/costing" },
            { label: "Needs attention", icon: AlertTriangle, href: "/office/pricing-strategy/needs-attention" },
            { label: "Update prices", icon: FileStack, href: "/office/pricing-strategy/update-print-labels" },
            { label: "Print labels", icon: Barcode, href: "/office/pricing-strategy/print-labels" },
        ],
    },
    // Compliance
    {
        label: "Compliance",
        icon: BadgePercent,
        key: "compliance",
        dashboardHref: "/office/accountancy/reports/gst",
        pathPrefixes: ["/office/accountancy/reports/gst"],
        children: [
            { label: "Outward Supplies", icon: ArrowUpRight, href: "/office/accountancy/reports/gst/outward-supplies" },
            { label: "Inward Supplies", icon: ArrowDownRight, href: "/office/accountancy/reports/gst/inward-supplies" },
            { label: "Net GST Liability", icon: ReceiptIndianRupee, href: "/office/accountancy/reports/gst/liability" },
            { label: "HSN Summary", icon: Hash, href: "/office/accountancy/reports/gst/hsn-summary" },
            { label: "Tax Classification", icon: Tags, href: "/office/accountancy/reports/gst/classification" },
        ],
    },
];

export const ADMIN_NAV: SettingsNavItem[] = [
    { label: "Users", href: "/office/admin/users", icon: UserCog, permission: "users:edit" },
    { label: "Org Chart", href: "/office/admin/org-chart", icon: Network, permission: "users:edit" },
    { label: "Role", href: "/office/admin/role", icon: ShieldCheck, permission: "roles:edit" },
    { label: "Branches", href: "/office/admin/branches", icon: Building, permission: "branches:edit" },
    { label: "Departments", href: "/office/admin/departments", icon: UsersRound, permission: "departments:edit" },
    { label: "Positions", href: "/office/admin/positions", icon: Briefcase, permission: "positions:edit" },
    { label: "POS Counters", href: "/office/admin/counters", icon: Terminal, permission: "pos-counters:edit" },
];

export const SETTINGS_NAV: SettingsNavItem[] = [
    { label: "Org Defaults", href: "/office/settings/org-defaults", icon: Settings, permission: "settings:manage" },
    { label: "E-Commerce", href: "/office/settings/ecommerce", icon: Globe, permission: "settings:manage" },
    { label: "Payment Methods", href: "/office/settings/payment-methods", icon: CreditCard, permission: "settings:manage" },
    { label: "Couriers", href: "/office/settings/couriers", icon: Bike, permission: "settings:manage" },
    { label: "Standard Courier", href: "/office/settings/standard-courier", icon: BadgeCheck, permission: "settings:manage" },
    { label: "Services", href: "/office/settings/pos-services", icon: ConciergeBell, permission: "settings:manage" },
    { label: "Credit Limit", href: "/office/settings/credit-limit", icon: ShieldAlert, permission: "settings:manage" },
    { label: "Workflow", href: "/office/settings/workflow", icon: Workflow, permission: "settings:manage" },
    { label: "Naming Convention", icon: SpellCheck, href: "/office/settings/naming-convention", permission: "inventory:masters:edit" },
    { label: "Year Ending", href: "/office/settings/year-ending", icon: Calendar, permission: "settings:manage" },
    { label: "Thermal Printer", href: "/office/settings/printer-settings", icon: Printer, permission: "settings:manage" },
    { label: "QR Display", href: "/office/settings/qr-display-settings", icon: QrCode, permission: "settings:manage" },
    { label: "Screen Size", href: "/office/settings/screen-size", icon: MonitorCog, permission: "settings:manage", desktopOnly: true },
    { label: "Print Templates", href: "/office/settings/voucher-templates", icon: Printer, permission: "settings:manage", sidebarKey: "voucher-templates" },
    // { label: "Print Preview", href: "/office/settings/voucher-templates/preview", icon: FileText, permission: "settings:manage", sidebarKey: "voucher-preview" },
    { label: "Backup & Restore", href: "/office/settings/backup-restore", icon: Database, permission: "settings:manage" },
    { label: "Downloads", href: "/office/settings/downloads", icon: Download, permission: "settings:manage" },
    { label: "Item Import", href: "/office/settings/item-import", icon: Upload, permission: "inventory:masters:edit" },
    { label: "Customer Import", href: "/office/settings/customer-import", icon: FileUp, permission: "customers:edit" },
    { label: "Customer Tools", href: "/office/settings/customer-tools", icon: Wand2, permission: "customers:edit" },
    { label: "Customer Groups", href: "/office/settings/customer-groups", icon: Group, permission: "customers:edit" },
    { label: "Offline Policies", href: "/office/settings/offline-policies", icon: WifiOff, permission: "settings:manage" },
];
