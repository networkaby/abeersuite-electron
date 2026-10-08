/**
 * Quick-create buttons — the Quick Actions bar across the top of the office, and
 * the narrow action rail on the right edge of the POS screen.
 *
 * Edit these lists to add / remove / reorder buttons. The sidebar itself is in
 * `nav.ts`.
 */
import type { LucideIcon } from "lucide-react";
import {
    ArrowDownToLine,
    ArrowLeftRight,
    ArrowRightLeft,
    ArrowUpFromLine,
    Building2,
    ClipboardCheck,
    Ellipsis,
    Factory,
    FileCheck2,
    FileInput,
    FileMinus,
    FilePlus,
    HandCoins,
    Handshake,
    HelpCircle,
    LifeBuoy,
    MessageCircleQuestion,
    MessageSquare,
    NotebookPen,
    PackageCheck,
    PackageX,
    Receipt,
    RotateCcw,
    RotateCw,
    ScanBarcode,
    ScanSearch,
    ScrollText,
    ShoppingCart,
    SquareCheckBig,
    TicketPlus,
    Truck,
    UserRoundPlus,
    Users,
    Wallet,
    Wrench,
} from "lucide-react";
import { VOUCHER_MATRIX } from "@/shared/lib/auth/voucherMatrix";
import type { ModuleCreateAction } from "./nav";

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
    /**
     * Owning module key (see MODULES). Drives the action's colour in the Quick
     * Actions bar, so "Sale +" wears the same hue in the bar as Accountancy
     * does in the sidebar — one concept, one colour, everywhere.
     */
    module?: string;
    /** When set, the action is hidden unless the user holds this permission (admin:bypass also passes). */
    permission?: string | null;
    disabled?: boolean;
};

// ─── POS action rail ────────────────────────────────────────────────────────
// The narrow vertical button rail pinned to the far-right edge of the POS screen
// (Rcv / Exp / Help / Ticket / Enquiry). Edit POS_RAIL_ACTIONS to add / remove /
// reorder buttons — same way as the sidebar lists in nav.ts.
//   - kind "action" → runs a wired handler (keyed by `key`; e.g. rcv/exp).
//   - kind "soon"   → placeholder that toasts "<label> — coming soon".
//   - `divider: true` draws a separator line above that button.
//   - `can` hides the button unless that access flag is true.

/** Access-flag keys a rail button can be gated by. */
export type PosRailAccessKey = "canRcv" | "canExp";

export type PosRailAction = {
    /** Stable id — for "action" buttons this also picks the handler. */
    key: string;
    label: string;
    icon: LucideIcon;
    kind: "action" | "soon";
    title?: string;
    /** Draw a separator line above this button. */
    divider?: boolean;
    /** Hide the button unless this access flag is true. */
    can?: PosRailAccessKey;
    /** Pastel hue for the icon + label + hover (same palette as the header). */
    tint?: "emerald" | "amber" | "indigo" | "sky" | "violet" | "rose" | "cyan" | "teal";
};

// ⇩ Edit this list to add / remove / reorder POS rail buttons.
export const POS_RAIL_ACTIONS: PosRailAction[] = [
    { key: "rcv", label: "Rcv", icon: HandCoins, kind: "action", can: "canRcv", tint: "emerald", title: "Collect a payment from a customer into this counter's till — posts a receipt voucher" },
    { key: "exp", label: "Exp", icon: Wallet, kind: "action", can: "canExp", tint: "rose", title: "Record a counter expenditure (tea, sundry…) — posts a payment voucher from the counter's till" },

    { key: "chat", label: "Chat", icon: MessageSquare, kind: "action", tint: "indigo", title: "Team chat — inbox rooms, groups and DMs, right from the counter" },
    { key: "ticket", label: "Ticket", icon: TicketPlus, kind: "action", tint: "indigo", title: "Create a repair ticket for a customer" },
    { key: "enquiry", label: "Enquiry", icon: MessageCircleQuestion, kind: "action", tint: "sky", title: "Log a customer help / enquiry ticket (price, availability, warranty…)" },
    { key: "task", label: "Task", icon: SquareCheckBig, kind: "action", tint: "violet", title: "Add an internal work item to the board" },
    { key: "deal", label: "Deal", icon: Handshake, kind: "action", tint: "cyan", title: "Create a sales deal on the CRM pipeline — log the opportunity at the counter" },
    { key: "lead", label: "Lead", icon: UserRoundPlus, kind: "action", tint: "teal", title: "Capture a new lead — create a contact (person) on the fly" },
    // Same dialog as the office sidebar's Workspace → SL Search; on the POS its
    // links open in a new tab so the cashier never leaves a bill half made.
    { key: "sl-search", label: "SL Search", icon: ScanSearch, kind: "action", tint: "amber", title: "Find a sale or ticket from the SL no on the unit — no bill, name or phone needed" },

    // "?" — counter help, PINNED to the very bottom of the rail (PosActionRail
    // renders this key separately, below the other buttons). Opens the POS help
    // page in a new tab (same as F1).
    { key: "help", label: "Help", icon: HelpCircle, kind: "action", divider: true, tint: "sky", title: "Counter help & keyboard shortcuts (F1) — opens in a new tab" },

];

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
    // "More +" opens the all-create-actions dialog. Gated like any create action
    // (own permission → tick in the role's Quick Actions), rendered first.
    { label: "New Deal +", subtitle: "Add a deal to the pipeline", icon: Handshake, module: "crm", variant: "outline", action: "new-deal", permission: "deals:create" },
    { label: "New Task +", subtitle: "Add an internal work item", icon: SquareCheckBig, module: "crm", variant: "outline", action: "new-task", permission: "tasks:create" },
    {
        label: "Repair +", subtitle: "Open repair intake", icon: Wrench, module: "repair", variant: "default",
        action: "new-ticket",
        pipelineRef: "default",
        permission: "tickets:create",
    },
    { label: "Help Ticket +", subtitle: "Log a front-desk enquiry", icon: LifeBuoy, module: "help", variant: "default", action: "new-help-ticket", permission: "help:create" },
    { label: "POS +", subtitle: "New POS bill", icon: ScanBarcode, module: "pos", variant: "default", href: "/vouchers/pos/new", permission: "pos:shift:open" },

    { label: "Sale +", subtitle: "New Sale Invoice", icon: Receipt, module: "accountancy", variant: "default", action: "new-sale" },
    { label: "Purchase +", subtitle: "New Purchase Invoice", icon: ShoppingCart, module: "accountancy", variant: "outline", action: "new-purchase" },
    { label: "Sale Return +", subtitle: "Customer returns goods (Credit Note)", icon: RotateCcw, module: "accountancy", variant: "outline", action: "new-sale-return" },
    { label: "Purchase Return +", subtitle: "Return goods to supplier (Debit Note)", icon: RotateCw, module: "accountancy", variant: "outline", action: "new-purchase-return" },
    { label: "Estimate +", subtitle: "New estimate", icon: ScrollText, module: "accountancy", variant: "outline", action: "new-estimate" },
    { label: "Payment +", subtitle: "New payment voucher", icon: ArrowUpFromLine, module: "accountancy", variant: "outline", action: "new-payment", permission: "finance:voucher:create" },
    { label: "Receipt +", subtitle: "New receipt voucher", icon: ArrowDownToLine, module: "accountancy", variant: "outline", action: "new-receipt", permission: "finance:voucher:create" },
    { label: "Contra +", subtitle: "New contra voucher", icon: ArrowRightLeft, module: "accountancy", variant: "outline", action: "new-contra", permission: "finance:voucher:create" },
    { label: "Credit Note +", subtitle: "New credit note", icon: FileMinus, module: "accountancy", variant: "outline", action: "new-credit-note", permission: "finance:voucher:create" },
    { label: "Debit Note +", subtitle: "New debit note", icon: FilePlus, module: "accountancy", variant: "outline", action: "new-debit-note", permission: "finance:voucher:create" },
    { label: "Journal +", subtitle: "New journal voucher", icon: NotebookPen, module: "accountancy", variant: "outline", action: "new-journal-voucher", permission: "finance:voucher:create" },
    { label: "Sales Order +", subtitle: "New sales order", icon: FileCheck2, module: "orders", variant: "outline", action: "new-sales-order" },
    { label: "Purchase Order +", subtitle: "New purchase order", icon: FileInput, module: "orders", variant: "outline", action: "new-purchase-order" },
    { label: "GRN +", subtitle: "New goods receipt", icon: PackageCheck, module: "inventory", variant: "outline", action: "new-grn" },
    { label: "Challan +", subtitle: "New challan", icon: Truck, module: "inventory", variant: "outline", action: "new-challan" },
    { label: "Manufacturing Journal +", subtitle: "New manufacturing journal", icon: Factory, module: "inventory", variant: "outline", action: "new-manufacturing-journal" },
    { label: "Physical Stock +", subtitle: "New physical stock", icon: ClipboardCheck, module: "inventory", variant: "outline", action: "new-physical-stock" },
    { label: "Branch Transfer +", subtitle: "Move stock between locations", icon: ArrowLeftRight, module: "inventory", variant: "outline", action: "new-branch-transfer" },
    { label: "Rejection In +", subtitle: "New rejection in", icon: PackageX, module: "inventory", variant: "outline", action: "new-rejection-in" },
    { label: "Rejection Out +", subtitle: "New rejection out", icon: PackageX, module: "inventory", variant: "outline", action: "new-rejection-out" },

    // Links from other modules — folded in so the bar is one complete, always-on set.
    { label: "Person +", subtitle: "Create a new person", icon: Users, module: "customers", variant: "outline", action: "new-person", permission: "customers:create" },
    { label: "Companies +", subtitle: "Create a new company", icon: Building2, module: "customers", variant: "outline", action: "new-company", permission: "customers:create" },


    { label: "More +", subtitle: "All create actions", icon: Ellipsis, module: "administration", variant: "outline", action: "more", permission: "quick-actions:more" },


];
